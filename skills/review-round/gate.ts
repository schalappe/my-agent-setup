#!/usr/bin/env bun
// Gate for the review-round skill: `bun ~/.agents/skills/review-round/gate.ts [command]`, run from the PR's worktree.
// Every file a verdict depends on is written or judged here, so the skill acts on the gate's output instead of its
// own reading of the state.
//
// State: $(git common dir)/review/<branch>/ ("dir"), shared by every worktree of the repo so it outlives them.
//   round-N.json       written by `record` only; noise.ts and the verdict read it.
//   verify-N.json      written by the verifier (contract in verifier.md) or by `reuse`, never by the skill. The round's
//                      verdict is derived here from it. verify-0.json is the implement skill's final verification,
//                      written before the loop; its exec records, and the files.txt and base of `prepare 0`, live in
//                      round-0/.
//   round-N/           files.txt, patches/, base (`prepare`); review prompts, slice-<S>.txt, slice-<S>.patch (every
//                      patch of the slice in one file), slices (`slice`); review-<S>.json (`reviewed`);
//                      verify-attempt-<A>.json (`attempt`); exec/<k>.json and evidence/exec-<k>.log (`exec`).
//   status, stall.json written by the verdict only; `resume` archives them under stalls/<n>/. stall.json holds either
//                      the repeats or the hotspots behind a stall.
//   stalls/<n>/round   written by `resume`: the latest recorded round when the loop resumed (absent = 0).
//   same-defect.json   the same-defect judgments, {<pair hash>: {same, reason}}, written by the verdict only and
//                      never judged again.
//
// Commands (exit 2 always means a broken gate: bad or missing file, git error, or a failed same-defect
// judge run; the skill stops):
//   (none)          the verdict after a round. Exit 0 = stop, printing `review loop: converged|stalled` and writing
//                   "<status> <tree>" to status; exit 1 = run another round.
//   tree            the working-tree hash (tracked + untracked, ignoring .gitignore'd files) that verify, exec, and
//                   round files are keyed on.
//   round           the next round number (recorded rounds + 1).
//   prepare N --base <ref>   fetches origin/<ref>, then writes round N's diff handoff from the merge-base to the tree
//                   `tree` hashes (untracked files included): files.txt (numstat), one patch per file, and base (the
//                   merge-base sha). Renames are split into a delete and an add, so every path in files.txt has its own
//                   patch.
//   reuse K N       copies verify-K.json, verified on the current tree, to verify-N.json with "reused_from" set to
//                   the round that ran it. Its carried attempts, exec records, and base resolve in that round.
//   brief N         prints the mechanical part of round N's verifier brief on stdout, including the browser-scenario
//                   line when the diff changes UI files, and, on stderr, what the skill judges before appending its
//                   own part (the files changed since the latest green verification and the entries it may carry).
//   exec N [--base] -- <command>   runs <command> through $SHELL from the current directory (with --base, from the
//                   same directory of the base worktree round-N/evidence/base), tees its output to
//                   round-N/evidence/exec-<k>.log, and records round-N/exec/<k>.json. Exits with the command's code.
//   exec N --wait   waits up to WAIT_MINUTES for round N's running exec records, then prints every record. Exit 1 =
//                   some still run.
//   verify N        round N's verification outcome: `green`, `green (known failure on base: <cmd>)`, `red`, or
//                   `blocked: <reason>`. The skill acts on that line instead of judging verify-N.json itself.
//   attempt N       archives verify-N.json as round-N/verify-attempt-<A>.json before the verifier runs again in the
//                   same round, and prints `attempt <A> same-tree|tree-changed`.
//   slice N         splits round N's diff into review slices and writes their prompts (below).
//   reviewed N      judges each reviewer process of round N from its trace and writes review-<S>.json (below).
//   record N [--fix <file>]   writes round-N.json from verify-N.json, the round's review-<S>.json files, and the
//                   fixer's {"fixed": [...], "rejected": [...]}, then prints the `Round N: …` line. Its `diff=+A/-R`
//                   counts the hand-written lines of files.txt, with the change since the loop's first round: review
//                   fixes tend to grow a PR, and the number shows it.
//   ready           whether the PR may leave draft (below).
//   resume          archives a stalled loop's status and stall.json, so the next round runs, and records the latest
//                   round in stalls/<n>/round: the rounds up to it never count toward a hotspot again.
//
// Verification. A check counts only through its exec record: the verifier's own exit code is a self-report, and one
// once read 0 while its log showed 314 failed tests. Every check of verify-N.json that is not carried needs a finished
// exec record of the same command on the verified tree, and the latest such record holds the same exit; otherwise the
// round is blocked. A failing check is a known failure, and does not block green, when the latest `--base` record of
// the same command ran on the merge-base in round-N/base and failed too: the PR did not introduce it.
// After a green round K, a later verification reruns only the checks and scenarios that the changed files reach and
// copies the others from verify-K.json, marked `carried_from: K`. The gate accepts a carried entry only when round K
// is green and verify-K.json holds a passing entry with the same command or scenario name. K may be 0. On the same
// tree, a rerun in the same round copies the passing entries of the archived attempt, marked
// `carried_from_attempt: A`; the gate accepts one only when that attempt holds the same tree and a passing entry with
// the same name: identical code gives the same result, so a blocked scenario no longer reruns a build that passed.
// A round whose files.txt lists a non-test, non-generated UI file (tsx, jsx, vue, svelte, css, scss, html, or a
// .ts/.js file that a component imports, directly or not; ui.ts holds the rule) is green only with a passing scenario
// whose `surface` is "browser": unit tests and API calls never prove a screen. Round 0 follows the same rule: its
// files.txt comes from `prepare 0`, or, when that never ran, from the diff between the merge-base with origin's
// default branch and the verified tree; with neither, `verify 0` is blocked (the UI rule cannot be checked) and a later
// brief carries nothing from it. Generated files (generatedPaths) leave this rule and the review slices:
// nobody writes them by hand.
//
// Review. `slice N` packs round N's diff into slices of at most SLICE_LINES changed lines (a bigger single file is its
// own slice) and writes two prompts per slice, review-<S>.prompt (correctness) and review-sec-<S>.prompt (security),
// printing their names one per line (`A`, `sec-A`, `B`, `sec-B`). No name printed = nothing to review. It also writes
// slice-<S>.patch, every patch of the slice under an `=== PATCH: <path> ===` header, so a reviewer prints the whole
// slice in one call; a whole `cat` of its exact absolute path whose output holds every one of those headers counts as a
// read of every file of the slice. A non-empty
// decisions.md (the defaults a run built on while its owner was away, and the findings deferred to the owner) goes into
// every prompt as <recorded_decisions>, and a non-empty REVIEW.md at the repo root (the repo's own review rules) as
// <review_guide>, read from the merge-base so a pull request cannot weaken its own review rules. The task texts live here (eval.ts builds its prompts from them too) so
// the prompts are the same every round. The first reviewed round covers every file; later ones re-review
// only the files changed since the previous reviewed round plus the files of its rejected findings, so the loop
// converges on its own fixes instead of digging up older code. Every prompt lists the findings earlier rounds rejected
// or recorded as pre-existing, so they are not repeated. `reviewed N` passes a process when its trace
// (review-<S>.jsonl, any engine trace.ts reads) ends with well-formed findings and reads every file of its slice; it
// prints one line per process and `rerun: <names>` for the failures (exit 1). The verdict and `record` refuse a round
// whose reviews do not pass this check.
//
// converged: the latest recorded round on the current tree (the converged round) is green with no critical/major
//   finding, whatever rounds were recorded after it on other trees: that exact code was verified and reviewed clean (a
//   follow-up commit that a later round found a major in, then reverted, gives that tree back). A later round on the
//   same tree, red, blocked, or with a major, is a newer judgment of that code and wins. A round whose fixes
//   changed the code leaves its tree behind the current one, so the fixes are always verified and reviewed by one more
//   round before the loop converges.
// stalled: a critical/major finding of the latest green round repeats one from an earlier green round (the fix
//   failed, or the fixer rejected it and the reviewer reported it again). Only two kinds of pair can repeat: the same
//   file (a failed fix), or an earlier finding the fixer rejected (a disagreement). The same pattern found in another
//   file is a new instance: the loop goes on and the round cap bounds it. "Same defect" is judged by the peer,
//   GPT-6.2 Astra through peer.ts: fixes shift lines and the reviewer rewords titles, so file/line/title matching
//   misses repeats. Each pair is judged once and kept in same-defect.json (its run's trace in same-defect.jsonl), so
//   the verdict is a deterministic function of the round files and those kept judgments. The repeats behind a stall
//   are written to stall.json and printed with the judge's reason.
//   With no repeat, the loop is also stalled on a hotspot: one file holds a critical/major finding in each of the last
//   HOTSPOT_ROUNDS green rounds, counting only rounds after the latest stalls/<n>/round, so a resumed loop is not
//   stalled again by the same rounds. Hotspots are written to stall.json and printed as
//   `hotspot: <file>: critical or major findings in rounds 5, 6, 7`.
// ready: exit 0 when the loop converged on the current tree and either the minor pass ran or the converged round left
//   no minor finding to pass on; it prints each remaining minor of the converged round (`minor left: <file>: <title>`)
//   for the hand-over. A converged status cached by an older gate, whose rounds no longer prove a converged round,
//   reads its minors from the latest round file, as that gate did. Exit 1 prints why the PR stays draft.
// A status written for another tree is stale (the code changed since): it is dropped and the loop goes on.
// Red and blocked rounds never count as passes; they always continue.

