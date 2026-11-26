---
name: implement
description: "Use when the user wants one ticket, or a spec and its tickets, implemented end to end through subagents."
disable-model-invocation: true
---

Implement the named issue(s): one ticket, or a spec forming a **task graph** (blocking edges give a ready **frontier**). Each parent stands for all its open sub-issues at every depth; closed issues count as done; two or more open tickets use the **spec shape**.

A trailing `send` or `stop` sets the `End` of `review-round`: continue past the draft PR through the review loop until ready to merge (`stop`) or merged (`send`), opening the draft PR at step 4 regardless of tracker. Only the user's invocation sets `End`. Fetch each reference and state its title before starting; ask if ambiguous. If no issue tracker is configured, tell the user to run `/setup-repo`.

## Main is the conductor

Main owns scope, decisions, and acceptance: read the tickets, spec, touched projects' `AGENTS.md`, and returned diffs. Delegate exploration and code to subagents and communicate via **context pointers** (specs, tickets, notes files, commits), never restated prose.

Subagents report open product/business questions instead of guessing. Main answers from tickets, docs, or conversation, asks the user when it is their call (with an `End`, see [Decisions with an End](#decisions-with-an-end)), and resumes the subagent with the answer. At the end, Main **harmonises** what was built against what was asked and decided, closing every gap until they match.

Model roles and harness mapping are fixed: see [harness.md](../review-round/harness.md#model-roles) (Opus 5.5 writes/merges/fixes; GPT-6.2 Sol critiques, reviews, verifies).

### Decisions with an End

With `send`/`stop`, the user is away: build on your recommended default and append the question, options, recommendation, default, and evidence to `$dir/decisions.md` (`dir=$(git rev-parse --path-format=absolute --git-common-dir)/review/<branch>`). `review-round` prints it at the end, and `send` asks before merging while it exists. Ask immediately only when a default is unsafe (spends money, changes security or public interface, deletes data, irreversible migration, or ambiguous goal).

## Steps

1. Read the tickets/spec and build the task graph (on GitHub: `bun ~/.agents/skills/implement/plan-graph.ts <owner/repo> <issue>...`). Record `git -C <main-checkout> status --porcelain` as baseline.
2. *(Optional)* Dispatch an exploration subagent to save shared markdown notes outside the repo for implementers.
3. Run the [plan critique](../review-round/harness.md#model-roles) on the tickets, spec, and task graph unless GPT-6.2 Sol already reviewed this version (for a single ticket, a clean Sol cold read recorded by `/scout` on this version counts; multi-ticket specs still critique the combined spec and task graph). Resolve each objection before implementing.
4. Create the worktree and branch:
   - **One ticket**: a feature branch; the implementer works on it directly.
   - **Spec shape**:
     - **Stacked PRs** (preferred when the spec exceeds the repo's PR size limit, e.g. ~3,000 lines, or combines migrations, engine, and UI): one branch and draft PR per ticket (or split backend/frontend if one ticket exceeds the limit), each targeting the previous branch and squash-merging top down (`docs/agents/pr-stacks.md` when present, still squash-merging every PR). Pipeline **implementation** of ticket N+1 in parallel while PR N runs `review-round`; wait until PR N stabilizes shared contracts/schema before starting `review-round` on PR N+1, and check base drift before launching any container or stack build.
     - **Integration branch** (small multi-ticket specs fitting one PR): each implementer uses its own branch/worktree; a merger subagent merges finished tickets into the integration branch. Open a draft PR after the first merge when the tracker uses PRs or `End` is set, referencing every closed issue.
5. Dispatch one **implementer subagent** per frontier ticket (background when possible). Each implementer:
   - verifies its worktree base and resets onto it if wrong;
   - works with absolute paths under its worktree (file tools resolve relative paths against the main checkout) and runs the repo's frozen install before its first commit so hooks work;
   - builds via `tdd`, typechecking each slice, runs static checks (lint, formatter, static analysis per `AGENTS.md`) on every changed module, and satisfies the repo's review checklist before reporting done;
   - fixes defects on touched paths and small local adjacent ones, reporting anything needing a product decision;
   - on the spec shape, merges the integration branch tip into its branch before reporting done.

   After each wave, re-check `git -C <main-checkout> status --porcelain`; move any stray edit not in baseline into its owning worktree and restore the main checkout.
6. *(Spec shape)* Merge each finished ticket with a merger subagent, then dispatch newly unblocked frontier tickets.
7. *(Only without an `End`)* Run `branch-review` on the branch. Ask the user on doubtful/partial/product findings; fix the rest in one implementer subagent, then re-run `branch-review` once on the fix commits alone and fix what it finds. With an `End`, skip this step (`review-round` round 1 is the first review).
8. **Harmonise** against tickets, spec, decisions, and (if step 7 ran) review findings. Fix small adjacent findings subagents only reported.
9. **Final verification (`round 0`)** on the settled tree (including doc/skill edits), using `gate=~/.agents/skills/review-round/gate.ts` from the branch worktree:
   - Check [Land](../review-round/handover.md#land) step 1's base listing and merge the base first if any touched file moved on base.
   - Run `bun $gate prepare 0 --base <base>` and `bun $gate brief 0`, then build the brief and launch/clean up any `verify-<app>` stack per `review-round`'s [Verify](../review-round/SKILL.md#1-verify) and [Verifier](../review-round/SKILL.md#verifier) rules (include a progress file for multi-minute runs; keep unreachable states out of `verify-0.json` and list them as `not verified` in the hand-off table so `review-round` can reuse `verify-0.json`).
   - Loop until `bun $gate verify 0` prints `green` (or `green (known failure on base: …)`) and `verify-0.json`'s `tree` equals `bun $gate tree`. Before any rerun, archive with `bun $gate attempt 0`, re-run `prepare 0` (if code changed) and `brief 0`.
10. Commit to the branch. Rewrite any draft PR body with the `pr` skill (scope, non-goals, ticket rules/amounts/states/refusals, preserving `Closes #…` lines) because `review-round` hands it to reviewers as the intent. Keep the PR in draft—only `review-round` marks it ready. Without a PR, resolve tickets per the tracker and report the branch.
11. Remove per-ticket subagent worktrees; keep the feature/integration worktree for `review-round`.
12. With an `End`, run `review-round` with `#<PR> <End>` in this turn once step 9 is green on the committed tree. Its reviewers see `decisions.md` as recorded open decisions. Place the acceptance table below in the final loop message, reading each row's revision/status from the `verify-N.json` matching the delivered `tree`.

## Hand-off acceptance table

End with a markdown table—one row per acceptance criterion: `criterion | revision | command | result counts | status` (verbatim verifier status: `pass`, `blocked`, `bypassed prerequisite`, or `not verified`).

- Report synthetic interactions as synthetic, never physical.
- Mark baseline attribution `unproven` until reproduced on the base revision.
- A required full run needs one passing full invocation, not pieced-together partial runs.
- Unfixed defects state why (redesign, product decision, contract change) and link a drafted issue.
- List unresolved assumptions (or `none` if all are asked or in `decisions.md`).
