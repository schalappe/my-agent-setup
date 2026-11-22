import { expect, test } from "bun:test";
import { openedBundle, openedFile, printedText, readTrace } from "./trace";

const codexRun = (...commands: string[]) => codexRunWithOutput(...commands.map((command) => [command, ""] as [string, string]));
const codexRunWithOutput = (...commands: [string, string][]) =>
  [
    ...commands.map(([command, aggregated_output]) =>
      JSON.stringify({ type: "item.completed", item: { type: "command_execution", command, exit_code: 0, aggregated_output } }),
    ),
    JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: '{"findings": []}' } }),
    JSON.stringify({ type: "turn.completed" }),
  ].join("\n");

test("a cat over a glob opens every patch it matches, within one folder", () => {
  const { opened } = readTrace(codexRun("/bin/zsh -lc 'cat /r/round-1/patches/*.patch'"));
  expect(openedFile(opened, "/r/round-1/patches/AGENTS.md.patch")).toBe(true);
  expect(openedFile(opened, "/r/round-1/patches/sub/x.patch")).toBe(false);
  expect(openedFile(opened, "/r/round-1/other/AGENTS.md.patch")).toBe(false);
});

test("a repo-relative glob opens the repo-relative paths it matches", () => {
  const { opened } = readTrace(codexRun("/bin/zsh -lc 'cat src/*.ts'"));
  expect(openedFile(opened, "src/a.ts")).toBe(true);
  expect(openedFile(opened, "src/b.tsx")).toBe(false);
});

test("a plain path still opens itself, absolute or repo-relative", () => {
  const { opened } = readTrace(codexRun("/bin/zsh -lc 'cat AGENTS.md; sed -n 1,20p /wt/src/a.ts'"));
  expect(openedFile(opened, "AGENTS.md")).toBe(true);
  expect(openedFile(opened, "src/a.ts")).toBe(true);
  expect(openedFile(opened, "README.md")).toBe(false);
});

test("a patch printed whole by any command counts, a partial print does not", () => {
  const patch = "diff --git a/AGENTS.md b/AGENTS.md\n+line\n";
  const loop = JSON.stringify({
    type: "item.completed",
    item: { type: "command_execution", command: "/bin/zsh -lc 'for f in p/*.patch; do cat \"$f\"; done'", exit_code: 0, aggregated_output: `x\n${patch}y` },
  });
  const failed = JSON.stringify({
    type: "item.completed",
    item: { type: "command_execution", command: "cat q", exit_code: 1, aggregated_output: "diff --git a/README.md" },
  });
  const { printed } = readTrace([loop, failed, JSON.stringify({ type: "turn.completed" })].join("\n"));
  expect(printedText(printed, patch)).toBe(true);
  expect(printedText(printed, `${patch}+more\n`)).toBe(false);
  expect(printedText(printed, "diff --git a/README.md")).toBe(false);
  expect(printedText(printed, "")).toBe(false);
});

const t3Command = (position: number, command: string, output = "", status = "completed") => ({
  position,
  type: "command_execution",
  status,
  text: `$ ${command}${output ? `\n${output}` : ""}`,
});
const t3Answer = (position: number, text = '{"findings": []}') => ({
  position,
  type: "assistant_message",
  status: "completed",
  text,
});
const t3Page = (items: unknown[], status = "completed", providerInstanceId = "codex") => ({
  thread: { providerInstanceId, status },
  items,
});

test("a single pretty-printed T3 activity dump reads its commands, answer, and engine", () => {
  const dump = JSON.stringify(
    t3Page([t3Command(1, "/bin/zsh -lc 'cat /r/patches/*.patch; cat AGENTS.md'"), t3Answer(2)], "completed", "claudeAgent"),
    null,
    2,
  );
  const trace = readTrace(dump);
  expect(trace.engine).toBe("claude");
  expect(openedFile(trace.opened, "/r/patches/a.patch")).toBe(true);
  expect(openedFile(trace.opened, "AGENTS.md")).toBe(true);
  expect(openedFile(trace.opened, "README.md")).toBe(false);
  expect(trace.output).toEqual({ findings: [] });
  expect(trace.toolCalls).toBe(1);
  expect(trace.isError).toBe(false);
});

test("a multi-page T3 dump merges items in order, deduplicating repeated positions", () => {
  const jsonl = [
    JSON.stringify(t3Page([t3Command(1, "/bin/zsh -lc 'cat a.ts'"), t3Command(2, "/bin/zsh -lc 'cat b.ts'")], "running")),
    JSON.stringify(t3Page([t3Command(2, "/bin/zsh -lc 'cat b.ts'"), t3Answer(3, "first"), t3Answer(4)])),
  ].join("\n");
  const trace = readTrace(jsonl);
  expect(trace.engine).toBe("codex");
  expect(trace.opened).toEqual(["a.ts", "b.ts"]);
  expect(trace.toolCalls).toBe(2);
  expect(trace.output).toEqual({ findings: [] });
  expect(trace.isError).toBe(false);
});

