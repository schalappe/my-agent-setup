#!/usr/bin/env bun
// Mechanical coherence check for the `scout` skill (`/scout`):
// `bun ~/.agents/skills/scout/check-coherence.ts <owner/repo> <issue>... [options]`
//
// Options:
//   --record <file>           Save each visited issue's `updatedAt` (step 1 baseline).
//   --check-snapshot <file>   Fail if any issue's live `updatedAt` moved since `--record` (step 6 guard).
//   --draft <num>:<path>      Evaluate a local draft markdown file in place of `#<num>`'s live body (step 5).
//
// Hard errors (exit 1):
//   - CONCURRENT_EDIT: live `updatedAt` moved since `--record`.
//   - UNWIRED_BLOCKER: `blocked by #N` / `bloqué par #N` in prose missing from native `blocked_by`.
//   - BACK_REFERENCE: `same as #N` / `as in #N` / `comme #N` delegating rules to another ticket.
//
// Advisory (printed for step 2 / step 5 review, does not fail the exit code):
//   - SHARED_SURFACE: open `ready-for-agent` tickets referencing the same source/test/migration file
//     in their Scout map with no native `blocked_by` ordering between them, ranked by overlap count.
import { $ } from "bun";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

type Issue = {
  number: number;
  title: string;
  state: string;
  body: string | null;
  updated_at: string;
  labels: { name: string }[];
  pull_request?: unknown;
};

const READY_LABEL = "ready-for-agent";
const MAX_HUB_TICKETS = 8; // Files mentioned in >8 ready-for-agent issues are shared hubs, not pair conflicts.

const args = process.argv.slice(2);
let repo = "";
const roots: number[] = [];
let recordPath: string | null = null;
let snapshotPath: string | null = null;
const drafts = new Map<number, string>();

