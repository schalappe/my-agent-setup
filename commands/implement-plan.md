---
description: Plan the execution order of a spec's tickets for /implement, with what can run in parallel
argument-hint: "<issue> [<issue>...]"
disable-model-invocation: true
allowed-tools: Bash(bun ~/.agents/skills/implement/plan-graph.ts:*), Bash(gh issue view:*), Bash(gh issue list:*), Bash(gh api:*), Bash(git log:*), Bash(git rev-parse:*), Bash(rg:*), Bash(fd:*), Read, Grep, Glob, Skill
---

`/implement-plan` asks for an execution plan, not for work: change nothing, on the tracker or in the repo. Issues: $ARGUMENTS

The plan is executed with the `implement` skill. Read `~/.agents/skills/implement/SKILL.md` first: its unit of work is one `/implement` **run** (one ticket, or several tickets run in parallel on one integration branch, then one `branch-review`, one verifier, one PR), and its opening paragraph defines what a `/implement` argument list means. Recommend runs, not loose tickets.

1. **Collect.** Read the tracker setup in `docs/agents/issue-tracker.md` (missing: tell the user to run `/setup-repo` and stop). On GitHub, run `bun ~/.agents/skills/implement/plan-graph.ts <owner/repo> <issue>...` on the issues given: it expands every parent at every depth and prints each open ticket's wave, size, readiness, the not-ready tickets holding it, and its open native blockers. Then read each open ticket's body and comments, and compare its "Blocked by" section with the native blockers: a mismatch is a risk.
2. **Readiness.** A plan needs the fog of war cleared first: only `ready-for-agent` tickets sized XS, S, M, or L can be implemented (the script's `ready` column says `yes`). An XL ticket goes back to `/scout #<n>` to be split, and so does a ticket with no size. List every other ticket with its reason and the next step (`/scout #<n>`), and drop it from the plan along with every ticket it holds (the script's `held by` column).
3. **Hidden coupling.** Blocking edges miss conflicts. Explore the code lightly to see what each ticket touches: shared modules, database migrations, lockfiles, generated files, shared config, the same UI screen. Two tickets with no edge but the same hot spot are coupled.
4. **Order.** Take the waves from the script: wave 1 is the frontier, each later wave is unblocked by the earlier ones.
5. **Group into runs.** A run holds **at most two tickets of size L**, plus any number of XS, S, and M tickets. Cut the graph so each run depends only on itself and on earlier runs, and keep coupled tickets in the same run when the budget allows. A run that depends on another starts after that run's PR is merged into the base. Run two groups in parallel sessions only when they share no edge and no hot spot: each parallel run costs its own `branch-review`, its own peer verifier (`review-round`'s `peer.ts`), and its own app stack on the ports the repo assigns to a parallel session.
6. **Write each command.** Give a parent when the run takes all its open sub-issues; otherwise list the run's tickets one by one.

Reply with:

- **Waves**: table `wave | ticket | size | title | blocked by | touches`.
- **Runs**: table `run | tickets | L count | start after | parallel with | command`, the command being the exact `/implement …` to type.
- **Why**: one line per grouping or split decision, with the coupling or budget it rests on.
- **Not ready**: tickets left out and their next step.
- **Risks**: likely conflicts or blocking edges that look wrong, marked as guesses when not confirmed in the code.
- **Tracker actions**: a numbered list of the exact changes you propose (add or remove a blocking link, fix a ticket's text), so the user can approve them by number. Make none until approved. Waves stay out of the tracker: the script recomputes them from the native links, so a spec carries no build-order section.
