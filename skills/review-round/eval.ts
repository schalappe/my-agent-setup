#!/usr/bin/env bun
// Regression evals for the reviewer prompts of gate.ts: `bun ~/.agents/skills/review-round/eval.ts [--list]
// [--dry-run] [--dir <path>] [case-id...]`. Each case in evals/*.json is a small diff with a known answer: a
// must_catch case holds a defect the reviewer has to report, a must_stay_clean case a change it must not block. A prompt
// edit that loses recall or adds noise shows here before it costs a real loop.
//
// A case runs the real prompt (gate.ts REVIEW_TASK or securityTask(), through buildReviewPrompt) on GPT-6.2 Sol via
// peer.ts, with its cwd set to a temp dir that holds only its patches and slice bundle, so bare repo-relative paths do
// not land in the caller's repo. This is not a sandbox: `codex -s read-only` still lets the reviewer read paths outside it.
// --dry-run builds every prompt without calling the peer. --list prints the cases.
// Exit 0 = every case passed; 1 = some failed (their temp dir, trace included, is kept and printed); 2 = bad CLI or
// case, or a peer run that failed (a broken eval, not a regression).

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildReviewPrompt, formatReviewGuide, isFinding, patchPath, REVIEW_TASK, type ReviewFinding, SEVERITIES, securityTask } from "./gate";
import { runPeer } from "./peer";
import { openedBundle, openedFile, patchHeader, printedText } from "./trace";

export type EvalCase = {
  id: string;
  kind: "must_catch" | "must_stay_clean";
  reviewer: "correctness" | "security";
  intent: string;
  review_guide?: string;
  files: Record<string, string>; // path -> unified diff patch
  expect?: {
    file?: string;
    min_severity?: "critical" | "major" | "minor";
    match?: string; // case-insensitive regex against title + "\n" + why
  };
};

const KINDS = ["must_catch", "must_stay_clean"];
const REVIEWERS = ["correctness", "security"];
const CASE_KEYS = ["id", "kind", "reviewer", "intent", "review_guide", "files", "expect"];
const EXPECT_KEYS = ["file", "min_severity", "match"];
const BLOCKING = ["critical", "major"];

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const nonEmpty = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";

// Throws `<source>: <problem>` on the first problem. Unknown keys are refused so a typo (`min_severiy`) never turns a
// case into a weaker one silently.
export function validateCase(value: unknown, source: string): EvalCase {
  const fail = (problem: string): never => {
    throw new Error(`${source}: ${problem}`);
  };
  if (!isObject(value)) return fail("not a JSON object");
  const unknown = Object.keys(value).filter((key) => !CASE_KEYS.includes(key));
  if (unknown.length > 0) fail(`unknown key(s) ${unknown.join(", ")}`);
  if (!nonEmpty(value.id) || !/^[a-z0-9][a-z0-9-]*$/.test(value.id)) fail("id must be kebab-case");
  if (!KINDS.includes(value.kind as string)) fail(`kind must be ${KINDS.join(" or ")}`);
  if (!REVIEWERS.includes(value.reviewer as string)) fail(`reviewer must be ${REVIEWERS.join(" or ")}`);
  if (!nonEmpty(value.intent)) fail("intent must be a non-empty string");
  if (value.review_guide !== undefined && typeof value.review_guide !== "string") fail("review_guide must be a string");
  if (!isObject(value.files) || Object.keys(value.files).length === 0) fail("files must map at least one path to its patch");
  // The case's files land in a temp dir, and a case-insensitive / Unicode-normalizing filesystem (macOS APFS/HFS+) would merge them.
  const lowered = Object.keys(value.files as object).map((path) => path.normalize("NFC").toLowerCase());
  if (new Set(lowered).size !== lowered.length) fail("files must not hold two paths that collide on case or Unicode normalization");
  for (const [path, patch] of Object.entries(value.files as Record<string, unknown>)) {
    // Paths become files under the case's temp dir: no absolute path or `..` may leave it.
    if (!nonEmpty(path) || path.startsWith("/") || path.split("/").some((part) => part === ".." || part === "")) fail(`bad path ${JSON.stringify(path)}`);
    if (!nonEmpty(patch)) fail(`${path}: patch must be a non-empty string`);
  }
  if (value.expect !== undefined) {
    const expect = value.expect;
    if (!isObject(expect)) return fail("expect must be an object");
    const extra = Object.keys(expect).filter((key) => !EXPECT_KEYS.includes(key));
    if (extra.length > 0) fail(`unknown expect key(s) ${extra.join(", ")}`);
    // must_stay_clean blocks on critical/major anywhere; a file or severity would only read as a narrower rule.
    if (value.kind === "must_stay_clean" && (expect.file !== undefined || expect.min_severity !== undefined))
      fail("must_stay_clean takes only expect.match");
    if (expect.file !== undefined && (typeof expect.file !== "string" || !Object.hasOwn(value.files as object, expect.file)))
      fail("expect.file must be one of files");
    if (expect.min_severity !== undefined && !["critical", "major", "minor"].includes(expect.min_severity as string))
      fail("expect.min_severity must be critical, major, or minor");
    if (expect.match !== undefined) {
      if (!nonEmpty(expect.match)) fail("expect.match must be a non-empty regex");
      try {
        new RegExp(expect.match as string, "i");
      } catch (error) {
        fail(`expect.match: ${error instanceof Error ? error.message : error}`);
      }
    }
  }
  return value as EvalCase;
}

