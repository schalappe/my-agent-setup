# Hand over

Final phase of [review-round](SKILL.md) (`wt`, `dir`, `gate`, `End` as set there). Runs after `converged`, or at step 2 with step 4 answered when the user chose "merge with known limits" ([stopped loop](stopped.md#stopped-loop)).

1. `bun $gate ready`:
   - Exit 0 → if `gh pr view --json isDraft --jq .isDraft` is `true`, run `gh pr ready <number>` and print `PR #<number> marked ready`. Print all `minor left:` lines.
   - Exit 1 → print the gate's line, print `wt`, [release the stack](SKILL.md#release-the-stack), print [decisions](SKILL.md#decisions), and stop.
   - Exit 2 → print stderr, release the stack, print decisions, and stop.
2. **PR description**: if any `round-*.json` has a non-null `commit`, run the `pr` skill on the current body to fix stale claims, apply with `gh pr edit <number> --body-file`, and report what changed.
3. [Release the stack](SKILL.md#release-the-stack), print [decisions](SKILL.md#decisions), and repeat the last `Round N:` line verbatim in a code span.
4. **Act on `$dir/end`**:
   - `ask` → one grouped multiple-choice question (only applicable options): Squash-merge (on green CI, delete branch, fast-forward main checkout; recommended if no open decision); File drafted pre-existing issues (repo category label + `needs-triage`); Remove worktree `<wt>` (only if `$dir/worktree-created` is `existing`); None.
   - `stop` → [Land](#land) up to merge; keep the worktree.
   - `send` → if `$dir/decisions.md` exists, ask as for `ask`; otherwise choose Squash-merge automatically, filing any untracked `known failure on base` in `$dir/pre-existing.md` (repo category label + `needs-triage`) while leaving other pre-existing findings drafted.
5. If Squash-merge chosen → [Land](#land).
6. If filing chosen → `gh issue create`.
7. Run [Worktree](#worktree) if Squash-merge didn't already and `End != stop`.

## Land

Runs for Squash-merge and for `stop` (which exits at step 4).

1. **Base check**: in `wt`, `git fetch origin <base>` and list overlapping changed files:
   ```bash
   mb=$(git merge-base HEAD origin/<base>)
   comm -12 <(git diff --name-only "$mb" origin/<base> | sort) <(git diff --name-only "$mb" HEAD | sort)
   ```
   If any file is listed or `gh pr view <number> --json mergeable` is `CONFLICTING`: dispatch Opus (medium) in `wt` to `git merge origin/<base>` (regenerating generated files instead of hand-merging), commit, push, then run a scoped verification round (`round`, `prepare`, brief limited to affected files, verifier); `bun $gate verify` must print green, else stop and report.
2. **Checks**: wait for PR checks ([harness.md](harness.md#harness-operations)); on failure → [CI red](#ci-red).
3. **Base re-check**: repeat step 1's listing (base may have moved during CI); if any file overlaps, loop back to step 1.
4. If `stop` → print `PR #<number> ready to merge: checks green on <head>` and stop.
5. **Squash-merge**: always squash-merge, including every PR in a stack (never a merge commit or rebase merge, even if a repo stack doc suggests merge commits). Capture `head=$(git -C "$wt" rev-parse HEAD)`, run [Worktree](#worktree), then squash-merge from main checkout per [harness.md](harness.md#harness-operations). Fast-forward main checkout (`git pull --ff-only`) if it is on the base branch.
6. Comment what changed and how it was verified (last verify line, checks, scenarios) on each closed issue (`gh pr view <number> --json closingIssuesReferences`).

## CI red

Read failing check logs (`gh pr checks <number>`, `gh run view <run-id> --log-failed`):
- **Infrastructure** (runner/network/registry/unrelated timeout) → `gh run rerun <run-id> --failed` once and wait again.
- **Repository** → dispatch Opus (medium) in `wt` with the failing log to fix only that failure, commit `fix(ci): <check>`, push, and run [Loop](SKILL.md#loop) for up to 2 rounds (adding the failed check locally if possible). `converged` → resume [Land](#land) step 1 without a second hand-over; anything else → stop and report (no class fix, no stopped-loop question).

If the rerun or fix fails again, or the fixer changes nothing, stop and report with the log.

## Worktree

1. Never remove the main checkout.
2. If `git -C "$wt" status --porcelain` is non-empty or `git -C "$wt" rev-list @{u}..HEAD` has commits/fails, keep it and print `Worktree <wt> kept: uncommitted or unpushed changes.`
3. If `$dir/worktree-created` is `created` or the user chose removal, run `git worktree remove "$wt"` from main checkout and print `Worktree <wt> removed`; else print `Worktree <wt> kept.` Keep the branch and `$dir` (`noise.ts` reads `$dir`).
