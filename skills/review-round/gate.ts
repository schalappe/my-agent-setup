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
// review-sec-<S>.prompt (security), printing their names (`A sec-A B sec-B`). The reviewer task texts live here so
// the prompts are the same every round. The first reviewed round covers every file; later
// ones re-review only the files changed since the previous reviewed round plus the files of its rejected findings,
// so the loop converges on its own fixes instead of digging up older code. No letters printed = nothing to review.
// Every prompt lists the findings earlier rounds rejected or recorded as pre-existing, so they are not repeated.
// `gate.ts verify N` prints round N's verification outcome (`green`, `red`, or `blocked: <reason>`); the skill
// acts on that line instead of judging verify-N.json itself.
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
//   (the fix failed, or the fixer rejected it and the reviewer reported it again). "Same defect" is a
//   TypeSafe Jev judgment: fixes shift lines and the reviewer rewords titles, so file/line/title
//   matching misses repeats. Needs TYPESAFE_API_KEY.
// A status written for another tree is stale (the code changed since): it is dropped and the loop goes on.
// Red and blocked rounds never count as passes; they always continue.

import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { $ } from "bun";

type Finding = { file: string; line: number; title: string; why: string };
type Round = { head: string; tree: string; majors: Finding[] };
type Verify = {
  head: string;
  tree: string;
  checks: { command: string; exit: number }[];
  scenarios: { name: string; result: "pass" | "fail" | "blocked"; surface?: string }[];
};

const UI_FILE = /\.(tsx|jsx|vue|svelte|css|scss|html)$/;
const SCRIPT_FILE = /\.(ts|js|mjs)$/;
const TEST_FILE = /(\.(test|spec)\.|(^|\/)(e2e|__tests__|tests?)\/)/;
const UI_FRAMEWORKS = ["react", "vue", "svelte", "solid-js", "preact", "@angular/core"];

const SLICE_LINES = 2000;

// Rules every reviewer prompt shares: finding fields, re-review scope, earlier judgments, and severity.
const FINDING_RULES = `For each finding, \`trigger\` names the input or state that makes it fail. Set \`pre_existing\` to true when the faulty code is not added or changed by the patch: the pull request did not introduce it, so it is recorded for the owner and never blocks this PR. When a defect is one instance of a pattern, report the pattern once, at its first instance, and list every other instance you find in \`why\`, so all of them get fixed in one round.

<scope> says whether this is a full review or a re-review. On a re-review, the files outside your slice were reviewed in an earlier round and have not changed since: open them only to check how your slice affects them. <already_judged> lists findings earlier rounds rejected (with the reason) or recorded as pre-existing. Do not report them again unless you can show the reason is wrong, citing the code that proves it.

Severity: critical = data loss, security, or crash on the main path; major = incorrect behavior or contract violation; minor = real but low-impact defect; nit = anything else.`;

const REVIEW_TASK = `Review your slice of this pull request diff against its stated intent. Read only the patch files listed in <slice> (open surrounding source when needed). Report only defects you can point to in those patches: wrong logic, contract violations against the intent, missing error handling at trust boundaries, data loss, missing or incorrect tests for changed behavior. Security has its own reviewer. If the repository's AGENTS.md names a review checklist, apply its rules to your slice. Do not report style, naming, formatting, or hypothetical future needs. Zero findings is a valid result.

Also interrogate: a state-changing operation that breaks when it runs twice or after a crash halfway; a guard, retry, cast, or fallback that hides a broken invariant instead of fixing its cause; a check that reads a proxy (cache, mtime, self-report) instead of the real value. For a possible null or bad input, trace the caller before reporting it.

Report every cheapest road to green: a threshold or config loosened; \`.skip\` added, tests deleted, or assertions removed; a new \`@ts-ignore\`, \`eslint-disable\`, \`# noqa\`, \`# type: ignore\`, or coverage-ignore comment; a stub or empty catch; a new exception or allowlist entry. Tightening the bar is fine silently; loosening it is always a finding.

When the diff changes launch config, routes, or seed data and the repository has a \`verify-<app>\` skill, its matching recipe must change in the same PR (check <files>); otherwise report it.

${FINDING_RULES}`;

