---
name: agents-md
description: Create a repository's AGENTS.md when it is missing, or audit and rewrite an existing one until it conforms. Use when the user asks to write, fix, update, audit, or trim AGENTS.md, when a repo has no AGENTS.md, or when a repeated agent mistake should become a rule.
---

# AGENTS.md

Agents load AGENTS.md into every session in its repository. Every line costs context on every task, so each line must hold a fact about this repository that an agent cannot cheaply rediscover and that changes what it does.

Sources behind these rules:

- The Coldtea field study read the root AGENTS.md of the 100 most-starred repos that have one (August 2026). Orientation and verification take about half of the words. The median file has 1,198 words under 14 headings. Of the files, 86% contain explicit "don't" rules, 79% give commit and PR rules, and 74% give test instructions. Only 25% say how to run a single test.
- The warrenday gist is an example AGENTS.md for one real project. It states that "this file is a failure log, not a wishlist" and that general advice "belongs nowhere". It moves long workflows into skills and subsystem rules into nested files, and it keeps the root file under 500 lines.

## Rules for the file

1. Every rule is specific to this repo. Test each line: if it could appear unchanged in another project's AGENTS.md, delete it. Generic behavior (be concise, ask when unsure, don't hide failures) belongs in the user's global instructions, not here.
2. Every path exists and every command runs as written from the stated directory.
3. Commands are fenced, copy-pasteable, and annotated with their purpose. Include the single-test command. Most files miss it, and agents need it most.
4. Each "don't" names the trap and the correct action: "Do not edit `dist/`; run `bun run build`." Record a negative rule only when it traces to a real failure, a history entry, or a stated maintainer policy.
5. Link deeper docs instead of copying them. Move workflows that run rarely (release, migration, security review) into a skill or doc and leave a one-line pointer.
6. Subsystem rules go into the nearest nested AGENTS.md. The root keeps only rules that apply repo-wide. Nested files follow the same rules.
7. Target under two pages (about 1,000 words). Hard cap is 500 lines. Size follows the repo: a small library may need 30 lines.
8. No placeholders standing in for unknown content, sample paths, or template leftovers such as `<install command>` or an unused `src/`. Pattern variables inside a real path or CLI signature (`skills/<name>/SKILL.md`) are fine.
9. Numbers stated as limits (latency budget, page size, line cap) come from the repo's actual policy, never from an example.
10. One term per concept, matching the code.

## Sections

Use only the sections the repo has grounded content for, in this order. Headings are sentence case.

1. Project overview. One paragraph on what the project does and which parts agents touch most, plus links to deeper docs.
2. Structure. Real top-level paths with one-line responsibilities. Add a "where things live" table only when the repo is large enough that agents search for the same locations repeatedly.
3. Commands. Setup, build, full test suite, single test, lint, type check. State which command must pass before a task counts as done, and name commands that never exit (dev servers, watchers) so agents do not use them as checks.
4. Architecture. Dependency direction, sources of truth and generated outputs with the command that regenerates each, and the change order for cross-layer contracts.
5. Conventions. Formatter and linter names, naming patterns, and domain vocabulary. Only what the tools do not already enforce.
6. Git and PR workflow. Commit format and trailer policy from history (step 3). Branch targets and required CI checks from the CI workflows (step 2).
7. Boundaries. Repo-specific "don't" rules: generated files, protected directories, dependency policy, secrets locations.
8. Failure log. Short imperative entries, each from a real incident: "Run `make gen` before `go test`; stale mocks fail with `undefined: MockStore`."

## Workflow

### 1. Detect mode

Look for the root `AGENTS.md`, nested `AGENTS.md` files, and repo skill directories (rule 5 pointers target them). Ignore AGENTS.md files that are shipped or vendored content rather than context for this repo.

- No root AGENTS.md: **create** mode.
- Root AGENTS.md exists: **audit** mode. Audit nested files the same way.

Done when the mode and the target files are known.

### 2. Collect repo facts

Read what the repo already declares: manifests and their scripts (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `Makefile`, `justfile`), CI workflows, formatter and linter configs, `README`, `CONTRIBUTING`, the docs directory, and generated-file markers (`.gitattributes` `linguist-generated`, `.gitignore`d build output).

Run the setup, lint, type-check, full test, and single-test commands you intend to document, plus every Makefile target or package script you name, because wrappers break silently. Use a runtime version the repo supports, preferably the one CI uses. Then handle each command this way:

