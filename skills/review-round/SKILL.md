---
name: review-round
description: Run one verify → review → fix round on the current branch's pull request and record the result. Designed to be repeated by `/loop N --until gate.ts`. Use when the user asks to review-loop, auto-review, or run a review round on a PR.
---

# Review round

One round of the review loop for the PR attached to the current branch. Every round is self-contained: no memory of previous rounds except what is on disk under `$(git rev-parse --git-dir)/review/`. Never run more than one round per invocation; the loop does the repetition.

Run it with:

```
/loop 5 --until '~/.omp/agent/skills/review-round/gate.ts' /skill:review-round
```

`gate.ts` stops the loop when a round is `converged` (two or more rounds with green checks and the latest found no major issue) or `stalled` (a critical/major finding of the latest green round repeats one from an earlier green round). "Same defect" is judged by TypeSafe Jev, since fixes shift lines and titles get reworded; the gate needs `TYPESAFE_API_KEY` and fails (disabling `/loop`) without it. Hitting the count means `capped`. `pr-guide` marks the PR ready only on `converged`.

## Resolve context

- Branch: `git branch --show-current`
- PR of the current branch: `gh pr view --json number,baseRefName,body`
  - No PR → stop and say exactly: `No PR for branch <branch>; run /skill:create-pr first.`
- State: `dir=$(git rev-parse --git-dir)/review`; `mkdir -p "$dir"`
  - `$dir/status` exists → stop and say exactly: `Review loop already finished (<status>); rm -r <dir> to restart.`
  - Round number `N` = count of `$dir/round-*.json` + 1
- Base: `git fetch origin <base>`; `merge_base=$(git merge-base origin/<base> HEAD)`
- Diff under review: `git diff $merge_base` (includes the working tree, so fixes from a previous round are always seen)

## 1. Verify

Green means two things passed: the repo's checks and a live exercise of what the diff changed. Tests alone are not proof.

1. Checks: find the repo's check commands (nearest `AGENTS.md`, package scripts, `Makefile`, `justfile`, CI config). No checks defined anywhere → note `no checks defined` in the round file and rely on the live exercise alone.
2. Live exercise: from the PR intent and the diff, write 2–5 concrete scenarios that the change must satisfy, each with an expected observable outcome. Match the surface:
   - API or backend: start the real service against its real (dev) database, send real requests, assert responses and the resulting DB state.
   - UI: open the actual page in the Eval browser, perform the user actions, assert what appears or changes.
   - CLI or library: run the real command or a throwaway script on the changed path and assert output.
   Skip the exercise only when nothing in the diff changes what executes (docs, comments, tests only). Config, env, migrations, feature flags, and build settings do change what executes: exercise them. State the reason for any skip in the round file.

Dispatch `verifier` once with the exact check commands and the scenarios (expected outcome per scenario). It reports pass/fail/blocked with evidence. A blocked scenario is not green.

- Red: dispatch `task` to fix only what the failing checks or scenarios require, then dispatch `verifier` once more. Record the final result. Do not review this round: reviewing code that fails its own checks wastes a pass. Go to step 4.
- Green: continue.

## 2. Review

Dispatch the `reviewer` agent. It runs on the model mapped for `reviewer` in `task.agentModelOverrides` (currently `@slow`, an OpenAI model): keep that mapping on a different vendor than the model that wrote the code, or the review shares the writer's blind spots. Give it only: the PR body, the diff, and the list of checks and scenarios that passed. Never the conversation. Use this task text and this `outputSchema`:

```
Review this pull request diff against its stated intent. Report only defects you can point to in the diff: wrong logic, contract violations against the intent, missing error handling at trust boundaries, security issues, data loss, missing or incorrect tests for changed behavior. Do not report style, naming, formatting, or hypothetical future needs. Zero findings is a valid result.

Severity: critical = data loss, security, or crash on the main path; major = incorrect behavior or contract violation; minor = real but low-impact defect; nit = anything else.

<intent>…PR body…</intent>
<checks_passed>…</checks_passed>
<diff>…</diff>
```

```json
{"type":"object","required":["findings"],"properties":{"findings":{"type":"array","items":{"type":"object","required":["severity","file","line","title","why","fix"],"properties":{"severity":{"enum":["critical","major","minor","nit"]},"file":{"type":"string"},"line":{"type":"integer"},"title":{"type":"string"},"why":{"type":"string"},"fix":{"type":"string"}}}}}}
```

## 3. Fix

Only `critical` and `major` findings are fixed by the loop. `minor` and `nit` are recorded for the human; fixing them is where review loops oscillate.

Dispatch `task` with the diff, the PR body, and the critical/major findings. Contract: for each finding, either fix it or reject it with a one-sentence reason. Rejecting is correct when the finding is wrong, outside the diff, or contradicts the PR intent. The fixer returns `{"fixed":[titles],"rejected":[{"file","line","title","reason"}]}`.

## 4. Record

1. If the working tree changed: `git add -A && git commit -m "review: round N" && git push`. One commit per round is what makes a bad round revertible.
2. Write `$dir/round-N.json`:

```json
{
  "round": 1,
  "verify": "green",
  "verified": ["bun test", "bun run lint", "POST /orders with valid body creates the row and returns 201"],
  "findings": 4,
  "majors": [{"file": "src/x.ts", "line": 12, "title": "…", "why": "…"}, {"file": "src/z.ts", "line": 7, "title": "…", "why": "…"}],
  "fixed": 1,
  "rejected": [{"file": "src/x.ts", "line": 12, "title": "…", "reason": "…"}],
  "minor": [{"file": "src/y.ts", "line": 40, "title": "…"}],
  "commit": "abc1234"
}
```

`majors` lists every critical and major finding exactly as the reviewer reported it (fixed or rejected alike); the gate compares these across rounds. `verified` lists the checks and scenarios that passed (empty when red). When `verify` is `red`: `findings: 0, majors: [], fixed: <fixes applied to pass checks>, rejected: [], minor: []`. `commit` is `null` when nothing was committed.

3. Print exactly one line and stop:

```
Round N: verify=green findings=4 major=2 fixed=1 rejected=1
```
