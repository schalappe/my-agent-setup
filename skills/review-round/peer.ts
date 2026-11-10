#!/usr/bin/env bun
// Runs one headless agent from the model family that did not write the code, so verification and review do not
// share the writer's blind spots. Each family runs through its own CLI and login, with no proxy:
//   the writer is Claude → GPT-6.1 Sol through `codex exec`;
//   the writer is GPT    → Claude Opus 5.5 through `claude -p`.
// The writer is the family of the session that runs the skill, since the implementer and fixer subagents run on the
// session's provider: Claude Code sets CLAUDECODE in its shells, Codex sets CODEX_THREAD_ID, and T3 Code runs one of
// the two. `--writer` overrides the detection, for a diff another session wrote.
//
//   bun peer.ts [--writer claude|gpt] --check
//       runs the peer once on a one-line prompt; prints `<engine> <model>` and exits 0, or says what failed and exits 1.
//   bun peer.ts [--writer claude|gpt] --access read|shell|full --trace FILE [--schema FILE] [--add-dir DIR]...
//               < prompt > answer.json
//       one run from the current directory. FILE receives the engine's raw JSONL trace (the evidence trace.ts and
//       the review gate read). Stdout gets {engine, model, is_error, result, structured_output, opened, tool_calls}.
//
// Access: read = file reads and search only; shell = also a shell, without prompts; full = also writes files, without
// prompts or sandbox (the verifier: gates, Docker, and browsers write caches outside the worktree).
// Both engines enforce a schema; the caller still validates the answer.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Engine, readTrace } from "./trace";

type Family = "claude" | "gpt";
type Access = "read" | "shell" | "full";

const PEERS: Record<Family, { engine: Engine; model: string }> = {
  claude: { engine: "codex", model: "gpt-6.1-sol" },
  gpt: { engine: "claude", model: "claude-opus-5-5" },
};

type Options = { writer?: Family; check: boolean; access?: Access; trace?: string; schema?: string; addDirs: string[] };

function parseArgs(argv: string[]): Options {
  const options: Options = { check: false, addDirs: [] };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined) throw new Error(`${flag} needs a value`);
      return next;
    };
    if (flag === "--check") options.check = true;
    else if (flag === "--writer") options.writer = value() as Family;
    else if (flag === "--access") options.access = value() as Access;
    else if (flag === "--trace") options.trace = value();
    else if (flag === "--schema") options.schema = value();
    else if (flag === "--add-dir") options.addDirs.push(value());
    else throw new Error(`unknown argument ${flag}`);
  }
  if (options.writer !== undefined && !(options.writer in PEERS)) throw new Error("--writer must be claude or gpt");
  if (!options.check) {
    if (!["read", "shell", "full"].includes(options.access ?? "")) throw new Error("--access must be read, shell, or full");
    if (!options.trace) throw new Error("--trace FILE is required");
  }
  return options;
}

// No fallback when the session is unclear: a wrong family would put the writer's family on its own review.
function sessionFamily(): Family {
  const inClaude = Boolean(process.env.CLAUDECODE);
  const inCodex = Boolean(process.env.CODEX_THREAD_ID);
  if (inClaude && inCodex) throw new Error("both CLAUDECODE and CODEX_THREAD_ID are set; pass --writer claude|gpt");
  if (inClaude) return "claude";
  if (inCodex) return "gpt";
  throw new Error("not in a Claude Code or Codex session; pass --writer claude|gpt");
}

function command(engine: Engine, model: string, access: Access, addDirs: string[], schema?: { path: string; text: string }): string[] {
  if (engine === "claude") {
    const tools = { read: "Read,Grep,Glob", shell: "Read,Grep,Glob,Bash", full: "Read,Grep,Glob,Bash,Write" }[access];
    const permissions =
      access === "full" ? ["--dangerously-skip-permissions"] : access === "shell" ? ["--allowedTools", "Bash", "--permission-prompts", "none"] : ["--permission-prompts", "none"];
    return [
      "claude", "-p", "--model", model, "--output-format", "stream-json", "--verbose",
      // Keep MCP servers and skills out of the context: about 26k input tokens instead of 210k.
      "--strict-mcp-config", "--disable-slash-commands", "--no-session-persistence",
      "--tools", tools, ...permissions,
      ...addDirs.flatMap((dir) => ["--add-dir", dir]),
      ...(schema ? ["--json-schema", schema.text] : []),
    ];
  }
  // codex reads anywhere in its read-only sandbox, so --add-dir is not needed; shell and full need writes outside it.
  return [
    "codex", "exec", "-m", model, "--json", "--ephemeral", "--skip-git-repo-check",
    ...(access === "read" ? ["-s", "read-only"] : ["--dangerously-bypass-approvals-and-sandbox"]),
    ...(schema ? ["--output-schema", schema.path] : []),
    "-",
  ];
}

async function runPeer(family: Family, access: Access, prompt: string, traceFile: string, addDirs: string[], schemaPath?: string) {
  const { engine, model } = PEERS[family];
  const schema = schemaPath ? { path: schemaPath, text: await Bun.file(schemaPath).text() } : undefined;
  const child = Bun.spawn(command(engine, model, access, addDirs, schema), {
    stdin: new Blob([prompt]),
    stdout: Bun.file(traceFile),
    stderr: "inherit",
  });
  const exit = await child.exited;
  const trace = readTrace(await Bun.file(traceFile).text());
  return { engine, model, exit, trace, schema };
}

// A real one-line run through the same launch path as a review: a CLI's own status command can report a login whose
// token no longer refreshes, and a sandboxed Codex thread blocks the peer's network only when it runs.
async function check(family: Family): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "peer-check-"));
  try {
    const { engine, model, exit, trace } = await runPeer(family, "read", "Reply with the word ok.", join(dir, "trace.jsonl"), []);
    if (exit !== 0 || trace.isError) {
      const sandbox = process.env.CODEX_SANDBOX ? "; this Codex thread runs in a sandbox: run it in full access" : "";
      throw new Error(`${engine} ${model} failed its check run (exit ${exit}): ${trace.text || "no answer"}${sandbox}`);
    }
    console.log(`${engine} ${model}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

try {
  const options = parseArgs(process.argv.slice(2));
  const family = options.writer ?? sessionFamily();
  if (options.check) await check(family);
  else {
    const prompt = await Bun.stdin.text();
    const { engine, model, exit, trace, schema } = await runPeer(family, options.access!, prompt, options.trace!, options.addDirs, options.schema);
    console.log(
      JSON.stringify({
        engine,
        model,
        is_error: trace.isError || exit !== 0,
        result: trace.text,
        structured_output: schema ? trace.output : undefined,
        opened: trace.opened,
        tool_calls: trace.toolCalls,
      }),
    );
    if (exit !== 0) process.exit(exit);
  }
} catch (error) {
  console.error(`peer: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