const rank = (severity: string): number => SEVERITIES.indexOf(severity);
const describe = (finding: ReviewFinding): string => `${finding.severity} ${finding.file}: ${finding.title}`;

// Pre-existing findings never count: the gate records them without blocking, so they are neither a catch nor noise.
export function scoreCase(evalCase: EvalCase, findings: ReviewFinding[]): { pass: boolean; reason: string } {
  const introduced = findings.filter((finding) => !finding.pre_existing);
  const pattern = evalCase.expect?.match === undefined ? undefined : new RegExp(evalCase.expect.match, "i");
  const matches = (finding: ReviewFinding) => !pattern || pattern.test(`${finding.title}\n${finding.why}`);
  if (evalCase.kind === "must_catch") {
    const min = evalCase.expect?.min_severity ?? "major";
    const file = evalCase.expect?.file;
    const hit = introduced.find((finding) => rank(finding.severity) <= rank(min) && (!file || finding.file === file) && matches(finding));
    if (hit) return { pass: true, reason: `caught: ${describe(hit)}` };
    const wanted = [`${min}+`, file && `in ${file}`, pattern && `matching ${pattern}`].filter(Boolean).join(" ");
    return { pass: false, reason: `missed: ${introduced.length} finding(s), none ${wanted}` };
  }
  const noise = introduced.filter((finding) => BLOCKING.includes(finding.severity) || (pattern && matches(finding)));
  if (noise.length > 0) return { pass: false, reason: `noise: ${noise.map(describe).join("; ")}` };
  return { pass: true, reason: `clean: ${introduced.length} minor/nit finding(s)` };
}

// Every case of dir, sorted by file name. Duplicate ids are refused: a case id selects one case.
export function loadCases(dir: string): EvalCase[] {
  if (!existsSync(dir)) throw new Error(`${dir}: no such directory`);
  const cases = readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => {
      const source = join(dir, name);
      let value: unknown;
      try {
        value = JSON.parse(readFileSync(source, "utf8"));
      } catch (error) {
        throw new Error(`${source}: ${error instanceof Error ? error.message : error}`);
      }
      return validateCase(value, source);
    });
  const seen = new Set<string>();
  for (const evalCase of cases) {
    if (seen.has(evalCase.id)) throw new Error(`duplicate case id ${evalCase.id} in ${dir}`);
    seen.add(evalCase.id);
  }
  return cases;
}

// `<added>\t<removed>\t<path>` per file, as gate.ts prepare writes files.txt.
const numstat = (files: Record<string, string>): string =>
  Object.entries(files)
    .map(([path, patch]) => {
      const lines = patch.split("\n");
      const added = lines.filter((line) => line.startsWith("+") && !line.startsWith("+++")).length;
      const removed = lines.filter((line) => line.startsWith("-") && !line.startsWith("---")).length;
      return `${added}\t${removed}\t${path}`;
    })
    .join("\n");

// Writes the case as gate.ts `slice` lays out one slice (patches/ and slice-A.patch) under root, and returns the prompt.
export function prepareCase(evalCase: EvalCase, root: string): { prompt: string; bundle: string; patches: string[] } {
  const paths = Object.keys(evalCase.files);
  const patches = paths.map((path) => patchPath(root, path));
  mkdirSync(join(root, "patches"), { recursive: true });
  paths.forEach((path, i) => writeFileSync(patches[i], evalCase.files[path]));
  const bundle = join(root, "slice-A.patch");
  writeFileSync(bundle, paths.map((path) => `${patchHeader(path)}\n${evalCase.files[path]}`).join("\n"));
  const prompt = buildReviewPrompt(evalCase.reviewer === "security" ? securityTask() : REVIEW_TASK, {
    intent: evalCase.intent,
    reviewGuide: formatReviewGuide(evalCase.review_guide ?? ""),
    checks: "- eval: no checks run",
    scope: "Full review: every changed file of the pull request is in the slices.",
    judged: "",
    files: numstat(evalCase.files),
    generated: "",
    slice: [`bundle: ${bundle} (every patch below, in one file)`, ...patches].join("\n"),
  });
  return { prompt, bundle, patches };
}

