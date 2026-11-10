#!/usr/bin/env bun
// Gate for the review-round skill: `bun ~/.agents/skills/review-round/gate.ts [command]`, run from the PR's worktree.
// Every file a verdict depends on is written or judged here, so the skill acts on the gate's output instead of its
// own reading of the state.
//
// State: $(git common dir)/review/<branch>/ ("dir"), shared by every worktree of the repo so it outlives them.
//   round-N.json       written by `record` only; noise.ts and the verdict read it.
//   verify-N.json      written by the verifier (contract in verifier.md) or by `reuse`, never by the skill. The round's
//                      verdict is derived here from it. verify-0.json is the implement skill's final verification,
//                      written before the loop; its exec records live in round-0/.
//   round-N/           files.txt, patches/, base (`prepare`); review prompts, slice-<S>.txt, slices (`slice`);
//                      review-<S>.json (`reviewed`); verify-attempt-<A>.json (`attempt`); exec/<k>.json and
//                      evidence/exec-<k>.log (`exec`).
//   status, stall.json written by the verdict only; `resume` archives them under stalls/<n>/.
//
// Commands (exit 2 always means a broken gate: bad or missing file, git or TypeSafe error; the skill stops):
//   (none)          the verdict after a round. Exit 0 = stop, printing `review loop: converged|stalled` and writing
//                   "<status> <tree>" to status; exit 1 = run another round.
//   tree            the working-tree hash (tracked + untracked, ignoring .gitignore'd files) that verify, exec, and
//                   round files are keyed on.
//   round           the next round number (recorded rounds + 1).
//   prepare N --base <ref>   fetches origin/<ref>, then writes round N's diff handoff against the merge-base:
//                   files.txt (numstat), one patch per file, and base (the merge-base sha). Renames are split into a
//                   delete and an add, so every path in files.txt has its own patch.
//   reuse K N       copies verify-K.json, verified on the current tree, to verify-N.json with "reused_from" set to
//                   the round that ran it. Its carried attempts, exec records, and base resolve in that round.
//   brief N         prints the mechanical part of round N's verifier brief on stdout and, on stderr, what the skill
//                   judges before appending its own part (the files changed since the latest green verification and
//                   the entries it may carry).
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
//                   fixer's {"fixed": [...], "rejected": [...]}, then prints the `Round N: …` line.
//   ready           whether the PR may leave draft (below).
//   resume          archives a stalled loop's status and stall.json, so the next round runs.
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
// whose `surface` is "browser": unit tests and API calls never prove a screen. Generated files (isGenerated) leave this rule and the
// review slices: nobody writes them by hand.
//
// Review. `slice N` packs round N's diff into slices of at most SLICE_LINES changed lines (a bigger single file is its
// own slice) and writes two prompts per slice, review-<S>.prompt (correctness) and review-sec-<S>.prompt (security),
// printing their names one per line (`A`, `sec-A`, `B`, `sec-B`). No name printed = nothing to review. The task texts
// live here so the prompts are the same every round. The first reviewed round covers every file; later ones re-review
// only the files changed since the previous reviewed round plus the files of its rejected findings, so the loop
// converges on its own fixes instead of digging up older code. Every prompt lists the findings earlier rounds rejected
// or recorded as pre-existing, so they are not repeated. `reviewed N` passes a process when its trace
// (review-<S>.jsonl, any engine trace.ts reads) ends with well-formed findings and reads every file of its slice; it
// prints one line per process and `rerun: <names>` for the failures (exit 1). The verdict and `record` refuse a round
// whose reviews do not pass this check.
//
// converged: the latest round is the latest green one, found no critical/major finding, and its tree is the current
//   tree. A round whose fixes changed the code leaves its tree behind the current one, so the fixes are always
//   verified and reviewed by one more round before the loop converges.
// stalled: a critical/major finding of the latest green round repeats one from an earlier green round (the fix
//   failed, or the fixer rejected it and the reviewer reported it again). Only two kinds of pair can repeat: the same
//   file (a failed fix), or an earlier finding the fixer rejected (a disagreement). The same pattern found in another
//   file is a new instance: the loop goes on and the round cap bounds it. "Same defect" is a TypeSafe Jev judgment:
//   fixes shift lines and the reviewer rewords titles, so file/line/title matching misses repeats. Needs
//   TYPESAFE_API_KEY. The repeats behind a stall are written to stall.json and printed.
// ready: exit 0 when the loop converged on the current tree and either the minor pass ran or the latest round left
//   no minor finding to pass on; it prints each remaining minor (`minor left: <file>: <title>`) for the hand-over.
//   Exit 1 prints why the PR stays draft.
// A status written for another tree is stale (the code changed since): it is dropped and the loop goes on.
// Red and blocked rounds never count as passes; they always continue.

