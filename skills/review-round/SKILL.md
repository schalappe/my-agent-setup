---
name: review-round
description: Run verify → review → fix rounds on the current branch's pull request until the review gate stops it or the round cap is hit. Claude Code only. Use when the user asks to review-loop, auto-review, or run review rounds on a PR.
argument-hint: "[max rounds, default 5]"
model: sonnet
effort: medium
---

# Review rounds

Verify → review → fix rounds on the PR attached to the current branch, in Claude Code: `/review-round 5`. The skill runs the loop itself, so do not wrap it in `/loop`.

Max rounds `M` = the number given with the invocation, or 5.

Each step runs on the cheapest model that does it reliably. The orchestration (this file) runs on Sonnet through the frontmatter, until the end of the turn. Set every other model at the call; never rely on the session default:

| Step | Model, effort | How |
|---|---|---|
| Verify | Sonnet, low (Haiku, low, when the round has no live exercise) | `verifier` agent, Agent tool `model` and `effort` |
| Fix (red) | Sonnet, medium | general-purpose agent, Agent tool `model` and `effort` |
| Review | Fable, high | `claude -p`, one process per slice |
| Fix (findings) | Opus, high | general-purpose agent, Agent tool `model` and `effort` |
| Same defect | TypeSafe Jev | the gate |

Rounds share nothing but the files under `$(git rev-parse --git-common-dir)/review/<branch>/`, which every worktree shares, so state survives disposable ones. Re-resolve the context at the start of every round and do not carry findings over in memory.

Gate: `gate=~/.agents/skills/review-round/gate.ts`. It stops the loop when the rounds are `converged` (two or more green rounds and the latest, run on the current code, found no critical or major issue) or `stalled` (a critical or major finding of the latest green round repeats one from an earlier green round). Red and blocked rounds never count. "Same defect" is judged by TypeSafe Jev, since fixes shift lines and titles get reworded, so the gate needs `TYPESAFE_API_KEY`. `pr-guide` marks the PR ready only on `converged`.

## Preflight (once)

- Branch: `git branch --show-current`.
- PR: `gh pr view <branch> --json number`. No PR → stop and say `No PR for branch <branch>; open one first.`
- Worktree: `git worktree list --porcelain`. The branch is checked out in another worktree → stop and print `cd <worktree-path>` followed by the same invocation.
- `command -v claude` and `[ -n "$TYPESAFE_API_KEY" ]`. Either is missing → stop and say which one.

## Loop

Repeat up to `M` times: run one round (below), then `bun $gate`.

- Exit 0 → print the gate's line (`review loop: converged|stalled`). On `converged`, run the [minor pass](#minor-pass) if it has not run in this loop; otherwise stop.
- Exit 1 → start the next round.
- Exit 2 → the gate is broken. Print its stderr and stop. Never repair state files to make it pass.

The minor pass's follow-up round does not count toward `M`. After `M` rounds without exit 0, print `review loop: capped after M rounds` and stop. Never write `$dir/status` or `$dir/verify-N.json` yourself, and never declare the loop done from a round's result: the gate derives each round's verdict from the verifier's file.

## Resolve context (every round)

- PR: `gh pr view --json number,baseRefName,body`.
- State: `dir=$(git rev-parse --path-format=absolute --git-common-dir)/review/$(git branch --show-current)`; `mkdir -p "$dir"`.
  - Round number `N` = count of `$dir/round-*.json` + 1.
- Code identity: `tree=$(bun $gate tree)` (hash of tracked + untracked files; the real index is untouched).
  - `$dir/status` reads `<status> <tree>` with that same tree → stop and say `Review loop already finished (<status>) for this code; rm -r <dir> to restart.` A status for another tree is stale: ignore it.
- Base: `git fetch origin <base>`; `merge_base=$(git merge-base origin/<base> HEAD)`.
- Diff handoff (includes the working tree, so fixes from a previous round are always seen), one patch per file so nobody reads the whole diff:

```bash
p="$dir/round-$N"; mkdir -p "$p/patches"
git diff --numstat $merge_base > "$p/files.txt"   # added<TAB>removed<TAB>file
git diff --name-only $merge_base | while IFS= read -r f; do git diff $merge_base -- "$f" > "$p/patches/${f//\//__}.patch"; done
```

## 1. Verify

Green means the repo's checks passed and a live exercise of the change passed. Tests alone are not proof.

1. Checks: find the repo's check commands (nearest `AGENTS.md`, package scripts, `Makefile`, `justfile`, CI config). None anywhere → note `no checks defined` in the round file and rely on the live exercise alone.
2. Live exercise: from the PR intent and the diff, write 2–5 concrete scenarios, each with an expected observable outcome:
   - API or backend: start the real service against its real dev database, send real requests, assert responses and DB state.
   - UI: open the real page in the session's browser, perform the user actions, assert what appears or changes. Every diff that changes a UI file needs at least one such scenario; the gate refuses green without it.
   - CLI or library: run the real command or a throwaway script on the changed path and assert output.
   Skip the exercise only when nothing in the diff changes what executes (docs, comments, tests only). Config, env, migrations, feature flags, and build settings do change it. State the reason for any skip in the round file.

Reuse first: an earlier `$dir/verify-K.json` whose `tree` equals `$tree` and has no blocked scenario already verified this exact code → `cp` it to `$dir/verify-N.json` and skip the dispatch. A different tree is never reused.

