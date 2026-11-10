# Running these skills in Claude Code and Codex

`review-round`, `branch-review`, and `implement` run in Claude Code or Codex, directly or under T3 Code, which runs
one of the two and adds tools of its own. Two kinds of work, two mechanisms:

- **Peer runs** (verifier and reviewers) are headless CLI processes launched by `peer.ts`, never in-session subagents.
  The process leaves a trace (`trace.ts` reads the claude and codex formats) that proves which files the reviewer
  opened, and it runs on the model family that did not write the code. Each family runs through its own CLI and
  login: GPT through `codex exec`, Claude through `claude -p`.
- **Subagents** (implementers, fixers, mergers) use the session's own subagent tool, as the table below says.

## Writer family

Implementers and fixers run on the session's provider, so the writer is the session's family. `peer.ts` detects it:
Claude Code sets `CLAUDECODE` in its shells (writer `claude`, peer GPT-6.1 Sol), Codex sets `CODEX_THREAD_ID`
(writer `gpt`, peer Claude Opus 5.5). Neither or both set → it stops and asks for `--writer claude|gpt`. Pass
`--writer` only when another session's model wrote the diff: a wrong family puts the writer's family on its own review.

## Codex sandbox

A Codex thread that runs these skills runs in full access. Codex's workspace sandbox (T3 Code's "auto" and
"auto-accept-edits" modes) cuts the network and forbids a nested sandbox, so `claude -p` cannot reach its API and
`codex exec` cannot start; each peer run then needs an escalation. `peer.ts --check` runs the peer once and names the
sandbox when it fails.

## Harness operations

| Operation the skills name | Claude Code | Codex | Added under T3 Code |
|---|---|---|---|
| Subagent on a set model and effort | Agent tool, `model` and `effort` | `spawn_agent` with `model` and `reasoning_effort` (and `fork_turns: "none"`, which overrides require), then `wait_agent` | nothing: subagents stay native on the session's provider |
| Answer a subagent's question and let it continue | `SendMessage` | `followup_task` | — |
| Run another skill (`tdd`, `branch-review`) | Skill tool | read that skill's `SKILL.md` and follow it | — |
| Ask the user | ask tool (`AskUserQuestion`) | no tool waits for the answer outside Plan mode: ask in the reply and end the turn; the answer arrives as the next user message | — |
| Run a long shell command and wait | shell call with `run_in_background`, then end the turn: its notification wakes you | `exec_command`, then `write_stdin` with empty input on the returned session until it exits; one poll lasts at most 5 minutes | Claude: `t3_background_wait` with the task id the shell call returned, before ending the turn |
| Wait for a PR's checks | `gh pr checks <number> --watch`, run as a long shell command | the same | no `gh --watch`: `link_pull_request`, `watch_pull_request`, end the turn; the wake resumes the step that waited: read `gh pr checks <number>`, end the turn again while they run, then `unwatch_pull_request` before going on |

A wait is one background task and its own completion signal: the notification in Claude Code, the command's exit in
the `write_stdin` output in Codex. A `sleep` or `until` polling loop, or a second background task started only to wait on the first, adds nothing
but a turn that ends early.

The `model` and `effort` frontmatter of a skill applies only in Claude Code; Codex reads only a skill's `name`,
`description`, and `metadata.short-description`, so the skill runs on the session model.
