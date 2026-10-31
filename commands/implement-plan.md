---
description: Plan the execution order of a spec's tickets for /implement, with what can run in parallel
argument-hint: "<issue> [<issue>...]"
disable-model-invocation: true
allowed-tools: Bash(gh issue view:*), Bash(gh issue list:*), Bash(gh api:*), Bash(git log:*), Bash(git rev-parse:*), Bash(rg:*), Bash(fd:*), Read, Grep, Glob, Skill
---

`/implement-plan` asks for an execution plan, not for work: change nothing, on the tracker or in the repo. Issues: $ARGUMENTS

The plan is executed with the `implement` skill. Read `~/.agents/skills/implement/SKILL.md` first: its unit of work is one `/implement` **run** (one ticket, or a spec whose frontier it already runs in parallel on one integration branch, then one `branch-review`, one verifier, one PR). Recommend runs, not loose tickets.

1. **Collect.** Read the tracker setup in `docs/agents/issue-tracker.md` (missing: tell the user to run `/setup-repo` and stop). For each issue given, read its body, comments, labels, and state. A parent issue or spec expands to its sub-issues (`gh api repos/{owner}/{repo}/issues/<n>/sub_issues`). Read every blocking edge: native links (`gh api repos/{owner}/{repo}/issues/<n>/dependencies/blocked_by`) and "Blocked by" sections. A closed ticket counts as done.
2. **Readiness.** Only `ready-for-agent` tickets can be implemented. List the others with their label and the next step (`/scout #<n>`), and drop them from the plan along with every ticket they block.
3. **Hidden coupling.** Blocking edges miss conflicts. Explore the code lightly to see what each ticket touches: shared modules, database migrations, lockfiles, generated files, shared config, the same UI screen. Two tickets with no edge but the same hot spot are coupled.
4. **Order.** Build the task graph and cut it into **waves**: wave 1 is the frontier, each later wave is unblocked by the earlier ones.
5. **Group into runs.** Default to one `/implement` run per spec: it already parallelises its frontier, and gives one review and one verification. Split into separate runs, started in parallel sessions, only when ticket groups share no edge and no hot spot and a separate PR is worth it (different reviewers, ship one group sooner). Each extra parallel run costs its own `branch-review`, its own GPT-6.1 Sol verifier, and its own app stack on the ports the repo assigns to a parallel session. A run that depends on another starts after that run's PR is merged into the base.

Reply with:

- **Waves**: table `wave | ticket | title | blocked by | touches`.
- **Runs**: table `run | tickets | start after | parallel with | command`, the command being the exact `/implement …` to type.
- **Why**: one line per grouping or split decision, with the coupling it rests on.
- **Not ready**: tickets left out and their next step.
- **Risks**: likely conflicts or blocking edges that look wrong, marked as guesses when not confirmed in the code. Offer to fix an edge on the tracker; do not fix it.
