#!/usr/bin/env bun
// Gate for `/loop N --until '~/.omp/agent/skills/review-round/gate.ts' /skill:review-round`.
// Reads $GIT_DIR/review/round-*.json written by the review-round skill.
// Exit 0 = stop the loop (writes converged|stalled to $GIT_DIR/review/status).
// Exit 1 = run another round. Exit 2 = broken gate (bad round file, TypeSafe error); /loop disables itself.
//
// converged: ≥2 green rounds and the latest found no critical/major finding.
// stalled: a critical/major finding of the latest green round repeats one from an earlier green round
//   (the fix failed, or the fixer rejected it and the reviewer reported it again). "Same defect" is a
//   TypeSafe Jev judgment: fixes shift lines and the reviewer rewords titles, so file/line/title
//   matching misses repeats. Needs TYPESAFE_API_KEY.
// Red rounds never count as passes; they always continue.

import { existsSync } from "node:fs";
import { $ } from "bun";

type Finding = { file: string; line: number; title: string; why: string };
type Round = { verify: "green" | "red"; majors: Finding[] };

// ponytail: 0.5 = "more likely the same defect than not"; recalibrate on real rounds if stalls look wrong.
const SAME_DEFECT = 0.5;

async function verdict(): Promise<"converged" | "stalled" | undefined> {
  const dir = `${(await $`git rev-parse --git-dir`.text()).trim()}/review`;
  if (!existsSync(dir)) return undefined; // no round recorded yet
  const names = [...new Bun.Glob("round-*.json").scanSync(dir)].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  );
  const rounds: unknown[] = await Promise.all(names.map((name) => Bun.file(`${dir}/${name}`).json()));
  if (
    !rounds.every(
      (round): round is Round =>
        typeof round === "object" && round !== null && "verify" in round && "majors" in round && Array.isArray(round.majors),
    )
  )
    throw new Error(`${dir}: a round file lacks "verify" or the "majors" array`);

  const green = rounds.filter((round) => round.verify === "green");
  const latest = green.at(-1);
  if (!latest || rounds.at(-1) !== latest || green.length < 2) return undefined;

  let result: "converged" | "stalled" | undefined;
  if (latest.majors.length === 0) result = "converged";
  else if (await repeatsEarlier(latest.majors, green.slice(0, -1).flatMap((round) => round.majors))) result = "stalled";
  if (result) await Bun.write(`${dir}/status`, `${result}\n`);
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
  const result = await verdict();
  if (!result) process.exit(1);
  console.log(`review loop: ${result}`);
  process.exit(0);
} catch (error) {
  // Exit 1 would mean "continue": any failure must surface as a broken gate instead.
  console.error(`review gate: ${error instanceof Error ? error.message : error}`);
  process.exit(2);
}
