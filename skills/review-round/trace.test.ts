import { expect, test } from "bun:test";
import { openedFile, printedText, readTrace } from "./trace";

const codexRun = (...commands: string[]) =>
  [
    ...commands.map((command) =>
      JSON.stringify({ type: "item.completed", item: { type: "command_execution", command, exit_code: 0 } }),
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
