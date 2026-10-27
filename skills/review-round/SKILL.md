---
name: review-round
description: Run verify → review → fix rounds on a pull request, in its own worktree, until the review gate stops it or the round cap is hit. Claude Code only. Use when the user asks to review-loop, auto-review, or run review rounds on a PR.
argument-hint: "[#PR] [max rounds, default 5]"
model: sonnet
effort: medium
---

# Review rounds

Verify → review → fix rounds on a pull request, in Claude Code: `/review-round #42 5`. The skill runs the loop itself, so do not wrap it in `/loop`.

PR = the `#N` (or PR URL) given with the invocation, or else the PR of the current branch. Max rounds `M` = the bare number given, or 5: `/review-round 42` means 42 rounds on the current branch, so a PR always takes its `#`.

Each loop runs in the PR branch's own worktree (a second checkout of the same repository), never in a checkout another session uses. That is what lets several loops, and other agents, run at once from the same main checkout without `git switch`.

Claude writes the code; GPT-6.1 Sol, another model family, verifies and reviews it, so the checks do not share the writer's blind spots. Sol runs in headless `claude -p` processes through the local CLI Proxy: `sol=~/.agents/skills/review-round/sol.sh` sets the model and the proxy. The orchestration (this file) runs on Sonnet through the frontmatter, until the end of the turn. Set every other model at the call; never rely on the session default:

| Step | Model, effort | How |
|---|---|---|
| Verify | GPT-6.1 Sol | `$sol` with the [verifier](#verifier) prompt |
| Fix (red) | Sonnet, medium | general-purpose agent, Agent tool `model` and `effort` |
| Review | GPT-6.1 Sol | `$sol`, two processes per slice: correctness and security |
| Fix (findings) | Opus, high | general-purpose agent, Agent tool `model` and `effort` |
| Same defect | TypeSafe Jev | the gate |

Rounds share nothing but the files under `$(git rev-parse --git-common-dir)/review/<branch>/`, which every worktree shares, so state survives disposable ones. Re-resolve the context at the start of every round and do not carry findings over in memory.

Gate: `gate=~/.agents/skills/review-round/gate.ts`. It stops the loop when the rounds are `converged` (two or more green rounds and the latest, run on the current code, found no critical or major issue) or `stalled` (a critical or major finding of the latest green round repeats one from an earlier green round). Red and blocked rounds never count. "Same defect" is judged by TypeSafe Jev, since fixes shift lines and titles get reworded, so the gate needs `TYPESAFE_API_KEY`. Only a converged loop whose last round left no minor finding marks the PR ready ([hand over](#hand-over)).

## Preflight (once)

- PR and branch:
  - `#N` given: `gh pr view <N> --json number,state,headRefName,isCrossRepository`. `state` is not `OPEN` → stop and say `PR #<N> is <state>.` `isCrossRepository` is true → stop and say `PR #<N> comes from a fork; the loop cannot push to it.` Branch = `headRefName`.
  - No `#N`: branch = `git branch --show-current`, PR = `gh pr view <branch> --json number`. No PR → stop and say `No PR for branch <branch>; open one first.`
- Worktree `wt`, from `git worktree list --porcelain` (its first entry is the main checkout):
  - The branch is checked out in a worktree (the current one included) → `wt` = that path. Nothing new is created.
  - Otherwise create one at the location the repo's `AGENTS.md` gives for worktrees, else at `<main-checkout>.worktrees/<branch>` beside the main checkout (outside it, so its tools and `AGENTS.md` lookup never see a second copy). `git fetch origin <branch>`; then `git worktree add "$wt" <branch>` and `git -C "$wt" merge --ff-only origin/<branch>` when the local branch exists, else `git worktree add --track -b <branch> "$wt" origin/<branch>`. The fast-forward fails → stop and say `Local <branch> has diverged from origin; reconcile it first.`
  - Install dependencies in `wt` with the repo's frozen install (e.g. `bun install --frozen-lockfile`) before the first commit: git hooks run from the worktree and fail without them.
- `command -v claude`, `[ -n "$TYPESAFE_API_KEY" ]`, and `$sol --check` (CLI Proxy up with `CLI_PROXY_API_KEY`, serving GPT-6.1 Sol). One fails → stop and say which one.

Every shell command from here on, the gate included, runs from `wt` (start each call with `cd "$wt" &&`: the shell may reset its directory between calls). Every path given to a file tool or a subagent is absolute under `wt`: file tools resolve relative paths against the main checkout.

## Loop

Repeat up to `M` times: run one round (below), then `cd "$wt" && bun $gate`.

- Exit 0 → print the gate's line (`review loop: converged|stalled`). On `converged`, run the [minor pass](#minor-pass) if it has not run in this loop; otherwise [hand over](#hand-over).
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
   - UI: open the real page in the session's browser, perform the user actions, assert what appears or changes. Every diff that changes a UI file needs at least one such scenario; the gate refuses green without it, so such a PR never leaves draft without browser evidence.
   - CLI or library: run the real command or a throwaway script on the changed path and assert output.
   The repo has a `verify-<app>` skill (`.agents/skills/` or `.claude/skills/`) → the scenarios use its Launch and Drive recipes, and the verifier brief names its path.
   Skip the exercise only when nothing in the diff changes what executes (docs, comments, tests only). Config, env, migrations, feature flags, and build settings do change it. State the reason for any skip in the round file.
3. Isolation: other loops and sessions may run their own servers at the same time. The live exercise starts its services from `wt` with the ports, database, and containers the repo's `AGENTS.md` (or its `verify-<app>` skill) assigns to a parallel session. The repo documents no such mechanism → use the default ports; a port already in use is `blocked: port <port> in use`, never a reason to stop or reuse another session's server.
4. Stack: launching the app costs minutes (a backend image build, migrations, seeds), so the loop launches it once and every verifier drives the same one. The repo has a `verify-<app>` skill with Doctor, Launch, and Cleanup → before a dispatch with a live exercise, run its Doctor from `wt`:
   - free → take the slot and Launch, building first when the skill says the change needs it; record in `$dir/stack` what you launched, so [Release the stack](#release-the-stack) knows it is yours.
   - ready, launched by this loop, and holding the code under test → keep it. Doctor says the running build misses changes the diff made since the launch (for example backend commits since the image) → Cleanup, rebuild, Launch.
   - busy (another session holds it) → launch nothing; the verifier's Doctor reports it and its scenarios come back `blocked`.
   The verifier brief then says `the loop launched the stack; do not launch or clean it up`. Without such a skill, the verifier starts and stops what its scenarios need.

Reuse first: an earlier `$dir/verify-K.json` whose `tree` equals `$tree` and has no blocked scenario already verified this exact code → `cp` it to `$dir/verify-N.json` and skip the dispatch. `verify-0.json` is the final verification of the `implement` skill, written before the loop; it is reused under the same rule. A different tree is never reused. When `verify-0.json` exists but its tree differs, print the files that differ (`git diff --name-only <its tree> $tree`) before dispatching, so the cause of the second verification is visible.

Later verifications rerun only what the changes reach. The first verification of a loop (a reused `verify-0.json` or the first dispatch) runs everything. After it, take the latest round K whose `bun $gate verify K` prints `green`. List the files changed since that round with `git diff --name-only <tree of verify-K.json> $tree`. The brief then:

- reruns every check that the repo scopes by changed paths. When the check takes a base ref (for example a gate script's `--since`), the base is the `head` of verify-K.json. An older base is safe: it only reruns more checks.
- reruns a slow suite (a full integration or E2E run, a browser campaign) and each scenario only when a changed file is on its path. Its path is the code it exercises and its fixtures or seeds. A changed build, dependency, configuration, or migration file is on every path. A check or scenario that failed or was blocked after round K always reruns. When unsure, rerun it.
- tells the verifier to copy every other check and scenario of verify-K.json unchanged, adding `"carried_from": K`.

The gate accepts a carried entry only when round K is green and its verify-K.json holds a passing entry with the same command or scenario name. Otherwise the gate prints `blocked`, and the verifier runs again and reruns that entry. Print the carried entries beside the changed files, so the reader sees what was not rerun and why.

When no verification is reused, run the [verifier](#verifier) once with a brief holding the absolute path of `wt` (it runs everything from there), the exact check commands, the scenarios with their expected outcomes, the entries to carry, the isolation rule above, the stack line, and this output contract: first record `git rev-parse HEAD` and `bun ~/.agents/skills/review-round/gate.ts tree`, then run everything, save every evidence file (screenshots, logs, traces) under `$p/evidence/` (absolute path) and cite those paths in the report, and write `$dir/verify-N.json` (absolute path) with the observed exit codes and the wall seconds of each check and scenario. A command that did not run is not exit 0.

```json
{"head": "abc1234…", "tree": "9f3e…", "checks": [{"command": "bun test", "exit": 0, "seconds": 41}, {"command": "./gradlew :integration-tests:test", "exit": 0, "seconds": 1380, "carried_from": 1}], "scenarios": [{"name": "POST /orders with valid body returns 201 and creates the row", "result": "pass", "surface": "api", "seconds": 12}, {"name": "Deleting the last stock re-enables « Supprimer »", "result": "pass", "surface": "browser", "seconds": 95}, {"name": "…", "result": "blocked", "reason": "dev DB unreachable"}]}
```

`result` is `pass`, `fail`, or `blocked`; `surface` is `browser`, `api`, or `cli`; a carried entry keeps the `seconds` of the round it comes from. The outcome is the line `bun $gate verify N` prints (`green`, `red`, or `blocked: <reason>`), never the agent's summary.

- Red: dispatch one general-purpose agent (Sonnet) with the absolute path of `wt` to fix only what the failing checks or scenarios require, then the verifier once more (it overwrites `verify-N.json`). Do not review code that fails its own checks. Go to step 4.
- Blocked: unblock it with the repo's documented local setup (nearest `AGENTS.md`), then the verifier once more. When the reason is a missing browser scenario, dispatch the verifier again with one. Still blocked → skip review, go to step 4. A blocked scenario is never green.
- Green: continue.

### Verifier

The verifier is GPT-6.1 Sol in a headless `claude -p` process, never an Agent-tool subagent: those run on Claude, the writer's family. Write its brief to `$p/verify.brief`, then run it from `wt` in one background shell call and wait for it:

```bash
cd "$wt"
cat ~/.agents/skills/review-round/verifier.md "$p/verify.brief" \
  | $sol --tools Read,Grep,Glob,Bash,Write --dangerously-skip-permissions 2> "$p/verify.log" > "$p/verify.out.json"
jq -r .result "$p/verify.out.json"
```

It runs without permission prompts or sandbox, like the old in-session verifier: gates, Docker, and browsers write outside `wt` (Gradle, Bun, and Playwright caches). `verifier.md` keeps it from editing sources. The printed report is for the hand-off; the verdict is still `bun $gate verify N`. A run with no report or no `verify-N.json`: rerun once, then stop and show the tail of `verify.log`.

## 2. Review

Recompute `tree`. It must equal `tree` in `verify-N.json` (the code reviewed is the code verified); otherwise re-run step 1.

Reviewers run on GPT-6.1 Sol in a separate headless `claude -p` process: a model family other than the writer's (Claude), a fresh context with no conversation, read-only tools, and only its slice's patches. That separation is what keeps the review from sharing the writer's blind spots. `$sol` passes `--strict-mcp-config` and `--disable-slash-commands`, which keep MCP servers and skills out of its context (about 26k input tokens instead of 210k); `--json-schema` enforces the output and puts it under `structured_output`.

Write the prompts: `slices=$(bun $gate slice N)`. It packs `files.txt` into slices of at most 2000 changed lines (a bigger single file is its own slice), writes two prompts per slice letter `S`, `$p/review-S.prompt` (correctness) and `$p/review-sec-S.prompt` (security, checked against the same list as the `hardening` skill), and prints their names one per line (`A`, `sec-A`, `B`, `sec-B`); the loop below runs each name as its own slice. The loop reads lines rather than splitting `$slices` on spaces, because zsh does not split an unquoted variable into words. Each prompt carries the reviewer task text, the PR body, the checks and scenarios that passed, the full `files.txt` for orientation, the findings earlier rounds rejected or recorded as pre-existing (so the reviewer does not repeat them without new evidence), and the absolute paths of that slice's patches: never the whole diff or the conversation.

The first reviewed round covers every file. Later rounds are re-reviews: only the files changed since the previous reviewed round, plus the files of its rejected findings, so the loop checks its own fixes instead of finding older bugs each round. No letters printed → nothing changed since the last review: skip to step 4 with `findings: 0`.

Then run all slices in parallel in one background shell call from the repo root and wait for it:

```bash
cd "$wt"
schema=$(cat ~/.agents/skills/review-round/reviewer-schema.json)
while IFS= read -r S; do
  $sol --json-schema "$schema" --tools Read,Grep,Glob --permission-prompts none \
    < "$p/review-$S.prompt" 2> "$p/review-$S.log" | jq -e .structured_output > "$p/review-$S.json" &
done <<< "$slices"
wait
```

A slice whose `review-S.json` is missing, `null`, or not valid JSON: rerun it once. Still failing → stop the loop and show the tail of `review-S.log`. Never review a slice yourself or through a subagent: only the `claude -p` process writes `review-S.json`. Never edit a prompt: change the task text in `gate.ts`.

## 3. Fix

Only `critical` and `major` findings are fixed by the loop; fixing minors every round is where review loops oscillate. `minor` findings are fixed once, by the [minor pass](#minor-pass) after convergence. `nit` findings are recorded for the human.

A finding with `pre_existing: true` is a defect the PR did not introduce, whatever its severity: the loop never fixes it and it never counts toward the gate. Append each to `$dir/pre-existing.md` (file, line, severity, title, trigger, why) unless the same file and title are already there; they reach the user at the [end](#decisions).

Merge the slices' findings. Dispatch one general-purpose agent (Opus, high: a wrong rejection stalls the loop and a failed fix repeats) with the absolute path of `wt` (it edits only there), the PR body, the critical and major findings, and the patch paths of the files they touch. When a finding names a pattern, the agent fixes every instance: it greps the repo for the pattern before reporting the finding fixed. For each finding it either fixes it or rejects it with a one-sentence reason (the finding is wrong, outside the diff, contradicts the PR intent, is hypothetical because no traced caller reaches that state, or is a preference with no concrete failure). A finding that hinges on a business or product rule the PR intent does not settle is rejected with a reason starting `decision:`, naming the question, its recommendation, and the evidence. It returns `{"fixed":[titles],"rejected":[{"file","line","title","reason"}]}` and does not commit.

Append each `decision:` rejection to `$dir/decisions.md` and keep going: decisions reach the user once, at the [end](#decisions), never as mid-run notes.

## 4. Record

1. If the working tree changed: `git add -A && git commit -m "review: round N" && git push`. One commit per round is what makes a bad round revertible.
2. Write `$dir/round-N.json`:

```json
{
  "round": 1,
  "head": "abc1234…",
  "tree": "9f3e…",
  "findings": 4,
  "majors": [{"file": "src/x.ts", "line": 12, "title": "…", "why": "…", "trigger": "…"}, {"file": "src/z.ts", "line": 7, "title": "…", "why": "…", "trigger": "…"}],
  "fixed": 1,
  "rejected": [{"file": "src/x.ts", "line": 12, "title": "…", "reason": "…"}],
  "minor": [{"file": "src/y.ts", "line": 40, "title": "…"}],
  "pre_existing": [{"file": "src/w.ts", "line": 3, "severity": "major", "title": "…"}],
  "commit": "abc1234"
}
```

`head` and `tree` are copied from `verify-N.json`: the code this round verified and reviewed (the gate exits 2 if they disagree). No `verify` field: the gate derives it from `verify-N.json`. `majors` lists every critical and major finding exactly as the reviewer reported it (fixed or rejected alike), pre-existing ones excepted; the gate compares these across rounds. `minor` also leaves out pre-existing findings. On a re-review round, `minor` also carries over the previous reviewed round's minors whose file was in no slice this round (one entry per file and title): those files were not re-read, so their minors still stand for the minor pass and the ready check. `pre_existing` holds the pre-existing findings, and the next rounds' prompts list them as already judged, like `rejected`. When verification was red or blocked: `findings: 0, majors: [], fixed: <fixes applied to pass checks>, rejected: [], minor: [], pre_existing: []`. `commit` is `null` when nothing was committed.

3. Print one line, then run the gate:

```
Round N: verify=<green|red|blocked from `bun $gate verify N`> findings=4 major=2 fixed=1 rejected=1
```

## Minor pass

Runs once per loop, when the gate first prints `converged`. `$dir/minor-pass` exists → it already ran: [hand over](#hand-over). Owners almost always ask for the minors to be fixed in the same PR, so the loop does it before handing over.

1. Write `$dir/minor-pass` first, so a pass that changes nothing still counts as run. Read `minor` from the latest `round-N.json`. Empty → [hand over](#hand-over).
2. Dispatch one general-purpose agent (Sonnet, medium) with the absolute path of `wt`, the PR body, those minor findings, and the patch paths of the files they touch. It fixes each one or rejects it under the [Fix](#3-fix) rules (including `decision:`), returns `{"fixed":[titles],"rejected":[{"file","line","title","reason"}]}`, and does not commit.
3. Nothing changed → report the rejections and [hand over](#hand-over). Otherwise commit `review: minor fixes` and push, then run one more full round (verify, review, fix, record) and `bun $gate`. That round reviews the minor fixes; its own minors go to the human.
4. The gate's exit after that round decides as usual: exit 1 continues the loop within `M` plus that one extra round.

Report each minor as fixed or rejected with its reason.

## Hand over

Runs when the loop stops after `converged`. A stalled, capped, or broken loop never gets here, so its PR stays as it is. Run `bun $gate ready`:

- Exit 0 → if `gh pr view --json isDraft --jq .isDraft` prints `true`, run `gh pr ready <number>` and print `PR #<number> marked ready`. Then [remove the worktree](#remove-the-worktree).
- Exit 1 → print the gate's line (`review loop: stays draft (<reason>)`) and leave the PR as it is. Keep the worktree and print its path: the human finishes the PR there.
- Exit 2 → the gate is broken. Print its stderr.

## Remove the worktree

Runs only once the PR is ready for review: the loop's work on the branch is over. A stopped, stalled, capped, or draft loop keeps its worktree. It runs last, after [Decisions](#decisions), so the user reads them before answering.

1. `wt` is the main checkout → remove nothing.
2. `git -C "$wt" status --porcelain` prints anything, or `git -C "$wt" rev-list @{u}..HEAD` lists a commit or fails (no upstream) → keep it and print `Worktree <wt> kept: uncommitted or unpushed changes.` Never force the removal: those changes may be the user's.
3. Ask the user with the ask tool: remove the worktree at `<wt>` for PR #<number> now that it is ready? Options: remove it (recommended: everything is committed and pushed) or keep it. Keep → print `Worktree <wt> kept at the user's request.` and stop. Never remove it without that answer.
4. From the main checkout: `git worktree remove "$wt"`, then print `Worktree <wt> removed`. The branch and `$dir` stay: the PR still needs the branch, and `noise.ts` reads `$dir`.

## Release the stack

Whenever the loop stops (converged, stalled, capped, or broken), before [Decisions](#decisions): `$dir/stack` exists → run the `verify-<app>` skill's Cleanup from `wt`, release the slot (ports, database, containers) the way the repo's `AGENTS.md` says, and delete `$dir/stack`. A stack held by a stopped loop blocks every other session's verification. Never clean up a stack the loop did not launch.

## Decisions

Whenever the loop stops (converged, stalled, capped, or broken), print `$dir/decisions.md` as one list: each question with its recommendation and evidence. Missing file → print nothing.

Then print `$dir/pre-existing.md`: the bugs the PR did not introduce. Draft one issue per bug with the `agent-ready-issue` skill and file none without the user's go. Missing file → print nothing.

## Measure noise

`bun ~/.agents/skills/review-round/noise.ts <repo>...` reads every loop recorded in those repositories and prints, per loop and in total, the rounds, the critical and major findings, how many were rejected and why, the pre-existing count, and the minutes the verifier spent running checks and scenarios. A high rejected share means the reviewer is noisy: tune `REVIEW_TASK` in `gate.ts` before adding steps, and rerun the script on the next loops to check the change helped.
