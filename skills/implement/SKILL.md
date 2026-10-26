---
name: implement
description: "Implement one ticket, or a spec and its tickets, through implementer subagents while the main agent keeps scope, decisions, and acceptance."
disable-model-invocation: true
---

Implement the work the user names: one ticket, or a spec whose tickets form a **task graph** (tickets with blocking relationships, so a **frontier** of unblocked tickets is always ready). One ticket is a graph of one node. Fetch each reference from the issue tracker and state its title before starting; if a reference is ambiguous, ask. The issue tracker should have been provided to you. If not, tell the user to run `/setup-repo`.

## The main agent is the conductor

The main agent owns scope, decisions, and acceptance. It reads the tickets, the spec, the `AGENTS.md` of each project the work touches, and the diffs its subagents return. Exploration and code go to subagents, so the main context keeps every decision of the conversation intact.

Subagents report open questions instead of guessing a product or business rule. The main agent answers from the tickets, the docs, and the conversation, asks the user with the ask tool when the decision is the user's, and resumes the subagent with `SendMessage`.

At the end the main agent **harmonises**: it compares what each subagent did with what was asked and decided. Any gap is the main agent's to close, by sending the work back with the precise difference or by correcting it itself, until the result matches.

Communicate through **context pointers** (the spec, tickets, notes files, commits), not restated content.

## Steps

1. Read the tickets and the spec, and draw the task graph. Record `git -C <main-checkout> status --porcelain` as the user's baseline.

2. (optional) Dispatch an **exploration subagent** for the files and external docs the tickets need. It saves markdown notes to a directory outside the repo that every later subagent can read, so implementers spend their context on implementation.

3. Create the branch, in its own worktree:
   - **One ticket**: a feature branch. The implementer works on it directly.
   - **A spec**: an **integration branch**. Each implementer works on its own branch in its own worktree, and a **merger subagent** merges each finished ticket into the integration branch. If the issue tracker closes work through PRs, or the user asks for one, open a draft PR after the first merge (a branch with no commits ahead of the base can't open one), marked as closing the spec and tickets.

4. Dispatch **implementer subagents**, in the background where possible, one per frontier ticket. Each one:
   - confirms its worktree is based on the right branch before starting, and resets onto it if not;
   - calls the Skill tool with `tdd` to build the ticket, and runs the repo's typecheck after each slice;
   - follows the repo's review checklist (named in `AGENTS.md`, a PR template, or a standards file), so its test requirements are met before review rather than found by it;
   - fixes defects it finds on the paths the ticket touches, and small adjacent ones whose fix is local and verifiable, and reports any that needs a product decision;
   - on the spec shape, merges the integration branch tip into its own branch before reporting done.

   Every subagent that works in a worktree (implementer, merger, fixer):
   - gets the worktree's absolute path and uses absolute paths under it for every file tool. File tools resolve relative paths against the main checkout, not the shell's cwd, so a relative edit lands in the wrong tree;
   - installs dependencies in the worktree before its first commit (the repo's frozen install, e.g. `bun install --frozen-lockfile`): git hooks run from the worktree and fail without its `node_modules`.

   After every wave, rerun `git -C <main-checkout> status --porcelain`. Any entry not in the baseline is a stray edit: stop the wave, move that change into the worktree that owns it, and restore the main checkout's file. Shared `.git` metadata written from a worktree (refs, gate evidence) is expected.

5. On the spec shape, merge each finished ticket with a merger subagent. When that changes the frontier, dispatch implementers for the new tickets.

6. Call the Skill tool with `branch-review` on the branch. A finding that is doubtful, partial, or a product decision goes to the user now, through the ask tool, before final verification. Fix the rest in one implementer subagent, then review the fix commits alone with a reviewer subagent before merging them: a fix can trade one finding for a regression.

7. Harmonise (see above) against the tickets, the spec, the conversation's decisions, and the review. Fix the small adjacent findings that subagents only reported instead of handing them on.

8. Dispatch a **verifier subagent** for the full test suite and the repo's gates, once, on the final revision. Final means every edit is in, docs and skill notes included: a change after this step changes the code identity, so the review loop verifies everything again. The verifier runs on Sonnet (its agent definition); do not override it with a bigger model, execution does not need one. Its brief sets a setup deadline and asks for a report on the first blocker instead of working around it. Other sessions may run servers at the same time, so its brief also carries `review-round`'s isolation rule (Verify step): services start from the worktree on the ports, database, and containers the repo assigns to a parallel session, and a port already in use is `blocked`. For runs longer than a few minutes it writes a progress file (stage, elapsed time, result counts so far); multi-hour runs use `timeout: 0`. Run scripts meant for reuse take the worktree path as an argument.

   The verifier also writes its result where `review-round` reuses it, so the loop's first round skips a second full verification of the same code. From the worktree, before running anything, it records `git rev-parse HEAD` and `bun ~/.agents/skills/review-round/gate.ts tree`; at the end it writes (creating the directory, overwriting an older file) `$(git rev-parse --path-format=absolute --git-common-dir)/review/$(git branch --show-current)/verify-0.json` in the format of `review-round`'s Verify step: every check command with its observed exit code, every browser, API, or CLI scenario with `pass`, `fail`, or `blocked` and its `surface`. A stage it did not run is not listed as a passing check. `blocked` means the environment stopped the scenario (stack, database, access). A state the app cannot produce after one realistic attempt stays out of the file and goes in the hand-off table as `not verified`, with what was tried: a `blocked` entry stops the review loop from reusing the file.

9. Commit to the branch. If a draft PR exists, mark it ready for review; otherwise resolve each ticket the way the issue tracker closes work, and report the branch. With a PR, the next step is `/review-round #<PR>`: it reuses the branch's worktree.

10. Remove the per-ticket subagent worktrees. Keep the worktree of the feature or integration branch: `review-round` runs in it, and offers to remove it once the PR is ready.

Hand off with an acceptance table, one row per criterion: `criterion | revision | command | result counts | status`. Copy the status verbatim from the verifier: `pass`, `blocked`, `bypassed prerequisite`, or `not verified`.

- Synthetic interactions (scripted events, mocks, injected state) are never reported as physical ones.
- Baseline attribution ("not new", "also fails on develop") is `unproven` until reproduced on the base revision.
- A required full run is satisfied only by one passing full invocation, not by pieced-together partial runs.
- A defect found and not fixed names why (redesign, product decision, contract change) and links its drafted issue.
- Unresolved assumptions: none, or each one already asked through the ask tool.
