---
name: implement-spec
description: "Implement the result of /to-spec and /to-tickets in code."
disable-model-invocation: true
---

You have been provided a spec. This spec should have tickets associated with it, describing how to implement the spec.

The issue tracker should have been provided to you. If not, tell the user to run `/setup-matt-pocock-skills`.

The goal is the entire spec implemented on a single **integration branch**, with every ticket resolved the way the issue tracker closes work.

The tickets are not a list of steps. They are a **task graph** with blocking relationships between them. This means there is always a **frontier** of tickets which are ready to be grabbed.

Communication to and from subagents should be sparse. Communicate primarily through **context pointers**: to the spec, tickets, research notes, and previous commits. Don't duplicate information already available via pointers.

**Implementer subagents** should be run in the background where possible for maximum concurrency.

## Steps

1. Read the spec and tickets to understand the task graph.

2. (optional) Use an **exploration subagent** to conduct any exploration required by the tickets - relevant codebase files or external documentation. Ensure the exploration subagent can save files - it should save its markdown notes in a directory outside the repo, accessible by all future subagents. This lets **implementer subagents** focus on implementation rather than exploration.

3. Create the integration branch. If the issue tracker closes work through PRs, or the user asks for one, open a draft PR after the first merge in step 5 (a branch with no commits ahead of main can't open one), marked as closing the spec and tickets.

4. Use **implementer subagents** to implement each ticket, each in its own worktree on its own branch. Each implementer subagent:
   - confirms its worktree is based on the integration branch before starting, and resets onto it if not;
   - calls the Skill tool with `tdd` to build the ticket;
   - merges the integration branch tip into its own branch before reporting done

   The implementer brief points to the repo's review checklist (e.g. a PR template or review standards file) if one exists, so its test requirements are met before review rather than found by it.

   Every subagent that works in a worktree (implementer, merger, fixer, and the integration worktree itself):
   - gets the worktree's absolute path in its task and uses absolute paths under it for every file tool (read, edit, write, grep). File tools resolve relative paths against the main checkout, not the shell's cwd, so a relative edit lands in the wrong tree;
   - installs dependencies in the worktree before its first commit (the repo's frozen install, e.g. `bun install --frozen-lockfile`): git hooks run from the worktree and fail without its `node_modules`.

   The absolute-path rule alone has not stopped stray edits, so check mechanically. Before step 3, record `git -C <main-checkout> status --porcelain` as the user's baseline. After every implementer or merger wave, run it again: any entry not in the baseline is a stray edit. Stop the wave, move that change into the worktree that owns it, and restore the main checkout's file before continuing.

   "Main checkout untouched" means its working-tree files. Shared `.git` metadata written from a worktree (refs, gate evidence) is expected.

   Every **verifier subagent** brief sets a setup deadline and asks for a report on the first blocker instead of working around it. For runs longer than a few minutes it writes a progress file (stage, elapsed time, result counts so far); multi-hour runs use `timeout: 0`. Run scripts meant for reuse take the worktree path as an argument instead of hard-coding one.

5. Once an **implementer subagent** completes, merge its work to the integration branch with a **merger subagent**.

6. If this changes the **frontier** of available tickets, kick off more **implementer subagents** to work on the new tickets. This allows for maximum concurrency.

7. Once all tickets are complete, call the Skill tool with `code-review` on the integration branch. Fix all issues raised by the code review in a single **implementer subagent**, then review the fix commits alone with a **reviewer subagent** before merging them: a fix can trade one finding for a regression.

8. If a draft PR exists, mark it ready for review. Otherwise, resolve each ticket the way the issue tracker closes work, and report the integration branch.

9. Clean up all **implementer subagent** worktrees.

Hand off with an acceptance table, one row per criterion: `criterion | revision | command | result counts | status`. Copy the status verbatim from the verifier: `pass`, `blocked`, `bypassed prerequisite`, or `not verified`.

- Synthetic interactions (scripted events, mocks, injected state) are never reported as physical ones.
- Baseline attribution ("not new", "also fails on develop") is `unproven` until reproduced on the base revision.
- A required full run is satisfied only by one passing full invocation, not by pieced-together partial runs.
- List out-of-scope defects found along the way with their tracking status: existing issue, filed, or unfiled.
