import { expect, test } from "bun:test";
import { describeDiff, diffSize } from "./gate";

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
