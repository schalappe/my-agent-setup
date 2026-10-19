---
name: review-round
description: Run one verify → review → fix round on the current branch's pull request and record the result. Designed to be repeated by `/loop N --until gate.ts`. Use when the user asks to review-loop, auto-review, or run a review round on a PR.
---

# Review round

One round of the review loop for the PR attached to the current branch. Every round is self-contained: no memory of previous rounds except what is on disk under `$(git rev-parse --git-common-dir)/review/<branch>/` (shared by every worktree, so it survives disposable ones). Never run more than one round per invocation; the loop does the repetition.

## Preflight (once, before the loop)

Resolve branch, PR, and worktree once before starting `/loop`, not every round:

- Branch: `git branch --show-current`.
- PR: `gh pr view <branch> --json number`. No PR → do not start the loop; say `No PR for branch <branch>; run /skill:create-pr first.` A missing PR never fixes itself between rounds, so retrying it each round only burns the count.
- Worktree: `git worktree list --porcelain`. The branch is checked out in another worktree → do not start the loop here; print the command to launch it there: `cd <worktree-path>` followed by the same `/loop` command.

Run it with:

```
/loop 5 --until '~/.omp/agent/skills/review-round/gate.ts' /skill:review-round
```

`gate.ts` stops the loop when a round is `converged` (two or more green rounds and the latest, run on the current code, found no major issue) or `stalled` (a critical/major finding of the latest green round repeats one from an earlier green round). Red and blocked rounds never count. "Same defect" is judged by TypeSafe Jev, since fixes shift lines and titles get reworded; the gate needs `TYPESAFE_API_KEY` and fails (disabling `/loop`) without it. Hitting the count means `capped`. `pr-guide` marks the PR ready only on `converged`.

The loop is finished only when `gate.ts` exits 0. Never write `$dir/status` or `$dir/verify-N.json` yourself and never declare the loop done from a round's result: the gate derives each round's verdict from the verifier's file. Running rounds without `/loop` (the user asked in plain words to loop until no issue): run `bun ~/.omp/agent/skills/review-round/gate.ts` after each round and start another round while it exits 1.

## Resolve context

- Branch: `git branch --show-current`
- PR of the current branch: `gh pr view --json number,baseRefName,body`
  - No PR → stop and say exactly: `No PR for branch <branch>; run /skill:create-pr first.`
- State: `dir=$(git rev-parse --path-format=absolute --git-common-dir)/review/$(git branch --show-current)`; `mkdir -p "$dir"` (one folder per branch, the same path `gate.ts` reads)
  - Round number `N` = count of `$dir/round-*.json` + 1
- Code identity: `tree=$(bun ~/.omp/agent/skills/review-round/gate.ts tree)` (hash of tracked + untracked files; the real index is untouched)
  - `$dir/status` reads `<status> <tree>` with that same tree → stop and say exactly: `Review loop already finished (<status>) for this code; rm -r <dir> to restart.` A status for another tree is stale: ignore it and run the round.
- Base: `git fetch origin <base>`; `merge_base=$(git merge-base origin/<base> HEAD)`
- Diff handoff (includes the working tree, so fixes from a previous round are always seen), one patch per file so nobody reads the whole diff:

```bash
p="$dir/round-$N"; mkdir -p "$p/patches"
git diff --numstat $merge_base > "$p/files.txt"   # added<TAB>removed<TAB>file
git diff --name-only $merge_base | while IFS= read -r f; do git diff $merge_base -- "$f" > "$p/patches/${f//\//__}.patch"; done
```

## 1. Verify

Green means two things passed: the repo's checks and a live exercise of what the diff changed. Tests alone are not proof.

1. Checks: find the repo's check commands (nearest `AGENTS.md`, package scripts, `Makefile`, `justfile`, CI config). No checks defined anywhere → note `no checks defined` in the round file and rely on the live exercise alone.
2. Live exercise: from the PR intent and the diff, write 2–5 concrete scenarios that the change must satisfy, each with an expected observable outcome. Match the surface:
   - API or backend: start the real service against its real (dev) database, send real requests, assert responses and the resulting DB state.
   - UI: open the actual page in the Eval browser, perform the user actions, assert what appears or changes.
   - CLI or library: run the real command or a throwaway script on the changed path and assert output.
   Skip the exercise only when nothing in the diff changes what executes (docs, comments, tests only). Config, env, migrations, feature flags, and build settings do change what executes: exercise them. State the reason for any skip in the round file.

Reuse first: an earlier `$dir/verify-M.json` whose `tree` equals `$tree` and has no blocked scenario already verified this exact code → `cp` it to `$dir/verify-N.json` and skip the dispatch. A different tree is never reused.

Otherwise dispatch `verifier` once with the exact check commands, the scenarios (expected outcome per scenario), and this output contract: first record `git rev-parse HEAD` and `bun ~/.omp/agent/skills/review-round/gate.ts tree`, then run everything and write `$dir/verify-N.json` with the observed exit codes (a command that did not run is not exit 0):

