# Hand over

The last phase of [review-round](SKILL.md): `wt`, `dir`, `gate`, and the End are as SKILL.md sets them.

Runs when the loop stops after `converged`. A stalled, capped, or broken loop never gets here, so its PR and its worktree stay as they are.

1. `bun $gate ready`:
   - Exit 0 → if `gh pr view --json isDraft --jq .isDraft` prints `true`, run `gh pr ready <number>` and print `PR #<number> marked ready`. Print its `minor left:` lines: those minors go to the human.
   - Exit 1 → print the gate's line (`review loop: stays draft (<reason>)`), leave the PR as it is, print the worktree path (the human finishes the PR there), release the stack, print the decisions, and stop.
   - Exit 2 → the gate is broken. Print its stderr, release the stack, print the decisions, and stop.
2. PR description: when a `round-*.json` has a non-null `commit`, the loop changed the code after the description was written. Run the `pr` skill on the existing body (`gh pr view --json body`) to correct each claim the fixes made false (counts, "no migration", evidence), apply it with `gh pr edit <number> --body-file`, and print what changed.
3. [Release the stack](SKILL.md#release-the-stack) and print the [decisions](SKILL.md#decisions), so the user reads them before answering. The message that ends the loop repeats the last `Round N:` line verbatim, in a code span: its `diff=` is what the loop added to the PR.
4. Act on the End in `$dir/end`:
   - `ask` → ask one grouped question (ask tool, multiple choice), with only the options that apply, and act only on the answer:
     - Merge: squash-merge once CI is green, delete the branch, and fast-forward the main checkout (recommended when no decision is open).
     - File the drafted pre-existing issues, each labeled with the repo's category label plus `needs-triage`.
     - Remove the worktree `<wt>`: only for a worktree the loop did not create (`$dir/worktree-created` reads `existing`).
     - None.
   - `stop` → no question. [Land](#land) the PR up to its merge, and keep the worktree.
   - `send` → `$dir/decisions.md` exists → a decision is open and the merge is the user's: ask the grouped question as for `ask`. Otherwise Merge is chosen without a question. The pre-existing issues stay drafted either way.
5. Merge, when chosen: [Land](#land) the PR.
6. File the issues, when chosen, with `gh issue create`.
7. [Worktree](#worktree), when the merge did not already run it and the End is not `stop`.

## Land

Takes the ready PR to its merge. It runs for Merge, and for `stop`, which leaves at step 4.

1. Base. The code the loop verified is the PR's head, so base commits that touch the PR's files are unverified with it. In `wt`, `git fetch origin <base>`, then list the files both sides changed:

   ```bash
   mb=$(git merge-base HEAD origin/<base>)
   comm -12 <(git diff --name-only "$mb" origin/<base> | sort) <(git diff --name-only "$mb" HEAD | sort)
   ```

   A file listed, or `gh pr view <number> --json mergeable` reads `CONFLICTING` → dispatch one Opus subagent (medium) with the absolute path of `wt` to `git merge origin/<base>` and resolve only the conflicting files (regenerate a generated one with the repo's command instead of merging it by hand); then commit and push. Then verify once more as the next round (`round`, `prepare`, a brief limited to the checks and scenarios that the listed files and the resolution reach, the verifier): `bun $gate verify <that round>` must print green, else stop and report it. Nothing listed → go on.
2. Checks. Wait for the PR checks ([harness.md](harness.md)); under T3 Code the wait ends the turn and the wake resumes at this step. A failing check → [CI red](#ci-red).
3. Base again: the base may have moved during the wait. Run step 1's listing once more; a file listed → back to step 1.
4. `stop` → print `PR #<number> ready to merge: checks green on <head>` and stop here.
5. Merge. Read `head=$(git -C "$wt" rev-parse HEAD)`, then take the [worktree](#worktree) step, since the merge deletes the branch. From the main checkout, with the worktree removed: `gh pr merge <number> --squash --delete-branch --match-head-commit "$head"`. With it kept (it still holds the local branch): `gh pr merge <number> --squash --match-head-commit "$head"`, then `git push origin --delete <branch>`. Then `git pull --ff-only` in the main checkout when it is on the base branch.
6. On each issue the PR closed (`gh pr view <number> --json closingIssuesReferences`), comment what changed and how it was verified (the last `verify` line, its checks, and its scenarios).

## CI red

A check that the loop's own verification passed fails on GitHub. Read its log (`gh pr checks <number>`, then `gh run view <run-id> --log-failed`) and sort it:

- Infrastructure (a runner, network, or registry error, or a timeout in a step the diff does not reach) → `gh run rerun <run-id> --failed`, once, and wait again.
- Repository (the PR's code fails the check) → dispatch one Opus subagent (medium) with the absolute path of `wt` and the failing log, to fix only what that check requires. Commit `fix(ci): <check>` and push. The code changed after the loop converged, so run the [Loop](SKILL.md#loop) for up to 2 more rounds; the verifier brief adds the failed check's command when the repo can run it locally. `converged` → resume [Land](#land) at step 1, without a second hand over. Anything else → stop and report it.

A check that fails again after its rerun or its fix, or a fixer that changes nothing → stop and report the check with its log. The PR stays open and unmerged.

## Worktree

1. `wt` is the main checkout → remove nothing.
2. `git -C "$wt" status --porcelain` prints anything, or `git -C "$wt" rev-list @{u}..HEAD` lists a commit or fails (no upstream) → keep it and print `Worktree <wt> kept: uncommitted or unpushed changes.` Never force the removal: those changes may be the user's.
3. `$dir/worktree-created` reads `created`, or the user chose its removal → from the main checkout, `git worktree remove "$wt"`, then print `Worktree <wt> removed`. Otherwise print `Worktree <wt> kept.` The branch and `$dir` stay: `noise.ts` reads `$dir`.