// The security pass runs as its own reviewer on the same slices: one prompt that covers everything dilutes it.
// The checks mirror the Verification list of the hardening skill, which governs the same code at build time.
const SECURITY_TASK = `Review your slice of this pull request diff for security defects only. Read only the patch files listed in <slice> (open surrounding source when needed). Report a defect only when you can trace untrusted input or an unauthorized caller to the patched code; a missing control that no reachable input exercises is not a finding. Zero findings is a valid result.

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

function isVerify(value: unknown): value is Verify {
  return (
    isObject(value) &&
    isString(value.head) &&
    isString(value.tree) &&
    Array.isArray(value.checks) &&
    value.checks.every((check) => isObject(check) && isString(check.command) && Number.isInteger(check.exit)) &&
    Array.isArray(value.scenarios) &&
    value.scenarios.every(
      (scenario) => isObject(scenario) && isString(scenario.name) && ["pass", "fail", "blocked"].includes(scenario.result as string),
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
    names.push(name, `sec-${name}`);
  }
  return names;
}

async function readVerify(dir: string, round: string): Promise<Outcome & { verify: Verify }> {
  const verifyName = `verify-${round}.json`;
  const verifyFile = Bun.file(`${dir}/${verifyName}`);
  if (!(await verifyFile.exists())) throw new Error(`${dir}/${verifyName}: missing; only the verifier writes it`);
  const verify: unknown = await verifyFile.json();
  if (!isVerify(verify))
    throw new Error(`${dir}/${verifyName}: needs head, tree, checks [{command, exit}], scenarios [{name, result: pass|fail|blocked, surface?}]`);
  return { ...verifyResult(verify, await changesUi(`${dir}/round-${round}/files.txt`)), verify };
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
      return { ...round, verify: result };
    }),
  );

  // After validating rounds, so a bad round file still breaks the gate; reuse skips the TypeSafe call.
  const statusFile = Bun.file(`${dir}/status`);
  if (await statusFile.exists()) {
    const [status, statusTree] = (await statusFile.text()).trim().split(" ");
    if (statusTree === current && (status === "converged" || status === "stalled")) return status;
    await statusFile.delete(); // stale: written for code that has changed since
  }

  const green = rounds.filter((round) => round.verify === "green");
  const latest = green.at(-1);
  if (!latest || rounds.at(-1) !== latest || green.length < 2) return undefined;

  let result: "converged" | "stalled" | undefined;
  // Converged only for the code that was reviewed; stalled is about the history, so fixes since don't matter.
  if (latest.majors.length === 0) result = latest.tree === current ? "converged" : undefined;
  else if (await repeatsEarlier(latest.majors, green.slice(0, -1).flatMap((round) => round.majors))) result = "stalled";
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

// One Noul per (latest, earlier) pair, all in one request.
async function repeatsEarlier(latest: Finding[], earlier: Finding[]): Promise<boolean> {
  if (earlier.length === 0) return false;
  const key = Bun.env.TYPESAFE_API_KEY;
  if (!key) throw new Error("TYPESAFE_API_KEY is not set");

  const questions = Object.fromEntries(
    latest.flatMap((_, i) =>
      earlier.map((_, j) => [
        `${i}:${j}`,
        {
          type: "noul",
          instructions: `Do \`latest[${i}]\` and \`earlier[${j}]\` report the same underlying defect in the code, even if worded differently?`,
          criteria: {
            true: "Same defect: fixing one would resolve the other.",
            false: "Different defects, even when they share a file or a kind of problem.",
          },
        },
      ]),
    ),
  );
  // Lines drift between rounds, so only the file and the defect description are compared.
  const body = JSON.stringify({
    model: "jev-latest",
    state: {
      latest: latest.map(({ file, title, why }) => ({ file, title, why })),
      earlier: earlier.map(({ file, title, why }) => ({ file, title, why })),
    },
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
    const probabilities = Object.values(answers ?? {}).map((answer) => answer.noul);
    if (
      probabilities.length !== Object.keys(questions).length ||
      !probabilities.every((probability): probability is number => typeof probability === "number")
    )
      throw new Error(`unexpected TypeSafe answers: ${JSON.stringify(answers)}`);
    return probabilities.some((probability) => probability >= SAME_DEFECT);
  }
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
      console.log((await slice(process.argv[3])).join(" "));
      process.exit(0);
    }
    if (process.argv[2] === "verify") {
      if (!/^\d+$/.test(process.argv[3] ?? "")) throw new Error("usage: gate.ts verify <round number>");
      const { result, reason } = await readVerify(await stateDir(), process.argv[3]);
      console.log(reason ? `${result}: ${reason}` : result);
      process.exit(0);
    }
    if (process.argv[2] === "ready") {
      const reason = await notReadyReason();
      console.log(reason ? `review loop: stays draft (${reason})` : "review loop: ready");
      process.exit(reason ? 1 : 0);
    }
    const result = await verdict();
    if (!result) process.exit(1);
    console.log(`review loop: ${result}`);
    process.exit(0);
  } catch (error) {
    // Exit 1 would mean "continue": any failure must surface as a broken gate instead.
    console.error(`review gate: ${error instanceof Error ? error.message : error}`);
    process.exit(2);
  }
}