import { closeSync, constants, copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, renameSync, rmSync, writeSync } from "node:fs";
import { constants as osConstants, tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import { $ } from "bun";
import { openedFile, readTrace } from "./trace";
import { isUiFile, TEST_FILE } from "./ui";

type Finding = { file: string; line: number; title: string; why: string };
type Round = { head: string; tree: string; majors: Finding[]; rejected?: unknown[] };
type Earlier = { finding: Finding; round: string; rejected: boolean };
type Repeat = { latest: Finding; earlier: Finding; round: string; probability: number };
type Carry = { carried_from?: number; carried_from_attempt?: number };
type Check = Carry & { command: string; exit: number; seconds?: number };
type Scenario = Carry & { name: string; result: "pass" | "fail" | "blocked"; surface?: string; reason?: string; seconds?: number };
type Verify = { head: string; tree: string; checks: Check[]; scenarios: Scenario[]; reused_from?: number };
type ExecRecord = { command: string; cwd: string; head: string; tree?: string; base?: boolean; pid: number; exit?: number; seconds?: number; log: string };
type Numbered = { k: number; record: ExecRecord };
type ReviewFinding = { severity: string; file: string; line: number; title: string; why: string; fix: string; trigger: string; pre_existing: boolean };
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
// The verifier's shell caps one call at 10 minutes, so one wait must end before that.
const WAIT_MINUTES = 9;

// Rules every reviewer prompt shares: finding fields, re-review scope, earlier judgments, and severity.
const FINDING_RULES = `For each finding, \`trigger\` names the input or state that makes it fail. Set \`pre_existing\` to true when the faulty code is not added or changed by the patch: the pull request did not introduce it, so it is recorded for the owner and never blocks this PR. When a defect is one instance of a pattern, report the pattern once, at its first instance, and list every other instance you find in \`why\`, so all of them get fixed in one round.

<scope> says whether this is a full review or a re-review. On a re-review, the files outside your slice were reviewed in an earlier round and have not changed since: open them only to check how your slice affects them. <already_judged> lists findings earlier rounds rejected (with the reason) or recorded as pre-existing. Do not report them again unless you can show the reason is wrong, citing the code that proves it. <generated> lists the generated files of the diff: they are outside every slice; open one only as context for your slice.

Severity: critical = data loss, security, or crash on the main path; major = incorrect behavior or contract violation; minor = real but low-impact defect; nit = anything else, including a stale recipe or doc of a dev tool (a \`verify-<app>\` skill, a script's README) that the product never runs.`;

const REVIEW_TASK = `Review your slice of this pull request diff against its stated intent. Open every patch file listed in <slice>, and surrounding source when needed: the gate rejects a review whose trace never opens one of them. Report only defects you can point to in those patches: wrong logic, contract violations against the intent, missing error handling at trust boundaries, data loss, missing or incorrect tests for changed behavior. Security has its own reviewer. If the repository's AGENTS.md names a review checklist, apply its rules to your slice. Do not report style, naming, formatting, or hypothetical future needs. Zero findings is a valid result.

Also interrogate: a state-changing operation that breaks when it runs twice or after a crash halfway; a guard, retry, cast, or fallback that hides a broken invariant instead of fixing its cause; a check that reads a proxy (cache, mtime, self-report) instead of the real value. For a possible null or bad input, trace the caller before reporting it.

Report every cheapest road to green: a threshold or config loosened; \`.skip\` added, tests deleted, or assertions removed; a new \`@ts-ignore\`, \`eslint-disable\`, \`# noqa\`, \`# type: ignore\`, or coverage-ignore comment; a stub or empty catch; a new exception or allowlist entry. Tightening the bar is fine silently; loosening it is always a finding.

When the diff changes launch config, routes, or seed data and the repository has a \`verify-<app>\` skill, its matching recipe changes in the same PR (check <files>); report a recipe left behind as a nit.

${FINDING_RULES}`;

// The security pass runs as its own reviewer on the same slices: one prompt that covers everything dilutes it.
// The checks mirror the Verification list of the hardening skill, which governs the same code at build time.
const SECURITY_TASK = `Review your slice of this pull request diff for security defects only. Open every patch file listed in <slice>, and surrounding source when needed: the gate rejects a review whose trace never opens one of them. Report a defect only when you can trace untrusted input or an unauthorized caller to the patched code; a missing control that no reachable input exercises is not a finding. Zero findings is a valid result.

Check the patches against each of these:
- Input crossing a trust boundary (request, upload, webhook, queue, third-party response, another process's arguments or files) is schema-validated at the boundary, and downstream code uses only the parsed value.
- Every protected route or action checks authentication and per-resource authorization: the caller owns or was granted this record, not merely logged in.
- SQL, NoSQL, and shell calls are parameterized; untrusted data never reaches eval, innerHTML, a shell, or a file path.
- No secret in source, logs, or error bodies; required config and secrets fail at startup instead of falling back; error responses expose no internals.
- Server-side fetches of user-influenced URLs allowlist scheme and host, reject private, loopback, and link-local addresses, and forbid redirects.
- Deletes, moves, and overwrites on derived paths check an allowlisted root, a depth below it, and ownership on the resolved path.
- Money-moving writes derive the idempotency key from the intent, claim it atomically, reject the same key with a different payload, and record an unknown outcome instead of retrying blindly.
- LLM output is validated and encoded before it reaches SQL, a shell, the DOM, or a path; permissions are enforced in code, not in the prompt.
- New or bumped dependencies in a manifest of your slice: install scripts and the lockfile diff (its patch is listed under <generated>) hold only the intended packages.

A security defect reachable from a trust boundary is critical.

${FINDING_RULES}`;

// 0.5 = "more likely the same defect than not"; recalibrate on real rounds if stalls look wrong.
const SAME_DEFECT = 0.5;

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
const patchPath = (roundDir: string, path: string): string => `${roundDir}/patches/${path.replaceAll("/", "__")}.patch`;

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

// files.txt is `git diff --numstat`: added<TAB>removed<TAB>path.
async function changesUi(filesTxt: string): Promise<boolean> {
  const file = Bun.file(filesTxt);
  if (!(await file.exists())) throw new Error(`${filesTxt}: missing; gate.ts prepare writes it at the start of the round`);
  const root = await toplevel();
  const paths = (await file.text()).split("\n").map(pathOf).filter((path) => path && !TEST_FILE.test(path));
  const generated = await generatedPaths(root, paths);
  for (const path of paths) {
    if (generated.has(path)) continue;
    if (await isUiFile(root, path)) return true;
  }
  return false;
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

// Writes round N's diff handoff against the merge-base with origin/<base>, working tree included so the previous
// round's fixes are always seen. --no-renames splits a rename into a delete and an add: a rename's numstat path
// (`old => new`) names no file, so it would match no patch.
async function prepare(round: string, base: string): Promise<string> {
  const root = await toplevel();
  const roundDir = `${await stateDir()}/round-${round}`;
  await $`git fetch --quiet origin ${base}`.cwd(root);
  const mergeBase = (await $`git merge-base ${`origin/${base}`} HEAD`.cwd(root).text()).trim();
  rmSync(`${roundDir}/patches`, { recursive: true, force: true }); // a rerun of prepare must not keep stale patches
  mkdirSync(`${roundDir}/patches`, { recursive: true });
  // -z keeps unusual paths verbatim instead of quoted.
  const records = (await $`git diff --no-renames -z --numstat ${mergeBase}`.cwd(root).text()).split("\0").filter(Boolean);
  for (const line of records) {
    // `:(literal)` stops git from reading a `*` or `?` in a file name as a glob.
    const patch = await $`git diff --no-renames ${mergeBase} -- ${`:(literal)${pathOf(line)}`}`.cwd(root).text();
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
  const earlier = await earlierReviewedRounds(dir, round);
  const previous = earlier.at(-1);
  const kept = await reReviewPaths(previous, verify.tree);
  const files = await Bun.file(`${roundDir}/files.txt`).text();
  const scopedLines = files.split("\n").filter((line) => pathOf(line) && (!kept || kept.has(pathOf(line))));
  const generated = await generatedPaths(await toplevel(), scopedLines.map(pathOf));
  const reviewed = scopedLines.filter((line) => !generated.has(pathOf(line))).join("\n");
  const scope = kept
    ? `Re-review: only files changed since ${previous?.name.slice(0, -".json".length)} or named by its rejected findings are in the slices.`
    : "Full review: every changed file of the pull request is in the slices.";
  const judged = describeJudged(earlier);
  const generatedList = [...generated].map((path) => `- ${path}: generated, not reviewed (${patchPath(roundDir, path)})`).join("\n");
  const intent = (await $`gh pr view --json body --jq .body`.text()).trim();
  const checks = [
    ...verify.checks.map((check) => `- ${check.command}: exit ${check.exit}${known.includes(check.command) ? " (fails on the base too)" : ""}`),
    ...verify.scenarios.map((scenario) => `- ${scenario.name}: ${scenario.result}`),
  ].join("\n");
  const names: string[] = [];
  for (const [i, paths] of packSlices(reviewed).entries()) {
    const name = i < 26 ? String.fromCharCode(65 + i) : `S${i}`;
    const patches = [];
    for (const path of paths) {
      const patch = patchPath(roundDir, path);
      if (!(await Bun.file(patch).exists())) throw new Error(`${patch}: missing; gate.ts prepare writes one patch per file`);
      patches.push(patch);
    }
    const context = `<intent>\n${intent}\n</intent>\n<checks_passed>\n${checks}\n</checks_passed>\n<scope>\n${scope}\n</scope>\n<already_judged>\n${judged || "none"}\n</already_judged>\n<files>\n${files.trim()}\n</files>\n<generated>\n${generatedList || "none"}\n</generated>\n<slice>\n${patches.join("\n")}\n</slice>\n`;
    await Bun.write(`${roundDir}/review-${name}.prompt`, `${REVIEW_TASK}\n\n${context}`);
    await Bun.write(`${roundDir}/review-sec-${name}.prompt`, `${SECURITY_TASK}\n\n${context}`);
    await Bun.write(`${roundDir}/slice-${name}.txt`, `${paths.join("\n")}\n`);
    names.push(name, `sec-${name}`);
  }
  // Written even when empty: `record` tells "nothing to review" from "slice never ran" by this file.
  await Bun.write(`${roundDir}/slices`, names.length > 0 ? `${names.join("\n")}\n` : "");
  return names;
}

type ReviewCheck = { name: string; problem?: string; summary: string };

const SEVERITIES = ["critical", "major", "minor", "nit"];

// The shape reviewer-schema.json asks for. Both engines enforce the schema, but the answer is still model output, so
// the gate checks it here before it records a finding.
function isFinding(value: unknown): value is ReviewFinding {
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
// clean review, so a review counts only when the trace shows a read of every file of its slice (the patch or the
// source file) and ends with a well-formed result. On success it writes review-<name>.json from that result: the
// trace is the only source of the findings.
async function judgeReview(roundDir: string, name: string): Promise<ReviewCheck> {
  const letter = name.replace(/^sec-/, "");
  const paths = (await Bun.file(`${roundDir}/slice-${letter}.txt`).text()).split("\n").filter(Boolean);
  const traceFile = Bun.file(`${roundDir}/review-${name}.jsonl`);
  if (!(await traceFile.exists())) return { name, problem: "no trace", summary: `${name}: no trace review-${name}.jsonl` };
  const { engine, opened, output, toolCalls } = readTrace(await traceFile.text());
  const unopened = paths.filter((path) => !opened.includes(patchPath(roundDir, path)) && !openedFile(opened, path));
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

// The failing checks that fail on the merge-base too: the latest base run of the same command, at the sha
// round-N/base holds, exited non-zero. The PR did not introduce them, so they are recorded as pre-existing.
async function knownFailures(dir: string, verify: Verify, records: Numbered[], source: number): Promise<string[]> {
  const baseFile = Bun.file(`${dir}/round-${source}/base`);
  if (!(await baseFile.exists())) return [];
  const baseSha = (await baseFile.text()).trim();
  return verify.checks
    .filter((check) => check.exit !== 0 && !isCarried(check))
    .filter((check) => {
      const run = latestFinished(records, (record) => record.base === true && record.command === check.command && record.head === baseSha);
      return run !== undefined && run.record.exit !== 0;
    })
    .map((check) => check.command);
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
  const known = await knownFailures(dir, verify, records, source);
  // verify-0.json has no round, so no files.txt. Its UI rule is not checked here: a round that reuses or carries from
  // it is judged on its own files.txt, so a UI diff still needs a passing browser scenario there.
  const ui = round === "0" ? false : await changesUi(`${dir}/round-${round}/files.txt`);
  const outcome = verifyResult(verify, ui, known);
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
  const body = {
    round: Number(round),
    head: verify.head,
    tree: verify.tree,
    ...reviewed,
    fixed: fix.fixed.length,
    rejected: outcome.result === "green" ? fix.rejected : [],
    commit: head !== verify.head ? head : null,
  };
  await Bun.write(`${dir}/round-${round}.json`, `${JSON.stringify(body, null, 2)}\n`);
  return `Round ${round}: verify=${describeOutcome(outcome)} findings=${body.findings} major=${body.majors.length} fixed=${body.fixed} rejected=${body.rejected.length} minor=${body.minor.length} pre-existing=${body.pre_existing.length}`;
}

async function verdict(): Promise<"converged" | "stalled" | undefined> {
  const dir = await stateDir();
  if (!existsSync(dir)) return undefined; // no round recorded yet
  const current = await tree();

  const names = roundNames(dir);
  const rounds = await Promise.all(
    names.map(async (name) => {
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

  // After validating rounds, so a bad round file still breaks the gate; reuse skips the TypeSafe call.
  const statusFile = Bun.file(`${dir}/status`);
  if (await statusFile.exists()) {
    const [status, statusTree] = (await statusFile.text()).trim().split(" ");
    if (statusTree === current && (status === "converged" || status === "stalled")) return status;
    await statusFile.delete(); // stale: written for code that has changed since
  }
  rmSync(`${dir}/stall.json`, { force: true }); // judged again below; a leftover would explain a stall that no longer holds

  const green = rounds.filter((round) => round.verify === "green");
  const latest = green.at(-1);
  if (!latest || rounds.at(-1) !== latest) return undefined;

  let result: "converged" | "stalled" | undefined;
  // Converged only for the code that was reviewed; stalled is about the history, so fixes since don't matter.
  if (latest.majors.length === 0) result = latest.tree === current ? "converged" : undefined;
  else {
    const earlier = green.slice(0, -1).flatMap((round) =>
      round.majors.map((finding) => ({
        finding,
        round: round.name.slice("round-".length, -".json".length),
        rejected: (round.rejected ?? []).some((r) => isObject(r) && r.file === finding.file && r.title === finding.title),
      })),
    );
    const repeats = await repeatsEarlier(latest.majors, earlier);
    if (repeats.length > 0) {
      result = "stalled";
      await Bun.write(`${dir}/stall.json`, `${JSON.stringify(repeats, null, 2)}\n`);
    }
  }
  if (result) await Bun.write(`${dir}/status`, `${result} ${current}\n`);
  return result;
}

// Why the PR must stay draft (reason), and the minors it leaves for the human. Converged already guarantees the
// latest round is green, has no critical/major finding, and reviewed the current tree. The minor pass is owed only
// when that round left minors: a round with none has nothing to pass on.
async function readiness(): Promise<{ reason?: string; minors: string[] }> {
  if ((await verdict()) !== "converged") return { reason: "the loop has not converged on the current code", minors: [] };
  const dir = await stateDir();
  const latestName = roundNames(dir).at(-1);
  const latest = await readJson(`${dir}/${latestName}`);
  if (!isObject(latest) || !Array.isArray(latest.minor)) throw new Error(`${dir}/${latestName}: lacks the "minor" array`);
  const minors = latest.minor.map((finding) => (isObject(finding) ? `${finding.file}: ${finding.title}` : String(finding)));
  if (minors.length > 0 && !existsSync(`${dir}/minor-pass`)) return { reason: `the minor pass has not run on the ${minors.length} minor finding(s) of ${latestName}`, minors };
  return { minors };
}

// Archives a stalled loop's verdict so the next round runs. Round files stay: they are the history the next stall
// judgment compares against.
async function resume(): Promise<{ resumed: boolean; message: string }> {
  const dir = await stateDir();
  const statusFile = Bun.file(`${dir}/status`);
  if (!(await statusFile.exists())) return { resumed: false, message: "review loop: no status to resume from; run the next round" };
  const status = (await statusFile.text()).trim().split(" ")[0];
  if (status !== "stalled") return { resumed: false, message: `review loop: ${status}; only a stalled loop resumes` };
  let n = 1;
  while (existsSync(`${dir}/stalls/${n}`)) n++;
  mkdirSync(`${dir}/stalls/${n}`, { recursive: true });
  renameSync(`${dir}/status`, `${dir}/stalls/${n}/status`);
  if (existsSync(`${dir}/stall.json`)) renameSync(`${dir}/stall.json`, `${dir}/stalls/${n}/stall.json`);
  return { resumed: true, message: `review loop: resumed; the stall is archived in ${dir}/stalls/${n}/` };
}

// A pair can repeat only when it shares a file (the fix there failed) or the earlier finding was rejected (the
// reviewer re-raised it). The same pattern in another file is a new instance, so it never stalls the loop: an
// earlier fix that worked where it applied is progress, and the round cap bounds the rest.
// One Noul per candidate pair, all in one request; returns the pairs judged the same defect.
async function repeatsEarlier(latest: Finding[], earlier: Earlier[]): Promise<Repeat[]> {
  const pairs = latest.flatMap((finding) =>
    earlier.filter((e) => e.rejected || e.finding.file === finding.file).map((e) => ({ latest: finding, ...e })),
  );
  if (pairs.length === 0) return [];
  const key = Bun.env.TYPESAFE_API_KEY;
  if (!key) throw new Error("TYPESAFE_API_KEY is not set");

  const questions = Object.fromEntries(
    pairs.map((_, k) => [
      `${k}`,
      {
        type: "noul",
        instructions: `Do \`latest[${k}]\` and \`earlier[${k}]\` report the same underlying defect in the code, even if worded differently?`,
        criteria: {
          true: "Same defect: fixing one would resolve the other.",
          false: "Different defects, even when they share a file or a kind of problem.",
        },
      },
    ]),
  );
  // Lines drift between rounds, so only the file and the defect description are compared.
  const pick = ({ file, title, why }: Finding) => ({ file, title, why });
  const body = JSON.stringify({
    model: "jev-latest",
    state: { latest: pairs.map((pair) => pick(pair.latest)), earlier: pairs.map((pair) => pick(pair.finding)) },
    questions,
  });

  for (let attempt = 0; ; attempt++) {
    const response = await fetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body,
    });
    // 429 rate limit / 529 overloaded: documented as retryable with backoff.
    if ((response.status === 429 || response.status === 529) && attempt < 3) {
      await Bun.sleep(1000 * 2 ** attempt);
      continue;
    }
    if (!response.ok) throw new Error(`TypeSafe ${response.status}: ${await response.text()}`);
    // Unchecked shape on purpose: every probability is type-checked just below.
    const { answers } = (await response.json()) as { answers?: Record<string, { noul?: unknown }> };
    // Read by key, not by order: answers is an object and its key order is the server's.
    const probabilities = pairs.map((_, k) => answers?.[`${k}`]?.noul);
    if (!probabilities.every((probability): probability is number => typeof probability === "number"))
      throw new Error(`unexpected TypeSafe answers: ${JSON.stringify(answers)}`);
    return pairs
      .map((pair, k) => ({ latest: pair.latest, earlier: pair.finding, round: pair.round, probability: probabilities[k] }))
      .filter((repeat) => repeat.probability >= SAME_DEFECT);
  }
}

// The pairs behind a stall, so the reader sees which findings repeated without asking. A status reused from an
// earlier run of the gate prints the stall.json that run wrote.
async function printRepeats(): Promise<void> {
  const file = Bun.file(`${await stateDir()}/stall.json`);
  if (!(await file.exists())) return;
  const repeats = (await file.json()) as Repeat[];
  for (const r of repeats)
    console.log(`  repeat ${r.probability.toFixed(2)}: ${r.latest.file}: ${r.latest.title} ≈ round ${r.round}: ${r.earlier.title}`);
}

function roundArg(value: string | undefined, usage: string): string {
  if (!/^\d+$/.test(value ?? "")) throw new Error(`usage: gate.ts ${usage}`);
  return value!;
}

// Guarded so `packSlices` and `verifyProblem` can be imported without running the gate.
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
    const result = await verdict();
    if (!result) process.exit(1);
    console.log(`review loop: ${result}`);
    if (result === "stalled") await printRepeats();
    process.exit(0);
  } catch (error) {
    // Exit 1 would mean "continue": any failure must surface as a broken gate instead.
    console.error(`review gate: ${error instanceof Error ? error.message : error}`);
    process.exit(2);
  }
}
