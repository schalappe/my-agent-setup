#!/usr/bin/env bun
// Gate for the review-round skill, run after each round: `bun ~/.agents/skills/review-round/gate.ts`.
// `gate.ts tree` prints the working-tree hash (tracked + untracked, ignoring .gitignore'd files) that
// verify and round files are keyed on; the skill and the verifier use it so all three agree on the hash.
//
// State: $(git common dir)/review/<branch>/, shared by every worktree of the repo so it outlives them.
// round-N.json is written by the skill; verify-N.json by the verifier only; the round's verdict is
// derived here from verify-N.json, never taken from the round file. verify-0.json, written by the implement
// skill's verifier before the loop, has no round: the skill copies it into a round when the tree matches.
// `gate.ts slice N` splits round N's diff into review slices of at most SLICE_LINES changed lines (a bigger single
// file is its own slice) and writes two prompts per slice, round-N/review-<S>.prompt (correctness) and
// review-sec-<S>.prompt (security), printing their names one per line (`A`, `sec-A`, `B`, `sec-B`). The reviewer
// task texts live here so the prompts are the same every round. The first reviewed round covers every file; later
// ones re-review only the files changed since the previous reviewed round plus the files of its rejected findings,
// so the loop converges on its own fixes instead of digging up older code. No letters printed = nothing to review.
// Every prompt lists the findings earlier rounds rejected or recorded as pre-existing, so they are not repeated.
// `gate.ts reviewed N` judges each reviewer process of round N from its trace, round-N/review-<S>.jsonl, written by
// peer.ts in the format of the engine that ran it (trace.ts reads all three): it passes when the trace ends with
// well-formed findings and reads every file of the slice (slice-<S>.txt, written by `slice`), then writes
// review-<S>.json from that result. It prints one line per process and `rerun: <names>` for
// the failures (exit 1). The main gate refuses (exit 2) a recorded round whose reviews do not pass this check.
// `gate.ts verify N` prints round N's verification outcome (`green`, `red`, or `blocked: <reason>`); the skill
// acts on that line instead of judging verify-N.json itself.
// After a green round K, a later verification reruns only the checks and scenarios that the changed files reach.
// It copies the others from verify-K.json and marks each with `carried_from: K`. The gate accepts a carried entry
// only when round K is green and verify-K.json holds a passing entry with the same command or scenario name.
// K may be 0: a green verify-0.json is a valid source. Otherwise the round is blocked, and the skill runs the
// verifier again.
// `gate.ts attempt N` archives round N's verify-N.json as round-N/verify-attempt-<A>.json before the skill runs
// the verifier again in the same round, and prints `attempt <A> same-tree` or `attempt <A> tree-changed`. On the
// same tree, the next verifier copies that attempt's passing entries, marked `carried_from_attempt: A`, and reruns
// only the rest. The gate accepts such an entry only when the attempt file holds the same tree as verify-N.json
// and a passing entry with the same command or scenario name: identical code gives the same result, so a failed
// typecheck or a blocked scenario no longer reruns a build that already passed. The attempt itself may be red.
// `seconds` is the wall time of a check or scenario. It is optional because older verify files lack it.
// `gate.ts ready` decides whether the PR may leave draft once the loop stops: exit 0 when the loop converged on
// the current tree, the minor pass ran, and the latest round left no minor finding (nits stay for the human);
// exit 1 prints why not.
// A round whose files.txt lists a non-test UI file (tsx, jsx, vue, svelte, css, scss, html, or a .ts/.js file in
// a package that depends on a UI framework) is green only
// with a passing scenario whose `surface` is "browser": unit tests and API calls never prove a screen.
// Exit 0 = stop the loop (writes "converged|stalled <tree>" to status; nothing else may write it).
// Exit 1 = run another round. Exit 2 = broken gate (bad or missing file, verify tree differs from the
// round's tree, TypeSafe error); the skill stops the loop.
//
// converged: ≥2 green rounds, the latest is the last round, found no critical/major finding, and its
//   tree is the current tree.
// stalled: a critical/major finding of the latest green round repeats one from an earlier green round
//   (the fix failed, or the fixer rejected it and the reviewer reported it again). Only two kinds of pair
//   can repeat: the same file (a failed fix), or an earlier finding the fixer rejected (a disagreement).
//   The same pattern found in another file is a new instance: the loop goes on and the round cap bounds it.
//   "Same defect" is a TypeSafe Jev judgment: fixes shift lines and the reviewer rewords titles, so
//   file/line/title matching misses repeats. Needs TYPESAFE_API_KEY. The repeats behind a stall are
//   written to stall.json and printed.
// A status written for another tree is stale (the code changed since): it is dropped and the loop goes on.
// Red and blocked rounds never count as passes; they always continue.

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { $ } from "bun";
import { openedFile, readTrace } from "./trace";

