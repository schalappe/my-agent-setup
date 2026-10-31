#!/usr/bin/env bun
// Runs one headless agent from the model family that did not write the code, so verification and review do not
// share the writer's blind spots: the writer is Claude → GPT-6.1 Sol; the writer is GPT → Claude Opus 5.5.
// The review-round, branch-review, and implement skills call it from whatever harness runs them (Claude Code, OMP,
// Codex, T3 Code); it only needs a shell and one of three CLIs:
//   claude  `claude -p`. Any model the CLI Proxy set in ~/.claude/settings.json serves; without a proxy, Claude only.
//   omp     `omp -p`, on the providers OMP is logged in to.
//   codex   `codex exec`, GPT only.
// The first engine that can run the model wins, in that order; `--engine` forces one.
//
//   bun peer.ts --writer claude|gpt --check
//       prints `<engine> <model>` and exits 0, or names what is missing for each engine and exits 1.
//   bun peer.ts --writer claude|gpt --access read|shell|full --trace FILE [--schema FILE] [--add-dir DIR]...
//               [--engine claude|omp|codex] < prompt > answer.json
//       one run from the current directory. FILE receives the engine's raw JSONL trace (the evidence trace.ts and
//       the review gate read). Stdout gets {engine, model, is_error, result, structured_output, tool_calls}.
//
// Access: read = file reads and search only; shell = also a shell, without prompts; full = also writes files, without
// prompts or sandbox (the verifier: gates, Docker, and browsers write caches outside the worktree).
// A schema is enforced by claude and codex; omp has no such option, so the schema goes in the prompt and the
// caller (the gate) validates the answer.

import { $ } from "bun";
import { homedir } from "node:os";
import { type Engine, readTrace } from "./trace";

type Family = "claude" | "gpt";
type Access = "read" | "shell" | "full";

// The reviewer's model for each writer family, named as each engine names it. codex runs GPT only.
const PEERS: Record<Family, { label: string; claude: string; omp: string; codex?: string }> = {
  claude: { label: "gpt-6.1-sol", claude: "gpt-6.1-sol", omp: "openai-codex/gpt-6.1-sol", codex: "gpt-6.1-sol" },
  gpt: { label: "claude-opus-5-5", claude: "claude-opus-5-5", omp: "anthropic/claude-opus-5-5" },
};
const ENGINES: Engine[] = ["claude", "omp", "codex"];

type Options = { writer: Family; check: boolean; access?: Access; trace?: string; schema?: string; addDirs: string[]; engine?: Engine };

function parseArgs(argv: string[]): Options {
  const options: Options = { writer: "claude", check: false, addDirs: [] };
  let writer: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined) throw new Error(`${flag} needs a value`);
      return next;
    };
    if (flag === "--check") options.check = true;
    else if (flag === "--writer") writer = value();
    else if (flag === "--access") options.access = value() as Access;
    else if (flag === "--trace") options.trace = value();
    else if (flag === "--schema") options.schema = value();
    else if (flag === "--add-dir") options.addDirs.push(value());
    else if (flag === "--engine") options.engine = value() as Engine;
    else throw new Error(`unknown argument ${flag}`);
  }
  // No default writer: picking the wrong family silently would put the writer's family on its own review.
  if (writer !== "claude" && writer !== "gpt") throw new Error("--writer must be claude or gpt (the family of the model that wrote the code)");
  options.writer = writer;
  if (options.engine && !ENGINES.includes(options.engine)) throw new Error(`--engine must be one of ${ENGINES.join(", ")}`);
  if (!options.check) {
    if (!["read", "shell", "full"].includes(options.access ?? "")) throw new Error("--access must be read, shell, or full");
    if (!options.trace) throw new Error("--trace FILE is required");
  }
  return options;
}

const installed = async (command: string) => (await $`command -v ${command}`.nothrow().quiet()).exitCode === 0;

// Why `engine` cannot run `model`, or undefined when it can.
async function unavailable(engine: Engine, model: string | undefined): Promise<string | undefined> {
  if (!model) return `${engine} does not run this model family`;
  if (!(await installed(engine))) return `${engine} is not installed`;
  if (engine === "claude") return claudeUnavailable(model);
  if (engine === "omp") {
    const listed = await $`omp models ls ${model.split("/")[1]} --json`.nothrow().quiet();
    const selectors = listed.exitCode === 0 ? (listed.json().models ?? []).map((entry: { selector?: string }) => entry.selector) : [];
    return selectors.includes(model) ? undefined : `omp lists no ${model}`;
  }
  return undefined; // codex: GPT models through the user's ChatGPT or API login; a failed login shows in the run
}