- It works: document it.
- It fails and a prerequisite fixes it: document both.
- It fails on a clean checkout but CI requires it: document it with the observed baseline (for example, the failure count), so agents compare against that and do not blame their change.
- It does not exist, or fails with no fix: leave it out.
- It needs a tool the machine lacks, or runs longer than about 10 minutes: run the largest subset that works and list the full command as unverified.

Restore any files these commands modified (`git status`) before writing.

Done when each planned command is either verified or listed as unverified with the reason.

### 3. Mine git history

History shows the real conventions and the real failures. If `git rev-parse --is-shallow-repository` prints `true`, run `git fetch --unshallow`. When that fails, report history as unavailable, leave out history-derived rules, and ask for the commit format. Run these from the repo root:

```bash
git log --format='%s' -200                                  # commit format: Conventional Commits? scopes? language?
git log --format='%(trailers)' -100 | sort | uniq -c        # Co-authored-by, Signed-off-by, AI disclosure trailers
git symbolic-ref --short refs/remotes/origin/HEAD           # default branch that PRs target
git log --format= --name-only -300 | sort | uniq -c | sort -rn \
  | while read -r n p; do test -e "$p" && echo "$n $p"; done | head -20   # most-changed paths that still exist: feed the overview
git log --format='%h %s' -300 | rg -i '^\w+ (fix|revert|hotfix|add back|restore)|regress|broke'   # failure candidates, from subjects only
git log --follow -p -- AGENTS.md                            # audit mode: why each existing rule was added
```

For each failure candidate, read the commit (`git show <sha>`) and its fix. Turn it into a failure-log entry only when all three hold: an agent could plausibly repeat it, the cause is specific to this repo, and one imperative sentence prevents it. Skip one-off typos and logic bugs. Check the sentence against current code: if the code breaks the rule elsewhere, narrow the rule to the files the fix touched. A code comment that records an incident and its fix also counts as a source; cite the file instead of a sha.

In squash-merge repos the commit format is the PR title format. Ignore the `(#NNN)` suffix that GitHub adds.

Done when the commit format, default branch, and hot paths are known or recorded as unavailable, and each failure entry has a sha or file that supports it.

### 4a. Create

Write the file section by section from steps 2 and 3. Leave out any section without grounded content. Don't invent product intent, policies, or budgets. When a fact that would change agent behavior is missing (for example whether agents may commit), ask one question with a recommended default instead of guessing.

### 4b. Audit and rewrite

Classify every line of the existing file before editing. Consecutive lines with the same verdict and reason (a table, a code block, a list) share one row.

| Verdict | When |
|---|---|
| keep | Repo-specific, true, and actionable. |
| fix | Right intent but a wrong path, dead command, vague wording, or missing correct action. |
| move | Belongs in a nested AGENTS.md, a skill, or a doc. Leave a one-line pointer. |
| delete | Generic advice, duplicate of the global instructions, aspirational, stale, or contradicted by the code or history. |

Keep any rule that `git log --follow -p -- AGENTS.md` ties to a fix commit, unless the code it guards no longer exists. Then add what steps 2 and 3 found missing: commands (single test first), history-derived git rules, and failure entries. Reorder into the section order above. Keep the maintainers' terminology and any rule they marked as policy, but rewrite arrow-speak and fragments into sentences (unslop rule 33).

Done when every original line has a verdict and the rewritten file satisfies the rules above.

### 5. Unslop the prose

Always apply the `unslop` skill to every file you wrote. Read `../unslop/SKILL.md` (it sits next to this skill), rewrite every flagged pattern, then run its check on each file:

```bash
bun ../unslop/check.ts AGENTS.md
```

Resolve `../` against this skill's directory. Ignore hits inside code fences and inline code, because commands and identifiers must stay verbatim. Ignore hits where the rule does not fit the line, such as a sentence-case heading flagged as title case. The judge is not deterministic, so expect hits near 0.5 on unchanged lines. Fix real hits, run the check once more, then stop. Unslop rule 33 applies here too: write whole imperative sentences with articles, not arrow-speak. If `TYPESAFE_API_KEY` is unset, apply the rules by hand and say that the check did not run.

### 6. Verify

- Every concrete path in backticks exists (`test -e`). Skip globs, `<name>` patterns, bare extensions, and package names.
- Every documented command was run in step 2, or the report lists it as unverified.
- No template leftovers remain: `rg -n '<[a-z][a-z -]*>' AGENTS.md` finds nothing outside intentional syntax.
- Length is within rule 7: `wc -lw AGENTS.md`.

### 7. Report

Tell the user:

- mode (created or audited) and the final line and word count
- for audits, the lines deleted or moved and why, grouped by verdict
- failure-log entries added, each with its source commit or file
- commands left unverified and why
- whether the unslop check ran