test("a T3 command's output counts as printed text, a failed command's neither opens nor prints", () => {
  const patch = "diff --git a/AGENTS.md b/AGENTS.md\n+line\n";
  const trace = readTrace(
    JSON.stringify(
      t3Page([
        t3Command(1, "/bin/zsh -lc 'cat /p/x.patch'", patch),
        t3Command(2, "/bin/zsh -lc 'cat /p/y.patch'", "diff --git a/y b/y\n", "failed"),
        t3Answer(3),
      ]),
    ),
  );
  expect(printedText(trace.printed, patch)).toBe(true);
  expect(printedText(trace.printed, "diff --git a/y b/y\n")).toBe(false);
  expect(openedFile(trace.opened, "/p/x.patch")).toBe(true);
  expect(openedFile(trace.opened, "/p/y.patch")).toBe(false);
  expect(trace.toolCalls).toBe(2);
});

test("a T3 thread whose last page is not completed is an error", () => {
  const jsonl = [JSON.stringify(t3Page([t3Answer(1)])), JSON.stringify(t3Page([], "failed"))].join("\n");
  expect(readTrace(jsonl).isError).toBe(true);
});

const bundle = "/r/round-1/slice-A.patch";
const slicePaths = ["a.py", "b.py"];
const bundleText = "=== PATCH: a.py ===\ndiff --git a/a.py b/a.py\n+x\n=== PATCH: b.py ===\ndiff --git a/b.py b/b.py\n+y\n";

test("only a whole cat of the bundle's exact absolute path reads the slice bundle", () => {
  const reads = (command: string) =>
    openedBundle(readTrace(codexRunWithOutput([`/bin/zsh -lc '${command}'`, bundleText])).fullReads, bundle, slicePaths);
  expect(reads("cat /r/round-1/slice-A.patch")).toBe(true);
  expect(reads("cd /elsewhere && cat -n /r/round-1/slice-A.patch")).toBe(true);
  expect(reads("head -n 1 /r/round-1/slice-A.patch")).toBe(false);
  expect(reads("sed -n 1p /r/round-1/slice-A.patch")).toBe(false);
  expect(reads("cat /r/round-1/slice-A.patch | head -n 1")).toBe(false);
  expect(reads("cat /r/round-1/slice-A.patch > /tmp/copy")).toBe(false);
  expect(reads("cd /other/round && cat ./slice-A.patch")).toBe(false);
  expect(reads("cd /r/round-1 && cat slice-A.patch")).toBe(false);
  expect(reads("cat /r/round-1/slice-*.patch")).toBe(false);
  expect(reads("cat /r/round-1/slice-sec-A.patch")).toBe(false);
  expect(reads("cat /r/round-1/slice-B.patch")).toBe(false);
  expect(reads("cat /r/round-2/slice-A.patch")).toBe(false);
  expect(reads("rg TODO /r/round-1/slice-A.patch")).toBe(false);
});

test("a bundle cat counts only when its output holds every patch header of the slice", () => {
  const reads = (command: string, output: string) =>
    openedBundle(readTrace(codexRunWithOutput([`/bin/zsh -lc '${command}'`, output])).fullReads, bundle, slicePaths);
  expect(reads(`cat ${bundle}`, bundleText)).toBe(true);
  expect(reads(`true || cat ${bundle}`, "")).toBe(false);
  expect(reads(`cat ${bundle}`, bundleText.slice(0, bundleText.indexOf("=== PATCH: b.py ===")))).toBe(false);
  const failed = [
    JSON.stringify({ type: "item.completed", item: { type: "command_execution", command: `cat ${bundle}`, exit_code: 1, aggregated_output: bundleText } }),
    JSON.stringify({ type: "turn.completed" }),
  ].join("\n");
  expect(openedBundle(readTrace(failed).fullReads, bundle, slicePaths)).toBe(false);
  const t3 = (status: string) =>
    readTrace(JSON.stringify(t3Page([t3Command(1, `cat ${bundle}`, bundleText, status), t3Answer(2)]))).fullReads;
  expect(openedBundle(t3("completed"), bundle, slicePaths)).toBe(true);
  expect(openedBundle(t3("failed"), bundle, slicePaths)).toBe(false);
});

test("a claude Read prints the bundle whole only without offset or limit and with a full, successful result", () => {
  const numbered = bundleText.split("\n").map((line, index) => `${String(index + 1).padStart(6)}\t${line}`).join("\n");
  const trace = (input: Record<string, unknown>, result?: Record<string, unknown>) =>
    readTrace(
      [
        JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Read", input }] } }),
        ...(result ? [JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", ...result }] } })] : []),
        JSON.stringify({ type: "result", result: "", structured_output: { findings: [] } }),
      ].join("\n"),
    );
  const read = (input: Record<string, unknown>, result?: Record<string, unknown>) =>
    openedBundle(trace(input, result).fullReads, bundle, slicePaths);
  expect(read({ file_path: bundle }, { content: numbered })).toBe(true);
  expect(read({ file_path: bundle }, { content: [{ type: "text", text: numbered }] })).toBe(true);
  expect(read({ file_path: bundle, limit: 1 }, { content: numbered })).toBe(false);
  expect(read({ file_path: bundle, offset: 5 }, { content: numbered })).toBe(false);
  expect(read({ file_path: bundle }, { content: numbered, is_error: true })).toBe(false);
  expect(read({ file_path: bundle }, { content: "File does not exist.", is_error: true })).toBe(false);
  expect(read({ file_path: bundle }, { content: numbered.slice(0, numbered.indexOf("=== PATCH: b.py ===")) })).toBe(false);
  expect(read({ file_path: bundle })).toBe(false);
});