type Finding = { file: string; line: number; title: string; why: string };
type Round = { head: string; tree: string; majors: Finding[]; rejected?: unknown[] };
type Earlier = { finding: Finding; round: string; rejected: boolean };
type Repeat = { latest: Finding; earlier: Finding; round: string; probability: number };
type Check = { command: string; exit: number; seconds?: number; carried_from?: number; carried_from_attempt?: number };
type Scenario = {
  name: string;
  result: "pass" | "fail" | "blocked";
  surface?: string;
  seconds?: number;
  carried_from?: number;
  carried_from_attempt?: number;
};
type Verify = { head: string; tree: string; checks: Check[]; scenarios: Scenario[] };

const UI_FILE = /\.(tsx|jsx|vue|svelte|css|scss|html)$/;
const SCRIPT_FILE = /\.(ts|js|mjs)$/;
const TEST_FILE = /(\.(test|spec)\.|(^|\/)(e2e|__tests__|tests?)\/)/;
const UI_FRAMEWORKS = ["react", "vue", "svelte", "solid-js", "preact", "@angular/core"];

const SLICE_LINES = 2000;

// Rules every reviewer prompt shares: finding fields, re-review scope, earlier judgments, and severity.
const FINDING_RULES = `For each finding, \`trigger\` names the input or state that makes it fail. Set \`pre_existing\` to true when the faulty code is not added or changed by the patch: the pull request did not introduce it, so it is recorded for the owner and never blocks this PR. When a defect is one instance of a pattern, report the pattern once, at its first instance, and list every other instance you find in \`why\`, so all of them get fixed in one round.

<scope> says whether this is a full review or a re-review. On a re-review, the files outside your slice were reviewed in an earlier round and have not changed since: open them only to check how your slice affects them. <already_judged> lists findings earlier rounds rejected (with the reason) or recorded as pre-existing. Do not report them again unless you can show the reason is wrong, citing the code that proves it.

Severity: critical = data loss, security, or crash on the main path; major = incorrect behavior or contract violation; minor = real but low-impact defect; nit = anything else.`;

const REVIEW_TASK = `Review your slice of this pull request diff against its stated intent. Open every patch file listed in <slice>, and surrounding source when needed: the gate rejects a review whose trace never opens one of them. Report only defects you can point to in those patches: wrong logic, contract violations against the intent, missing error handling at trust boundaries, data loss, missing or incorrect tests for changed behavior. Security has its own reviewer. If the repository's AGENTS.md names a review checklist, apply its rules to your slice. Do not report style, naming, formatting, or hypothetical future needs. Zero findings is a valid result.

Also interrogate: a state-changing operation that breaks when it runs twice or after a crash halfway; a guard, retry, cast, or fallback that hides a broken invariant instead of fixing its cause; a check that reads a proxy (cache, mtime, self-report) instead of the real value. For a possible null or bad input, trace the caller before reporting it.

Report every cheapest road to green: a threshold or config loosened; \`.skip\` added, tests deleted, or assertions removed; a new \`@ts-ignore\`, \`eslint-disable\`, \`# noqa\`, \`# type: ignore\`, or coverage-ignore comment; a stub or empty catch; a new exception or allowlist entry. Tightening the bar is fine silently; loosening it is always a finding.

When the diff changes launch config, routes, or seed data and the repository has a \`verify-<app>\` skill, its matching recipe must change in the same PR (check <files>); otherwise report it.

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
- New or bumped dependencies: install scripts and the lockfile diff hold only the intended packages.

A security defect reachable from a trust boundary is critical.

${FINDING_RULES}`;

