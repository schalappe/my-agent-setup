import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCases, prepareCase, scoreCase, validateCase, type EvalCase } from "./eval";
import { patchHeader } from "./trace";

const PATCH = "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n";
const base = { id: "c", reviewer: "correctness", intent: "Fix a", files: { "a.ts": PATCH } } as const;
const finding = (severity: string, extra: Partial<{ file: string; title: string; why: string; pre_existing: boolean }> = {}) => ({
  severity, file: "a.ts", line: 1, title: "Swallowed error", why: "The empty catch hides write failures.", fix: "rethrow", trigger: "disk full", pre_existing: false, ...extra,
});

test("validateCase accepts a well-formed case and refuses each malformed field", () => {
  const ok = { ...base, kind: "must_catch", expect: { file: "a.ts", min_severity: "minor", match: "catch" } };
  expect(validateCase(ok, "ok.json")).toEqual(ok as unknown as EvalCase);
  const bad: [unknown, string][] = [
    [[], "not a JSON object"],
    [{ ...ok, extra: 1 }, "unknown key(s) extra"],
    [{ ...ok, id: "Bad Id" }, "id must be kebab-case"],
    [{ ...ok, kind: "maybe" }, "kind must be"],
    [{ ...ok, reviewer: "style" }, "reviewer must be"],
    [{ ...ok, intent: " " }, "intent must be"],
    [{ ...ok, files: {} }, "files must map"],
    [{ ...ok, files: { "../x.ts": PATCH } }, "bad path"],
    [{ ...ok, files: { "/etc/x": PATCH } }, "bad path"],
    [{ ...ok, files: { "a.ts": "" } }, "a.ts: patch must be"],
    [{ ...ok, expect: { file: "b.ts" } }, "expect.file must be one of files"],
    // A number would pass Object.hasOwn against a file named "1" but never equal a finding's string file.
    [{ ...ok, files: { "1": PATCH }, expect: { file: 1 } }, "expect.file must be one of files"],
    [{ ...ok, files: { "a.ts": PATCH, "A.ts": PATCH } }, "files must not hold two paths that collide on case or Unicode normalization"],
    [{ ...ok, files: { "CAF\u00c9.ts": PATCH, "cafe\u0301.ts": PATCH } }, "files must not hold two paths that collide on case or Unicode normalization"],
    [{ ...ok, expect: { min_severity: "nit" } }, "expect.min_severity"],
    [{ ...ok, expect: { match: "(" } }, "expect.match:"],
    [{ ...ok, expect: { severity: "major" } }, "unknown expect key(s) severity"],
    [{ ...ok, kind: "must_stay_clean" }, "must_stay_clean takes only expect.match"],
  ];
  for (const [value, problem] of bad) expect(() => validateCase(value, "bad.json")).toThrow(`bad.json: ${problem}`);
});

test("scoreCase must_catch: severity threshold, file, regex, and pre-existing findings ignored", () => {
  const evalCase = validateCase({ ...base, kind: "must_catch", expect: { file: "a.ts", match: "swallow" } }, "c");
  expect(scoreCase(evalCase, [finding("major")])).toEqual({ pass: true, reason: "caught: major a.ts: Swallowed error" });
  expect(scoreCase(evalCase, [finding("critical")]).pass).toBe(true);
  // Default threshold is major: a minor catch is a miss.
  expect(scoreCase(evalCase, [finding("minor")])).toEqual({ pass: false, reason: "missed: 1 finding(s), none major+ in a.ts matching /swallow/i" });
  expect(scoreCase(evalCase, [finding("major", { pre_existing: true })]).pass).toBe(false);
  expect(scoreCase(evalCase, [finding("major", { file: "b.ts" })]).pass).toBe(false);
  expect(scoreCase(evalCase, [finding("major", { title: "Off by one", why: "Loop ends early." })]).pass).toBe(false);
  // The regex reads title and why, case-insensitively.
  expect(scoreCase(evalCase, [finding("major", { title: "Lost write", why: "SWALLOWS the error." })]).pass).toBe(true);
  const minor = validateCase({ ...base, kind: "must_catch", expect: { min_severity: "minor" } }, "c");
  expect(scoreCase(minor, [finding("minor")]).pass).toBe(true);
  expect(scoreCase(minor, [finding("nit")]).pass).toBe(false);
  expect(scoreCase(minor, []).pass).toBe(false);
});

test("scoreCase must_stay_clean: blocks on critical/major or a matching finding, ignores pre-existing", () => {
  const clean = validateCase({ ...base, kind: "must_stay_clean" }, "c");
  expect(scoreCase(clean, [])).toEqual({ pass: true, reason: "clean: 0 minor/nit finding(s)" });
  expect(scoreCase(clean, [finding("minor"), finding("nit")])).toEqual({ pass: true, reason: "clean: 2 minor/nit finding(s)" });
  expect(scoreCase(clean, [finding("critical", { pre_existing: true })]).pass).toBe(true);
  expect(scoreCase(clean, [finding("major")])).toEqual({ pass: false, reason: "noise: major a.ts: Swallowed error" });
  const guarded = validateCase({ ...base, kind: "must_stay_clean", expect: { match: "missing test" } }, "c");
  expect(scoreCase(guarded, [finding("nit", { title: "Missing test for helper" })]).pass).toBe(false);
  expect(scoreCase(guarded, [finding("nit")]).pass).toBe(true);
});

test("the starter cases load and build the real reviewer prompts", () => {
  const cases = loadCases(join(import.meta.dir, "evals"));
  expect(cases.map((evalCase) => evalCase.id)).toEqual(["cheapest-road-to-green", "clean-refactor-with-guide", "sql-injection-boundary"]);
  for (const evalCase of cases) {
    const root = mkdtempSync(`${tmpdir()}/review-eval-test-`);
    try {
      const { prompt, bundle, patches } = prepareCase(evalCase, root);
      const paths = Object.keys(evalCase.files);
      expect(prompt.startsWith(evalCase.reviewer === "security" ? "Review your slice of this pull request diff for security defects only." : "Review your slice of this pull request diff against its stated intent.")).toBe(true);
      expect(prompt).toContain(`<slice>\nbundle: ${bundle} (every patch below, in one file)\n${patches.join("\n")}\n</slice>`);
      expect(prompt.includes("</intent>\n<review_guide>\n")).toBe(evalCase.review_guide !== undefined);
      const bundleText = readFileSync(bundle, "utf8");
      for (const [i, path] of paths.entries()) {
        expect(existsSync(patches[i])).toBe(true);
        expect(bundleText).toContain(`${patchHeader(path)}\n${evalCase.files[path]}`);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("eval.ts --dry-run builds every starter case without calling the peer, and refuses an unknown id", async () => {
  const run = (...args: string[]) => Bun.spawnSync(["bun", join(import.meta.dir, "eval.ts"), ...args]);
  const dry = run("--dry-run");
  expect(dry.exitCode).toBe(0);
  expect(dry.stdout.toString().trim().split("\n").filter((line) => line.includes("\tbuilt\t"))).toHaveLength(3);
  const unknown = run("--dry-run", "no-such-case");
  expect(unknown.exitCode).toBe(2);
  expect(unknown.stderr.toString()).toContain("unknown case id(s) no-such-case");
  expect(run("--bogus").exitCode).toBe(2);
});
