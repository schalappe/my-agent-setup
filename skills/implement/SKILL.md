---
name: implement
description: "Implement one ticket, or a spec and its tickets, through implementer subagents while the main agent keeps scope, decisions, and acceptance."
disable-model-invocation: true
---

Implement the work the user names: one ticket, or a spec whose tickets form a **task graph** (tickets with blocking relationships, so a **frontier** of unblocked tickets is always ready). One ticket is a graph of one node. The arguments are a list of issues: each parent (a spec or a lot) stands for all its open sub-issues at every depth, a closed ticket counts as done, and the union of the list is the work. There is no exclusion syntax; to leave a ticket out, list the others. Two or more tickets take the spec shape. A last word `send` or `stop` is the End of `review-round`: the work then continues past the PR, through the review loop, to a PR ready to merge (`stop`) or merged (`send`), so the draft PR of step 3 is opened whatever the tracker. Only the user's invocation sets it. Fetch each reference from the issue tracker and state its title before starting; if a reference is ambiguous, ask. The issue tracker should have been provided to you. If not, tell the user to run `/setup-repo`.

## The main agent is the conductor

The main agent owns scope, decisions, and acceptance. It reads the tickets, the spec, the `AGENTS.md` of each project the work touches, and the diffs its subagents return. Exploration and code go to subagents, so the main context keeps every decision of the conversation intact.

Subagents report open questions instead of guessing a product or business rule. The main agent answers from the tickets, the docs, and the conversation, asks the user with the ask tool when the decision is the user's (with an End, [it waits for the end](#decisions-with-an-end)), and lets the subagent continue with the answer (`SendMessage` in Claude Code).

At the end the main agent **harmonises**: it compares what each subagent did with what was asked and decided. Any gap is the main agent's to close, by sending the work back with the precise difference or by correcting it itself, until the result matches.

### Decisions with an End

With an End the user is away, so a decision that is theirs waits for the end of the run. The main agent takes its recommended option, has the work built on it, and appends the decision to `$dir/decisions.md`, with `dir=$(git rev-parse --path-format=absolute --git-common-dir)/review/<branch>` for the feature or integration branch: the question, its options, the recommendation, the default it built on, and the evidence. `review-round` prints that file at its end, and `send` asks before it merges while the file exists.

Ask now, through the ask tool, only when building on a default is unsafe: the choice spends money, changes security or a public interface, deletes data, needs a migration a later answer could not undo, or the goal itself is ambiguous.

Communicate through **context pointers** (the spec, tickets, notes files, commits), not restated content.

It runs in Claude Code or Codex, directly or under T3 Code: [harness.md](../review-round/harness.md) maps the subagent, skill, and ask operations named here to each one.

## Steps

1. Read the tickets and the spec, and draw the task graph. On GitHub, `bun ~/.agents/skills/implement/plan-graph.ts <owner/repo> <issue>...` prints it: the open tickets with their wave, size, readiness, and native blockers. Record `git -C <main-checkout> status --porcelain` as the user's baseline.

2. (optional) Dispatch an **exploration subagent** for the files and external docs the tickets need. It saves markdown notes to a directory outside the repo that every later subagent can read, so implementers spend their context on implementation.

