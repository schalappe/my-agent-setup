#!/usr/bin/env bun
// Task graph of GitHub issues, for `/implement-plan` and the `implement` skill:
// `bun ~/.agents/skills/implement/plan-graph.ts <owner/repo> <issue> [<issue>...]`.
// Every parent expands recursively to its sub-issues; a ticket is a leaf issue. Prints one row per open ticket:
// its wave (1 = startable now; computed from GitHub's native "blocked by" links, closed tickets count as done),
// its size (first XS/S/M/L/XL of the ticket's "Size and plan" section, `?` if absent), whether it is ready,
// and `held by`: the not-ready tickets it waits on, directly or through other tickets.
// Ready means labelled `ready-for-agent` and sized XS, S, M, or L. An XL ticket must be split and an unsized one
// is still in the fog of war: both go back to `/scout` before any plan includes them.
// Text "Blocked by" sections are not read; compare them with the native links yourself.
import { $ } from "bun";

type Issue = { number: number; title: string; state: string; body: string | null; labels: { name: string }[] };
type Ticket = {
  number: number;
  title: string;
  state: string;
  parent: number | null;
  size: string;
  ready: string;
  blockedBy: number[];
  isLeaf: boolean;
};

const READY_LABEL = "ready-for-agent";
const [repo, ...roots] = process.argv.slice(2);
if (!repo?.includes("/") || roots.length === 0) {
  console.error("usage: plan-graph.ts <owner/repo> <issue> [<issue>...]");
  process.exit(2);
}

async function api<T>(path: string): Promise<T[]> {
  const pages: T[][] = JSON.parse(await $`gh api --paginate --slurp repos/${repo}/${path}`.text());
  return pages.flat();
}

function sizeOf(body: string | null): string {
  const section = body?.split(/^## Size and plan\s*$/m)[1] ?? "";
  return section.match(/\b(XS|XL|S|M|L)\b/)?.[1] ?? "?";
}

function readiness(labels: string[], size: string): string {
  if (!labels.includes(READY_LABEL)) return labels.join(",") || "no label";
  if (size === "XL") return "XL: split with /scout";
  if (size === "?") return "no size: /scout";
  return "yes";
}

const tickets = new Map<number, Ticket>();

async function visit(number: number, parent: number | null): Promise<void> {
  if (tickets.has(number)) return;
  const [[issue], subIssues, blockers] = await Promise.all([
    api<Issue>(`issues/${number}`),
    api<Issue>(`issues/${number}/sub_issues`),
    api<Issue>(`issues/${number}/dependencies/blocked_by`),
  ]);
  const labels = issue.labels.map((label) => label.name);
  tickets.set(number, {
    number,
    title: issue.title,
    state: issue.state,
    parent,
    size: sizeOf(issue.body),
    ready: readiness(labels, sizeOf(issue.body)),
    blockedBy: blockers.filter((b) => b.state === "open").map((b) => b.number),
    isLeaf: subIssues.length === 0,
  });
  await Promise.all(subIssues.map((sub) => visit(sub.number, number)));
}

await Promise.all(roots.map((root) => visit(Number(root.replace("#", "")), null)));

const openTickets = [...tickets.values()].filter((t) => t.isLeaf && t.state === "open");
const outsideBlockers = new Set(openTickets.flatMap((t) => t.blockedBy).filter((b) => !tickets.has(b)));

const waves = new Map<number, number>();
function waveOf(number: number, path: number[] = []): number {
  const known = waves.get(number);
  if (known !== undefined) return known;
  if (path.includes(number)) throw new Error(`blocking cycle: ${[...path, number].map((n) => `#${n}`).join(" -> ")}`);
  const blockers = tickets.get(number)?.blockedBy ?? [];
  const wave = 1 + Math.max(0, ...blockers.filter((b) => tickets.has(b)).map((b) => waveOf(b, [...path, number])));
  waves.set(number, wave);
  return wave;
}

function heldBy(number: number, seen = new Set<number>()): Set<number> {
  for (const blocker of tickets.get(number)?.blockedBy ?? []) {
    if (seen.has(blocker)) continue;
    const ticket = tickets.get(blocker);
    if (!ticket || ticket.ready !== "yes") seen.add(blocker);
    heldBy(blocker, seen);
  }
  return seen;
}

if (openTickets.length === 0) {
  console.log(`no open ticket under ${roots.join(" ")}: everything is closed`);
  process.exit(0);
}

const tag = (numbers: Iterable<number>) => [...numbers].map((n) => `#${n}`).join(" ") || "-";
openTickets.sort((a, b) => waveOf(a.number) - waveOf(b.number) || a.number - b.number);
console.log("wave | ticket | size | ready | held by | parent | blocked by (open) | title");
for (const t of openTickets) {
  const parent = t.parent === null ? "-" : `#${t.parent}`;
  console.log(
    `${waveOf(t.number)} | #${t.number} | ${t.size} | ${t.ready} | ${tag(heldBy(t.number))} | ${parent} | ${tag(t.blockedBy)} | ${t.title}`,
  );
}
if (outsideBlockers.size > 0) {
  console.log(`\nopen blockers outside the given issues (they hold the tickets above): ${tag(outsideBlockers)}`);
}
