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

| Operation the skills name | Claude Code | OMP | Other harnesses |
|---|---|---|---|
| Subagent on a set model and effort | Agent tool, `model` and `effort` | `task` tool: `effort`; the model comes from the agent type's configured model | the harness's subagent tool |
| Answer a subagent's question and let it continue | `SendMessage` | as other harnesses | resume it if the harness can; else start a new subagent with its report and the answer |
| Run another skill (`tdd`, `branch-review`) | Skill tool | the harness's skill invocation | read that skill's `SKILL.md` and follow it |
| Ask the user | ask tool (`AskUserQuestion`) | `ask` tool | the harness's ask tool; none → ask in the reply and stop |
| Run a long shell command and wait | background shell call, then wait for its notification | one shell call with a timeout long enough | same; a harness with a background-wait tool uses it |

When the harness cannot set a subagent's model or effort, the subagent runs on what the harness gives it. Say so in the
hand-off, and keep `--writer` true to that model.

The `model` and `effort` frontmatter of a skill applies only in Claude Code; other harnesses run the skill on the
session model.