3. Create the branch, in its own worktree:
   - **One ticket**: a feature branch. The implementer works on it directly.
   - **A spec**: an **integration branch**. Each implementer works on its own branch in its own worktree, and a **merger subagent** merges each finished ticket into the integration branch. If the issue tracker closes work through PRs, or the user asks for one, open a draft PR after the first merge (a branch with no commits ahead of the base can't open one), marked as closing the spec and tickets.

4. Dispatch **implementer subagents**, in the background where possible, one per frontier ticket. Each one:
   - confirms its worktree is based on the right branch before starting, and resets onto it if not;
   - runs the `tdd` skill to build the ticket, and runs the repo's typecheck after each slice;
   - follows the repo's review checklist (named in `AGENTS.md`, a PR template, or a standards file), so its test requirements are met before review rather than found by it;
   - fixes defects it finds on the paths the ticket touches, and small adjacent ones whose fix is local and verifiable, and reports any that needs a product decision;
   - on the spec shape, merges the integration branch tip into its own branch before reporting done.

   Every subagent that works in a worktree (implementer, merger, fixer):
   - gets the worktree's absolute path and uses absolute paths under it for every file tool. File tools resolve relative paths against the main checkout, not the shell's cwd, so a relative edit lands in the wrong tree;
   - installs dependencies in the worktree before its first commit (the repo's frozen install, e.g. `bun install --frozen-lockfile`): git hooks run from the worktree and fail without its `node_modules`.

   After every wave, rerun `git -C <main-checkout> status --porcelain`. Any entry not in the baseline is a stray edit: stop the wave, move that change into the worktree that owns it, and restore the main checkout's file. Shared `.git` metadata written from a worktree (refs, gate evidence) is expected.

5. On the spec shape, merge each finished ticket with a merger subagent. When that changes the frontier, dispatch implementers for the new tickets.

6. Run the `branch-review` skill on the branch. A finding that is doubtful, partial, or a product decision goes to the user now, through the ask tool, before final verification; with an End, it is a [decision that waits](#decisions-with-an-end). Fix the rest in one implementer subagent, then review the fix commits alone with `branch-review` (fixed point: the commit before the fixes) before merging them: a fix can trade one finding for a regression. Its reviewers are peer processes on the other model family; an in-session reviewer would be the writer's family reviewing itself.

7. Harmonise (see above) against the tickets, the spec, the conversation's decisions, and the review. Fix the small adjacent findings that subagents only reported instead of handing them on.

8. Run the **verifier** for the repo's per-ticket gates, as its `AGENTS.md` defines them, once, on the final revision. Final means every edit is in, docs and skill notes included: a change after this step changes the code identity, so the review loop verifies everything again. The verifier is the peer, run with `review-round`'s Verifier command (Verify step), never an in-session subagent: those run on the writer's family. Check `bun ~/.agents/skills/review-round/peer.ts --check` first; the implementers run on the session's provider, so the peer takes the session's family as the writer's ([harness.md](../review-round/harness.md#writer-family)). Its brief sets a setup deadline and asks for a report on the first blocker instead of working around it. Other sessions may run servers at the same time, so its brief also carries `review-round`'s isolation rule (Verify step): services start from the worktree on the ports, database, and containers the repo assigns to a parallel session, and a port already in use is `blocked`. When the repo has a `verify-<app>` skill, the main agent launches the stack before the run and runs its Cleanup after, under `review-round`'s Stack rule; the verifier only drives it. `review-round` reuses this verification for its first round, so it never needs this stack. For runs longer than a few minutes the verifier writes a progress file (stage, elapsed time, result counts so far). Run scripts meant for reuse take the worktree path as an argument.

   The verifier also writes its result where `review-round` reuses it, so the loop's first round skips a second full verification of the same code. Its brief starts with what `bun ~/.agents/skills/review-round/gate.ts brief 0` prints from the worktree: the paths, including `verify-0.json`, and the rule that every check runs through `gate.ts exec 0`, so the exec records that prove each exit code land in `round-0/`, where the loop looks for them when it reuses the file. The verifier writes `verify-0.json` in the contract of `review-round`'s [verifier.md](../review-round/verifier.md#verify-file): every check with its exit, every browser, API, or CLI scenario with `pass`, `fail`, or `blocked` and its `surface`. A state the app cannot produce after one realistic attempt stays out of the file and goes in the hand-off table as `not verified`, with what was tried: a `blocked` entry stops the review loop from reusing the file. Before a rerun on the same revision, `gate.ts attempt 0` archives the file, and the next `brief 0` carries what already passed.

9. Commit to the branch. If a draft PR exists, mark it ready for review; otherwise resolve each ticket the way the issue tracker closes work, and report the branch. With a PR and no End, the next step is the user's `/review-round #<PR>`: it reuses the branch's worktree.

10. Remove the per-ticket subagent worktrees. Keep the worktree of the feature or integration branch: `review-round` runs in it, and offers to remove it once the PR is ready.

11. An End was given → run the `review-round` skill with `#<PR> <End>` in this turn. The acceptance table then goes in the message that ends the loop, with each row's revision and status read from the loop's last `verify-N.json`.

Hand off with an acceptance table in the run's last message: a markdown table, one row per acceptance criterion of the ticket, with the columns `criterion | revision | command | result counts | status`. Copy the status verbatim from the verifier: `pass`, `blocked`, `bypassed prerequisite`, or `not verified`. The hand-off is done when every criterion has its row; a paragraph that sums up the verification is not the table.

- Synthetic interactions (scripted events, mocks, injected state) are never reported as physical ones.
- Baseline attribution ("not new", "also fails on develop") is `unproven` until reproduced on the base revision.
- A required full run is satisfied only by one passing full invocation, not by pieced-together partial runs.
- A defect found and not fixed names why (redesign, product decision, contract change) and links its drafted issue.
- Unresolved assumptions: none, or each one already asked through the ask tool or, with an End, recorded in `decisions.md`.