import { closeSync, constants, copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, renameSync, rmSync, writeSync } from "node:fs";
import { constants as osConstants, tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import { $ } from "bun";
import { runPeer } from "./peer";
import { openedBundle, openedFile, patchHeader, printedText, readTrace } from "./trace";
import { isUiFile, TEST_FILE } from "./ui";

export type Finding = { file: string; line: number; title: string; why: string };
type Round = { head: string; tree: string; majors: Finding[]; rejected?: unknown[] };
type Earlier = { finding: Finding; round: string; rejected: boolean };
type Repeat = { latest: Finding; earlier: Finding; round: string; reason: string };
export type Hotspot = { hotspot: string; rounds: string[]; titles: string[] };
export type Bloat = { bloat: string; baseRound: string; growth: number; percent: number };
export type Diverging = { diverging: string; rounds: string[]; counts: number[] };
// stall.json holds the repeats, hotspots, bloat, or divergence behind a stall.
type StallEntry = Repeat | Hotspot | Bloat | Diverging;
type Judgment = { same: boolean; reason: string };
type Carry = { carried_from?: number; carried_from_attempt?: number };
type Check = Carry & { command: string; exit: number; seconds?: number };
type Scenario = Carry & { name: string; result: "pass" | "fail" | "blocked"; surface?: string; reason?: string; seconds?: number };
type Verify = { head: string; tree: string; checks: Check[]; scenarios: Scenario[]; reused_from?: number };
export type ExecRecord = { command: string; cwd: string; head: string; tree?: string; base?: boolean; pid: number; exit?: number; seconds?: number; log: string };
type Numbered = { k: number; record: ExecRecord };
export type ReviewFinding = { severity: string; file: string; line: number; title: string; why: string; fix: string; trigger: string; pre_existing: boolean };
type Rejection = { file: string; line?: number; title: string; reason: string };
type Fix = { fixed: string[]; rejected: Rejection[] };
type RecordedFindings = { findings: number; majors: unknown[]; minor: unknown[]; pre_existing: unknown[] };

const LOCKFILES = new Set([
  "bun.lock", "bun.lockb", "package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml", "uv.lock",
  "poetry.lock", "Pipfile.lock", "Cargo.lock", "Gemfile.lock", "composer.lock", "go.sum", "flake.lock", "gradle.lockfile",
]);
const GENERATED_HEADER = /@generated|auto-generated|code generated/i;
const RESULTS = ["pass", "fail", "blocked"];
const SURFACES = ["browser", "api", "cli"];

const SLICE_LINES = 2000;
// The brief line of a round whose diff changes UI files: the rule verifyResult enforces, said before the run.
const UI_BRIEF_LINE = 'UI files changed: at least one passing scenario with surface "browser" is required.';
// Green rounds in a row with a critical/major finding in one file before the loop stalls on that file.
const HOTSPOT_ROUNDS = 3;
// Hand-written diff growth from the baseline round (first round, or first round after resume) that stalls the loop.
const DIFF_GROWTH_LINES = 1500;
const DIFF_GROWTH_RATIO = 0.5;
// The verifier's shell caps one call at 10 minutes, so one wait must end before that.
const WAIT_MINUTES = 9;

// Rules every reviewer prompt shares: finding fields, re-review scope, earlier judgments, and severity.
export const FINDING_RULES = `For each finding, \`trigger\` names the input or state that makes it fail. Set \`pre_existing\` to true when the faulty code is not added or changed by the patch: the pull request did not introduce it, so it is recorded for the owner and never blocks this PR. When a defect is one instance of a pattern, report the pattern once, at its first instance, and list every other instance you find in \`why\`, so all of them get fixed in one round.

<recorded_decisions>, when present, lists the decisions this run recorded for its owner, who has not reviewed them yet: product questions it built on a recommended default, and findings it deferred to the owner. They are open, not adopted, but already on the owner's list. Do not report a behavior that follows one of them, or the deferred finding itself, unless it breaks a hard invariant (data loss, a security hole, a crash, a broken contract), citing the code that proves it.

<review_guide>, when present, holds the repository's own review rules (what failure looks like here, paths or patterns to skip, local anti-noise rules): apply it to your slice.

<scope> says whether this is a full review or a re-review. On a re-review, the files outside your slice were reviewed in an earlier round and have not changed since: open them only to check how your slice affects them. <already_judged> lists findings earlier rounds rejected (with the reason) or recorded as pre-existing. Do not report them again unless you can show the reason is wrong, citing the code that proves it. <generated> lists the generated files of the diff: they are outside every slice; open one only as context for your slice.

Severity: critical = data loss, security, or crash on the main path; major = incorrect behavior or contract violation; minor = real but low-impact defect; nit = anything else, including a stale recipe or doc of a dev tool (a \`verify-<app>\` skill, a script's README) that the product never runs.`;

// What the gate accepts as proof that a reviewer read a patch (trace.ts): a search or a loop over a shell variable is
// not a read, and reviewers skipped large test patches that way, which no rerun changed.
const OPEN_RULE = `Print every patch of <slice> in full, test files included, and open surrounding source when needed. Its first line names the slice bundle: \`cat <bundle path>\`, with the absolute path exactly as listed and its output neither piped nor redirected, prints every patch of the slice in one call, each under an \`=== PATCH: <path> ===\` header. \`cat\` with each patch path, or a glob of them, also counts. Write the path in the command itself: the gate rejects a review whose trace leaves one patch unprinted, and it does not count a search (\`rg\`, \`grep\`), a count (\`wc\`), or a loop that reads a shell variable (\`for f in …; do cat "$f"\`).`;

export const REVIEW_TASK = `Review your slice of this pull request diff against its stated intent. ${OPEN_RULE} Report only defects you can point to in those patches: wrong logic, contract violations against the intent, missing error handling at trust boundaries, data loss, missing or incorrect tests for changed behavior. Security has its own reviewer. If the repository's AGENTS.md names a review checklist, apply its rules to your slice. Do not report style, naming, formatting, or hypothetical future needs. Zero findings is a valid result.

Also interrogate: a state-changing operation that breaks when it runs twice or after a crash halfway; a guard, retry, cast, or fallback that hides a broken invariant instead of fixing its cause; a check that reads a proxy (cache, mtime, self-report) instead of the real value. For a possible null or bad input, trace the caller before reporting it.

Report every cheapest road to green: a threshold or config loosened; \`.skip\` added, tests deleted, or assertions removed; a new \`@ts-ignore\`, \`eslint-disable\`, \`# noqa\`, \`# type: ignore\`, or coverage-ignore comment; a stub or empty catch; a new exception or allowlist entry. Tightening the bar is fine silently; loosening it is always a finding.

When the diff changes launch config, routes, or seed data and the repository has a \`verify-<app>\` skill, its matching recipe changes in the same PR (check <files>); report a recipe left behind as a nit.

${FINDING_RULES}`;

// Returns the `- [ ] ` bullets under `## Verification` of the hardening skill as plain `- ` lines.
// Throws when none is found: a security reviewer must never run with an empty checklist.
export function securityChecklist(markdown: string): string[] {
  const lines = markdown.split("\n");
  const heading = lines.findIndex((line) => line.trimEnd() === "## Verification");
  if (heading === -1) throw new Error("hardening/SKILL.md: no `## Verification` heading to read the security checklist from");
  const next = lines.findIndex((line, i) => i > heading && /^#{1,6} /.test(line));
  const checks = lines
    .slice(heading + 1, next === -1 ? undefined : next)
    .filter((line) => line.startsWith("- [ ] "))
    .map((line) => `- ${line.slice("- [ ] ".length).trim()}`);
  if (checks.length === 0) throw new Error("hardening/SKILL.md: no `- [ ] ` bullet under `## Verification`");
  return checks;
}

// The security pass runs as its own reviewer on the same slices: one prompt that covers everything dilutes it.
// The checks are read from the Verification list of the hardening skill, which governs the same code at build time,
// so the two never drift. Built by `slice` only, so a broken hardening file fails that command and no other.
export function securityTask(): string {
  const checks = securityChecklist(readFileSync(new URL("../hardening/SKILL.md", import.meta.url), "utf8"));
  return `Review your slice of this pull request diff for security defects only. ${OPEN_RULE} Report a defect only when you can trace untrusted input or an unauthorized caller to the patched code; a missing control that no reachable input exercises is not a finding. Zero findings is a valid result.

Check the patches against each of these:
${checks.join("\n")}
- New or bumped dependencies in a manifest of your slice: the lockfile diff (its patch is listed under <generated>) holds only the intended packages.

A security defect reachable from a trust boundary is critical.

${FINDING_RULES}`;
}

// The repo's REVIEW.md as a prompt block; "" when it holds only whitespace, so an empty file adds no rule.
export function formatReviewGuide(content: string): string {
  const guide = content.trim();
  return guide ? `<review_guide>\n${guide}\n</review_guide>\n` : "";
}

// REVIEW.md as committed at baseRef (the round's merge-base), never the PR working tree: a PR branch could otherwise
// rewrite its own review rules or plant a symlink to any file. Only a regular blob counts; a symlink (120000) adds no rule.
export async function readReviewGuide(root: string, baseRef: string): Promise<string> {
  const entry = (await $`git ls-tree ${baseRef} -- REVIEW.md`.cwd(root).text()).trim();
  const [mode, type, oid] = entry.split(/\s+/);
  if (type !== "blob" || (mode !== "100644" && mode !== "100755")) return "";
  return formatReviewGuide(await $`git cat-file -p ${oid}`.cwd(root).text());
}

export type ReviewContext = {
  intent: string;
  reviewGuide?: string; // formatted block from formatReviewGuide
  decisions?: string; // raw decisions.md
  checks: string;
  scope: string;
  judged: string;
  files: string;
  generated: string;
  slice: string;
};

// One prompt layout for `slice` and eval.ts, so an eval measures the prompt the loop really sends.
export function buildReviewPrompt(task: string, context: ReviewContext): string {
  const decisions = context.decisions?.trim();
  const recorded = decisions ? `<recorded_decisions>\n${decisions}\n</recorded_decisions>\n` : "";
  return `${task}\n\n<intent>\n${context.intent}\n</intent>\n${context.reviewGuide ?? ""}${recorded}<checks_passed>\n${context.checks}\n</checks_passed>\n<scope>\n${context.scope}\n</scope>\n<already_judged>\n${context.judged || "none"}\n</already_judged>\n<files>\n${context.files.trim()}\n</files>\n<generated>\n${context.generated || "none"}\n</generated>\n<slice>\n${context.slice}\n</slice>\n`;
}

const toplevel = async (cwd = process.cwd()): Promise<string> => (await $`git rev-parse --show-toplevel`.cwd(cwd).text()).trim();

// Hash of the working tree as `git add -A` would stage it, without touching the real index.
// Starts from a copy of the real index so unchanged files reuse its stat cache instead of being rehashed.
async function tree(cwd = process.cwd()): Promise<string> {
  const tmp = mkdtempSync(`${tmpdir()}/review-tree-`);
  try {
    const index = (await $`git rev-parse --path-format=absolute --git-path index`.cwd(cwd).text()).trim();
    if (existsSync(index)) copyFileSync(index, `${tmp}/index`);
    const env = { ...process.env, GIT_INDEX_FILE: `${tmp}/index` };
    const root = await toplevel(cwd);
    await $`git add -A`.cwd(root).env(env).quiet();
    return (await $`git write-tree`.cwd(root).env(env).text()).trim();
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const isString = (value: unknown): value is string => typeof value === "string";
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const isCount = (value: unknown, min: number): boolean => Number.isInteger(value) && (value as number) >= min;
const isCarried = (entry: Carry): boolean => entry.carried_from !== undefined || entry.carried_from_attempt !== undefined;

// A JSON file whose parse error names the file: a bare SyntaxError says nothing about which state file is broken.
async function readJson(path: string): Promise<unknown> {
  const file = Bun.file(path);
  if (!(await file.exists())) throw new Error(`${path}: missing`);
  try {
    return await file.json();
  } catch (error) {
    throw new Error(`${path}: not valid JSON (${error instanceof Error ? error.message : error})`);
  }
}

function isRound(value: unknown): value is Round {
  return isObject(value) && isString(value.head) && isString(value.tree) && Array.isArray(value.majors);
}

// The verify-N.json contract of verifier.md, rule by rule, so a malformed file names the entry and the rule it breaks.
function entryProblem(entry: Record<string, unknown>): string | undefined {
  if (entry.seconds !== undefined && !(typeof entry.seconds === "number" && entry.seconds >= 0)) return "seconds must be a number of 0 or more";
  if (entry.carried_from !== undefined && !isCount(entry.carried_from, 0)) return "carried_from must be a round number of 0 or more";
  if (entry.carried_from_attempt !== undefined && !isCount(entry.carried_from_attempt, 1)) return "carried_from_attempt must be an attempt number of 1 or more";
  if (entry.carried_from !== undefined && entry.carried_from_attempt !== undefined) return "carried_from and carried_from_attempt are exclusive";
  return undefined;
}

export function verifyProblem(value: unknown): string | undefined {
  if (!isObject(value)) return "the file must hold a JSON object";
  if (!isString(value.head)) return "head must be a string (git rev-parse HEAD)";
  if (!isString(value.tree)) return "tree must be a string (gate.ts tree)";
  if (value.reused_from !== undefined && !isCount(value.reused_from, 0)) return "reused_from must be a round number of 0 or more";
  if (!Array.isArray(value.checks)) return "checks must be an array";
  if (!Array.isArray(value.scenarios)) return "scenarios must be an array";
  for (const [i, check] of value.checks.entries()) {
    if (!isObject(check)) return `checks[${i}] must be an object`;
    if (!isString(check.command)) return `checks[${i}]: command must be a string`;
    const label = `check ${JSON.stringify(check.command)}`;
    if (!Number.isInteger(check.exit)) return `${label}: exit must be an integer`;
    const problem = entryProblem(check);
    if (problem) return `${label}: ${problem}`;
  }
  for (const [i, scenario] of value.scenarios.entries()) {
    if (!isObject(scenario)) return `scenarios[${i}] must be an object`;
    if (!isString(scenario.name)) return `scenarios[${i}]: name must be a string`;
    const label = `scenario ${JSON.stringify(scenario.name)}`;
    if (!RESULTS.includes(scenario.result as string)) return `${label}: result must be pass, fail, or blocked`;
    if (scenario.surface !== undefined && !SURFACES.includes(scenario.surface as string)) return `${label}: surface must be browser, api, or cli`;
    if (scenario.reason !== undefined && !isString(scenario.reason)) return `${label}: reason must be a string`;
    const problem = entryProblem(scenario);
    if (problem) return `${label}: ${problem}`;
  }
  return undefined;
}

async function readVerifyFile(path: string): Promise<Verify> {
  const value = await readJson(path);
  const problem = verifyProblem(value);
  if (problem) throw new Error(`${path}: ${problem} (contract: ~/.agents/skills/review-round/verifier.md)`);
  return value as Verify;
}

type Outcome = { result: "green" | "red" | "blocked"; reason?: string; known?: string[] };

function describeOutcome({ result, reason, known }: Outcome): string {
  if (reason) return `${result}: ${reason}`;
  if (known && known.length > 0) return `${result} (known failure on base: ${known.join("; ")})`;
  return result;
}

const pathOf = (numstatLine: string): string => numstatLine.split("\t").slice(2).join("\t");
// One patch file per changed path. `%` and `_` are escaped before `/` becomes `__`, so no two paths share a name:
// `a/b.txt` is a__b.txt.patch and `a__b.txt` is a%5F%5Fb.txt.patch.
export const patchPath = (roundDir: string, path: string): string =>
  `${roundDir}/patches/${path.replaceAll("%", "%25").replaceAll("_", "%5F").replaceAll("/", "__")}.patch`;
// The patch a round holds for `path`. A round prepared before the escaped names holds `/`→`__` names: they are read as
// they are, so a loop started then keeps its recorded reviews.
function roundPatch(roundDir: string, path: string): string {
  const escaped = patchPath(roundDir, path);
  const legacy = `${roundDir}/patches/${path.replaceAll("/", "__")}.patch`;
  return !existsSync(escaped) && existsSync(legacy) ? legacy : escaped;
}
// Every patch of slice <letter> in one file, so a reviewer prints the slice in one call.
const bundlePath = (roundDir: string, letter: string): string => `${roundDir}/slice-${letter}.patch`;

// A generated file is written by a tool, not by the PR's author: reviewing it finds nothing a person can fix, and a
// generated API client is not a screen. Generated = marked linguist-generated in .gitattributes, named like one
// (generated., .gen., openapi.json, a lockfile), or headed by a generator's banner in its first 5 lines.
async function generatedPaths(root: string, paths: string[]): Promise<Set<string>> {
  const generated = new Set<string>();
  if (paths.length === 0) return generated;
  const input = Buffer.from(`${paths.join("\0")}\0`);
  const fields = (await $`git check-attr --stdin -z linguist-generated < ${input}`.cwd(root).text()).split("\0");
  for (let i = 0; i + 2 < fields.length; i += 3) if (fields[i + 2] === "set" || fields[i + 2] === "true") generated.add(fields[i]);
  for (const path of paths) {
    const name = basename(path);
    if (name.includes("generated.") || name.includes(".gen.") || name === "openapi.json" || LOCKFILES.has(name)) generated.add(path);
    if (generated.has(path)) continue;
    const file = Bun.file(`${root}/${path}`);
    if (!(await file.exists())) continue; // deleted by the diff: nothing to read
    const head = (await file.slice(0, 4096).text()).split("\n").slice(0, 5).join("\n");
    if (GENERATED_HEADER.test(head)) generated.add(path);
  }
  return generated;
}

// Whether a numstat (`git diff --numstat`: added<TAB>removed<TAB>path) lists a hand-written UI file.
async function changesUi(numstat: string): Promise<boolean> {
  const root = await toplevel();
  const paths = numstat.split("\n").map(pathOf).filter((path) => path && !TEST_FILE.test(path));
  const generated = await generatedPaths(root, paths);
  for (const path of paths) {
    if (generated.has(path)) continue;
    if (await isUiFile(root, path)) return true;
  }
  return false;
}

// Round N's changed files as a numstat: its files.txt. Round 0 is the implement skill's verification, which may run
// without `prepare 0`; its diff then runs from the merge-base with origin's default branch to `tree` (the verified
// tree, or the current one for a brief), so verify-0.json is never blind to a UI diff. When neither exists, as for a
// verify-0.json written before this rule, the diff is `unknown`, with the reason: the caller decides whether that
// blocks a verification or breaks the command.
async function roundNumstat(dir: string, round: string, tree: string): Promise<{ numstat: string } | { unknown: string }> {
  const filesTxt = `${dir}/round-${round}/files.txt`;
  if (existsSync(filesTxt)) return { numstat: readFileSync(filesTxt, "utf8") };
  if (round !== "0") throw new Error(`${filesTxt}: missing; gate.ts prepare writes it at the start of the round`);
  const root = await toplevel();
  const fix = "run gate.ts prepare 0 --base <base> first";
  const head = await $`git symbolic-ref --quiet --short refs/remotes/origin/HEAD`.cwd(root).nothrow().quiet();
  if (head.exitCode !== 0) return { unknown: `${filesTxt} is missing and origin/HEAD is unset, so the diff of round 0 has no base; ${fix}` };
  const mergeBase = (await $`git merge-base ${head.text().trim()} HEAD`.cwd(root).text()).trim();
  const diff = await $`git diff --no-renames -z --numstat ${mergeBase} ${tree}`.cwd(root).nothrow().quiet();
  if (diff.exitCode !== 0) return { unknown: `${filesTxt} is missing and tree ${tree} is gone, so the diff of round 0 is unknown; ${fix}` };
  return { numstat: diff.text().split("\0").filter(Boolean).join("\n") };
}

function verifyResult({ checks, scenarios }: Verify, ui: boolean, known: string[]): Outcome {
  const failing = checks.some((check) => check.exit !== 0 && !known.includes(check.command));
  if (failing || scenarios.some((scenario) => scenario.result === "fail")) return { result: "red" };
  const blocked = scenarios.find((scenario) => scenario.result === "blocked");
  if (blocked) return { result: "blocked", reason: `scenario blocked: ${blocked.name}` };
  if (ui && !scenarios.some((scenario) => scenario.surface === "browser" && scenario.result === "pass"))
    return { result: "blocked", reason: "the diff changes UI files but no passing scenario has surface \"browser\"" };
  return { result: "green", known };
}

async function stateDir(): Promise<string> {
  const commonDir = (await $`git rev-parse --path-format=absolute --git-common-dir`.text()).trim();
  const branch = (await $`git branch --show-current`.text()).trim();
  if (!branch) throw new Error("no branch is checked out here; run the gate from the PR's worktree");
  return `${commonDir}/review/${branch}`;
}

// Greedy packing in files.txt order keeps a directory's files together. Binary files (numstat "-") count as 0.
export function packSlices(numstat: string, limit = SLICE_LINES): string[][] {
  const slices: { paths: string[]; lines: number }[] = [];
  for (const line of numstat.split("\n")) {
    const [added, removed] = line.split("\t");
    const path = pathOf(line);
    if (!path) continue;
    const lines = (Number(added) || 0) + (Number(removed) || 0);
    const last = slices.at(-1);
    if (last && last.lines + lines <= limit) {
      last.paths.push(path);
      last.lines += lines;
    } else slices.push({ paths: [path], lines });
  }
  return slices.map((slice) => slice.paths);
}

export type DiffSize = { added: number; removed: number };

// The lines a numstat adds and removes, generated files left out: a lockfile's churn says nothing about what the
// author wrote. Binary files (numstat "-") count as 0.
export function diffSize(numstat: string, generated: Set<string> = new Set()): DiffSize {
  const size = { added: 0, removed: 0 };
  for (const line of numstat.split("\n")) {
    const [added, removed] = line.split("\t");
    if (!pathOf(line) || generated.has(pathOf(line))) continue;
    size.added += Number(added) || 0;
    size.removed += Number(removed) || 0;
  }
  return size;
}

// `+A/-R`, then how many lines the diff gained or lost since `first`, the loop's first measured round.
export function describeDiff(size: DiffSize, first: DiffSize | undefined): string {
  const text = `+${size.added}/-${size.removed}`;
  if (!first) return text;
  const growth = size.added + size.removed - first.added - first.removed;
  return `${text} (${growth >= 0 ? "+" : ""}${growth} lines since the first round)`;
}

const isDiffSize = (value: unknown): value is DiffSize =>
  isObject(value) && typeof value.added === "number" && typeof value.removed === "number";

// Writes round N's diff handoff from the merge-base with origin/<base> to the tree `tree` hashes: the working tree,
// untracked files included, so the previous round's fixes and a new file not yet added are always seen, and the
// round reviews and verifies exactly the files its verify-N.json is keyed on. --no-renames splits a rename into a
// delete and an add: a rename's numstat path (`old => new`) names no file, so it would match no patch.
async function prepare(round: string, base: string): Promise<string> {
  const root = await toplevel();
  const current = await tree();
  const roundDir = `${await stateDir()}/round-${round}`;
  await $`git fetch --quiet origin ${base}`.cwd(root);
  const mergeBase = (await $`git merge-base ${`origin/${base}`} HEAD`.cwd(root).text()).trim();
  rmSync(`${roundDir}/patches`, { recursive: true, force: true }); // a rerun of prepare must not keep stale patches
  mkdirSync(`${roundDir}/patches`, { recursive: true });
  // -z keeps unusual paths verbatim instead of quoted.
  const records = (await $`git diff --no-renames -z --numstat ${mergeBase} ${current}`.cwd(root).text()).split("\0").filter(Boolean);
  for (const line of records) {
    // `:(literal)` stops git from reading a `*` or `?` in a file name as a glob.
    const patch = await $`git diff --no-renames ${mergeBase} ${current} -- ${`:(literal)${pathOf(line)}`}`.cwd(root).text();
    await Bun.write(patchPath(roundDir, pathOf(line)), patch);
  }
  await Bun.write(`${roundDir}/files.txt`, records.length > 0 ? `${records.join("\n")}\n` : "");
  await Bun.write(`${roundDir}/base`, `${mergeBase}\n`);
  return `round ${round}: ${records.length} file(s) against origin/${base}, merge-base ${mergeBase}`;
}

// Copies a verification of the current tree into round N. reused_from keeps the round that ran it, so the attempts,
// exec records, and base its entries point to resolve there and not in round N.
async function reuse(from: number, to: number): Promise<string> {
  if (from >= to) throw new Error(`reuse copies an earlier verification: ${from} is not before ${to}`);
  const dir = await stateDir();
  const source = await readVerifyFile(`${dir}/verify-${from}.json`);
  const current = await tree();
  if (source.tree !== current)
    throw new Error(`verify-${from}.json verified tree ${source.tree}, not the current tree ${current}: dispatch the verifier instead`);
  const origin = source.reused_from ?? from;
  await Bun.write(`${dir}/verify-${to}.json`, `${JSON.stringify({ ...source, reused_from: origin }, null, 2)}\n`);
  return `verify-${to}.json reused from verify-${origin}.json`;
}

type EarlierRound = { name: string; tree: string; rejected: unknown[]; preExisting: unknown[]; minor: unknown[] };

// The earlier rounds of this loop that a reviewer read, oldest first. A green verify is not enough: a red round
// fixed and re-verified ends green without review, and an empty re-review writes no prompt. This gate is the only
// writer of review prompts, so their presence marks a reviewed round.
async function earlierReviewedRounds(dir: string, round: string): Promise<EarlierRound[]> {
  const rounds: EarlierRound[] = [];
  for (const name of roundNames(dir)) {
    const number = name.slice("round-".length, -".json".length);
    if (Number(number) >= Number(round)) continue;
    if ([...new Bun.Glob("review-*.prompt").scanSync(`${dir}/round-${number}`)].length === 0) continue;
    if ((await readVerify(dir, number)).result !== "green") continue;
    const data = await readJson(`${dir}/${name}`);
    if (!isRound(data)) throw new Error(`${dir}/${name}: lacks "head", "tree", or the "majors" array`);
    const { rejected, pre_existing, minor } = data as Record<string, unknown>;
    rounds.push({
      name,
      tree: data.tree,
      rejected: Array.isArray(rejected) ? rejected : [],
      preExisting: Array.isArray(pre_existing) ? pre_existing : [],
      minor: Array.isArray(minor) ? minor : [],
    });
  }
  return rounds;
}

// Paths a re-review keeps: changed since the previous reviewed round, or named by one of its rejected findings so the
// reviewer can challenge the rejection. undefined = full review (first reviewed round, or its tree is gone).
async function reReviewPaths(previous: EarlierRound | undefined, tree: string): Promise<Set<string> | undefined> {
  if (!previous) return undefined;
  const root = await toplevel();
  if ((await $`git cat-file -e ${`${previous.tree}^{tree}`}`.cwd(root).nothrow().quiet()).exitCode !== 0) {
    // A full review is the safe superset; say so instead of failing the loop.
    console.error(`tree ${previous.tree} of ${previous.name} is gone (git gc?); reviewing every file`);
    return undefined;
  }
  const changed = (await $`git diff --name-only ${previous.tree} ${tree}`.cwd(root).text()).split("\n").filter(Boolean);
  const rejectedFiles = previous.rejected.flatMap((finding) => (isObject(finding) && isString(finding.file) ? [finding.file] : []));
  return new Set([...changed, ...rejectedFiles]);
}

function describeJudged(rounds: EarlierRound[]): string {
  const line = (finding: unknown, label: (f: Record<string, unknown>) => string) =>
    isObject(finding) ? [`- ${finding.file}: ${finding.title} (${label(finding)})`] : [];
  return [
    ...rounds.flatMap((round) => round.rejected.flatMap((finding) => line(finding, (f) => `rejected: ${f.reason}`))),
    ...rounds.flatMap((round) => round.preExisting.flatMap((finding) => line(finding, () => "pre-existing, recorded"))),
  ].join("\n");
}

async function slice(round: string): Promise<string[]> {
  const dir = await stateDir();
  const roundDir = `${dir}/round-${round}`;
  const { result, verify, known = [] } = await readVerify(dir, round);
  if (result !== "green") throw new Error(`round ${round} is ${result}; only a green round is reviewed`);
  const security = securityTask();
  const earlier = await earlierReviewedRounds(dir, round);
  const previous = earlier.at(-1);
  const kept = await reReviewPaths(previous, verify.tree);
  const files = await Bun.file(`${roundDir}/files.txt`).text();
  const scopedLines = files.split("\n").filter((line) => pathOf(line) && (!kept || kept.has(pathOf(line))));
  const root = await toplevel();
  const generated = await generatedPaths(root, scopedLines.map(pathOf));
  const reviewed = scopedLines.filter((line) => !generated.has(pathOf(line))).join("\n");
  const scope = kept
    ? `Re-review: only files changed since ${previous?.name.slice(0, -".json".length)} or named by its rejected findings are in the slices.`
    : "Full review: every changed file of the pull request is in the slices.";
  const judged = describeJudged(earlier);
  const generatedList = [...generated].map((path) => `- ${path}: generated, not reviewed (${roundPatch(roundDir, path)})`).join("\n");
  const intent = (await $`gh pr view --json body --jq .body`.text()).trim();
  const decisionsFile = `${dir}/decisions.md`;
  const decisions = existsSync(decisionsFile) ? readFileSync(decisionsFile, "utf8") : "";
  const baseFile = Bun.file(`${roundDir}/base`);
  if (!(await baseFile.exists())) throw new Error(`${roundDir}/base: missing; gate.ts prepare ${round} writes it`);
  const reviewGuide = await readReviewGuide(root, (await baseFile.text()).trim());
  const checks = [
    ...verify.checks.map((check) => `- ${check.command}: exit ${check.exit}${known.includes(check.command) ? " (fails on the base too)" : ""}`),
    ...verify.scenarios.map((scenario) => `- ${scenario.name}: ${scenario.result}`),
  ].join("\n");
  const names: string[] = [];
  for (const [i, paths] of packSlices(reviewed).entries()) {
    const name = i < 26 ? String.fromCharCode(65 + i) : `S${i}`;
    const patches = [];
    const bundle = [];
    for (const path of paths) {
      const patch = roundPatch(roundDir, path);
      if (!(await Bun.file(patch).exists())) throw new Error(`${patch}: missing; gate.ts prepare writes one patch per file`);
      patches.push(patch);
      bundle.push(`${patchHeader(path)}\n${await Bun.file(patch).text()}`);
    }
    await Bun.write(bundlePath(roundDir, name), bundle.join("\n"));
    const sliceList = [`bundle: ${bundlePath(roundDir, name)} (every patch below, in one file)`, ...patches].join("\n");
    const context = { intent, reviewGuide, decisions, checks, scope, judged, files, generated: generatedList, slice: sliceList };
    await Bun.write(`${roundDir}/review-${name}.prompt`, buildReviewPrompt(REVIEW_TASK, context));
    await Bun.write(`${roundDir}/review-sec-${name}.prompt`, buildReviewPrompt(security, context));
    await Bun.write(`${roundDir}/slice-${name}.txt`, `${paths.join("\n")}\n`);
    names.push(name, `sec-${name}`);
  }
  // Written even when empty: `record` tells "nothing to review" from "slice never ran" by this file.
  await Bun.write(`${roundDir}/slices`, names.length > 0 ? `${names.join("\n")}\n` : "");
  return names;
}

type ReviewCheck = { name: string; problem?: string; summary: string };

export const SEVERITIES = ["critical", "major", "minor", "nit"];

// The shape reviewer-schema.json asks for. Both engines enforce the schema, but the answer is still model output, so
// the gate checks it here before it records a finding.
export function isFinding(value: unknown): value is ReviewFinding {
  return (
    isObject(value) &&
    SEVERITIES.includes(value.severity as string) &&
    ["file", "title", "why", "fix", "trigger"].every((key) => isString(value[key])) &&
    Number.isInteger(value.line) &&
    typeof value.pre_existing === "boolean"
  );
}

// Judges one reviewer process from its trace, review-<name>.jsonl, written by peer.ts in its engine's format (see
// trace.ts). A reviewer that answers without opening its files can return zero findings that look exactly like a
// clean review, so a review counts only when the trace shows a read of every file of its slice (a whole print of the
// slice bundle's exact path that returned every patch header, the patch, or the source file) and ends with a well-formed result. On success it writes review-<name>.json from that result: the
// trace is the only source of the findings.
async function judgeReview(roundDir: string, name: string): Promise<ReviewCheck> {
  const letter = name.replace(/^sec-/, "");
  const paths = (await Bun.file(`${roundDir}/slice-${letter}.txt`).text()).split("\n").filter(Boolean);
  const traceFile = Bun.file(`${roundDir}/review-${name}.jsonl`);
  if (!(await traceFile.exists())) return { name, problem: "no trace", summary: `${name}: no trace review-${name}.jsonl` };
  const { engine, opened, fullReads, printed, output, toolCalls } = readTrace(await traceFile.text());
  const patchFiles = paths.map((path) => roundPatch(roundDir, path));
  const patches = await Promise.all(patchFiles.map((file) => Bun.file(file).text()));
  // Rounds sliced before bundles existed have none, and their traces never read one.
  const bundled = openedBundle(fullReads, bundlePath(roundDir, letter), paths);
  const unopened = paths.filter(
    (path, index) =>
      !bundled &&
      !openedFile(opened, patchFiles[index]) &&
      !openedFile(opened, path) &&
      !printedText(printed, patches[index]),
  );
  const coverage = `${paths.length - unopened.length}/${paths.length} files opened, ${toolCalls} tool calls, ${engine}`;
  if (!isObject(output) || !Array.isArray(output.findings) || !output.findings.every(isFinding))
    return { name, problem: "no schema result", summary: `${name}: no well-formed findings in the trace (${coverage})` };
  if (unopened.length > 0)
    return { name, problem: "files not opened", summary: `${name}: not reviewed, ${coverage}; never opened: ${unopened.join(", ")}` };
  await Bun.write(`${roundDir}/review-${name}.json`, `${JSON.stringify(output, null, 2)}\n`);
  return { name, summary: `${name}: ${output.findings.length} finding(s), ${coverage}` };
}

// Every reviewer process of a round, in prompt order. A round without prompts was not reviewed and returns [].
async function judgeReviews(dir: string, round: string): Promise<ReviewCheck[]> {
  const roundDir = `${dir}/round-${round}`;
  if (!existsSync(roundDir)) return [];
  const names = [...new Bun.Glob("review-*.prompt").scanSync(roundDir)]
    .map((file) => file.slice("review-".length, -".prompt".length))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return Promise.all(names.map((name) => judgeReview(roundDir, name)));
}

function isExecRecord(value: unknown): value is ExecRecord {
  return (
    isObject(value) &&
    isString(value.command) &&
    isString(value.cwd) &&
    isString(value.head) &&
    (value.tree === undefined || isString(value.tree)) &&
    (value.base === undefined || typeof value.base === "boolean") &&
    Number.isInteger(value.pid) &&
    (value.exit === undefined || Number.isInteger(value.exit)) &&
    isString(value.log)
  );
}

// Round N's exec records, oldest first. A record without `exit` is still running or died with its exec process.
async function readExecRecords(dir: string, round: number): Promise<Numbered[]> {
  const execDir = `${dir}/round-${round}/exec`;
  if (!existsSync(execDir)) return [];
  const records: Numbered[] = [];
  for (const name of readdirSync(execDir).filter((file) => /^\d+\.json$/.test(file))) {
    const record = await readJson(`${execDir}/${name}`);
    if (!isExecRecord(record)) throw new Error(`${execDir}/${name}: not an exec record; only gate.ts exec writes it`);
    records.push({ k: Number(name.slice(0, -".json".length)), record });
  }
  return records.sort((a, b) => a.k - b.k);
}

const latestFinished = (records: Numbered[], matches: (record: ExecRecord) => boolean): Numbered | undefined =>
  records.filter(({ record }) => record.exit !== undefined && matches(record)).at(-1);

// Blocked when a check the verifier ran has no exec record behind its exit code. Carried entries were proven in
// their source round.
function unproven(verify: Verify, records: Numbered[], source: number): Outcome | undefined {
  for (const check of verify.checks.filter((entry) => !isCarried(entry))) {
    const proof = latestFinished(records, (record) => !record.base && record.command === check.command && record.tree === verify.tree);
    const label = `check ${JSON.stringify(check.command)}`;
    if (!proof)
      return { result: "blocked", reason: `${label} has no finished exec record on tree ${verify.tree} in round-${source}/exec/; run it with gate.ts exec ${source}` };
    if (proof.record.exit !== check.exit)
      return { result: "blocked", reason: `${label}: exit ${check.exit} in the verify file, but exec record round-${source}/exec/${proof.k}.json observed exit ${proof.record.exit}` };
  }
  return undefined;
}

// A base run shorter than this share of the PR's run stopped before the check itself ran (no backend slot, a missing
// install): its exit says nothing about the base. A check that really fails fast on the base is blocked too, and the
// verifier's report says so; that costs a look, where a false known failure turns a red PR green.
const BASE_RUN_MIN_SHARE = 0.1;

// Whether a failed base run proves the check fails on the base: it ran about as long as the PR's run.
export function baseRunRan(prRun: ExecRecord, baseRun: ExecRecord): boolean {
  if (prRun.seconds === undefined || baseRun.seconds === undefined) return false;
  return baseRun.seconds >= prRun.seconds * BASE_RUN_MIN_SHARE;
}

// Extracts structured failures from common test/build logs: bun test, Gradle/JUnit (standard and test-logger plugin),
// pytest, non-test Gradle task failures (SpotBugs, Checkstyle, compile), and gates.sh mechanical violations.
export function extractFailedTests(logText: string): Set<string> {
  const failed = new Set<string>();
  let currentClass: string | undefined;
  for (const raw of logText.split(/\r?\n/)) {
    const line = raw.trim();
    const bun = /^\(fail\)\s+(.+?)(?:\s+\[\d+(?:\.\d+)?m?s\])?$/.exec(line);
    if (bun) {
      failed.add(bun[1]!.trim());
      continue;
    }
    const junit = /^([\w.$]+\s+>\s+.+?)\s+FAILED$/.exec(line);
    if (junit) {
      failed.add(junit[1]!.trim());
      continue;
    }
    const classHeader = /^([a-z][\w$]*(?:\.[a-zA-Z_][\w$]*)*\.[A-Z][\w$]*)$/.exec(line);
    if (classHeader) {
      currentClass = classHeader[1]!;
      continue;
    }
    const testLogger = /^Test\s+(.+?)\s+FAILED$/.exec(line);
    if (testLogger && currentClass) {
      failed.add(`${currentClass} > ${testLogger[1]!.trim()}`);
      continue;
    }
    const pytest = /^FAILED\s+(\S+)/.exec(line);
    if (pytest) {
      failed.add(pytest[1]!.trim());
      continue;
    }
    const task = /^>\s*Task\s+(:[\w:-]+)\s+FAILED$/.exec(line);
    if (task && !task[1]!.endsWith(":test")) {
      failed.add(`task:${task[1]!}`);
      continue;
    }
    if (line.startsWith("mechanical:") && line !== "mechanical: ok") {
      failed.add(line);
    }
  }
  return failed;
}

const ERROR_LINE = /\b(?:error|exception|failed)\b/i;

function extractErrorLines(logText: string): Set<string> {
  const errors = new Set<string>();
  for (const raw of logText.split(/\r?\n/)) {
    const line = raw.trim();
    if (line && ERROR_LINE.test(line)) errors.add(line);
  }
  return errors;
}

// Checks whether every failure in prLog is covered by baseLog (or combined base logs).
// Fail-closed: if no structured failure is recognized in prLog, non-test error lines must match baseLog; an empty or
// unrecognized failure is never treated as known on base.
export function failuresCoveredByBase(prLog: string, baseLog: string): { covered: boolean; newFailures: string[] } {
  const prFailures = extractFailedTests(prLog);
  const baseFailures = extractFailedTests(baseLog);
  if (prFailures.size > 0) {
    const newFailures = [...prFailures].filter((name) => !baseFailures.has(name));
    return { covered: newFailures.length === 0, newFailures };
  }
  if (baseFailures.size > 0) return { covered: false, newFailures: ["(unrecognized PR failure)"] };
  const prErrors = extractErrorLines(prLog);
  if (prErrors.size === 0) return { covered: false, newFailures: ["(unrecognized PR failure)"] };
  const baseErrors = extractErrorLines(baseLog);
  const newFailures = [...prErrors].filter((line) => !baseErrors.has(line));
  return { covered: newFailures.length === 0, newFailures };
}

// Collects all finished failing --base exec records on `baseSha` across the current and earlier rounds of `dir`, so
// targeted base runs and prior rounds on the same merge-base can prove base failures without redundant full base runs.
async function baseLogsOnSha(dir: string, baseSha: string): Promise<string[]> {
  const logs: string[] = [];
  if (!existsSync(dir)) return logs;
  for (const entry of readdirSync(dir)) {
    const match = /^round-(\d+)$/.exec(entry);
    if (!match) continue;
    const records = await readExecRecords(dir, Number(match[1]));
    for (const { record } of records) {
      if (record.base === true && record.head === baseSha && record.exit !== undefined && record.exit !== 0) {
        const file = Bun.file(record.log);
        if (await file.exists()) logs.push(await file.text());
      }
    }
  }
  return logs;
}

// The failing checks that fail on the merge-base too: every failure extracted from the PR run is covered by failing
// `--base` runs at `round-N/base` (either the full command's base run after passing baseRunRan, or targeted/cached
// base runs on the exact same merge-base sha). Non-test failures (task:, mechanical:) are never excused by a test-only
// base run, and a base run of the full command that stopped early is reported as `unrun`.
async function knownFailures(dir: string, verify: Verify, records: Numbered[], source: number): Promise<{ known: string[]; unrun: string[] }> {
  const known: string[] = [];
  const unrun: string[] = [];
  const baseFile = Bun.file(`${dir}/round-${source}/base`);
  if (!(await baseFile.exists())) return { known, unrun };
  const baseSha = (await baseFile.text()).trim();
  const cachedBaseLogs = await baseLogsOnSha(dir, baseSha);
  for (const check of verify.checks.filter((entry) => entry.exit !== 0 && !isCarried(entry))) {
    const prRun = latestFinished(records, (record) => !record.base && record.command === check.command && record.tree === verify.tree);
    if (prRun === undefined) continue;
    const prLogFile = Bun.file(prRun.record.log);
    if (!(await prLogFile.exists())) continue;
    const prLog = await prLogFile.text();
    const baseRun = latestFinished(records, (record) => record.base === true && record.command === check.command && record.head === baseSha);
    if (baseRun !== undefined && baseRun.record.exit !== 0 && !baseRunRan(prRun.record, baseRun.record)) {
      unrun.push(`${check.command} (base run round-${source}/exec/${baseRun.k}.json took ${baseRun.record.seconds ?? "?"} s)`);
      continue;
    }
    if (cachedBaseLogs.length === 0) continue;
    const { covered } = failuresCoveredByBase(prLog, cachedBaseLogs.join("\n"));
    if (covered) known.push(check.command);
  }
  return { known, unrun };
}

async function readVerify(dir: string, round: string): Promise<Outcome & { verify: Verify }> {
  const path = `${dir}/verify-${round}.json`;
  if (!existsSync(path)) throw new Error(`${path}: missing; only the verifier or gate.ts reuse writes it`);
  const verify = await readVerifyFile(path);
  // A reused file was verified in the round it comes from: its exec records, attempts, and base live there.
  const source = verify.reused_from ?? Number(round);
  const records = await readExecRecords(dir, source);
  const notProven = unproven(verify, records, source);
  if (notProven) return { ...notProven, verify };
  const { known, unrun } = await knownFailures(dir, verify, records, source);
  if (unrun.length > 0)
    return { result: "blocked", reason: `base run stopped before the check ran, so it proves nothing: ${unrun.join("; ")}; rerun it with its environment ready (a backend slot, the install)`, verify };
  const diff = await roundNumstat(dir, round, verify.tree);
  if ("unknown" in diff) return { result: "blocked", reason: `the UI rule cannot be checked: ${diff.unknown}`, verify };
  const outcome = verifyResult(verify, await changesUi(diff.numstat), known);
  if (outcome.result !== "green") return { ...outcome, verify };
  return { ...((await uncarried(dir, source, verify)) ?? outcome), verify };
}

// Returns a blocked outcome for the first carried entry that does not pass in its source: a green earlier round,
// or an earlier attempt of this round on the same tree. Returns undefined when every carried entry passes there.
// `round` is the round that ran the verification (reused_from for a reused file).
async function uncarried(dir: string, round: number, verify: Verify): Promise<Outcome | undefined> {
  const entries = [
    ...verify.checks.map((check) => ({ ...check, label: check.command })),
    ...verify.scenarios.map((scenario) => ({ ...scenario, label: scenario.name })),
  ];
  const passesIn = (source: Verify | undefined, label: string): boolean =>
    source !== undefined &&
    (source.checks.some((check) => check.command === label && check.exit === 0) ||
      source.scenarios.some((scenario) => scenario.name === label && scenario.result === "pass"));
  for (const { carried_from_attempt: from, label } of entries.filter((entry) => entry.carried_from_attempt !== undefined)) {
    const source = await readAttempt(dir, round, from!);
    if (source?.tree !== verify.tree || !passesIn(source, label))
      return { result: "blocked", reason: `carried from attempt ${from} of round ${round} but not passing there on tree ${verify.tree}: ${label}` };
  }
  const sources = new Map<number, Verify | undefined>();
  for (const { carried_from: from, label } of entries.filter((entry) => entry.carried_from !== undefined)) {
    if (!sources.has(from!)) {
      const source = from! < round && existsSync(`${dir}/verify-${from}.json`) ? await readVerify(dir, String(from)) : undefined;
      sources.set(from!, source?.result === "green" ? source.verify : undefined);
    }
    if (!passesIn(sources.get(from!), label))
      return { result: "blocked", reason: `carried from round ${from} but not passing in a green verify-${from}.json: ${label}` };
  }
  return undefined;
}

function attemptPath(dir: string, round: number, attempt: number): string {
  return `${dir}/round-${round}/verify-attempt-${attempt}.json`;
}

async function readAttempt(dir: string, round: number, attempt: number): Promise<Verify | undefined> {
  const path = attemptPath(dir, round, attempt);
  return existsSync(path) ? readVerifyFile(path) : undefined;
}

function latestAttempt(dir: string, round: number): number {
  let attempt = 0;
  while (existsSync(attemptPath(dir, round, attempt + 1))) attempt++;
  return attempt;
}

// Moves verify-N.json into the round directory as the next attempt and returns its number and whether the
// working tree still matches it.
async function archiveAttempt(round: number): Promise<string> {
  const dir = await stateDir();
  const verifyPath = `${dir}/verify-${round}.json`;
  const verify = await readVerifyFile(verifyPath);
  const attempt = latestAttempt(dir, round) + 1;
  mkdirSync(`${dir}/round-${round}`, { recursive: true });
  renameSync(verifyPath, attemptPath(dir, round, attempt));
  return `attempt ${attempt} ${verify.tree === (await tree()) ? "same-tree" : "tree-changed"}`;
}

// An entry as a later verification copies it: the same result, marked with its one new source.
function carriedAs<T extends Carry>(entry: T, mark: Carry): T {
  const { carried_from: _round, carried_from_attempt: _attempt, ...rest } = entry;
  return { ...rest, ...mark } as T;
}

function passingEntries(verify: Verify): (Check | Scenario)[] {
  return [...verify.checks.filter((check) => check.exit === 0), ...verify.scenarios.filter((scenario) => scenario.result === "pass")];
}

// The mechanical part of round N's verifier brief (text) and what the skill judges before it appends its own part
// (judge): the checks and scenarios, the stack line, and, after a green round K, which of its entries to carry.
async function brief(round: number): Promise<{ text: string; judge: string }> {
  const dir = await stateDir();
  const roundDir = `${dir}/round-${round}`;
  const current = await tree();
  const journeysDir = `${dir}/journeys`;
  const journeys = existsSync(journeysDir) ? readdirSync(journeysDir).sort() : [];
  const text = [
    `Worktree: ${await toplevel()}. Run everything from there.`,
    `Round: ${round}. Run every check with \`bun ~/.agents/skills/review-round/gate.ts exec ${round} -- '<command>'\` from the worktree.`,
    `Evidence directory: ${roundDir}/evidence/`,
    `Journeys directory: ${journeysDir}/`,
    `Verify file: ${dir}/verify-${round}.json, written in the contract above.`,
  ];
  if (existsSync(`${roundDir}/base`))
    text.push(`Base: ${(await Bun.file(`${roundDir}/base`).text()).trim()} (the merge-base), for the base run of a check that fails after its rerun.`);
  const diff = await roundNumstat(dir, String(round), current);
  if ("unknown" in diff) throw new Error(diff.unknown);
  if (await changesUi(diff.numstat)) text.push(UI_BRIEF_LINE);
  text.push(
    journeys.length > 0
      ? `Journeys from earlier runs; rerun the one of each assigned scenario instead of writing a new one:\n${journeys.map((name) => `- ${journeysDir}/${name}`).join("\n")}`
      : "Journeys from earlier runs: none.",
  );
  const carryHeader = "Carried entries: copy each JSON object below unchanged into the verify file, and run nothing of it again:";

  const attempt = latestAttempt(dir, round);
  const archived = attempt > 0 ? await readAttempt(dir, round, attempt) : undefined;
  if (archived?.tree === current) {
    const carried = passingEntries(archived).map((entry) => JSON.stringify(carriedAs(entry, { carried_from_attempt: attempt })));
    const rerun = [
      ...archived.checks.filter((check) => check.exit !== 0).map((check) => check.command),
      ...archived.scenarios.filter((scenario) => scenario.result !== "pass").map((scenario) => scenario.name),
    ];
    text.push(carried.length > 0 ? `${carryHeader}\n${carried.join("\n")}` : "Carried entries: none.");
    return { text: text.join("\n\n"), judge: `same tree as attempt ${attempt}: ${carried.length} entries carried; rerun: ${rerun.join("; ") || "nothing failed"}` };
  }

  for (let k = round - 1; k >= 0; k--) {
    if (!existsSync(`${dir}/verify-${k}.json`)) continue;
    const { result, verify } = await readVerify(dir, String(k));
    if (result !== "green") continue;
    const root = await toplevel();
    const diff = await $`git diff --name-only ${verify.tree} ${current}`.cwd(root).nothrow().quiet();
    const changed = diff.exitCode === 0 ? diff.text().trim() || "(none)" : `(tree ${verify.tree} is gone: carry nothing, rerun everything)`;
    const candidates = passingEntries(verify).map((entry) => JSON.stringify(carriedAs(entry, { carried_from: k })));
    return {
      text: text.join("\n\n"),
      judge: [
        `Latest green verification: verify-${k}.json (tree ${verify.tree}). Files changed since:`,
        changed,
        `Carry candidates: append to the brief the line "${carryHeader}" and, below it, each line here that no changed file reaches:`,
        ...candidates,
      ].join("\n"),
    };
  }
  text.push("Carried entries: none; this is the first verification, so run everything.");
  return { text: text.join("\n\n"), judge: "no earlier green verification: the brief runs everything" };
}

const pidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

// Claims the next record number atomically, so checks started in parallel never share a record.
function claimRecord(execDir: string, record: ExecRecord & { started: string }): number {
  for (let k = 1; ; k++) {
    let fd: number;
    try {
      fd = openSync(`${execDir}/${k}.json`, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw error;
    }
    writeSync(fd, `${JSON.stringify({ ...record, log: record.log.replace("<k>", String(k)) }, null, 2)}\n`);
    closeSync(fd);
    return k;
  }
}

// Runs one check and records what the gate itself observed. The record exists from the start without `exit`, so a
// check still running, or killed with its exec process, never reads as a result.
async function execCheck(round: number, base: boolean, words: string[]): Promise<number> {
  const command = words.join(" ");
  if (!command) throw new Error("usage: gate.ts exec <round> [--base] -- <command>");
  const dir = await stateDir();
  const roundDir = `${dir}/round-${round}`;
  let cwd = process.cwd();
  if (base) {
    const baseFile = Bun.file(`${roundDir}/base`);
    if (!(await baseFile.exists())) throw new Error(`${roundDir}/base: missing; gate.ts prepare ${round} writes it`);
    const baseRoot = `${roundDir}/evidence/base`;
    if (!existsSync(baseRoot))
      throw new Error(`${baseRoot}: missing; create it with git worktree add --detach ${baseRoot} ${(await baseFile.text()).trim()} and run the repo's install there`);
    cwd = join(baseRoot, relative(await toplevel(), process.cwd()));
  }
  const head = (await $`git rev-parse HEAD`.cwd(cwd).text()).trim();
  const start = {
    command,
    cwd,
    head,
    ...(base ? { base: true } : { tree: await tree(cwd) }),
    pid: process.pid,
    log: `${roundDir}/evidence/exec-<k>.log`,
    started: new Date().toISOString(),
  };
  mkdirSync(`${roundDir}/exec`, { recursive: true });
  mkdirSync(`${roundDir}/evidence`, { recursive: true });
  const k = claimRecord(`${roundDir}/exec`, start);
  const record = { ...start, log: `${roundDir}/evidence/exec-${k}.log` };

  // The log is the evidence; a closed terminal (a background run) must not kill the check halfway.
  process.stdout.on("error", () => {});
  process.stderr.on("error", () => {});
  const began = performance.now();
  const child = Bun.spawn([process.env.SHELL || "/bin/sh", "-c", command], { cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const log = Bun.file(record.log).writer();
  const pump = async (stream: ReadableStream<Uint8Array>, out: NodeJS.WriteStream) => {
    for await (const chunk of stream) {
      log.write(chunk);
      out.write(chunk);
    }
  };
  await Promise.all([pump(child.stdout, process.stdout), pump(child.stderr, process.stderr), child.exited]);
  await log.end();
  const signal = child.signalCode ? (osConstants.signals[child.signalCode as keyof typeof osConstants.signals] ?? 0) : 0;
  const exit = child.exitCode ?? 128 + signal;
  const seconds = Math.round((performance.now() - began) / 1000);
  const path = `${roundDir}/exec/${k}.json`;
  // Write then rename, so a reader never sees half a record.
  await Bun.write(`${path}.tmp`, `${JSON.stringify({ ...record, exit, seconds }, null, 2)}\n`);
  renameSync(`${path}.tmp`, path);
  console.error(`exec ${k}: exit ${exit} in ${seconds}s, log ${record.log}`);
  return exit;
}

// Waits for round N's running checks, at most WAIT_MINUTES, then prints every record. Exit 1 = some still run.
async function waitExec(round: number): Promise<number> {
  const dir = await stateDir();
  const deadline = Date.now() + WAIT_MINUTES * 60_000;
  for (;;) {
    const records = await readExecRecords(dir, round);
    const running = records.filter(({ record }) => record.exit === undefined && pidAlive(record.pid));
    if (running.length === 0 || Date.now() >= deadline) {
      for (const { k, record } of records) {
        const state =
          record.exit !== undefined ? `exit ${record.exit} in ${record.seconds}s` : pidAlive(record.pid) ? "running" : "died without an exit";
        console.log(`exec/${k}.json${record.base ? " (base)" : ""}: ${state}: ${record.command}`);
      }
      return running.length > 0 ? 1 : 0;
    }
    await Bun.sleep(5000);
  }
}

function roundNames(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return [...new Bun.Glob("round-*.json").scanSync(dir)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

async function readFix(path: string | undefined): Promise<Fix> {
  if (!path) return { fixed: [], rejected: [] };
  const value = await readJson(path);
  if (!isObject(value) || !Array.isArray(value.fixed) || !value.fixed.every(isString))
    throw new Error(`${path}: "fixed" must be an array of finding titles`);
  if (!Array.isArray(value.rejected)) throw new Error(`${path}: "rejected" must be an array`);
  for (const [i, rejection] of value.rejected.entries())
    if (!isObject(rejection) || !isString(rejection.file) || !isString(rejection.title) || !isString(rejection.reason) || (rejection.line !== undefined && !Number.isInteger(rejection.line)))
      throw new Error(`${path}: rejected[${i}] needs file, title, and reason strings, and an integer line`);
  return { fixed: value.fixed, rejected: value.rejected as Rejection[] };
}

// The findings part of a reviewed round's file, from the review-<S>.json files `reviewed` wrote from the traces.
async function reviewedFindings(dir: string, round: string): Promise<RecordedFindings> {
  const roundDir = `${dir}/round-${round}`;
  if (!existsSync(`${roundDir}/slices`)) throw new Error(`round ${round} is green but was never sliced; run gate.ts slice ${round} and the reviewers first`);
  const reviews = await judgeReviews(dir, round);
  const failed = reviews.filter((review) => review.problem);
  if (failed.length > 0) throw new Error(`round ${round} has no proven review: ${failed.map((review) => review.summary).join("; ")}`);
  const findings: ReviewFinding[] = [];
  for (const { name } of reviews) {
    const review = await readJson(`${roundDir}/review-${name}.json`);
    if (isObject(review) && Array.isArray(review.findings)) findings.push(...review.findings.filter(isFinding));
  }
  const blocking = (finding: ReviewFinding) => finding.severity === "critical" || finding.severity === "major";
  const majors = findings.filter((f) => blocking(f) && !f.pre_existing).map(({ file, line, title, why, trigger }) => ({ file, line, title, why, trigger }));
  const minor = findings.filter((f) => f.severity === "minor" && !f.pre_existing).map(({ file, line, title }) => ({ file, line, title }));
  // A previous minor whose file was in no slice this round was not re-read, so it still stands for the minor pass.
  const sliced = new Set(
    readdirSync(roundDir)
      .filter((name) => /^slice-.+\.txt$/.test(name))
      .flatMap((name) => readFileSync(`${roundDir}/${name}`, "utf8").split("\n").filter(Boolean)),
  );
  const previous = (await earlierReviewedRounds(dir, round)).at(-1);
  for (const finding of previous?.minor ?? []) {
    if (!isObject(finding) || !isString(finding.file) || !isString(finding.title) || sliced.has(finding.file)) continue;
    if (minor.some((m) => m.file === finding.file && m.title === finding.title)) continue;
    minor.push({ file: finding.file, line: Number(finding.line) || 0, title: finding.title });
  }
  const preExisting = findings
    .filter((f) => f.pre_existing)
    .map(({ file, line, severity, title, why, trigger }) => ({ file, line, severity, title, why, trigger }));
  return { findings: findings.length, majors, minor, pre_existing: preExisting };
}

// Writes round-N.json. A red or blocked round records no findings: its code was not reviewed.
async function record(round: string, fixPath: string | undefined): Promise<string> {
  const dir = await stateDir();
  const outcome = await readVerify(dir, round);
  const { verify } = outcome;
  const fix = await readFix(fixPath);
  const head = (await $`git rev-parse HEAD`.text()).trim();
  const reviewed: RecordedFindings =
    outcome.result === "green" ? await reviewedFindings(dir, round) : { findings: 0, majors: [], minor: [], pre_existing: [] };
  const numstat = await Bun.file(`${dir}/round-${round}/files.txt`).text();
  const diff = diffSize(numstat, await generatedPaths(await toplevel(), numstat.split("\n").map(pathOf).filter(Boolean)));
  let first: DiffSize | undefined;
  for (const name of roundNames(dir)) {
    const earlier = await readJson(`${dir}/${name}`);
    if (!isObject(earlier) || Number(earlier.round) >= Number(round) || !isDiffSize(earlier.diff)) continue;
    first = earlier.diff;
    break;
  }
  const body = {
    round: Number(round),
    head: verify.head,
    tree: verify.tree,
    diff,
    ...reviewed,
    fixed: fix.fixed.length,
    rejected: outcome.result === "green" ? fix.rejected : [],
    commit: head !== verify.head ? head : null,
  };
  await Bun.write(`${dir}/round-${round}.json`, `${JSON.stringify(body, null, 2)}\n`);
  return `Round ${round}: verify=${describeOutcome(outcome)} findings=${body.findings} major=${body.majors.length} fixed=${body.fixed} rejected=${body.rejected.length} minor=${body.minor.length} pre-existing=${body.pre_existing.length} diff=${describeDiff(diff, first)}`;
}

type CheckedRound = Round & { name: string; verify: Outcome["result"]; diff?: DiffSize };

const roundNumber = (round: { name: string }): string => round.name.slice("round-".length, -".json".length);

// The latest recorded round on the current tree, when it is green with no critical/major finding. That exact code was
// verified and reviewed clean, so a later round on other code (a follow-up commit since reverted) does not undo it;
// a later round on the same tree (red, blocked, or with a major) is a newer judgment of that code and wins.
export function convergedRound<T extends { tree: string; majors: unknown[]; verify: string }>(rounds: T[], current: string): T | undefined {
  const latestOnTree = rounds.filter((round) => round.tree === current).at(-1);
  if (latestOnTree?.verify !== "green" || latestOnTree.majors.length > 0) return undefined;
  return latestOnTree;
}

// A file with a critical/major finding in each of the last k green rounds (given oldest first): fixes keep breaking
// the same code, even when no finding repeats an earlier one. Fewer than k rounds hold no hotspot.
export function hotspots(rounds: { round: string; majors: Finding[] }[], k = HOTSPOT_ROUNDS): Hotspot[] {
  const window = rounds.slice(-k);
  if (window.length < k) return [];
  const files = [...new Set(window[0].majors.map((finding) => finding.file))];
  return files
    .filter((file) => window.every((round) => round.majors.some((finding) => finding.file === file)))
    .map((file) => ({
      hotspot: file,
      rounds: window.map((round) => round.round),
      titles: window.flatMap((round) => round.majors.filter((finding) => finding.file === file).map((finding) => finding.title)),
    }));
}

// Diff bloat since the baseline green round (first green round, or first green round after resume):
// stalls when hand-written diff grew by at least DIFF_GROWTH_LINES and DIFF_GROWTH_RATIO.
export function diffBloat(rounds: { round: string; diff?: DiffSize }[]): Bloat[] {
  const measured = rounds.filter((r): r is { round: string; diff: DiffSize } => isDiffSize(r.diff));
  if (measured.length < 2) return [];
  const first = measured[0]!;
  const latest = measured.at(-1)!;
  const firstTotal = first.diff.added + first.diff.removed;
  const latestTotal = latest.diff.added + latest.diff.removed;
  const growth = latestTotal - firstTotal;
  if (growth < DIFF_GROWTH_LINES) return [];
  const ratio = firstTotal > 0 ? growth / firstTotal : 1;
  if (ratio < DIFF_GROWTH_RATIO) return [];
  return [{ bloat: `round-${latest.round}`, baseRound: first.round, growth, percent: Math.round(ratio * 100) }];
}

// Post-resume divergence: after a resume, two consecutive green rounds whose major counts do not decrease.
export function postResumeDivergence(rounds: { round: string; majors: Finding[] }[], resumedFrom: number): Diverging[] {
  if (resumedFrom <= 0 || rounds.length < 2) return [];
  const prev = rounds.at(-2)!;
  const curr = rounds.at(-1)!;
  if (prev.majors.length > 0 && curr.majors.length >= prev.majors.length) {
    return [{ diverging: `round-${curr.round}`, rounds: [prev.round, curr.round], counts: [prev.majors.length, curr.majors.length] }];
  }
  return [];
}

// The latest round a `resume` let go on from, 0 when the loop never resumed. A stalls/<n>/ without the round file
// (archived before resume recorded it) counts as 0.
export function resumedAfter(dir: string): number {
  const stallsDir = `${dir}/stalls`;
  if (!existsSync(stallsDir)) return 0;
  let latest = 0;
  for (const n of readdirSync(stallsDir)) {
    const path = `${stallsDir}/${n}/round`;
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8").trim();
    if (!/^\d+$/.test(text)) throw new Error(`${path}: not a round number; only gate.ts resume writes it`);
    latest = Math.max(latest, Number(text));
  }
  return latest;
}

// Every recorded round, oldest first, with its verification outcome. Throws on a round file the gate cannot trust.
async function readRounds(dir: string): Promise<CheckedRound[]> {
  return Promise.all(
    roundNames(dir).map(async (name) => {
      const round = await readJson(`${dir}/${name}`);
      if (!isRound(round)) throw new Error(`${dir}/${name}: lacks "head", "tree", or the "majors" array`);
      const { result, verify } = await readVerify(dir, name.slice("round-".length, -".json".length));
      if (verify.tree !== round.tree)
        throw new Error(`${name}: tree ${round.tree} was not the verified tree ${verify.tree}; re-verify before recording`);
      const failed = (await judgeReviews(dir, name.slice("round-".length, -".json".length))).filter((review) => review.problem);
      if (failed.length > 0)
        throw new Error(`${name} was recorded without a proven review: ${failed.map((review) => review.summary).join("; ")}`);
      return { ...round, name, verify: result };
    }),
  );
}

// The verdict, and for `converged` the round file it converged on when the round files identify one (convergedRound).
// A cached converged status written by an older gate may name none: its rounds no longer prove green under today's
// rules, and `ready` then reads the latest round file, as that gate did.
type Verdict = { result?: "converged" | "stalled"; convergedOn?: string };

async function verdict(): Promise<Verdict> {
  const dir = await stateDir();
  if (!existsSync(dir)) return {}; // no round recorded yet
  const current = await tree();
  const rounds = await readRounds(dir);
  const converged = convergedRound(rounds, current);

  // After validating rounds, so a bad round file still breaks the gate; reuse skips the same-defect judge.
  const statusFile = Bun.file(`${dir}/status`);
  if (await statusFile.exists()) {
    const [status, statusTree] = (await statusFile.text()).trim().split(" ");
    if (statusTree === current && status === "stalled") return { result: status };
    if (statusTree === current && status === "converged") return { result: status, convergedOn: converged?.name };
    await statusFile.delete(); // stale: written for code that has changed since
  }
  rmSync(`${dir}/stall.json`, { force: true }); // judged again below; a leftover would explain a stall that no longer holds

  if (converged) {
    await Bun.write(`${dir}/status`, `converged ${current}\n`);
    return { result: "converged", convergedOn: converged.name };
  }

  const green = rounds.filter((round) => round.verify === "green");
  const latest = green.at(-1);
  if (!latest || rounds.at(-1) !== latest) return {};

  // Converged is only for the code that was reviewed (above): a clean round whose fixes changed the code is
  // verified and reviewed by one more round. Stalled is about the history, so fixes since don't matter.
  if (latest.majors.length === 0) return {};
  const earlier = green.slice(0, -1).flatMap((round) =>
    round.majors.map((finding) => ({
      finding,
      round: roundNumber(round),
      rejected: (round.rejected ?? []).some((r) => isObject(r) && r.file === finding.file && r.title === finding.title),
    })),
  );
  const repeats = await repeatsEarlier(dir, latest.majors, earlier);
  // Rounds a resume already let go on from never stall the loop again.
  const resumedFrom = resumedAfter(dir);
  const sinceResume = green
    .filter((round) => Number(roundNumber(round)) > resumedFrom)
    .map((round) => ({ round: roundNumber(round), majors: round.majors, diff: round.diff }));
  const stall: StallEntry[] =
    repeats.length > 0
      ? repeats
      : hotspots(sinceResume).length > 0
        ? hotspots(sinceResume)
        : postResumeDivergence(sinceResume, resumedFrom).length > 0
          ? postResumeDivergence(sinceResume, resumedFrom)
          : diffBloat(sinceResume);
  if (stall.length === 0) return {};
  await Bun.write(`${dir}/stall.json`, `${JSON.stringify(stall, null, 2)}\n`);
  await Bun.write(`${dir}/status`, `stalled ${current}\n`);
  return { result: "stalled" };
}

// Why the PR must stay draft (reason), and the minors it leaves for the human. The minors come from the round the
// verdict converged on (a later round on another tree judged code that is no longer there), or from the latest round
// file when the verdict names none. The minor pass is owed only when that round left minors: a round with none has
// nothing to pass on.
async function readiness(): Promise<{ reason?: string; minors: string[] }> {
  const { result, convergedOn } = await verdict();
  if (result !== "converged") return { reason: "the loop has not converged on the current code", minors: [] };
  const dir = await stateDir();
  const name = convergedOn ?? roundNames(dir).at(-1);
  const round = await readJson(`${dir}/${name}`);
  if (!isObject(round) || !Array.isArray(round.minor)) throw new Error(`${dir}/${name}: lacks the "minor" array`);
  const minors = round.minor.map((finding) => (isObject(finding) ? `${finding.file}: ${finding.title}` : String(finding)));
  if (minors.length > 0 && !existsSync(`${dir}/minor-pass`)) return { reason: `the minor pass has not run on the ${minors.length} minor finding(s) of ${name}`, minors };
  return { minors };
}

// Archives a stalled loop's verdict so the next round runs. Round files stay: they are the history the next stall
// judgment compares against. stalls/<n>/round keeps the latest recorded round, so the rounds behind a hotspot never
// stall the loop again; it is written before status moves, so a crash halfway leaves the loop still stalled.
async function resume(): Promise<{ resumed: boolean; message: string }> {
  const dir = await stateDir();
  const statusFile = Bun.file(`${dir}/status`);
  if (!(await statusFile.exists())) return { resumed: false, message: "review loop: no status to resume from; run the next round" };
  const status = (await statusFile.text()).trim().split(" ")[0];
  if (status !== "stalled") return { resumed: false, message: `review loop: ${status}; only a stalled loop resumes` };
  let n = 1;
  while (existsSync(`${dir}/stalls/${n}`)) n++;
  mkdirSync(`${dir}/stalls/${n}`, { recursive: true });
  const latestRound = roundNames(dir).at(-1);
  await Bun.write(`${dir}/stalls/${n}/round`, `${latestRound ? roundNumber({ name: latestRound }) : 0}\n`);
  renameSync(`${dir}/status`, `${dir}/stalls/${n}/status`);
  if (existsSync(`${dir}/stall.json`)) renameSync(`${dir}/stall.json`, `${dir}/stalls/${n}/stall.json`);
  return { resumed: true, message: `review loop: resumed; the stall is archived in ${dir}/stalls/${n}/` };
}

// A pair can repeat only when it shares a file (the fix there failed) or the earlier finding was rejected (the
// reviewer re-raised it). The same pattern in another file is a new instance, so it never stalls the loop: an
// earlier fix that worked where it applied is progress, and the round cap bounds the rest.
// GPT-6.2 Astra judges the candidate pairs it has not judged before, in one peer run; every judgment is kept in
// same-defect.json, keyed by the pair's text, so the verdict over the same round files is always the same.
export async function repeatsEarlier(dir: string, latest: Finding[], earlier: Earlier[]): Promise<Repeat[]> {
  const pairs = latest
    .flatMap((finding) => earlier.filter((e) => e.rejected || e.finding.file === finding.file).map((e) => ({ latest: finding, ...e })))
    .map((pair) => ({ ...pair, key: pairKey(pair.latest, pair.finding) }));
  if (pairs.length === 0) return [];

  const cacheFile = `${dir}/same-defect.json`;
  const cache: Record<string, Judgment> = existsSync(cacheFile) ? await readJudgments(cacheFile) : {};
  const unjudged = [...new Map(pairs.filter((pair) => !(pair.key in cache)).map((pair) => [pair.key, pair])).values()];
  if (unjudged.length > 0) {
    const judged = await judgeSameDefect(dir, unjudged.map((pair) => ({ latest: pair.latest, earlier: pair.finding })));
    unjudged.forEach((pair, k) => {
      cache[pair.key] = judged[k];
    });
    // Write a unique sibling then rename: a crash or a concurrent gate never leaves a half-written cache.
    const tmp = `${cacheFile}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      await Bun.write(tmp, `${JSON.stringify(cache, null, 2)}\n`);
      renameSync(tmp, cacheFile);
    } finally {
      rmSync(tmp, { force: true });
    }
  }
  return pairs
    .filter((pair) => cache[pair.key].same)
    .map((pair) => ({ latest: pair.latest, earlier: pair.finding, round: pair.round, reason: cache[pair.key].reason }));
}

// Lines drift between rounds, so only the file and the defect description identify a finding.
const pick = ({ file, title, why }: Finding) => ({ file, title, why });
export const pairKey = (latest: Finding, earlier: Finding): string =>
  new Bun.CryptoHasher("sha256").update(JSON.stringify([pick(latest), pick(earlier)])).digest("hex");

async function readJudgments(file: string): Promise<Record<string, Judgment>> {
  const cache = await readJson(file);
  if (!isObject(cache) || !Object.values(cache).every(isJudgment)) throw new Error(`${file}: not a map of {same, reason} judgments`);
  return cache as Record<string, Judgment>;
}

const isJudgment = (value: unknown): value is Judgment =>
  isObject(value) && typeof value.same === "boolean" && typeof value.reason === "string";

const SAME_DEFECT_TASK = `Each entry of <pairs> holds two code review findings from different rounds of a review loop on one pull request: \`latest\` and \`earlier\`. For each pair, decide whether they report the same underlying defect in the code, even when worded differently or found at shifted lines. Same defect: fixing one would resolve the other. Different defects, even when they share a file or a kind of problem. Judge only from the text given; do not open files. Answer every index exactly once, with \`reason\` in one sentence.`;

async function judgeSameDefect(dir: string, pairs: { latest: Finding; earlier: Finding }[]): Promise<Judgment[]> {
  const prompt = `${SAME_DEFECT_TASK}\n\n<pairs>\n${JSON.stringify(
    pairs.map((pair, index) => ({ index, latest: pick(pair.latest), earlier: pick(pair.earlier) })),
    null,
    2,
  )}\n</pairs>`;
  const schema = join(import.meta.dir, "same-defect-schema.json");
  const { exit, trace } = await runPeer("read", prompt, `${dir}/same-defect.jsonl`, schema);
  if (exit !== 0 || trace.isError) throw new Error(`same-defect judge failed (exit ${exit}): ${trace.text || "no answer"}; trace in ${dir}/same-defect.jsonl`);
  const answers = isObject(trace.output) && Array.isArray(trace.output.pairs) ? trace.output.pairs : undefined;
  const judgments = pairs.map((_, index) => answers?.filter((answer) => isObject(answer) && answer.index === index));
  if (!judgments.every((found): found is Judgment[] => found?.length === 1 && isJudgment(found[0])))
    throw new Error(`same-defect judge did not answer each index exactly once: ${trace.text}`);
  return judgments.map(([{ same, reason }]) => ({ same, reason }));
}

// The repeats or hotspots behind a stall, so the reader sees why without asking. A status reused from an earlier run
// of the gate prints the stall.json that run wrote.
async function printStall(): Promise<void> {
  const file = Bun.file(`${await stateDir()}/stall.json`);
  if (!(await file.exists())) return;
  const entries = (await file.json()) as StallEntry[];
  for (const entry of entries) {
    if ("hotspot" in entry) console.log(`  hotspot: ${entry.hotspot}: critical or major findings in rounds ${entry.rounds.join(", ")}`);
    else if ("bloat" in entry)
      console.log(`  bloat: diff grew by +${entry.growth} lines (+${entry.percent}%) since round ${entry.baseRound}`);
    else if ("diverging" in entry)
      console.log(`  diverging: major findings did not decrease after resume (rounds ${entry.rounds[0]}: ${entry.counts[0]}, ${entry.rounds[1]}: ${entry.counts[1]})`);
    else
      console.log(`  repeat: ${entry.latest.file}: ${entry.latest.title} ≈ round ${entry.round}: ${entry.earlier.title}${entry.reason ? ` (${entry.reason})` : ""}`);
  }
}

function roundArg(value: string | undefined, usage: string): string {
  if (!/^\d+$/.test(value ?? "")) throw new Error(`usage: gate.ts ${usage}`);
  return value!;
}

// Guarded so `packSlices`, `verifyProblem`, and `diffSize` can be imported without running the gate.
if (import.meta.main) {
  try {
    const [command, ...args] = process.argv.slice(2);
    if (command === "tree") {
      console.log(await tree());
      process.exit(0);
    }
    if (command === "round") {
      console.log(roundNames(await stateDir()).length + 1);
      process.exit(0);
    }
    if (command === "prepare") {
      const round = roundArg(args[0], "prepare <round number> --base <ref>");
      if (args[1] !== "--base" || !args[2]) throw new Error("usage: gate.ts prepare <round number> --base <ref>");
      console.log(await prepare(round, args[2]));
      process.exit(0);
    }
    if (command === "reuse") {
      const from = roundArg(args[0], "reuse <from round> <to round>");
      const to = roundArg(args[1], "reuse <from round> <to round>");
      console.log(await reuse(Number(from), Number(to)));
      process.exit(0);
    }
    if (command === "brief") {
      const { text, judge } = await brief(Number(roundArg(args[0], "brief <round number>")));
      console.log(text);
      console.error(judge);
      process.exit(0);
    }
    if (command === "exec") {
      const usage = "exec <round number> [--base] -- <command> | exec <round number> --wait";
      const round = Number(roundArg(args[0], usage));
      if (args[1] === "--wait") process.exit(await waitExec(round));
      const base = args[1] === "--base";
      const separator = base ? 2 : 1;
      if (args[separator] !== "--") throw new Error(`usage: gate.ts ${usage}`);
      process.exit(await execCheck(round, base, args.slice(separator + 1)));
    }
    if (command === "slice") {
      console.log((await slice(roundArg(args[0], "slice <round number>"))).join("\n"));
      process.exit(0);
    }
    if (command === "verify") {
      console.log(describeOutcome(await readVerify(await stateDir(), roundArg(args[0], "verify <round number>"))));
      process.exit(0);
    }
    if (command === "attempt") {
      console.log(await archiveAttempt(Number(roundArg(args[0], "attempt <round number>"))));
      process.exit(0);
    }
    if (command === "reviewed") {
      const reviews = await judgeReviews(await stateDir(), roundArg(args[0], "reviewed <round number>"));
      for (const review of reviews) console.log(review.summary);
      const failed = reviews.filter((review) => review.problem).map((review) => review.name);
      if (failed.length > 0) console.log(`rerun: ${failed.join(" ")}`);
      process.exit(failed.length > 0 ? 1 : 0);
    }
    if (command === "record") {
      const round = roundArg(args[0], "record <round number> [--fix <fixer json file>]");
      if (args[1] !== undefined && (args[1] !== "--fix" || !args[2])) throw new Error("usage: gate.ts record <round number> [--fix <fixer json file>]");
      console.log(await record(round, args[2]));
      process.exit(0);
    }
    if (command === "ready") {
      const { reason, minors } = await readiness();
      for (const minor of minors) console.log(`minor left: ${minor}`);
      console.log(reason ? `review loop: stays draft (${reason})` : "review loop: ready");
      process.exit(reason ? 1 : 0);
    }
    if (command === "resume") {
      const { resumed, message } = await resume();
      console.log(message);
      process.exit(resumed ? 0 : 1);
    }
    if (command !== undefined) throw new Error(`unknown command ${command}`);
    const { result } = await verdict();
    if (!result) process.exit(1);
    console.log(`review loop: ${result}`);
    if (result === "stalled") await printStall();
    process.exit(0);
  } catch (error) {
    // Exit 1 would mean "continue": any failure must surface as a broken gate instead.
    console.error(`review gate: ${error instanceof Error ? error.message : error}`);
    process.exit(2);
  }
}
