import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { baseRunRan, describeDiff, diffSize, pairKey, repeatsEarlier, securityChecklist } from "./gate";

test("diffSize counts hand-written lines and skips generated and binary files", () => {
  const numstat = "10\t2\tsrc/a.ts\n300\t280\tbun.lock\n-\t-\tlogo.png\n5\t0\tdocs/with\ttab.md\n";
  expect(diffSize(numstat, new Set(["bun.lock"]))).toEqual({ added: 15, removed: 2 });
  expect(diffSize("")).toEqual({ added: 0, removed: 0 });
});

test("describeDiff shows the change since the first round", () => {
  expect(describeDiff({ added: 40, removed: 10 }, undefined)).toBe("+40/-10");
  expect(describeDiff({ added: 90, removed: 10 }, { added: 40, removed: 10 })).toBe("+90/-10 (+50 lines since the first round)");
  expect(describeDiff({ added: 30, removed: 5 }, { added: 40, removed: 10 })).toBe("+30/-5 (-15 lines since the first round)");
});

test("baseRunRan rejects a base run that stopped before the check ran", () => {
  const prRun = { command: "gates", cwd: "/wt", head: "31f9dd8e73", tree: "t", pid: 1, exit: 1, seconds: 619, log: "16.log" };
  const unrun = { command: "gates", cwd: "/wt/base", head: "2993a0c914", base: true, pid: 2, exit: 1, seconds: 0, log: "17.log" };
  expect(baseRunRan(prRun, unrun)).toBe(false);
  expect(baseRunRan(prRun, { ...unrun, seconds: 580 })).toBe(true);
  expect(baseRunRan(prRun, { ...unrun, seconds: undefined })).toBe(false);
});

test("repeatsEarlier reads kept judgments and never asks the judge for a pair it cannot repeat", async () => {
  const dir = mkdtempSync(`${tmpdir()}/same-defect-`);
  const latest = { file: "src/a.ts", line: 12, title: "Retry loses the write", why: "the catch drops the row" };
  const sameFile = { finding: { file: "src/a.ts", line: 9, title: "Write lost on retry", why: "catch swallows it" }, round: "1", rejected: false };
  const otherFile = { finding: { file: "src/b.ts", line: 3, title: "Retry loses the write", why: "same pattern" }, round: "1", rejected: false };
  // A pair in another file that the fixer did not reject is a new instance: no judge run, no repeat.
  expect(await repeatsEarlier(dir, [latest], [otherFile])).toEqual([]);
  // A kept judgment decides without a peer run, so the verdict over the same rounds never changes.
  writeFileSync(`${dir}/same-defect.json`, JSON.stringify({ [pairKey(latest, sameFile.finding)]: { same: true, reason: "both drop the row" } }));
  expect(await repeatsEarlier(dir, [{ ...latest, line: 40 }], [sameFile])).toEqual([
    { latest: { ...latest, line: 40 }, earlier: sameFile.finding, round: "1", reason: "both drop the row" },
  ]);
});

test("securityChecklist reads only the checkbox bullets under the Verification heading", () => {
  const markdown = "# Skill\n\n- [ ] not this one\n\n## Verification\n\nA build-time sentence.\n\n- [ ] First check.\n- plain bullet\n- [ ] Second check.\n\n## Later\n\n- [ ] not this either\n";
  expect(securityChecklist(markdown)).toEqual(["- First check.", "- Second check."]);
  expect(securityChecklist("## Verification\n- [ ] Last section check.")).toEqual(["- Last section check."]);
});

test("securityChecklist throws rather than return an empty checklist", () => {
  expect(() => securityChecklist("# Skill\n\n- [ ] orphan check\n")).toThrow("no `## Verification` heading");
  expect(() => securityChecklist("## Verification\n\nOnly prose.\n\n## Next\n- [ ] elsewhere\n")).toThrow("no `- [ ] ` bullet");
});

test("the hardening skill keeps a checklist the security reviewer can read", () => {
  const checks = securityChecklist(readFileSync(new URL("../hardening/SKILL.md", import.meta.url), "utf8"));
  expect(checks.length).toBeGreaterThan(0);
});