Otherwise dispatch the `verifier` agent once (Sonnet, or Haiku when the live exercise is skipped) with the exact check commands, the scenarios with their expected outcomes, and this output contract: first record `git rev-parse HEAD` and `bun ~/.agents/skills/review-round/gate.ts tree`, then run everything and write `$dir/verify-N.json` (absolute path) with the observed exit codes. A command that did not run is not exit 0.

```json
{"head": "abc1234…", "tree": "9f3e…", "checks": [{"command": "bun test", "exit": 0}], "scenarios": [{"name": "POST /orders with valid body returns 201 and creates the row", "result": "pass", "surface": "api"}, {"name": "Deleting the last stock re-enables « Supprimer »", "result": "pass", "surface": "browser"}, {"name": "…", "result": "blocked", "reason": "dev DB unreachable"}]}
```

`result` is `pass`, `fail`, or `blocked`; `surface` is `browser`, `api`, or `cli`. The outcome is the line `bun $gate verify N` prints (`green`, `red`, or `blocked: <reason>`), never the agent's summary.

- Red: dispatch one general-purpose agent (Sonnet) to fix only what the failing checks or scenarios require, then the verifier once more (it overwrites `verify-N.json`). Do not review code that fails its own checks. Go to step 4.
- Blocked: unblock it with the repo's documented local setup (nearest `AGENTS.md`), then the verifier once more. When the reason is a missing browser scenario, dispatch the verifier again with one. Still blocked → skip review, go to step 4. A blocked scenario is never green.
- Green: continue.

## 2. Review

Recompute `tree`. It must equal `tree` in `verify-N.json` (the code reviewed is the code verified); otherwise re-run step 1.

Reviewers run on Fable in a separate headless `claude -p` process: a model family other than the writer's (Opus or Sonnet), a fresh context with no conversation, read-only tools, and only its slice's patches. That separation is what keeps the review from sharing the writer's blind spots. `--strict-mcp-config` and `--disable-slash-commands` keep MCP servers and skills out of its context (about 26k input tokens instead of 210k); `--json-schema` enforces the output and puts it under `structured_output`.

Write the prompts: `slices=$(bun $gate slice N)`. It packs `files.txt` into slices of at most 2000 changed lines (a bigger single file is its own slice), writes `$p/review-S.prompt` for each slice letter `S`, and prints the letters. Each prompt carries the reviewer task text, the PR body, the checks and scenarios that passed, the full `files.txt` for orientation, and the absolute paths of that slice's patches: never the whole diff or the conversation. Then run all slices in parallel in one background shell call from the repo root and wait for it:

```bash
cd "$(git rev-parse --show-toplevel)"
schema=$(cat ~/.agents/skills/review-round/reviewer-schema.json)
for S in $slices; do
  claude -p --model fable --effort high --output-format json --json-schema "$schema" \
    --tools Read,Grep,Glob --strict-mcp-config --disable-slash-commands \
    --no-session-persistence --permission-prompts none \
    < "$p/review-$S.prompt" 2> "$p/review-$S.log" | jq -e .structured_output > "$p/review-$S.json" &
done
wait
```

A slice whose `review-S.json` is missing, `null`, or not valid JSON: rerun it once. Still failing → stop the loop and show the tail of `review-S.log`. Never review a slice yourself or through a subagent: only the `claude -p` process writes `review-S.json`. Never edit a prompt: change the task text in `gate.ts`.

## 3. Fix

Only `critical` and `major` findings are fixed by the loop; fixing minors every round is where review loops oscillate. `minor` findings are fixed once, by the [minor pass](#minor-pass) after convergence. `nit` findings are recorded for the human.

Merge the slices' findings. Dispatch one general-purpose agent (Opus, high: a wrong rejection stalls the loop and a failed fix repeats) with the PR body, the critical and major findings, and the patch paths of the files they touch. For each finding it either fixes it or rejects it with a one-sentence reason (the finding is wrong, outside the diff, or contradicts the PR intent). It returns `{"fixed":[titles],"rejected":[{"file","line","title","reason"}]}` and does not commit.

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

3. Print one line, then run the gate:

```
Round N: verify=<green|red|blocked from `bun $gate verify N`> findings=4 major=2 fixed=1 rejected=1
```

## Minor pass

Runs once per loop, when the gate first prints `converged`. `$dir/minor-pass` exists → it already ran: stop. Owners almost always ask for the minors to be fixed in the same PR, so the loop does it before handing over.

1. Write `$dir/minor-pass` first, so a pass that changes nothing still counts as run. Read `minor` from the latest `round-N.json`. Empty → stop.
2. Dispatch one general-purpose agent (Sonnet, medium) with the PR body, those minor findings, and the patch paths of the files they touch. It fixes each one or rejects it with a one-sentence reason, returns `{"fixed":[titles],"rejected":[{"file","line","title","reason"}]}`, and does not commit.
3. Nothing changed → report the rejections and stop. Otherwise commit `review: minor fixes` and push, then run one more full round (verify, review, fix, record) and `bun $gate`. That round reviews the minor fixes; its own minors go to the human.
4. The gate's exit after that round decides as usual: exit 1 continues the loop within `M` plus that one extra round.

Report each minor as fixed or rejected with its reason.
