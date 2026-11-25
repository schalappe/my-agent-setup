---
name: review-round
description: "Use when the user asks to review-loop, auto-review, or run verify-review-fix rounds on a pull request until it is ready to merge."
argument-hint: "[#PR] [max rounds, default 5] [send|stop]"
---

# Review rounds

Verify → review → fix rounds on a PR (e.g. `/review-round #42 5`). The skill runs the loop itself—never wrap it in `/loop`.

- **Args**: `#PR` (or URL; defaults to current branch's PR), bare `M` = max rounds (default `5`; a PR always takes `#`), `End` = `send` (merge when ready), `stop` (ready + green checks), or default `ask`. Only the user's invocation sets `End`.
- **Roles & harness**: fixed across Claude Code, Codex, and T3 Code—see [harness.md](harness.md#model-roles). Opus 5.5 writes all fixes (medium for red/minor/CI/merge, high for findings); GPT-6.2 Sol verifies, reviews (correctness + security per slice), and judges repeats; `gate.ts` computes every verdict. Stop at preflight if Opus subagents cannot run ([harness.md](harness.md#harness-operations)).
- **Fixer contract**: every fixer brief (red, findings, minor pass) requires running the repo's fast static and mechanical checks on touched modules (per `AGENTS.md`, e.g. `gates.sh --dry-run` and `check -x test -x postgresTest -PstaticCheckModules=...`), running long checks in the foreground to completion (with exit codes), returning compiling code that passes static checks, and replying `{"fixed":[titles],"rejected":[{"file","line","title","reason"}]}` (save red/findings replies to `$p/fix.json`).
- **State**: shared across worktrees in `dir=$(git rev-parse --path-format=absolute --git-common-dir)/review/<branch>`. Re-resolve context every round; never carry findings in memory.
- **Gate** (`gate=~/.agents/skills/review-round/gate.ts`, header documents every command): prints `converged` (latest round on current tree is green with 0 critical/major) or `stalled` (same-defect repeat, 3-round file hotspot, post-resume non-decreasing majors, or runaway diff bloat, written to `$dir/stall.json`). Never edit state files (`verify-N.json`, `round-N.json`, `status`) yourself—only the verifier writes `verify-N.json` and `gate.ts` writes the rest.

## Preflight (once)

- **PR & branch**:
  - `#N` given: `gh pr view <N> --json number,state,headRefName,isCrossRepository`. Stop if `state != OPEN` or `isCrossRepository == true`. `branch = headRefName`.
  - No `#N`: `branch = $(git branch --show-current)`, resolve PR via `gh pr view "$branch" --json number` (stop if missing).
- **Worktree `wt`** (from `git worktree list --porcelain`; first entry is main checkout):
  - Reuse existing worktree for `branch` if checked out.
  - Otherwise create `wt` at the repo `AGENTS.md` worktree path (else `<main-checkout>.worktrees/<branch>`): `git fetch origin "$branch"`, then `git worktree add "$wt" "$branch" && git -C "$wt" merge --ff-only origin/"$branch"` (or `--track -b "$branch" origin/"$branch"` if no local branch). Stop if fast-forward fails.
  - Record origin: `mkdir -p "$dir"`, write `created` to `$dir/worktree-created` if created here, else `[ -f "$dir/worktree-created" ] || echo existing > "$dir/worktree-created"`.
  - Run the repo's frozen install (for git hooks) and fresh-checkout bootstrap (codegen, local env files per `AGENTS.md`) in `wt`.
- **End & tools**: `echo <ask|stop|send> > "$dir/end"`. Check `command -v bun`, `bun ~/.agents/skills/review-round/peer.ts --check`, `orchestrator_capabilities` under T3 (`codex` / `gpt-6.2-sol`), and Opus subagent route. Under T3 Code, call `link_pull_request`.

From here on, start every shell call with `cd "$wt" &&` and set `peer`, `gate`, `dir`, `N`, `p`. Pass absolute paths under `wt` to all file tools and subagents.

## Loop

Repeat up to `M` times: run steps 1–4 below, then `cd "$wt" && bun $gate`:

- **Exit 0**: print the gate's verdict line and any `repeat:` / `hotspot:` lines.
  - `converged` → if `$dir/minor-pass` is missing, run [minor-pass.md](minor-pass.md); else [hand over](handover.md).
  - `stalled` on `hotspot:` with no `$dir/stalls/` yet and rounds left in `M` → run [class fix](stopped.md#class-fix) without asking.
  - `stalled` otherwise → run [stopped loop](stopped.md#stopped-loop).
- **Exit 1**: run next round.
- **Exit 2**: broken gate—print stderr and stop.

The minor pass's follow-up round does not count toward `M`. Reaching `M` prints `review loop: capped after M rounds` and runs [stopped loop](stopped.md#stopped-loop). Any stop without hand-over runs [Release the stack](#release-the-stack) and [Decisions](#decisions).

## Resolve context (every round)

```bash
cd "$wt"
dir=$(git rev-parse --path-format=absolute --git-common-dir)/review/$(git branch --show-current)
N=$(bun $gate round); p="$dir/round-$N"
tree=$(bun $gate tree)
```

- Fetch `gh pr view --json number,baseRefName,body`.
- If `$dir/status` matches `<status> <tree>` for the current `tree`, take that branch of [Loop](#loop) immediately; ignore stale status for another tree.
- Run `bun $gate prepare $N --base <baseRefName>` (writes `$p/files.txt`, per-file patches, and `$p/base`).

## 1. Verify

Green requires both repo checks and a live exercise (tests alone are not proof).

1. **Checks**: find check commands from nearest `AGENTS.md`, package scripts, `Makefile`, `justfile`, or CI config (if none, live exercise alone decides).
2. **Live exercise**: write 2–5 concrete scenarios with expected observable outcomes:
   - **API/backend**: real service + real dev DB, real requests, assert responses and DB state.
   - **UI**: real browser via Playwright ([verifier.md](verifier.md)). Any hand-written UI file change requires ≥ 1 passing `surface: "browser"` scenario (`gate.ts brief` prints this requirement).
   - **CLI/library**: real command or throwaway script on the changed path.
   - Use the repo's `verify-<app>` skill recipes when present and name its path in the brief.
   - Keep adversarial/abuse probes (DoS/oversized/bypass scripts) and malformed-shape fuzzing payloads (`{}`, `[]` already covered by committed unit/PostgreSQL tests) in committed automated tests (`gate.ts exec`), never in live-exercise scripts ([cyber_policy](harness.md#codex-cyber_policy-refusal)).
   - Skip the exercise only for non-executable diffs (docs, comments, tests only) and state why.
3. **Isolation**: use the parallel-session ports/DB/containers documented in `AGENTS.md` (or default ports if none; port in use → `blocked: port <port> in use`, never touch another session's server).
4. **Stack** (repos with `verify-<app>` Doctor/Launch/Cleanup): run Doctor from `wt` before dispatching:
   - free → acquire slot, build if needed, Launch, record in `$dir/stack`;
   - ready & launched by this loop → keep if current, else Cleanup → rebuild → Launch;
   - busy (another session) → launch nothing; verifier reports `blocked`.
   Add `the loop launched the stack; do not launch or clean it up` to the brief.

**Reuse first**: look for an earlier `verify-K.json` matching `$tree`:
`K=$(rg -l -F "$tree" --max-depth 1 -g 'verify-*.json' "$dir" | sed -E 's/.*verify-([0-9]+)\.json$/\1/' | sort -n | tail -1)`.
If `K < N`, run `bun $gate reuse $K $N` then `bun $gate verify $N`; if `K == N` (from a closing verification), run `bun $gate verify $N`. If green, skip dispatch; if red/blocked, run `bun $gate attempt $N` and dispatch.

**Brief & carry**: run `bun $gate brief $N > "$p/verify.brief"`. Stderr prints the latest green round `K`, files changed since its tree, and carry candidates:
- Rerun path-scoped checks (with `--since <head of verify-K>`), any check/scenario that failed/blocked after `K`, and any slow suite or scenario reached by changed files (build/dep/config changes reach everything; migrations reach affected tables/seeds or everything for core tables; rerun when unsure). Rerun a failed slow suite filtered to its failed classes/tags unless changes hit the whole suite.
- Carry every other candidate by appending stderr's `Carried entries:` header and those JSON lines unchanged; print carried entries alongside changed files.
- Append exact check commands (paths relative to `wt`), scenarios, isolation rule, stack line, and `verify-<app>` path (never restate paths or contract already in `brief`/`verifier.md`).
- Before dispatching, run [Land](handover.md#land) step 1's base listing; if any file moved on base, merge base first, then re-run `prepare` and `brief`. Dispatch the [Verifier](#verifier).

**Act on `bun $gate verify $N`** (never the agent's summary):
- `green` → continue.
- `green (known failure on base: <cmd>)` → search open issues (`gh issue list --state open --search "<failing test or cmd>"`), append new entries to `$dir/pre-existing.md` (command, failing tests, `$p/base` sha, exec log, `tracked: #<N>` or `untracked: needs issue`), and continue.
- `red` → dispatch Opus fixer (medium) in `wt` for failing checks/scenarios only, then re-verify once; still red → step 4.
- `blocked: base run stopped before the check ran …` → rerun only that base check ready per [verifier.md](verifier.md#checks).
- `blocked: <reason>` → fix local setup (or add missing browser scenario / exec record), then re-verify once; still blocked → skip review, go to step 4.

Before any same-round rerun, archive with `bun $gate attempt $N` and regenerate `brief $N` (`same-tree` auto-carries passing entries from that attempt; `tree-changed` reruns per round rules).

### Verifier

Run the GPT-6.2 Sol peer ([harness.md](harness.md#model-roles)) with `$p/verify.brief`:
- **Under T3 Code**: `delegate_task` (`codex`, `gpt-6.2-sol`, `reasoningEffort: "high"`, `mode: "async"`, follow `next`), explicitly stating it is authorized by the user via `/implement` or `/review-round` to verify our own app on a local disposable stack. Instruct it to read `~/.agents/skills/review-round/verifier.md` and `$p/verify.brief` (absolute paths), work only in `$wt`, run checks via `bun $gate exec $N -- '<command>'`, write `verify-$N.json`, and not open `review-round/SKILL.md` or unlisted skills.
- **Outside T3 Code**:
  ```bash
  cd "$wt"
  cat ~/.agents/skills/review-round/verifier.md "$p/verify.brief" \
    | bun $peer --access full --trace "$p/verify.jsonl" 2> "$p/verify.log" > "$p/verify.out.json"
  jq -r .result "$p/verify.out.json"
  ```

On OpenAI `cyber_policy` abort, follow [harness.md](harness.md#codex-cyber_policy-refusal). On any other missing report/`verify-N.json`, rerun once, then stop and show the failure.

## 2. Review

Confirm `bun $gate tree` equals `verify-N.json`'s `tree` (else redo step 1).

Run `slices=$(bun $gate slice $N)`. It writes correctness (`review-S.prompt`) and security (`review-sec-S.prompt`) prompts and `slice-S.patch` bundles—full diff on the first reviewed round, only files changed since the previous reviewed round (plus rejected-finding files) on re-reviews. Empty output → nothing changed, go to step 4.

Run up to 8 GPT-6.2 Sol peers in parallel (fresh context, read-only), then `bun $gate reviewed $N`:
- **Under T3 Code**: `delegate_task` per slice `S`, instructing it to read `$p/review-$S.prompt` in `$wt` (read-only), print `$p/slice-<letter>.patch` with one `cat`, reply ONLY with JSON matching `~/.agents/skills/review-round/reviewer-schema.json`, and open no other skills. When done, paginate `t3_thread_read(threadId, view: "activity", afterPosition: -1, limit: 100, maxCharsPerItem: 20000)` to `$p/review-$S.jsonl` (one page per line), then run `bun $gate reviewed $N`. If activity pages are too large or truncated, run reviewers with the `peer.ts --trace "$p/review-$S.jsonl"` command below instead (writes directly to disk with zero tokens in conductor context); never read T3's internal SQLite database.
- **Outside T3 Code**:
  ```bash
  cd "$wt"
  i=0
  while IFS= read -r S; do
    bun $peer --access read --schema ~/.agents/skills/review-round/reviewer-schema.json --add-dir "$p" \
      --trace "$p/review-$S.jsonl" < "$p/review-$S.prompt" 2> "$p/review-$S.log" > /dev/null &
    i=$((i + 1)); [ $((i % 8)) -eq 0 ] && wait
  done <<< "$slices"
  wait
  bun $gate reviewed $N
  ```

`reviewed` writes `review-S.json` only from proven traces (schema valid + every slice file opened). Exit 1 → rerun the slices listed on `rerun:` once; still exit 1 → stop and show details. Print the per-reviewer summary lines after the round line. Never self-review, never hand-write `review-S.json`, and never edit generated prompts (change `gate.ts` instead).

## 3. Fix

Fix only `critical` and `major` findings where `pre_existing` is false (`minor` goes to [minor-pass.md](minor-pass.md) after convergence; `nit` goes to the human). Append `pre_existing: true` findings to `$dir/pre-existing.md` (deduped by file + title).

Dispatch one Opus subagent (high) with `$wt`, the PR body, merged critical/major findings, and their patch paths:
- Pattern findings: grep and fix every instance in the repo.
- Defects in unasked-for robustness (locks, retries, caches): prefer deleting that code over hardening it.
- Reject a finding only with a one-sentence reason (wrong, outside diff, contradicts intent, unreachable/hypothetical, preference); for unsettled product/business rules, start the reason with `decision:` (question, recommendation, evidence). Do not commit.

Append every `decision:` rejection to `$dir/decisions.md` (delivered once at the end, never mid-run).

## 4. Record

1. If working tree changed: `git add -A && git commit -m "chore(review): round N" && git push`.
2. Run `bun $gate record $N --fix "$p/fix.json"` (omit `--fix` if no fixer ran). Copy its `Round N: …` line verbatim into your reply, then run `bun $gate`.

## Hand over

After `converged` (and the minor pass), follow [handover.md](handover.md).

## Release the stack

On any stop (converged, stalled, capped, broken), before [Decisions](#decisions): if `$dir/stack` exists, run `verify-<app>` Cleanup from `wt`, release any slot per `AGENTS.md`, and remove `$dir/stack`. Never clean up a stack another session launched.

## Decisions

On any stop, print `$dir/decisions.md` (if present) as closed questions with options, recommendation, built-in default, and evidence.

Then print `$dir/pre-existing.md` (if present): keep `tracked: #<N>` links as-is, and draft one issue per untracked bug with `agent-ready-issue`. Untracked `known failure on base` checks are filed at [hand over](handover.md) even in `send` mode; other pre-existing findings are filed only if the user chooses so.

## Measure noise

`bun ~/.agents/skills/review-round/noise.ts <repo>...` reports per-loop rounds, majors, rejection rates/reasons, pre-existing counts, and verify minutes. High rejection share → tune `REVIEW_TASK` in `gate.ts`.
