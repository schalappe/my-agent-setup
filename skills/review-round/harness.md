# Model roles and harness operations

Shared routing for `review-round`, `branch-review`, `implement`, and `scout` across Claude Code, Codex, and T3 Code (Claude, Codex, Gemini).

## Model roles

Roles are fixed regardless of harness or who wrote the code (human included). Set every non-orchestrator model explicitly at the call—never rely on the session default or skill frontmatter (frontmatter `model`/`effort` applies only in Claude Code).

| Role | Model | Route |
|---|---|---|
| Implementers, fixers, mergers | Claude Opus 5.5 | Opus subagent (table below); orchestration never edits code directly |
| Plan critique, review, verification | GPT-6.2 Sol (`reasoningEffort: "high"`) | Under T3 Code: `delegate_task` (`providerInstanceId: "codex"`, `model: "gpt-6.2-sol"`, `mode: "async"`, follow `next`). Outside T3: `bun ~/.agents/skills/review-round/peer.ts` |
| Same-defect judgment | GPT-6.2 Sol | Headless `peer.ts` invoked by `gate.ts` (cached in `same-defect.json`) |
| Verdicts (`green`, `converged`, `stalled`, `ready`) | Deterministic | `gate.ts` over recorded files |

- Call `orchestrator_capabilities` once per T3 thread before the first `delegate_task`. `trace.ts` parses both `t3_thread_read(view: "activity")` dumps and `peer.ts` JSONL traces.
- **Plan critique**: write the plan/spec/tickets to a file and dispatch a read-only GPT-6.2 Sol peer asking for gaps, risks, and wrong assumptions (outside T3: `bun ~/.agents/skills/review-round/peer.ts --access read --trace <dir>/critique.jsonl < <plan>`). Resolve every objection before implementing.

## Codex and Antigravity sandbox

A Codex or Antigravity thread running these skills needs full access: workspace sandboxes ("auto", "auto-accept-edits") cut network and block nested sandboxes, stopping `codex exec`. `peer.ts --check` catches this at preflight.

## Codex `cyber_policy` refusal

Long `gpt-6.2-sol` runs can terminate mid-turn with `codex_error_info: "cyber_policy"`, leaving `verify-N.json` unwritten. The classifier scores accumulated context, typically after offensive-looking probes (oversized/DoS payloads, anonymous floods, auth/CORS/upload bypass scripts).

1. **Inspect first**: check `$p/exec/*.json` and `ps`. Detached `gate.ts exec` processes survive the abort—wait for them instead of killing or duplicating them.
2. **Slim the retry**: move abuse/exploit probes into committed tests run through `gate.ts exec`, and list already-passing `$p/exec/*.json` records in the retry brief.
3. **Frame the prompt**: dispatch a fresh `gpt-6.2-sol` verifier framed as authorized verification of our own app on a local disposable test stack. If it hits `cyber_policy` again, stop and report to the user (roles stay fixed).

## Harness operations

| Operation | Claude Code | Codex / Gemini under T3 Code | Codex outside T3 Code |
|---|---|---|---|
| Opus subagent (at set effort) | `Agent` tool (`model: "opus"`, `effort`) | `delegate_task` (`claude`, `claude-opus-5-5`, `effort` in `target.options`); follow `next` | Unsupported: stop at preflight |
| GPT-6.2 Sol peer | Under T3: `delegate_task` (`codex`, `gpt-6.2-sol`, `reasoningEffort: "high"`, `mode: "async"`). Outside T3: `peer.ts` | `delegate_task` (`codex`, `gpt-6.2-sol`, `reasoningEffort: "high"`, `mode: "async"`); follow `next` | `bun ~/.agents/skills/review-round/peer.ts` |
| Resume a subagent | `SendMessage` | Follow delegate's `next` | — |
| Run another skill | `Skill` tool | Read that skill's `SKILL.md` and follow it | Same |
| Ask the user | `AskUserQuestion` | Ask in reply and end turn | Same |
| Long shell wait | `run_in_background`, end turn (under T3, follow with `t3_background_wait` once task id returns, then end turn) | `exec_command`, then `write_stdin` (empty, ≤ 5 min polls) until exit | Same |
| Wait for PR checks | `gh pr checks <N> --watch` (under T3: use next column) | `link_pull_request`, `watch_pull_request`, end turn; on wake check `gh pr checks <N>`, end turn while running, `unwatch_pull_request` when done | `gh pr checks <N> --watch` |
| Squash-merge PR | `gh pr merge <N> --squash --match-head-commit "$head"` (`--delete-branch` if `wt` removed, else `git push origin --delete <branch>`) (under T3: use next column) | `pull_request_merge` with `method: "squash"` and `expectedHeadSha: "$head"` (always set `method: "squash"`, including for stacked PRs; delete remote branch if still present) | `gh pr merge <N> --squash --match-head-commit "$head"` (`--delete-branch` if `wt` removed, else `git push origin --delete <branch>`) |

Use one background wait and its own completion signal—never a `sleep`/`until` polling loop or a second watcher task.