const schemaPath = fileURLToPath(new URL("./reviewer-schema.json", import.meta.url));

// One reviewer run on the case. A review that never printed its patches scores as a failure, as the gate would refuse
// it: its empty findings would otherwise pass every must_stay_clean case.
async function runCase(evalCase: EvalCase): Promise<{ pass: boolean; reason: string }> {
  const root = mkdtempSync(join(tmpdir(), `review-eval-${evalCase.id}-`));
  const { prompt, bundle, patches } = prepareCase(evalCase, root);
  const traceFile = join(root, "trace.jsonl");
  const { exit, trace } = await runPeer("read", prompt, traceFile, schemaPath, root);
  if (exit !== 0 || trace.isError) throw new Error(`${evalCase.id}: peer run failed (exit ${exit}), trace in ${traceFile}`);
  const paths = Object.keys(evalCase.files);
  const read =
    openedBundle(trace.fullReads, bundle, paths) ||
    patches.every((patch, i) => openedFile(trace.opened, patch) || printedText(trace.printed, evalCase.files[paths[i]]));
  const output = trace.output;
  const score = !isObject(output) || !Array.isArray(output.findings) || !output.findings.every(isFinding)
    ? { pass: false, reason: "no well-formed findings in the trace" }
    : !read
      ? { pass: false, reason: "patches not read" }
      : scoreCase(evalCase, output.findings);
  if (score.pass) rmSync(root, { recursive: true, force: true });
  else score.reason += ` (trace: ${traceFile})`;
  return score;
}

type Options = { list: boolean; dryRun: boolean; dir: string; ids: string[] };

function parseArgs(argv: string[]): Options {
  const options: Options = { list: false, dryRun: false, dir: fileURLToPath(new URL("./evals", import.meta.url)), ids: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--list") options.list = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--dir") {
      const next = argv[++i];
      if (next === undefined) throw new Error("--dir needs a value");
      options.dir = next;
    } else if (arg.startsWith("--")) throw new Error(`unknown argument ${arg}`);
    else options.ids.push(arg);
  }
  return options;
}

const rate = (part: number, whole: number) => (whole === 0 ? "-" : `${part}/${whole} (${Math.round((100 * part) / whole)}%)`);

if (import.meta.main) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const all = loadCases(options.dir);
    const unknown = options.ids.filter((id) => !all.some((evalCase) => evalCase.id === id));
    if (unknown.length > 0) throw new Error(`unknown case id(s) ${unknown.join(", ")}`);
    const cases = options.ids.length > 0 ? all.filter((evalCase) => options.ids.includes(evalCase.id)) : all;
    if (cases.length === 0) throw new Error(`${options.dir}: no *.json case`);
    if (options.list) {
      for (const evalCase of cases) console.log([evalCase.id, evalCase.kind, evalCase.reviewer].join("\t"));
      process.exit(0);
    }
    console.log("case\tkind\treviewer\tresult\treason");
    const results: { evalCase: EvalCase; pass: boolean }[] = [];
    for (const evalCase of cases) {
      let score: { pass: boolean; reason: string };
      if (options.dryRun) {
        const root = mkdtempSync(join(tmpdir(), `review-eval-${evalCase.id}-`));
        try {
          score = { pass: true, reason: `prompt ${prepareCase(evalCase, root).prompt.length} chars` };
        } finally {
          rmSync(root, { recursive: true, force: true });
        }
      } else score = await runCase(evalCase);
      results.push({ evalCase, pass: score.pass });
      console.log([evalCase.id, evalCase.kind, evalCase.reviewer, options.dryRun ? "built" : score.pass ? "pass" : "FAIL", score.reason].join("\t"));
    }
    if (options.dryRun) process.exit(0);
    const of = (kind: string) => results.filter((result) => result.evalCase.kind === kind);
    const passed = (list: typeof results) => list.filter((result) => result.pass).length;
    console.log(`\nmust_catch recall ${rate(passed(of("must_catch")), of("must_catch").length)}, must_stay_clean clean rate ${rate(passed(of("must_stay_clean")), of("must_stay_clean").length)}`);
    process.exit(results.every((result) => result.pass) ? 0 : 1);
  } catch (error) {
    console.error(`review eval: ${error instanceof Error ? error.message : error}`);
    process.exit(2);
  }
}
