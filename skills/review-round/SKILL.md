---
name: review-round
description: Run verify → review → fix rounds on a pull request, in its own worktree, until the review gate stops it or the round cap is hit. Use when the user asks to review-loop, auto-review, or run review rounds on a PR.
argument-hint: "[#PR] [max rounds, default 5]"
model: sonnet
effort: medium
---

# Review rounds

Verify → review → fix rounds on a pull request: `/review-round #42 5`. The skill runs the loop itself, so do not wrap it in `/loop`. It runs in any harness with a shell (Claude Code, OMP, Codex, T3 Code): [harness.md](harness.md) maps the subagent, ask, and wait operations named here to each one.

PR = the `#N` (or PR URL) given with the invocation, or else the PR of the current branch. Max rounds `M` = the bare number given, or 5: `/review-round 42` means 42 rounds on the current branch, so a PR always takes its `#`.

Each loop runs in the PR branch's own worktree (a second checkout of the same repository), never in a checkout another session uses. That is what lets several loops, and other agents, run at once from the same main checkout without `git switch`.

One model family writes the code; the other verifies and reviews it, so the checks do not share the writer's blind spots. The **peer** (the verifier and the reviewers) runs in headless CLI processes launched by `peer=~/.agents/skills/review-round/peer.ts`: `bun $peer --writer $writer` picks GPT-6.1 Sol when the writer is Claude, Claude Opus 5.5 when it is GPT, and the first CLI that can run it (`claude -p` through the CLI Proxy of `~/.claude/settings.json`, then `omp -p`, then `codex exec`). `writer` is the family of the model the fix subagents run on ([harness.md](harness.md#writer-family)): `claude` in Claude Code. In Claude Code, the orchestration (this file) runs on Sonnet through the frontmatter, until the end of the turn. Set every other model at the call; never rely on the session default:

| Step | Model, effort | How |
|---|---|---|
| Verify | the peer | `bun $peer` with the [verifier](#verifier) prompt |
| Fix (red) | Sonnet, medium | general-purpose subagent with that model and effort |
| Review | the peer | `bun $peer`, two processes per slice: correctness and security |
| Fix (findings) | Opus, high | general-purpose subagent with that model and effort |
| Same defect | TypeSafe Jev | the gate |

The fix models are Claude Code's. A harness that runs GPT only (Codex) uses its strongest model for both fixes and sets `writer=gpt`; a harness that cannot set a subagent's model says so in the hand-off ([harness.md](harness.md)).

Every fixer brief (red fix, findings fix, minor pass) says: run long checks in the foreground and return only after they finish, with their exit codes; return code that compiles. Its answer is `{"fixed":[titles],"rejected":[{"file","line","title","reason"}]}`; save the red and findings fixers' answers to `$p/fix.json` for [record](#4-record).

Rounds share nothing but the files under `$(git rev-parse --git-common-dir)/review/<branch>/`, which every worktree shares, so state survives disposable ones. Re-resolve the context at the start of every round and do not carry findings over in memory.

Gate: `gate=~/.agents/skills/review-round/gate.ts`; its header documents every command and file. It stops the loop when the rounds are `converged` (the latest round is the latest green one, found no critical or major issue, and ran on the current code: a round whose fixes changed the code always gets one more round) or `stalled` (a critical or major finding of the latest green round repeats one from an earlier green round, in the same file or after the fixer rejected it; the same pattern found in another file is a new instance and the loop goes on). The gate prints the repeated pairs and writes them to `$dir/stall.json`. Red and blocked rounds never count. "Same defect" is judged by TypeSafe Jev, since fixes shift lines and titles get reworded, so the gate needs `TYPESAFE_API_KEY`. A converged loop marks the PR ready once the [minor pass](#minor-pass) has run on its minors; the minors left after it go to the human ([hand over](#hand-over)).

## Preflight (once)

- PR and branch:
  - `#N` given: `gh pr view <N> --json number,state,headRefName,isCrossRepository`. `state` is not `OPEN` → stop and say `PR #<N> is <state>.` `isCrossRepository` is true → stop and say `PR #<N> comes from a fork; the loop cannot push to it.` Branch = `headRefName`.
  - No `#N`: branch = `git branch --show-current`, PR = `gh pr view <branch> --json number`. No PR → stop and say `No PR for branch <branch>; open one first.`
- Worktree `wt`, from `git worktree list --porcelain` (its first entry is the main checkout):
  - The branch is checked out in a worktree (the current one included) → `wt` = that path. Nothing new is created.
  - Otherwise create one at the location the repo's `AGENTS.md` gives for worktrees, else at `<main-checkout>.worktrees/<branch>` beside the main checkout (outside it, so its tools and `AGENTS.md` lookup never see a second copy). `git fetch origin <branch>`; then `git worktree add "$wt" <branch>` and `git -C "$wt" merge --ff-only origin/<branch>` when the local branch exists, else `git worktree add --track -b <branch> "$wt" origin/<branch>`. The fast-forward fails → stop and say `Local <branch> has diverged from origin; reconcile it first.`
  - Record who made it, for the [hand over](#hand-over): `dir` as in [Resolve context](#resolve-context-every-round), `mkdir -p "$dir"`, then `echo created > "$dir/worktree-created"` when the loop created it, else `[ -f "$dir/worktree-created" ] || echo existing > "$dir/worktree-created"`.
  - In `wt`: the repo's frozen install (e.g. `bun install --frozen-lockfile`) before the first commit, since git hooks run from the worktree and fail without it; then the bootstrap the repo documents for a fresh checkout (codegen, the local env files its `AGENTS.md` lists), since a stale generated client or a missing `.env` turns the first verification red.
- Set `writer` ([harness.md](harness.md#writer-family)). `command -v bun`, `[ -n "$TYPESAFE_API_KEY" ]`, and `bun $peer --writer $writer --check` (it prints the engine and model it will use, or names what each engine misses). One fails → stop and say which one.

Every shell command from here on, the gate included, runs from `wt` (start each call with `cd "$wt" &&`: the shell may reset its directory between calls), and sets `peer`, `gate`, `writer`, `dir`, `N`, and `p` again for the same reason. Every path given to a file tool or a subagent is absolute under `wt`: file tools resolve relative paths against the main checkout.

## Loop

Repeat up to `M` times: run one round (below), then `cd "$wt" && bun $gate`.

- Exit 0 → print the gate's line (`review loop: converged|stalled`) and the repeat lines under it.
  - `converged` → run the [minor pass](#minor-pass) if it has not run in this loop; otherwise [hand over](#hand-over).
  - `stalled` → when the latest `round-N.json` has a `commit`, print `The last pushed fix (<commit>) is not verified.` Then ask the user once (ask tool): resume for K more rounds, or stop. Recommend resuming when every repeat's probability is below 0.8, or when the two findings of a pair sit in different functions: the reviewer may be re-reading a fix that worked. Resume → `bun $gate resume`, set `M` to K, and run the next round. Stop → the loop stops.
- Exit 1 → start the next round.
- Exit 2 → the gate is broken. Print its stderr and stop. Never repair state files to make it pass.

The minor pass's follow-up round does not count toward `M`. After `M` rounds without exit 0, print `review loop: capped after M rounds` and stop. A loop that stops without handing over (stalled, capped, broken, or a PR that stays draft) [releases the stack](#release-the-stack) and prints the [decisions](#decisions); the hand over does both at its step 3. The verifier writes `verify-N.json` and the gate writes everything else (`round-N.json`, `status`), so the verdict always comes from the verifier's observed results; never write those files yourself.

## Resolve context (every round)

```bash
cd "$wt"
dir=$(git rev-parse --path-format=absolute --git-common-dir)/review/$(git branch --show-current)
N=$(bun $gate round); p="$dir/round-$N"
tree=$(bun $gate tree)   # hash of tracked + untracked files; the real index is untouched
```

- PR: `gh pr view --json number,baseRefName,body`.
- `$dir/status` reads `<status> <tree>` with that same tree → `converged`: stop and say `Review loop already converged for this code.` `stalled`: say `Review loop stalled for this code.` and take the `stalled` branch of the [loop](#loop). A status for another tree is stale: ignore it.
- Diff handoff: `bun $gate prepare $N --base <baseRefName>`. It fetches the base and writes, against the merge-base, `$p/files.txt`, one patch per file (renames split into a delete and an add, so nobody reads the whole diff), and `$p/base` (the merge-base sha). The working tree is included, so fixes from a previous round are always seen.

## 1. Verify

Green means the repo's checks passed and a live exercise of the change passed. Tests alone are not proof.

1. Checks: find the repo's check commands (nearest `AGENTS.md`, package scripts, `Makefile`, `justfile`, CI config). None anywhere → the verify file has no checks, and the live exercise alone decides.
2. Live exercise: from the PR intent and the diff, write 2–5 concrete scenarios, each with an expected observable outcome:
   - API or backend: start the real service against its real dev database, send real requests, assert responses and DB state.
   - UI: open the real page in the session's browser, perform the user actions, assert what appears or changes. Every diff that changes a hand-written UI file needs at least one such scenario; the gate refuses green without it, so such a PR never leaves draft without browser evidence.
   - CLI or library: run the real command or a throwaway script on the changed path and assert output.
   The repo has a `verify-<app>` skill (`.agents/skills/` or `.claude/skills/`) → the scenarios use its Launch and Drive recipes, and the verifier brief names its path.
   Skip the exercise only when nothing in the diff changes what executes (docs, comments, tests only). Config, env, migrations, feature flags, and build settings do change it. State the reason for any skip in the brief.
3. Isolation: other loops and sessions may run their own servers at the same time. The live exercise starts its services from `wt` with the ports, database, and containers the repo's `AGENTS.md` (or its `verify-<app>` skill) assigns to a parallel session. The repo documents no such mechanism → use the default ports; a port already in use is `blocked: port <port> in use`, never a reason to stop or reuse another session's server.
4. Stack: launching the app costs minutes (a backend image build, migrations, seeds), so the loop launches it once and every verifier drives the same one. The repo has a `verify-<app>` skill with Doctor, Launch, and Cleanup → before a dispatch with a live exercise, run its Doctor from `wt`:
   - free → take the slot and Launch, building first when the skill says the change needs it; record in `$dir/stack` what you launched, so [Release the stack](#release-the-stack) knows it is yours.
   - ready, launched by this loop, and holding the code under test → keep it. Doctor says the running build misses changes the diff made since the launch (for example backend commits since the image) → Cleanup, rebuild, Launch.
   - busy (another session holds it) → launch nothing; the verifier's Doctor reports it and its scenarios come back `blocked`.
   The verifier brief then says `the loop launched the stack; do not launch or clean it up`. Without such a skill, the verifier starts and stops what its scenarios need.

Reuse first: an earlier verification of this exact code is reused instead of dispatched. `K=$(rg -l -F "$tree" --max-depth 1 -g 'verify-*.json' "$dir" | sed -E 's/.*verify-([0-9]+)\.json$/\1/' | sort -n | tail -1)`; a `K` below `N` → `bun $gate reuse $K $N` (it refuses another tree), then `bun $gate verify $N`. Green → skip the dispatch. Red or blocked → `bun $gate attempt $N` (it prints `same-tree`) and dispatch: the brief carries that attempt's passing entries. `verify-0.json` is the final verification of the `implement` skill, written before the loop, and is reused the same way.

Later verifications rerun only what the changes reach. `bun $gate brief $N > "$p/verify.brief"` writes the mechanical part of the brief and prints on stderr the latest green verification K (0 when only a green `verify-0.json` came before), the files changed since its tree, and its passing entries as carry candidates, one JSON line each. No green verification before → the brief runs everything. Otherwise judge each candidate:

- rerun every check that the repo scopes by changed paths. When the check takes a base ref (for example a gate script's `--since`), the base is the `head` of verify-K.json. An older base is safe: it only reruns more checks.
- rerun a slow suite (a full integration or E2E run, a browser campaign) and each scenario only when a changed file is on its path. Its path is the code it exercises and its fixtures or seeds. A changed build, dependency, or configuration file is on every path. A migration is on the path of what it changes: the tests that read the tables or columns it alters, or the report, setting, or seed rows it rewrites. It is on every path when it alters a table nearly every flow writes (clients, accounts, loans, journal entries, commands), or when you cannot tell what it touches. A check that replays every migration on an empty database (a PostgreSQL gate) reruns on any migration change. A full integration run once cost about 45 min to recheck one report's SQL. A check or scenario that failed or was blocked after round K always reruns. When unsure, rerun it.
- rerun a slow suite that failed by its failed classes or scenarios only (for example `scripts/gates.sh --it-tests <failed classes>`, or the Cucumber tags of the failed scenarios), unless a changed file is on the whole suite's path; the brief names the reason when it reruns the whole suite. A single red class once cost a 45 min to 3 h rerun offer, where rerunning that class took 2 min 19 s.
- carry every other candidate: append the `Carried entries:` line the stderr names, then those JSON lines unchanged.

The gate accepts a carried entry only when round K is green and its verify-K.json holds a passing entry with the same command or scenario name. Otherwise the gate prints `blocked`, and the verifier runs again and reruns that entry. Print the carried entries beside the changed files, so the reader sees what was not rerun and why.

Then append the rest of the brief: the exact check commands (paths relative to the worktree root, as [verifier.md](verifier.md#checks) requires), the scenarios with their expected outcomes, the isolation rule above, the stack line, and the `verify-<app>` skill path. The brief's first lines name every path and the verify file contract is in [verifier.md](verifier.md#verify-file); never restate them. Run the [verifier](#verifier) once.

The outcome is the line `bun $gate verify $N` prints, never the agent's summary:

- `green` → continue.
- `green (known failure on base: <command>)` → each such check failed on the PR and on the merge-base alike, so the PR did not introduce it and no fixer touches it. Append each to `$dir/pre-existing.md` (the command, the merge-base sha from `$p/base`, its exec log) unless it is already there; the [hand over](#hand-over) lists it. Continue.
- `red` → dispatch one general-purpose subagent (Sonnet, medium) with the absolute path of `wt` to fix only what the failing checks or scenarios require, then the verifier once more. Do not review code that fails its own checks. Still red → go to step 4.
- `blocked: <reason>` → unblock it with the repo's documented local setup (nearest `AGENTS.md`), then the verifier once more. When the reason is a missing browser scenario, dispatch the verifier again with one; when it names a check without an exec record, put the gate's line in the brief. Still blocked → skip review, go to step 4. A blocked scenario is never green.

Before running the verifier once more in the same round, archive its last run with `bun $gate attempt $N`; it moves `verify-N.json` to `$p/verify-attempt-A.json` and prints `attempt A same-tree` or `attempt A tree-changed`. Then write the brief again with `bun $gate brief $N`. On `same-tree` (the fixer changed nothing, or only the environment or the verifier's own journey was at fault), the brief itself carries every passing entry of that attempt, marked `"carried_from_attempt": A`, and its stderr names what reruns: the failing and blocked entries. `tree-changed` reruns as the brief of that round prescribed. Print the carried entries, as for a round. A check recorded with its sub-gates (one entry per shard or sub-task) reruns only the failed sub-gates, for example `:integration-tests:shard-3:test` instead of the whole `gates.sh`.

### Verifier

The verifier is the peer in a headless process, never an in-session subagent: those run on the writer's family. With the brief complete in `$p/verify.brief`, run it from `wt` in one long shell call and wait for it ([harness.md](harness.md)):

```bash
cd "$wt"
cat ~/.agents/skills/review-round/verifier.md "$p/verify.brief" \
  | bun $peer --writer $writer --access full --trace "$p/verify.jsonl" 2> "$p/verify.log" > "$p/verify.out.json"
jq -r .result "$p/verify.out.json"
```

`--access full` runs it without permission prompts or sandbox: gates, Docker, and browsers write outside `wt` (Gradle, Bun, and Playwright caches). `verifier.md` keeps it from editing sources and runs every check through `bun $gate exec`, whose records are what the gate compares the verify file against. The printed report is for the hand-off; the verdict is still `bun $gate verify $N`. A run with no report or no `verify-N.json`: rerun once, then stop and show the tail of `verify.log`.

## 2. Review

Recompute `tree`. It must equal `tree` in `verify-N.json` (the code reviewed is the code verified); otherwise re-run step 1.

Reviewers run on the peer in separate headless processes: a model family other than the writer's, a fresh context with no conversation, read-only tools (`--access read`), and only its slice's patches. That separation is what keeps the review from sharing the writer's blind spots. `--schema` gives the output's shape: `claude` and `codex` enforce it, and for `omp` the gate checks it.

Write the prompts: `slices=$(bun $gate slice $N)`. It packs `files.txt` into slices of at most 2000 changed lines (a bigger single file is its own slice), writes two prompts per slice letter `S`, `$p/review-S.prompt` (correctness) and `$p/review-sec-S.prompt` (security, checked against the same list as the `hardening` skill), and prints their names one per line (`A`, `sec-A`, `B`, `sec-B`); the loop below runs each name as its own process. The loop reads lines rather than splitting `$slices` on spaces, because zsh does not split an unquoted variable into words. Each prompt carries the reviewer task text, the PR body, the checks and scenarios that passed, the full `files.txt` for orientation, the generated files (lockfiles, generated clients), listed as generated and not reviewed, the findings earlier rounds rejected or recorded as pre-existing (so the reviewer does not repeat them without new evidence), and the absolute paths of that slice's patches: never the whole diff or the conversation.

The first reviewed round covers every file. Later rounds are re-reviews: only the files changed since the previous reviewed round, plus the files of its rejected findings, so the loop checks its own fixes instead of finding older bugs each round. No names printed → nothing changed since the last review: go to step 4.

Then run the processes 8 at a time in one long shell call from `wt` and wait for it. The patches live under the main checkout's `.git`, outside `wt`, so `--add-dir "$p"` is what lets the reviewer read them: without it every patch read is denied and the reviewer returns zero findings it could not check.

```bash
cd "$wt"
i=0
while IFS= read -r S; do
  bun $peer --writer $writer --access read --schema ~/.agents/skills/review-round/reviewer-schema.json --add-dir "$p" \
    --trace "$p/review-$S.jsonl" < "$p/review-$S.prompt" 2> "$p/review-$S.log" > /dev/null &
  i=$((i + 1)); [ $((i % 8)) -eq 0 ] && wait
done <<< "$slices"
wait
bun $gate reviewed $N
```

The trace `review-S.jsonl` is the evidence that a review happened: a reviewer that answers without opening its files returns zero findings that look exactly like a clean review. `bun $gate reviewed $N` prints, per process, its findings, the share of its slice's files it opened, its tool calls, and its engine. A `codex` reviewer has no read tool, so its opened files come from its file-printing shell commands (`cat`, `sed`, …): weaker evidence than a read tool's. Exit 0 → it wrote every `review-S.json` from the traces. Exit 1 → rerun once the processes named on its `rerun:` line (a missing trace, no schema result, or a file it never opened), then run it again. Still exit 1 → stop the loop and show those lines and the tail of each failing `review-S.log`. Print those per-process lines after the round line, so the reader sees what each reviewer read. Never review a slice yourself or through a subagent, and never write `review-S.json`: only the gate writes it, from the peer's trace. Never edit a prompt: change the task text in `gate.ts`.

## 3. Fix

Only `critical` and `major` findings are fixed by the loop; fixing minors every round is where review loops oscillate. `minor` findings are fixed once, by the [minor pass](#minor-pass) after convergence. `nit` findings are recorded for the human.

A finding with `pre_existing: true` is a defect the PR did not introduce, whatever its severity: the loop never fixes it and it never counts toward the gate. Append each to `$dir/pre-existing.md` (file, line, severity, title, trigger, why) unless the same file and title are already there; they reach the user at the [end](#decisions).

Merge the slices' findings. Dispatch one general-purpose subagent (Opus, high: a wrong rejection stalls the loop and a failed fix repeats) with the absolute path of `wt` (it edits only there), the PR body, the critical and major findings, and the patch paths of the files they touch. When a finding names a pattern, the agent fixes every instance: it greps the repo for the pattern before reporting the finding fixed. When the defect sits in robustness the PR intent did not ask for (a lock, a retry layer, a cache), it prefers deleting that code to hardening it: one PR grew 1279 lines of lock code that its owner then replaced with 60. For each finding it either fixes it or rejects it with a one-sentence reason (the finding is wrong, outside the diff, contradicts the PR intent, is hypothetical because no traced caller reaches that state, or is a preference with no concrete failure). A finding that hinges on a business or product rule the PR intent does not settle is rejected with a reason starting `decision:`, naming the question, its recommendation, and the evidence. It does not commit.

Append each `decision:` rejection to `$dir/decisions.md` and keep going: decisions reach the user once, at the [end](#decisions), never as mid-run notes.

## 4. Record

1. If the working tree changed: `git add -A && git commit -m "chore(review): round N" && git push`. One commit per round is what makes a bad round revertible.
2. `bun $gate record $N --fix "$p/fix.json"` (without `--fix` when no fixer ran). It writes `round-N.json` from `verify-N.json`, the round's `review-S.json` files, the fixer's answer, and the commit, then prints the `Round N: verify=… findings=… major=… fixed=… rejected=… minor=… pre-existing=…` line. Print that line, then run the gate.

## Minor pass

Runs once per loop, when the gate first prints `converged`. `$dir/minor-pass` exists → it already ran: [hand over](#hand-over). Owners almost always ask for the minors to be fixed in the same PR, so the loop does it before handing over.

1. Read `minor` from the latest `round-N.json`. Empty → [hand over](#hand-over).
2. `touch "$dir/minor-pass"`, so a pass that changes nothing still counts as run. Dispatch one general-purpose subagent (Sonnet, medium) with the absolute path of `wt`, the PR body, those minor findings, and the patch paths of the files they touch. It fixes each one or rejects it under the [Fix](#3-fix) rules (including `decision:`) and does not commit; its answer is reported, not recorded.
3. Nothing changed → report the rejections and [hand over](#hand-over). Otherwise commit `chore(review): minor fixes` and push, then run one more full round (verify, review, fix, record) and `bun $gate`. That round reviews the minor fixes; its own minors go to the human.
4. The gate's exit after that round decides as usual: exit 1 continues the loop within `M` plus that one extra round.

Report each minor as fixed or rejected with its reason.

## Hand over

Runs when the loop stops after `converged`. A stalled, capped, or broken loop never gets here, so its PR and its worktree stay as they are.

1. `bun $gate ready`:
   - Exit 0 → if `gh pr view --json isDraft --jq .isDraft` prints `true`, run `gh pr ready <number>` and print `PR #<number> marked ready`. Print its `minor left:` lines: those minors go to the human.
   - Exit 1 → print the gate's line (`review loop: stays draft (<reason>)`), leave the PR as it is, print the worktree path (the human finishes the PR there), release the stack, print the decisions, and stop.
   - Exit 2 → the gate is broken. Print its stderr, release the stack, print the decisions, and stop.
2. PR description: when a `round-*.json` has a non-null `commit`, the loop changed the code after the description was written. Run the `pr` skill on the existing body (`gh pr view --json body`) to correct each claim the fixes made false (counts, "no migration", evidence), apply it with `gh pr edit <number> --body-file`, and print what changed.
3. [Release the stack](#release-the-stack) and print the [decisions](#decisions), so the user reads them before answering.
4. Ask one grouped question (ask tool, multiple choice), with only the options that apply:
   - Merge: squash-merge once CI is green, delete the branch, and fast-forward the main checkout (recommended when no decision is open).
   - File the drafted pre-existing issues, each labeled with the repo's category label plus `needs-triage`.
   - Remove the worktree `<wt>`: only for a worktree the loop did not create (`$dir/worktree-created` reads `existing`).
   - None.
   Act only on the answer.
5. Merge, when chosen:
   - `gh pr view <number> --json mergeable` reads `CONFLICTING` → in `wt`, `git merge origin/<base>`, resolve only the conflicting files (regenerate a generated one with the repo's command instead of merging it by hand), commit, and push. Then verify once more as the next round (`round`, `prepare`, a brief limited to the checks and scenarios the resolution touched, the verifier): `bun $gate verify <that round>` must print green, else stop and report it.
   - Wait for the PR checks ([harness.md](harness.md)). Failing → stop and report them.
   - Read `head=$(git -C "$wt" rev-parse HEAD)`, then take the [worktree](#worktree) step, since the merge deletes the branch. From the main checkout, with the worktree removed: `gh pr merge <number> --squash --delete-branch --match-head-commit "$head"`. With it kept (it still holds the local branch): `gh pr merge <number> --squash --match-head-commit "$head"`, then `git push origin --delete <branch>`. Then `git pull --ff-only` in the main checkout when it is on the base branch.
   - On each issue the PR closed (`gh pr view <number> --json closingIssuesReferences`), comment what changed and how it was verified (the last `verify` line, its checks, and its scenarios).
6. File the issues, when chosen, with `gh issue create`.
7. [Worktree](#worktree), when the merge did not already run it.

### Worktree

1. `wt` is the main checkout → remove nothing.
2. `git -C "$wt" status --porcelain` prints anything, or `git -C "$wt" rev-list @{u}..HEAD` lists a commit or fails (no upstream) → keep it and print `Worktree <wt> kept: uncommitted or unpushed changes.` Never force the removal: those changes may be the user's.
3. `$dir/worktree-created` reads `created`, or the user chose its removal → from the main checkout, `git worktree remove "$wt"`, then print `Worktree <wt> removed`. Otherwise print `Worktree <wt> kept.` The branch and `$dir` stay: `noise.ts` reads `$dir`.

## Release the stack

Whenever the loop stops (converged, stalled, capped, or broken), before [Decisions](#decisions): `$dir/stack` exists → run the `verify-<app>` skill's Cleanup from `wt`, release the slot (ports, database, containers) the way the repo's `AGENTS.md` says, and delete `$dir/stack`. A stack held by a stopped loop blocks every other session's verification. Never clean up a stack the loop did not launch.

## Decisions

Whenever the loop stops (converged, stalled, capped, or broken), print `$dir/decisions.md` as one list of closed questions: each with its options, the recommendation, the default (what stays true if the user never answers), and the evidence. Missing file → print nothing.

Then print `$dir/pre-existing.md`: the bugs the PR did not introduce, known failures on the base included. Draft one issue per bug with the `agent-ready-issue` skill. They are filed only when the user chooses it in the [hand over](#hand-over)'s question; a loop that stops elsewhere leaves them drafted. Missing file → print nothing.

## Measure noise

`bun ~/.agents/skills/review-round/noise.ts <repo>...` reads every loop recorded in those repositories and prints, per loop and in total, the rounds, the critical and major findings, how many were rejected and why, the pre-existing count, and the minutes the verifier spent running checks and scenarios. A high rejected share means the reviewer is noisy: tune `REVIEW_TASK` in `gate.ts` before adding steps, and rerun the script on the next loops to check the change helped.
