# Running these skills outside Claude Code

`review-round`, `branch-review`, and `implement` run in any harness with a shell: Claude Code, OMP, Codex, or T3 Code
on top of one of them. Two kinds of work, two mechanisms:

- **Peer runs** (verifier and reviewers) are headless CLI processes launched by `peer.ts`, never in-session subagents.
  The process leaves a trace (`trace.ts` reads the claude, omp, and codex formats) that proves which files the
  reviewer opened, and it runs on the model family that did not write the code. Both hold in every harness.
- **Subagents** (implementers, fixers, mergers) use the harness's own subagent tool, as the table below says.

## Writer family

`peer.ts --writer` takes the family of the model that writes the code in this run: the model the implementer and
fixer subagents run on. `claude` → the peer is GPT-6.1 Sol; `gpt` → the peer is Claude Opus 5.5.

- Claude Code: `claude`.
- OMP: the model of the `task` agent (`task.agentModelOverrides` in `~/.omp/agent/config.yml`, else the session
  model). A Claude model → `claude`; a GPT model → `gpt`.
- Codex, or T3 Code on Codex: `gpt`.

Never guess it: a wrong writer family puts the writer's family on its own review.

## Harness operations

| Operation the skills name | Claude Code | OMP | T3 Code | Other harnesses |
|---|---|---|---|---|
| Subagent on a set model and effort | Agent tool, `model` and `effort` | `task` tool: `effort`; the model comes from the agent type's configured model | as the harness it runs on | the harness's subagent tool |
| Answer a subagent's question and let it continue | `SendMessage` | as other harnesses | as the harness it runs on | resume it if the harness can; else start a new subagent with its report and the answer |
| Run another skill (`tdd`, `branch-review`) | Skill tool | the harness's skill invocation | as the harness it runs on | read that skill's `SKILL.md` and follow it |
| Ask the user | ask tool (`AskUserQuestion`) | `ask` tool | as the harness it runs on | the harness's ask tool; none → ask in the reply and stop |
| Run a long shell command and wait | shell call with `run_in_background`, then end the turn: its notification wakes you | one shell call with a timeout long enough | shell call with `run_in_background`, then `t3_background_wait` with the task id that call returned, never a placeholder | one shell call with a timeout long enough; a background-wait tool, when the harness has one |
| Wait for a PR's checks | `gh pr checks <number> --watch`, run as a long shell command | as other harnesses | `watch_pull_request` | `gh pr checks <number> --watch`, run as a long shell command |

A wait is one background task and its own completion signal: the notification in Claude Code, the task id from the call's result in T3 Code. A `sleep` or `until` polling loop, or a second background task started only to wait on the first, adds nothing but a turn that ends early.

When the harness cannot set a subagent's model or effort, the subagent runs on what the harness gives it. Say so in the
hand-off, and keep `--writer` true to that model.

The `model` and `effort` frontmatter of a skill applies only in Claude Code; other harnesses run the skill on the
session model.