for (let i = 0; i < args.length; i++) {
  const arg = args[i]!;
  if (arg === "--record") {
    recordPath = args[++i] ?? null;
  } else if (arg === "--check-snapshot") {
    snapshotPath = args[++i] ?? null;
  } else if (arg === "--draft") {
    const spec = args[++i] ?? "";
    const sep = spec.indexOf(":");
    if (sep <= 0) {
      console.error(`invalid --draft value (expected <num>:<path>): ${spec}`);
      process.exit(2);
    }
    const num = Number(spec.slice(0, sep).replace(/^#/, ""));
    const filePath = spec.slice(sep + 1);
    drafts.set(num, readFileSync(filePath, "utf8"));
  } else if (!repo && arg.includes("/")) {
    repo = arg;
  } else if (/^#?\d+$/.test(arg)) {
    roots.push(Number(arg.replace(/^#/, "")));
  } else {
    console.error(`unknown argument: ${arg}`);
    process.exit(2);
  }
}

if (!repo || roots.length === 0) {
  console.error(
    "usage: check-coherence.ts <owner/repo> <issue>... [--record <file>] [--check-snapshot <file>] [--draft <num>:<path>]",
  );
  process.exit(2);
}

async function api<T>(path: string): Promise<T[]> {
  const pages: T[][] = JSON.parse(await $`gh api --paginate --slurp repos/${repo}/${path}`.text());
  return pages.flat();
}

const IGNORED_BASENAMES = new Set([
  "openapi.json",
  "generated.ts",
  "gates.sh",
  "check_docs_links.py",
  "package.json",
  "build.gradle",
  "build.gradle.kts",
  "settings.gradle",
  "settings.gradle.kts",
  "index.ts",
  "index.tsx",
  "types.ts",
  "utils.ts",
  "constants.ts",
  "0001_initial_schema.xml",
]);

function scoutMapSection(body: string): string {
  const parts = body.split(/^##\s+Scout map\b[^\n]*\n/m);
  if (parts.length < 2) return body;
  return parts[1]!.split(/^##\s+/m)[0] ?? "";
}

function extractCodeFiles(body: string): Set<string> {
  // Extract source/test/migration filenames from Scout map (normalized to basename so abbreviated paths match).
  const scope = scoutMapSection(body);
  const regex = /\b[A-Za-z0-9_.-]+\.(?:java|kt|ts|tsx|js|jsx|sql|xml|properties|py|rs|go|rb)\b/g;
  const found = new Set<string>();
  for (const m of scope.matchAll(regex)) {
    const name = m[0];
    if (IGNORED_BASENAMES.has(name)) continue;
    if (/^\d/.test(name) && !name.includes("_")) continue;
    found.add(name);
  }
  return found;
}

function extractProseBlockers(body: string): Set<number> {
  const found = new Set<number>();
  const regex = /\b(?:blocked\s+by|bloqu[eé]e?\s+par)\b[:\s]*((?:#\d+(?:\s*(?:,|and|et)\s*)?)+)/gi;
  for (const m of body.matchAll(regex)) {
    for (const numMatch of m[1]!.matchAll(/#(\d+)/g)) {
      found.add(Number(numMatch[1]));
    }
  }
  return found;
}

function extractBackRefs(body: string): string[] {
  const regex =
    /\b(?:same\s+(?:rule\s+|behavior\s+)?as|as\s+(?:defined\s+|specified\s+)?in|comme(?:\s+dans)?)\s+#\d+\b/gi;
  return [...body.matchAll(regex)].map((m) => m[0]);
}

const visited = new Map<number, { issue: Issue; blockedBy: Set<number>; blocking: Set<number>; isLeaf: boolean }>();

async function visit(num: number): Promise<void> {
  if (visited.has(num)) return;
  const [[issue], subIssues, blockedBy, blocking] = await Promise.all([
    api<Issue>(`issues/${num}`),
    api<Issue>(`issues/${num}/sub_issues`),
    api<Issue>(`issues/${num}/dependencies/blocked_by`),
    api<Issue>(`issues/${num}/dependencies/blocking`),
  ]);
  visited.set(num, {
    issue,
    blockedBy: new Set(blockedBy.filter((b) => b.state === "open").map((b) => b.number)),
    blocking: new Set(blocking.filter((b) => b.state === "open").map((b) => b.number)),
    isLeaf: subIssues.length === 0,
  });
  await Promise.all(subIssues.filter((s) => s.state === "open").map((s) => visit(s.number)));
}

const [readyIssues] = await Promise.all([
  api<Issue>(`issues?state=open&labels=${encodeURIComponent(READY_LABEL)}&per_page=100`),
  Promise.all(roots.map((r) => visit(r))),
]);

const openReady = readyIssues.filter((i) => !i.pull_request);
const openReadyByNum = new Map<number, Issue>(openReady.map((i) => [i.number, i]));
const openReadyFiles = new Map<number, Set<string>>();
const fileFreq = new Map<string, number>();

for (const i of openReady) {
  const files = extractCodeFiles(drafts.get(i.number) ?? i.body ?? "");
  openReadyFiles.set(i.number, files);
  for (const f of files) fileFreq.set(f, (fileFreq.get(f) ?? 0) + 1);
}

const hubFiles = new Set([...fileFreq.entries()].filter(([, c]) => c > MAX_HUB_TICKETS).map(([f]) => f));

if (recordPath) {
  const snapshot: Record<string, string> = {};
  for (const [num, entry] of visited) {
    snapshot[String(num)] = entry.issue.updated_at;
  }
  writeFileSync(recordPath, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
  console.log(`recorded snapshot for ${visited.size} issue(s) -> ${recordPath}`);
}

const errors: string[] = [];
const overlaps: { count: number; line: string }[] = [];

// 1. Concurrent edit guard
if (snapshotPath) {
  if (!existsSync(snapshotPath)) {
    console.error(`snapshot file not found: ${snapshotPath}`);
    process.exit(2);
  }
  const prev = JSON.parse(readFileSync(snapshotPath, "utf8")) as Record<string, string>;
  for (const [numStr, recordedAt] of Object.entries(prev)) {
    const num = Number(numStr);
    const live = visited.get(num)?.issue ?? (await api<Issue>(`issues/${num}`))[0];
    if (live && live.updated_at !== recordedAt) {
      errors.push(
        `[CONCURRENT_EDIT] #${num} changed since snapshot (${recordedAt} -> ${live.updated_at}): re-read before writing`,
      );
    }
  }
}

// Transitive reachability across visited nodes so A <- B <- C doesn't flag A <-> C.
function isOrdered(a: number, b: number): boolean {
  const walk = (start: number, target: number, dir: "blockedBy" | "blocking"): boolean => {
    const seen = new Set<number>();
    const stack = [start];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      const next = visited.get(cur)?.[dir];
      if (!next) continue;
      if (next.has(target)) return true;
      for (const n of next) stack.push(n);
    }
    return false;
  };
  return walk(a, b, "blockedBy") || walk(a, b, "blocking") || walk(b, a, "blockedBy") || walk(b, a, "blocking");
}

// 2–4. Per-target leaf checks
const targets = [...visited.values()].filter((v) => v.isLeaf && v.issue.state === "open");
const reportedPairs = new Set<string>();

for (const entry of targets) {
  const num = entry.issue.number;
  const body = drafts.get(num) ?? entry.issue.body ?? "";
  const files = extractCodeFiles(body);

  // 2. Shared surface against all open ready-for-agent tickets (and other targets)
  const peers = new Map<number, Set<string>>();
  for (const [otherNum, otherFiles] of openReadyFiles) {
    if (otherNum !== num) peers.set(otherNum, otherFiles);
  }
  for (const other of targets) {
    const otherNum = other.issue.number;
    if (otherNum !== num && !peers.has(otherNum)) {
      peers.set(otherNum, extractCodeFiles(drafts.get(otherNum) ?? other.issue.body ?? ""));
    }
  }

  for (const [otherNum, peerFiles] of peers) {
    if (isOrdered(num, otherNum)) continue;
    const shared = [...files].filter((f) => peerFiles.has(f) && !hubFiles.has(f)).sort();
    if (shared.length === 0) continue;
    const pairKey = num < otherNum ? `${num}:${otherNum}` : `${otherNum}:${num}`;
    if (reportedPairs.has(pairKey)) continue;
    reportedPairs.add(pairKey);
    const preview =
      shared.length <= 3 ? shared.join(", ") : `${shared.slice(0, 3).join(", ")} (+${shared.length - 3} more)`;
    overlaps.push({
      count: shared.length,
      line: `- [SHARED_SURFACE] #${num} <-> #${otherNum} (${shared.length}): ${preview}`,
    });
  }

  // 3. Unwired prose blockers
  for (const blockerNum of extractProseBlockers(body)) {
    if (blockerNum === num) continue;
    if (entry.blockedBy.has(blockerNum)) continue;
    const isOpenReady = openReadyByNum.has(blockerNum);
    const isOpenVisited = visited.get(blockerNum)?.issue.state === "open";
    if (isOpenReady || isOpenVisited) {
      errors.push(
        `[UNWIRED_BLOCKER] #${num} mentions "blocked by #${blockerNum}" in prose, but native blocked_by edge is missing`,
      );
    }
  }

  // 4. Non-self-contained back-references
  const backRefs = extractBackRefs(body);
  if (backRefs.length > 0) {
    errors.push(
      `[BACK_REFERENCE] #${num} delegates rules via "${backRefs.join('", "')}" — copy the rule into this body`,
    );
  }
}

overlaps.sort((a, b) => b.count - a.count || a.line.localeCompare(b.line));
if (overlaps.length > 0) {
  console.log(`Shared surfaces with open ${READY_LABEL} tickets (no blocked_by edge, ${overlaps.length} pair(s)):`);
  for (const o of overlaps) console.log(o.line);
}

if (errors.length === 0) {
  console.log(`clean: 0 hard errors across ${targets.length} target(s) (${openReady.length} open ${READY_LABEL} scanned)`);
  process.exit(0);
}

console.log(`\n${errors.length} hard error(s):`);
for (const e of errors) console.log(`- ${e}`);
process.exit(1);
