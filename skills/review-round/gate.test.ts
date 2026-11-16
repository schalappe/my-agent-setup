import { expect, test } from "bun:test";
import { baseRunRan, describeDiff, diffSize } from "./gate";

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
  // Real records from PR #1123, round 0: the base run exited 1 in 0 s with "slot.sh: no slot held".
  const prRun = { command: "gates", cwd: "/wt", head: "31f9dd8e73", tree: "t", pid: 1, exit: 1, seconds: 619, log: "16.log" };
  const unrun = { command: "gates", cwd: "/wt/base", head: "2993a0c914", base: true, pid: 2, exit: 1, seconds: 0, log: "17.log" };
  expect(baseRunRan(prRun, unrun)).toBe(false);
  expect(baseRunRan(prRun, { ...unrun, seconds: 580 })).toBe(true);
  expect(baseRunRan(prRun, { ...unrun, seconds: undefined })).toBe(false);
});
