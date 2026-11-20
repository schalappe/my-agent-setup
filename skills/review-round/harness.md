# Model roles and harness operations

`review-round`, `branch-review`, and `implement` run in Claude Code, in Codex, or under T3 Code, which runs Claude,
Codex, or Gemini (Antigravity) and adds tools of its own.

## Model roles

The roles are fixed. They never depend on which harness or session runs a skill:

| Role | Model | How |
|---|---|---|
| All code: implementers, fixers, mergers | Claude Opus 5.5 | Opus subagent (below) |
| Plan critique, review, verification, same-defect judgment | GPT-6.2 Sol | headless peer run through `peer.ts` |
| Verdicts (green, converged, stalled, ready) | none | `gate.ts`, deterministic code over the recorded files |

- **Peer runs** (verifier, reviewers, plan critic, same-defect judge) are headless `codex exec` processes launched by
  `peer.ts`, never in-session subagents. The process leaves a trace (`trace.ts` reads it) that proves which files the
  peer opened. `peer.ts` takes no writer argument: the peer is GPT-6.2 Sol whoever wrote the code, including a human.
- **Plan critique**: before a plan, spec, or ticket set goes to implementation, write it to a file and run
  `bun ~/.agents/skills/review-round/peer.ts --access read --trace <dir>/critique.jsonl < <plan file>` with a prompt
  that asks for the plan's gaps, risks, and wrong assumptions. The planner answers each point or revises the plan.
- **Opus subagents** write every change. The session never edits code itself in these skills.
- **The gate** turns observed results into verdicts. GPT-6.2 Sol only answers one narrow question for it (are two
  findings the same defect?), and the gate keeps each answer in `same-defect.json`, so its verdict over the same files
  never changes.

## Codex and Antigravity sandbox

A Codex or Antigravity thread that runs these skills runs in full access. A workspace sandbox (T3 Code's "auto" and
"auto-accept-edits" modes) cuts the network and forbids a nested sandbox, so `codex exec` cannot start; each peer run
then needs an escalation. `peer.ts --check` runs the peer once and names the sandbox when it fails.

## Harness operations

| Operation the skills name | Claude Code | Codex, or Gemini, under T3 Code | Codex without T3 Code |
|---|---|---|---|
| Opus subagent at a set effort | Agent tool, `model: "opus"` and `effort` | `delegate_task` to the Claude provider, model `claude-opus-5-5`, `effort` in `target.options`; follow its `next` | no route: stop at preflight and say so |
| Answer a subagent's question and let it continue | `SendMessage` | follow the delegate's `next` | — |
| Run another skill (`tdd`, `branch-review`) | Skill tool | read that skill's `SKILL.md` and follow it | the same |
| Ask the user | ask tool (`AskUserQuestion`) | ask in the reply and end the turn; the answer arrives as the next user message | the same |
| Run a long shell command and wait | shell call with `run_in_background`, then end the turn: its notification wakes you; under T3 Code, once the shell call's result is back, `t3_background_wait` in a later message with the task id read from that result, then end the turn | the harness's long command (Codex: `exec_command`, then `write_stdin` with empty input until it exits; one poll lasts at most 5 minutes) | Codex as in the previous column |
| Wait for a PR's checks | `gh pr checks <number> --watch`, run as a long shell command; under T3 Code as in the next column | no `gh --watch`: `link_pull_request`, `watch_pull_request`, end the turn; the wake resumes the step that waited: read `gh pr checks <number>`, end the turn again while they run, then `unwatch_pull_request` before going on | `gh pr checks <number> --watch` |

A wait is one background task and its own completion signal: the notification in Claude Code, the command's exit in
the `write_stdin` output in Codex. A `sleep` or `until` polling loop, or a second background task started only to wait
on the first, adds nothing but a turn that ends early.

A skill's `model` and `effort` frontmatter applies only in Claude Code, so these skills set every model at the call
instead.
