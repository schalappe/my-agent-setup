#!/usr/bin/env bun
// Reviewer noise report for the review-round skill: `bun ~/.agents/skills/review-round/noise.ts <repo>...`.
// Reads every loop under $(git common dir)/review/<branch>/ of each repo, read-only, and prints per loop: rounds,
// how the loop ended, critical/major findings reported, how many the fixer rejected, and pre-existing findings.
// The rejected share is the reviewer's noise as the fixer judged it; the reasons say which instruction to tune.
// `verify min` is the sum of the wall seconds of the checks and scenarios that the verifier ran. It skips carried
// entries and counts a reused verify file once. It prints `-` when no verify file records seconds.
// Rounds recorded before a field existed count that field as empty.

import { dirname, relative } from "node:path";
import { $ } from "bun";

type Loop = {
  repo: string;
  branch: string;
  rounds: number;
  status: string;
  majors: number;
  rejected: string[];
  preExisting: number;
  verifySeconds?: number;
};

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

async function loops(repo: string): Promise<Loop[]> {
  const reviewDir = `${(await $`git -C ${repo} rev-parse --path-format=absolute --git-common-dir`.text()).trim()}/review`;
  const byLoop = new Map<string, string[]>();
  for (const path of new Bun.Glob("**/round-*.json").scanSync({ cwd: reviewDir, dot: true }))
    byLoop.set(dirname(path), [...(byLoop.get(dirname(path)) ?? []), path]);

  const result: Loop[] = [];
  for (const [loopDir, rounds] of byLoop) {
    const loop: Loop = { repo, branch: loopDir, rounds: rounds.length, status: "unfinished", majors: 0, rejected: [], preExisting: 0 };
    const status = Bun.file(`${reviewDir}/${loopDir}/status`);
    if (await status.exists()) loop.status = (await status.text()).trim().split(" ")[0] ?? "unfinished";
    for (const path of rounds) {
      const round = (await Bun.file(`${reviewDir}/${path}`).json()) as Record<string, unknown>;
      loop.majors += asArray(round.majors).length;
      loop.preExisting += asArray(round.pre_existing).length;
      for (const finding of asArray(round.rejected))
        loop.rejected.push(typeof finding === "object" && finding !== null ? String((finding as Record<string, unknown>).reason) : String(finding));
    }
    loop.verifySeconds = await verifySeconds(`${reviewDir}/${loopDir}`);
    result.push(loop);
  }
  return result;
}

async function verifySeconds(dir: string): Promise<number | undefined> {
  const texts = new Set<string>();
  for (const name of new Bun.Glob("verify-*.json").scanSync(dir)) texts.add(await Bun.file(`${dir}/${name}`).text());
  let total: number | undefined;
  for (const text of texts) {
    const verify = JSON.parse(text) as Record<string, unknown>;
    for (const entry of [...asArray(verify.checks), ...asArray(verify.scenarios)] as Record<string, unknown>[])
      if (typeof entry.seconds === "number" && entry.carried_from === undefined) total = (total ?? 0) + entry.seconds;
  }
  return total;
}

const share = (part: number, whole: number) => (whole === 0 ? "-" : `${Math.round((100 * part) / whole)}%`);

const repos = process.argv.slice(2);
if (repos.length === 0) {
  console.error("usage: noise.ts <repo>...");
  process.exit(2);
}
const all = (await Promise.all(repos.map(loops))).flat();
const minutes = (seconds?: number) => (seconds === undefined ? "-" : Math.round(seconds / 60));
console.log("repo\tbranch\trounds\tend\tmajors\trejected\tpre-existing\tverify min");
for (const loop of all)
  console.log(
    [
      relative(process.cwd(), loop.repo) || ".",
      loop.branch,
      loop.rounds,
      loop.status,
      loop.majors,
      `${loop.rejected.length} (${share(loop.rejected.length, loop.majors)})`,
      loop.preExisting,
      minutes(loop.verifySeconds),
    ].join("\t"),
  );

const majors = all.reduce((sum, loop) => sum + loop.majors, 0);
const rejected = all.flatMap((loop) => loop.rejected);
const converged = all.filter((loop) => loop.status === "converged");
const meanRounds = converged.length ? (converged.reduce((sum, loop) => sum + loop.rounds, 0) / converged.length).toFixed(2) : "-";
console.log(`\ntotal: ${all.length} loops, ${majors} critical/major, ${rejected.length} rejected (${share(rejected.length, majors)}), mean rounds to converge ${meanRounds}`);
if (rejected.length) console.log(`rejection reasons:\n${rejected.map((reason) => `- ${reason}`).join("\n")}`);