```json
{"head": "abc1234…", "tree": "9f3e…", "checks": [{"command": "bun test", "exit": 0}], "scenarios": [{"name": "POST /orders with valid body returns 201 and creates the row", "result": "pass"}, {"name": "…", "result": "blocked", "reason": "dev DB unreachable"}]}
```

`result` is `pass`, `fail`, or `blocked`. The gate reads this file: green only if every `exit` is 0 and every scenario is `pass`; any failure is red; otherwise any `blocked` is blocked. Read it for the outcome; do not trust a summary instead.

- Red: dispatch `task` to fix only what the failing checks or scenarios require, then dispatch `verifier` once more (it overwrites `verify-N.json`). Do not review this round: reviewing code that fails its own checks wastes a pass. Go to step 4.
- Blocked (any scenario could not run, everything else passed): unblock it with the repo's documented local setup (nearest `AGENTS.md`), then dispatch `verifier` once more. Still blocked → skip review, go to step 4. A blocked scenario is never green.
- Green: every check and every scenario passed. Continue.

## 2. Review

Recompute `tree`; it must equal `tree` in `verify-N.json` (the code reviewed is the code verified). It differs → re-run step 1.

Split `files.txt` into slices of at most ~2000 changed lines (a bigger single file is its own slice) and dispatch one `reviewer` per slice in one batch. It runs on the model mapped for `reviewer` in `task.agentModelOverrides` (currently `@slow`, an OpenAI model): keep that mapping on a different vendor than the model that wrote the code, or the review shares the writer's blind spots. Give each only: the PR body, the full `files.txt` (for orientation), the paths of its slice's patch files, and the list of checks and scenarios that passed. It reads its patches and may open surrounding source; never hand it the whole diff. Never the conversation. Use this task text and this `outputSchema`:

```
Review your slice of this pull request diff against its stated intent. Read only the patch files listed in <slice> (open surrounding source when needed). Report only defects you can point to in those patches: wrong logic, contract violations against the intent, missing error handling at trust boundaries, security issues, data loss, missing or incorrect tests for changed behavior. Do not report style, naming, formatting, or hypothetical future needs. Zero findings is a valid result.

Severity: critical = data loss, security, or crash on the main path; major = incorrect behavior or contract violation; minor = real but low-impact defect; nit = anything else.

<intent>…PR body…</intent>
<checks_passed>…</checks_passed>
<files>…files.txt…</files>
<slice>…patch file paths…</slice>
```

```json
{"type":"object","required":["findings"],"properties":{"findings":{"type":"array","items":{"type":"object","required":["severity","file","line","title","why","fix"],"properties":{"severity":{"enum":["critical","major","minor","nit"]},"file":{"type":"string"},"line":{"type":"integer"},"title":{"type":"string"},"why":{"type":"string"},"fix":{"type":"string"}}}}}}
```

## 3. Fix

Only `critical` and `major` findings are fixed by the loop. `minor` and `nit` are recorded for the human; fixing them is where review loops oscillate.

Merge the slices' findings. Dispatch `task` with the PR body, the critical/major findings, and the patch paths of the files they touch. Contract: for each finding, either fix it or reject it with a one-sentence reason. Rejecting is correct when the finding is wrong, outside the diff, or contradicts the PR intent. The fixer returns `{"fixed":[titles],"rejected":[{"file","line","title","reason"}]}`.

## 4. Record

1. If the working tree changed: `git add -A && git commit -m "review: round N" && git push`. One commit per round is what makes a bad round revertible.
2. Write `$dir/round-N.json`:

```json
{
  "round": 1,
  "head": "abc1234…",
  "tree": "9f3e…",
  "findings": 4,
  "majors": [{"file": "src/x.ts", "line": 12, "title": "…", "why": "…"}, {"file": "src/z.ts", "line": 7, "title": "…", "why": "…"}],
  "fixed": 1,
  "rejected": [{"file": "src/x.ts", "line": 12, "title": "…", "reason": "…"}],
  "minor": [{"file": "src/y.ts", "line": 40, "title": "…"}],
  "commit": "abc1234"
}
```

`head` and `tree` are copied from `verify-N.json`: the code this round verified and reviewed (the gate exits 2 if they disagree). No `verify` field: the gate derives it from `verify-N.json`. `majors` lists every critical and major finding exactly as the reviewer reported it (fixed or rejected alike); the gate compares these across rounds. When verification was red or blocked: `findings: 0, majors: [], fixed: <fixes applied to pass checks>, rejected: [], minor: []`. `commit` is `null` when nothing was committed.

3. Print exactly one line and stop:

```
Round N: verify=<green|red|blocked from verify-N.json> findings=4 major=2 fixed=1 rejected=1
```
