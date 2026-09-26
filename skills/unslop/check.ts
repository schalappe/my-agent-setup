#!/usr/bin/env bun
// Unslop check: prints every sentence that still shows an unslop pattern.
// Usage: check.ts <file>, or pipe the text on stdin.
// Rules come from the numbered "N. **Name.** definition" lines of SKILL.md next to this script.
// Character rules (13 dashes, 18 emoji, 19 curly quotes) are exact checks in code; every other rule is a
// TypeSafe Jev Noul per sentence, one request per rule. Needs TYPESAFE_API_KEY.
// Output: `L<line> [<rule id> <rule name> <probability>; …] <sentence>`.
// Exit 0 = clean, 1 = flags printed, 2 = error.

// ponytail: 0.5 = "more likely than not"; raise it if flags turn out noisy on real text.
const FLAG = 0.5;
const CHARACTER_RULES: Record<string, RegExp> = { "13": /[—–]/, "18": /\p{Extended_Pictographic}/u, "19": /[“”‘’]/ };
const key = Bun.env.TYPESAFE_API_KEY;

async function main(): Promise<boolean> {
  const path = Bun.argv[2];
  const text = path ? await Bun.file(path).text() : await Bun.stdin.text();
  const skill = await Bun.file(`${import.meta.dir}/SKILL.md`).text();
  const rules = [...skill.matchAll(/^(\d+)\. \*\*(.+?)\*\* (.+)$/gm)].map(([, id, name, definition]) => ({
    id,
    name,
    definition,
  }));
  if (rules.length === 0) throw new Error("no numbered rules found in SKILL.md");

  // ponytail: line-based split on ". ", "! ", "? "; hard-wrapped sentences are judged in pieces.
  // YAML frontmatter is blanked (line numbers kept): it is metadata, not prose.
  const body = text.replace(/^---\n[\s\S]*?\n---\n/, (frontmatter) => "\n".repeat(frontmatter.split("\n").length - 1));
  const sentences: { line: number; text: string }[] = [];
  let fenced = false;
  body.split("\n").forEach((raw, index) => {
    if (raw.trimStart().startsWith("```")) fenced = !fenced;
    else if (!fenced)
      for (const piece of raw.split(/(?<=[.!?])\s+/))
        if (/\p{L}/u.test(piece)) sentences.push({ line: index + 1, text: piece.trim() });
  });
  if (sentences.length === 0) return true;

  const flags: string[][] = sentences.map(() => []);
  for (const rule of rules) {
    const pattern = CHARACTER_RULES[rule.id];
    if (pattern) sentences.forEach((sentence, i) => pattern.test(sentence.text) && flags[i].push(`${rule.id} ${rule.name}`));
  }

  if (!key) throw new Error("TYPESAFE_API_KEY is not set");
  const state = { sentences: sentences.map((sentence) => sentence.text) };
  await Promise.all(
    rules
      .filter((rule) => !CHARACTER_RULES[rule.id])
      .map(async (rule) => {
        const questions = Object.fromEntries(
          sentences.map((_, i) => [
            String(i),
            {
              type: "noul",
              instructions: {
                rule: { name: rule.name, definition: rule.definition },
                // Rule names mix problems ("Rule of three") and fixes ("Active voice"): ask about the violation.
                question: `Does \`sentences[${i}]\` contain the problem that \`rule\` tells writers to remove?`,
              },
              criteria: {
                true: "The sentence contains the problem and should be rewritten under this rule.",
                false:
                  "The sentence already follows the rule, the rule does not apply to this kind of line (for example a heading rule on a line that is not a heading), or it is an exception the rule allows.",
              },
            },
          ]),
        );
        const probabilities = await askNouls(state, questions);
        probabilities.forEach((p, i) => p >= FLAG && flags[i].push(`${rule.id} ${rule.name} ${p.toFixed(2)}`));
      }),
  );

  sentences.forEach((sentence, i) => {
    if (flags[i].length === 0) return;
    flags[i].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    console.log(`L${sentence.line} [${flags[i].join("; ")}] ${sentence.text}`);
  });
  return flags.every((sentenceFlags) => sentenceFlags.length === 0);
}

// Returns each Noul probability in question-key order. The state is one request's whole text:
// ponytail: no chunking, so text past Jev's 32k-token state limit fails with a 422.
async function askNouls(state: unknown, questions: Record<string, unknown>): Promise<number[]> {
  const body = JSON.stringify({ model: "jev-latest", state, questions });
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
    const probabilities = Object.keys(questions).map((id) => answers?.[id]?.noul);
    if (!probabilities.every((p): p is number => typeof p === "number"))
      throw new Error(`unexpected TypeSafe answers: ${JSON.stringify(answers)}`);
    return probabilities;
  }
}

try {
  process.exit((await main()) ? 0 : 1);
} catch (error) {
  console.error(`unslop check: ${error instanceof Error ? error.message : error}`);
  process.exit(2);
}