// Claude Code applies the `env` of ~/.claude/settings.json over the process environment, so a proxy set there is
// what `claude -p` talks to.
async function claudeUnavailable(model: string): Promise<string | undefined> {
  const settings = Bun.file(`${homedir()}/.claude/settings.json`);
  const env = (await settings.exists()) ? ((await settings.json()).env ?? {}) : {};
  const proxy: unknown = env.ANTHROPIC_BASE_URL;
  if (typeof proxy !== "string") return model.startsWith("claude-") ? undefined : `claude has no CLI Proxy for ${model} (no env.ANTHROPIC_BASE_URL in ~/.claude/settings.json)`;
  try {
    const response = await fetch(`${proxy}/v1/models`, {
      headers: { Authorization: `Bearer ${env.ANTHROPIC_AUTH_TOKEN ?? ""}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return `the CLI Proxy on ${proxy} answers ${response.status}`;
    const { data = [] } = (await response.json()) as { data?: { id?: string }[] };
    return data.some((entry) => entry.id === model) ? undefined : `the CLI Proxy on ${proxy} does not serve ${model}`;
  } catch (error) {
    return `the CLI Proxy does not answer on ${proxy} (${error instanceof Error ? error.message : error})`;
  }
}

async function pickEngine(writer: Family, forced?: Engine): Promise<{ engine: Engine; model: string }> {
  const reasons: string[] = [];
  for (const engine of forced ? [forced] : ENGINES) {
    const model = PEERS[writer][engine];
    const reason = await unavailable(engine, model);
    if (!reason && model) return { engine, model };
    reasons.push(reason ?? `${engine}: unavailable`);
  }
  throw new Error(`no engine can run ${PEERS[writer].label}: ${reasons.join("; ")}`);
}

const SCHEMA_IN_PROMPT = (schema: string) =>
  `\n\nYour final reply must be only a JSON object, with no prose around it and no code fence, that matches this JSON Schema:\n${schema}\n`;

function command(engine: Engine, model: string, options: Options, schemaPath?: string): string[] {
  const { access, addDirs } = options;
  if (engine === "claude") {
    const tools = { read: "Read,Grep,Glob", shell: "Read,Grep,Glob,Bash", full: "Read,Grep,Glob,Bash,Write" }[access!];
    const permissions =
      access === "full" ? ["--dangerously-skip-permissions"] : access === "shell" ? ["--allowedTools", "Bash", "--permission-prompts", "none"] : ["--permission-prompts", "none"];
    return [
      "claude", "-p", "--model", model, "--output-format", "stream-json", "--verbose",
      // Keep MCP servers and skills out of the context: about 26k input tokens instead of 210k.
      "--strict-mcp-config", "--disable-slash-commands", "--no-session-persistence",
      "--tools", tools, ...permissions,
      ...addDirs.flatMap((dir) => ["--add-dir", dir]),
    ];
  }
  if (engine === "omp") {
    const tools = { read: "read,grep,glob", shell: "read,grep,glob,bash", full: "read,grep,glob,bash,write" }[access!];
    return [
      "omp", "-p", "--model", model, "--mode", "json", "--no-session", "--no-skills", "--no-extensions", "--no-title",
      "--tools", tools, ...(access === "read" ? [] : ["--auto-approve"]),
      ...addDirs.flatMap((dir) => ["--add-dir", dir]),
    ];
  }
  // codex reads anywhere in its read-only sandbox, so --add-dir is not needed; shell and full need writes outside it.
  return [
    "codex", "exec", "-m", model, "--json", "--ephemeral", "--skip-git-repo-check",
    ...(access === "read" ? ["-s", "read-only"] : ["--dangerously-bypass-approvals-and-sandbox"]),
    ...(schemaPath ? ["--output-schema", schemaPath] : []),
    "-",
  ];
}

async function run(options: Options): Promise<void> {
  const { engine, model } = await pickEngine(options.writer, options.engine);
  const schema = options.schema ? await Bun.file(options.schema).text() : undefined;
  let prompt = await Bun.stdin.text();
  const args = command(engine, model, options, options.schema);
  if (schema && engine === "claude") args.push("--json-schema", schema);
  if (schema && engine === "omp") prompt += SCHEMA_IN_PROMPT(schema);

  const child = Bun.spawn(args, {
    stdin: new Blob([prompt]),
    stdout: Bun.file(options.trace!),
    stderr: "inherit",
    // Tool search and tool-use concurrency match the setup known to work with Sol through the proxy.
    env: { ...process.env, ENABLE_TOOL_SEARCH: "false", CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY: "3" },
  });
  const exit = await child.exited;
  const trace = readTrace(await Bun.file(options.trace!).text());
  console.log(
    JSON.stringify({
      engine,
      model,
      is_error: trace.isError || exit !== 0,
      result: trace.text,
      structured_output: schema ? trace.output : undefined,
      tool_calls: trace.toolCalls,
    }),
  );
  if (exit !== 0) process.exit(exit);
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.check) {
    const { engine, model } = await pickEngine(options.writer, options.engine);
    console.log(`${engine} ${model}`);
  } else await run(options);
} catch (error) {
  console.error(`peer: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