// 0.5 = "more likely the same defect than not"; recalibrate on real rounds if stalls look wrong.
const SAME_DEFECT = 0.5;

// Hash of the working tree as `git add -A` would stage it, without touching the real index.
// Starts from a copy of the real index so unchanged files reuse its stat cache instead of being rehashed.
async function tree(): Promise<string> {
  const tmp = mkdtempSync(`${tmpdir()}/review-tree-`);
  try {
    const index = (await $`git rev-parse --path-format=absolute --git-path index`.text()).trim();
    if (existsSync(index)) copyFileSync(index, `${tmp}/index`);
    const env = { ...process.env, GIT_INDEX_FILE: `${tmp}/index` };
    const root = (await $`git rev-parse --show-toplevel`.text()).trim();
    await $`git add -A`.cwd(root).env(env).quiet();
    return (await $`git write-tree`.cwd(root).env(env).text()).trim();
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const isString = (value: unknown): value is string => typeof value === "string";
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

function isRound(value: unknown): value is Round {
  return isObject(value) && isString(value.head) && isString(value.tree) && Array.isArray(value.majors);
}

// seconds, carried_from, and carried_from_attempt may be missing. When present, seconds is zero or more,
// carried_from a round from 0 up (0 is verify-0.json, the implement skill's final verification), and
// carried_from_attempt an attempt from 1 up. An entry carries from one source at most.
const timedAndCarried = (entry: Record<string, unknown>): boolean =>
  (entry.seconds === undefined || (typeof entry.seconds === "number" && entry.seconds >= 0)) &&
  (entry.carried_from === undefined || (Number.isInteger(entry.carried_from) && (entry.carried_from as number) >= 0)) &&
  (entry.carried_from_attempt === undefined ||
    (Number.isInteger(entry.carried_from_attempt) && (entry.carried_from_attempt as number) >= 1 && entry.carried_from === undefined));

function isVerify(value: unknown): value is Verify {
  return (
    isObject(value) &&
    isString(value.head) &&
    isString(value.tree) &&
    Array.isArray(value.checks) &&
    value.checks.every((check) => isObject(check) && isString(check.command) && Number.isInteger(check.exit) && timedAndCarried(check)) &&
    Array.isArray(value.scenarios) &&
    value.scenarios.every(
      (scenario) =>
        isObject(scenario) &&
        isString(scenario.name) &&
        ["pass", "fail", "blocked"].includes(scenario.result as string) &&
        timedAndCarried(scenario),
    )
  );
}

type Outcome = { result: "green" | "red" | "blocked"; reason?: string };

// A plain .ts/.js file is UI code when its nearest package.json depends on a UI framework: a shared hook or
// read-state helper changes every screen that uses it.
async function inUiPackage(root: string, path: string): Promise<boolean> {
  for (let dir = path.split("/").slice(0, -1); ; dir.pop()) {
    const manifest = Bun.file(`${root}/${[...dir, "package.json"].join("/")}`);
    if (await manifest.exists()) {
      const { dependencies = {}, devDependencies = {} } = await manifest.json();
      return UI_FRAMEWORKS.some((name) => name in dependencies || name in devDependencies);
    }
    if (dir.length === 0) return false;
  }
}

// files.txt is `git diff --numstat`: added<TAB>removed<TAB>path.
async function changesUi(filesTxt: string): Promise<boolean> {
  const file = Bun.file(filesTxt);
  if (!(await file.exists())) throw new Error(`${filesTxt}: missing; the skill writes it at the start of the round`);
  const root = (await $`git rev-parse --show-toplevel`.text()).trim();
  for (const path of (await file.text()).split("\n").map((line) => line.split("\t")[2] ?? "")) {
    if (!path || TEST_FILE.test(path)) continue;
    if (UI_FILE.test(path) || (SCRIPT_FILE.test(path) && (await inUiPackage(root, path)))) return true;
  }
  return false;
}

function verifyResult({ checks, scenarios }: Verify, ui: boolean): Outcome {
  if (checks.some((check) => check.exit !== 0) || scenarios.some((scenario) => scenario.result === "fail")) return { result: "red" };
  const blocked = scenarios.find((scenario) => scenario.result === "blocked");
  if (blocked) return { result: "blocked", reason: `scenario blocked: ${blocked.name}` };
  if (ui && !scenarios.some((scenario) => scenario.surface === "browser"))
    return { result: "blocked", reason: "the diff changes UI files but no passing scenario has surface \"browser\"" };
  return { result: "green" };
}

async function stateDir(): Promise<string> {
  const commonDir = (await $`git rev-parse --path-format=absolute --git-common-dir`.text()).trim();
  return `${commonDir}/review/${(await $`git branch --show-current`.text()).trim()}`;
}

// Greedy packing in files.txt order keeps a directory's files together. Binary files (numstat "-") count as 0.
export function packSlices(numstat: string, limit = SLICE_LINES): string[][] {
  const slices: { paths: string[]; lines: number }[] = [];
  for (const line of numstat.split("\n")) {
    const [added, removed, path] = line.split("\t");
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

type EarlierRound = { name: string; tree: string; rejected: unknown[]; preExisting: unknown[] };

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
    const data: unknown = await Bun.file(`${dir}/${name}`).json();
    if (!isRound(data)) throw new Error(`${dir}/${name}: lacks "head", "tree", or the "majors" array`);
    const { rejected, pre_existing } = data as Record<string, unknown>;
    rounds.push({
      name,
      tree: data.tree,
      rejected: Array.isArray(rejected) ? rejected : [],
      preExisting: Array.isArray(pre_existing) ? pre_existing : [],
    });
  }
  return rounds;
}

// Paths a re-review keeps: changed since the previous reviewed round, or named by one of its rejected findings so the
// reviewer can challenge the rejection. undefined = full review (first reviewed round, or its tree is gone).
async function reReviewPaths(previous: EarlierRound | undefined, tree: string): Promise<Set<string> | undefined> {
  if (!previous) return undefined;
  const root = (await $`git rev-parse --show-toplevel`.text()).trim();
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
  const { result, verify } = await readVerify(dir, round);
  if (result !== "green") throw new Error(`round ${round} is ${result}; only a green round is reviewed`);
  const earlier = await earlierReviewedRounds(dir, round);
  const previous = earlier.at(-1);
  const kept = await reReviewPaths(previous, verify.tree);
  const files = await Bun.file(`${roundDir}/files.txt`).text();
  const scoped = kept ? files.split("\n").filter((line) => kept.has(line.split("\t")[2] ?? "")).join("\n") : files;
  const scope = kept
    ? `Re-review: only files changed since ${previous?.name.slice(0, -".json".length)} or named by its rejected findings are in the slices.`
    : "Full review: every changed file of the pull request is in the slices.";
  const judged = describeJudged(earlier);
  const intent = (await $`gh pr view --json body --jq .body`.text()).trim();
  const checks = [
    ...verify.checks.map((check) => `- ${check.command}: exit ${check.exit}`),
    ...verify.scenarios.map((scenario) => `- ${scenario.name}: ${scenario.result}`),
  ].join("\n");
  const names: string[] = [];
  for (const [i, paths] of packSlices(scoped).entries()) {
    const name = i < 26 ? String.fromCharCode(65 + i) : `S${i}`;
    const patches = [];
    for (const path of paths) {
      const patch = `${roundDir}/patches/${path.replaceAll("/", "__")}.patch`;
      if (!(await Bun.file(patch).exists())) throw new Error(`${patch}: missing; the skill writes one patch per file`);
      patches.push(patch);
    }
    const context = `<intent>\n${intent}\n</intent>\n<checks_passed>\n${checks}\n</checks_passed>\n<scope>\n${scope}\n</scope>\n<already_judged>\n${judged || "none"}\n</already_judged>\n<files>\n${files.trim()}\n</files>\n<slice>\n${patches.join("\n")}\n</slice>\n`;
    await Bun.write(`${roundDir}/review-${name}.prompt`, `${REVIEW_TASK}\n\n${context}`);
    await Bun.write(`${roundDir}/review-sec-${name}.prompt`, `${SECURITY_TASK}\n\n${context}`);
    await Bun.write(`${roundDir}/slice-${name}.txt`, `${paths.join("\n")}\n`);
    names.push(name, `sec-${name}`);
  }
  return names;
}

type ReviewCheck = { name: string; problem?: string; summary: string };

const SEVERITIES = ["critical", "major", "minor", "nit"];

// The shape reviewer-schema.json asks for. claude and codex enforce the schema; omp cannot, so the gate checks it here
// for every engine alike.
function isFinding(value: unknown): boolean {
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
  const patchOf = (path: string) => `${roundDir}/patches/${path.replaceAll("/", "__")}.patch`;
  const unopened = paths.filter((path) => !opened.includes(patchOf(path)) && !openedFile(opened, path));
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

async function readVerify(dir: string, round: string): Promise<Outcome & { verify: Verify }> {
  const verifyName = `verify-${round}.json`;
  const verifyFile = Bun.file(`${dir}/${verifyName}`);
  if (!(await verifyFile.exists())) throw new Error(`${dir}/${verifyName}: missing; only the verifier writes it`);
  const verify: unknown = await verifyFile.json();
  if (!isVerify(verify))
    throw new Error(
      `${dir}/${verifyName}: needs head, tree, checks [{command, exit, seconds?, carried_from? | carried_from_attempt?}], scenarios [{name, result: pass|fail|blocked, surface?, seconds?, carried_from? | carried_from_attempt?}]`,
    );
  // verify-0.json has no round, so no files.txt. Its UI rule is not checked here: a round that carries from it is
  // judged on its own files.txt, so a UI diff still needs a passing browser scenario there.
  const ui = round === "0" ? false : await changesUi(`${dir}/round-${round}/files.txt`);
  const outcome = verifyResult(verify, ui);
  if (outcome.result !== "green") return { ...outcome, verify };
  return { ...((await uncarried(dir, Number(round), verify)) ?? outcome), verify };
}

// Returns a blocked outcome for the first carried entry that does not pass in its source: a green earlier round,
// or an earlier attempt of this round on the same tree. Returns undefined when every carried entry passes there.
async function uncarried(dir: string, round: number, verify: Verify): Promise<Outcome | undefined> {
  const fromAttempt = [
    ...verify.checks.filter((check) => check.carried_from_attempt !== undefined).map((check) => ({ from: check.carried_from_attempt!, label: check.command })),
    ...verify.scenarios
      .filter((scenario) => scenario.carried_from_attempt !== undefined)
      .map((scenario) => ({ from: scenario.carried_from_attempt!, label: scenario.name })),
  ];
  for (const { from, label } of fromAttempt) {
    const source = await readAttempt(dir, round, from);
    const passed =
      source?.tree === verify.tree &&
      (source.checks.some((check) => check.command === label && check.exit === 0) ||
        source.scenarios.some((scenario) => scenario.name === label && scenario.result === "pass"));
    if (!passed) return { result: "blocked", reason: `carried from attempt ${from} but not passing there on tree ${verify.tree}: ${label}` };
  }
  const carried = [
    ...verify.checks.filter((check) => check.carried_from !== undefined).map((check) => ({ from: check.carried_from!, label: check.command })),
    ...verify.scenarios.filter((scenario) => scenario.carried_from !== undefined).map((scenario) => ({ from: scenario.carried_from!, label: scenario.name })),
  ];
  const sources = new Map<number, Verify | undefined>();
  for (const { from, label } of carried) {
    if (!sources.has(from)) {
      const source = from < round && existsSync(`${dir}/verify-${from}.json`) ? await readVerify(dir, String(from)) : undefined;
      sources.set(from, source?.result === "green" ? source.verify : undefined);
    }
    const source = sources.get(from);
    const passed =
      source?.checks.some((check) => check.command === label && check.exit === 0) ||
      source?.scenarios.some((scenario) => scenario.name === label && scenario.result === "pass");
    if (!passed) return { result: "blocked", reason: `carried from round ${from} but not passing in a green verify-${from}.json: ${label}` };
  }
  return undefined;
}

function attemptPath(dir: string, round: number, attempt: number): string {
  return `${dir}/round-${round}/verify-attempt-${attempt}.json`;
}

async function readAttempt(dir: string, round: number, attempt: number): Promise<Verify | undefined> {
  const file = Bun.file(attemptPath(dir, round, attempt));
  if (!(await file.exists())) return undefined;
  const value: unknown = await file.json();
  return isVerify(value) ? value : undefined;
}

// Moves verify-N.json into the round directory as the next attempt and returns its number and whether the
// working tree still matches it.
async function archiveAttempt(round: number): Promise<string> {
  const dir = await stateDir();
  const verifyPath = `${dir}/verify-${round}.json`;
  const verify: unknown = await Bun.file(verifyPath)
    .json()
    .catch(() => undefined);
  if (!isVerify(verify)) throw new Error(`${verifyPath}: missing or malformed; nothing to archive`);
  let attempt = 1;
  while (existsSync(attemptPath(dir, round, attempt))) attempt++;
  mkdirSync(`${dir}/round-${round}`, { recursive: true });
  renameSync(verifyPath, attemptPath(dir, round, attempt));
  return `attempt ${attempt} ${verify.tree === (await tree()) ? "same-tree" : "tree-changed"}`;
}

function roundNames(dir: string): string[] {
  return [...new Bun.Glob("round-*.json").scanSync(dir)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

async function verdict(): Promise<"converged" | "stalled" | undefined> {
  const dir = await stateDir();
  if (!existsSync(dir)) return undefined; // no round recorded yet
  const current = await tree();

  const names = roundNames(dir);
  const rounds = await Promise.all(
    names.map(async (name) => {
      const round: unknown = await Bun.file(`${dir}/${name}`).json();
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
  if (!latest || rounds.at(-1) !== latest || green.length < 2) return undefined;

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

// Returns why the PR must stay in draft, or undefined when it may be marked ready. Converged already guarantees
// the latest round is green, has no critical/major finding, and reviewed the current tree.
async function notReadyReason(): Promise<string | undefined> {
  if ((await verdict()) !== "converged") return "the loop has not converged on the current code";
  const dir = await stateDir();
  if (!existsSync(`${dir}/minor-pass`)) return "the minor pass has not run";
  const latestName = roundNames(dir).at(-1);
  const latest: unknown = await Bun.file(`${dir}/${latestName}`).json();
  if (!isObject(latest) || !Array.isArray(latest.minor)) throw new Error(`${dir}/${latestName}: lacks the "minor" array`);
  if (latest.minor.length > 0) return `${latest.minor.length} minor finding(s) remain in ${latestName}`;
  return undefined;
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

// Guarded so `packSlices` can be imported without running the gate.
if (import.meta.main) {
  try {
    if (process.argv[2] === "tree") {
      console.log(await tree());
      process.exit(0);
    }
    if (process.argv[2] === "slice") {
      if (!/^\d+$/.test(process.argv[3] ?? "")) throw new Error("usage: gate.ts slice <round number>");
      console.log((await slice(process.argv[3])).join("\n"));
      process.exit(0);
    }
    if (process.argv[2] === "verify") {
      if (!/^\d+$/.test(process.argv[3] ?? "")) throw new Error("usage: gate.ts verify <round number>");
      const { result, reason } = await readVerify(await stateDir(), process.argv[3]);
      console.log(reason ? `${result}: ${reason}` : result);
      process.exit(0);
    }
    if (process.argv[2] === "attempt") {
      if (!/^[1-9]\d*$/.test(process.argv[3] ?? "")) throw new Error("usage: gate.ts attempt <round number>");
      console.log(await archiveAttempt(Number(process.argv[3])));
      process.exit(0);
    }
    if (process.argv[2] === "reviewed") {
      if (!/^\d+$/.test(process.argv[3] ?? "")) throw new Error("usage: gate.ts reviewed <round number>");
      const reviews = await judgeReviews(await stateDir(), process.argv[3]);
      for (const review of reviews) console.log(review.summary);
      const failed = reviews.filter((review) => review.problem).map((review) => review.name);
      if (failed.length > 0) console.log(`rerun: ${failed.join(" ")}`);
      process.exit(failed.length > 0 ? 1 : 0);
    }
    if (process.argv[2] === "ready") {
      const reason = await notReadyReason();
      console.log(reason ? `review loop: stays draft (${reason})` : "review loop: ready");
      process.exit(reason ? 1 : 0);
    }
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
