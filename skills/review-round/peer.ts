#!/usr/bin/env bun
// Runs one headless Codex peer agent through `codex exec`, with its own CLI and login and no proxy. The roles are
// fixed: Claude Opus 5.5 writes all code and fixes; GPT-6.2 Astra (high) reviews, critiques plans, and judges whether
// two findings are the same defect; GPT-6.2 Sol (medium) verifies, so checks never share the writer's blind spots. The
// peer never depends on which harness or session runs the skill.
//
//   bun peer.ts --check [--model MODEL]
//       runs the peer once on a one-line prompt; prints `codex <model>` and exits 0, or says what failed and exits 1.
//   bun peer.ts --access read|shell|full --trace FILE [--model MODEL] [--effort LEVEL] [--schema FILE] [--add-dir DIR]... < prompt > answer.json
//       one run from the current directory (defaults: gpt-6.2-astra, effort high). FILE receives the raw JSONL trace
//       (the evidence trace.ts and the review gate read). Stdout gets {engine, model, is_error, result,
//       structured_output, opened, tool_calls}.
//
// Access: read = read-only sandbox (file reads and read-only commands); shell and full = no sandbox and no prompts
// (the verifier: gates, Docker, and browsers write caches outside the worktree). codex reads anywhere in its read-only
// sandbox, so --add-dir is accepted for the callers' symmetry but not needed. The engine enforces a schema; the caller
// still validates the answer.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Engine, readTrace, type Trace } from "./trace";

export type Access = "read" | "shell" | "full";
export type Effort = "low" | "medium" | "high" | "xhigh" | "max" | "ultra";
export type PeerOptions = { model?: string; effort?: Effort };

const EFFORTS: readonly Effort[] = ["low", "medium", "high", "xhigh", "max", "ultra"];
export const REVIEW_PEER = { engine: "codex" as Engine, model: "gpt-6.2-astra", effort: "high" as Effort };
export const VERIFY_PEER = { engine: "codex" as Engine, model: "gpt-6.2-sol", effort: "medium" as Effort };

type Options = { check: boolean; access?: Access; trace?: string; model: string; effort: Effort; schema?: string; addDirs: string[] };

function parseArgs(argv: string[]): Options {
  const options: Options = { check: false, model: REVIEW_PEER.model, effort: REVIEW_PEER.effort, addDirs: [] };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined) throw new Error(`${flag} needs a value`);
      return next;
    };
    if (flag === "--check") options.check = true;
    else if (flag === "--access") options.access = value() as Access;
    else if (flag === "--trace") options.trace = value();
    else if (flag === "--model") options.model = value();
    else if (flag === "--effort") options.effort = value() as Effort;
    else if (flag === "--schema") options.schema = value();
    else if (flag === "--add-dir") options.addDirs.push(value());
    else throw new Error(`unknown argument ${flag}`);
  }
  if (!EFFORTS.includes(options.effort)) throw new Error(`--effort must be one of ${EFFORTS.join(", ")}`);
  if (!options.check) {
    if (!["read", "shell", "full"].includes(options.access ?? "")) throw new Error("--access must be read, shell, or full");
    if (!options.trace) throw new Error("--trace FILE is required");
  }
  return options;
}

function command(access: Access, model: string, effort: Effort, schemaPath?: string): string[] {
  return [
    "codex", "exec", "-m", model, "-c", `model_reasoning_effort="${effort}"`,
    "--json", "--ephemeral", "--skip-git-repo-check",
    ...(access === "read" ? ["-s", "read-only"] : ["--dangerously-bypass-approvals-and-sandbox"]),
    ...(schemaPath ? ["--output-schema", schemaPath] : []),
    "-",
  ];
}

// One run from cwd (default: the current directory); the raw trace goes to traceFile.
export async function runPeer(
  access: Access,
  prompt: string,
  traceFile: string,
  schemaPath?: string,
  cwd?: string,
  peer: PeerOptions = {},
): Promise<{ exit: number; trace: Trace }> {
  const model = peer.model ?? REVIEW_PEER.model;
  const effort = peer.effort ?? REVIEW_PEER.effort;
  // A Bun.file stdout writes from the start without truncating, so a rerun would leave the tail of the previous
  // run's trace behind, and its reads and answer would count as this run's.
  await rm(traceFile, { force: true });
  const child = Bun.spawn(command(access, model, effort, schemaPath), {
    cwd,
    stdin: new Blob([prompt]),
    stdout: Bun.file(traceFile),
    stderr: "inherit",
  });
  const exit = await child.exited;
  return { exit, trace: readTrace(await Bun.file(traceFile).text()) };
}

// A real one-line run through the same launch path as a review: the CLI's own status command can report a login whose
// token no longer refreshes, and a sandboxed Codex thread blocks the peer's network only when it runs.
async function check(model: string): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "peer-check-"));
  try {
    const { exit, trace } = await runPeer("read", "Reply with the word ok.", join(dir, "trace.jsonl"), undefined, undefined, { model, effort: "low" });
    if (exit !== 0 || trace.isError) {
      const sandbox = process.env.CODEX_SANDBOX ? "; this Codex thread runs in a sandbox: run it in full access" : "";
      throw new Error(`${REVIEW_PEER.engine} ${model} failed its check run (exit ${exit}): ${trace.text || "no answer"}${sandbox}`);
    }
    console.log(`${REVIEW_PEER.engine} ${model}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.check) await check(options.model);
    else {
      const prompt = await Bun.stdin.text();
      const { exit, trace } = await runPeer(options.access!, prompt, options.trace!, options.schema, undefined, {
        model: options.model,
        effort: options.effort,
      });
      console.log(
        JSON.stringify({
          engine: REVIEW_PEER.engine,
          model: options.model,
          is_error: trace.isError || exit !== 0,
          result: trace.text,
          structured_output: options.schema ? trace.output : undefined,
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
}
