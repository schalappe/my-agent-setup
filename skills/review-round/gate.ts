#!/usr/bin/env bun
// Gate for the review-round skill, run after each round: `bun ~/.agents/skills/review-round/gate.ts`.
// `gate.ts tree` prints the working-tree hash (tracked + untracked, ignoring .gitignore'd files) that
// verify and round files are keyed on; the skill and the verifier use it so all three agree on the hash.
//
// State: $(git common dir)/review/<branch>/, shared by every worktree of the repo so it outlives them.
// round-N.json is written by the skill; verify-N.json by the verifier only; the round's verdict is
// derived here from verify-N.json, never taken from the round file.
// `gate.ts verify N` prints round N's verification outcome (`green`, `red`, or `blocked: <reason>`); the skill
// acts on that line instead of judging verify-N.json itself.
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

async function readVerify(dir: string, round: string): Promise<Outcome & { verify: Verify }> {
  const verifyName = `verify-${round}.json`;
  const verifyFile = Bun.file(`${dir}/${verifyName}`);
  if (!(await verifyFile.exists())) throw new Error(`${dir}/${verifyName}: missing; only the verifier writes it`);
  const verify: unknown = await verifyFile.json();
  if (!isVerify(verify))
    throw new Error(`${dir}/${verifyName}: needs head, tree, checks [{command, exit}], scenarios [{name, result: pass|fail|blocked, surface?}]`);
  return { ...verifyResult(verify, await changesUi(`${dir}/round-${round}/files.txt`)), verify };
}

async function verdict(): Promise<"converged" | "stalled" | undefined> {
  const dir = await stateDir();
  if (!existsSync(dir)) return undefined; // no round recorded yet
  const current = await tree();

  const names = [...new Bun.Glob("round-*.json").scanSync(dir)].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  );
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

try {
  if (process.argv[2] === "tree") {
    console.log(await tree());
    process.exit(0);
  }
  if (process.argv[2] === "verify") {
    if (!/^\d+$/.test(process.argv[3] ?? "")) throw new Error("usage: gate.ts verify <round number>");
    const { result, reason } = await readVerify(await stateDir(), process.argv[3]);
    console.log(reason ? `${result}: ${reason}` : result);
    process.exit(0);
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
