#!/usr/bin/env bun
// Runs one headless GPT-6.2 Sol agent through `codex exec`, with its own CLI and login and no proxy. The roles are
// fixed: Claude Opus 5.5 writes all code and fixes, GPT-6.2 Sol verifies, reviews, critiques plans, and judges whether
// two findings are the same defect, so the checks never share the writer's blind spots. The peer never depends on
// which harness or session runs the skill.
//
//   bun peer.ts --check
//       runs the peer once on a one-line prompt; prints `codex gpt-6.2-sol` and exits 0, or says what failed and exits 1.
//   bun peer.ts --access read|shell|full --trace FILE [--schema FILE] [--add-dir DIR]... < prompt > answer.json
//       one run from the current directory. FILE receives the raw JSONL trace (the evidence trace.ts and the review
//       gate read). Stdout gets {engine, model, is_error, result, structured_output, opened, tool_calls}.
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
export const PEER = { engine: "codex" as Engine, model: "gpt-6.2-sol" };

type Options = { check: boolean; access?: Access; trace?: string; schema?: string; addDirs: string[] };

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
    else if (flag === "--access") options.access = value() as Access;
    else if (flag === "--trace") options.trace = value();
    else if (flag === "--schema") options.schema = value();
    else if (flag === "--add-dir") options.addDirs.push(value());
    else throw new Error(`unknown argument ${flag}`);
  }
  if (!options.check) {
    if (!["read", "shell", "full"].includes(options.access ?? "")) throw new Error("--access must be read, shell, or full");
    if (!options.trace) throw new Error("--trace FILE is required");
  }
  return options;
}

function command(access: Access, schemaPath?: string): string[] {
  return [
    "codex", "exec", "-m", PEER.model, "--json", "--ephemeral", "--skip-git-repo-check",
    ...(access === "read" ? ["-s", "read-only"] : ["--dangerously-bypass-approvals-and-sandbox"]),
    ...(schemaPath ? ["--output-schema", schemaPath] : []),
    "-",
  ];
}

// One run from the current directory; the raw trace goes to traceFile.
export async function runPeer(access: Access, prompt: string, traceFile: string, schemaPath?: string): Promise<{ exit: number; trace: Trace }> {
  // A Bun.file stdout writes from the start without truncating, so a rerun would leave the tail of the previous
  // run's trace behind, and its reads and answer would count as this run's.
  await rm(traceFile, { force: true });
  const child = Bun.spawn(command(access, schemaPath), { stdin: new Blob([prompt]), stdout: Bun.file(traceFile), stderr: "inherit" });
  const exit = await child.exited;
  return { exit, trace: readTrace(await Bun.file(traceFile).text()) };
}

// A real one-line run through the same launch path as a review: the CLI's own status command can report a login whose
// token no longer refreshes, and a sandboxed Codex thread blocks the peer's network only when it runs.
async function check(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "peer-check-"));
  try {
    const { exit, trace } = await runPeer("read", "Reply with the word ok.", join(dir, "trace.jsonl"));
    if (exit !== 0 || trace.isError) {
      const sandbox = process.env.CODEX_SANDBOX ? "; this Codex thread runs in a sandbox: run it in full access" : "";
      throw new Error(`${PEER.engine} ${PEER.model} failed its check run (exit ${exit}): ${trace.text || "no answer"}${sandbox}`);
    }
    console.log(`${PEER.engine} ${PEER.model}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.check) await check();
    else {
      const prompt = await Bun.stdin.text();
      const { exit, trace } = await runPeer(options.access!, prompt, options.trace!, options.schema);
      console.log(
        JSON.stringify({
          ...PEER,
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
