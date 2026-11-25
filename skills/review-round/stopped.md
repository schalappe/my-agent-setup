# Stalled or capped loop

Entered from [Loop](SKILL.md#loop) on `stalled` or after `M` rounds (`gate`, `dir`, `wt`, `N`, `p` per [SKILL.md](SKILL.md#resolve-context-every-round)).

## Class fix

A hotspot means earlier fixes patched symptoms of one unstated rule. Dispatch Opus (high) in `wt` with the PR body and every critical/major finding recorded on the hotspot file (from `round-N.json`). It states the shared invariant in one sentence, enforces it once where all paths pass, and deletes the case-by-case patches. If the invariant needs a schema/contract/product change (`decision:`) or no shared invariant exists (code unchanged), take [Stopped loop](#stopped-loop). Otherwise commit `fix(review): <file> class fix`, push, `bun $gate resume`, and run the next round.

## Stopped loop

1. **Closing verification** (skip if latest `verify-N.json` is already green on current `tree`): resolve `N`, `p`, `tree` (ignoring `$dir/status`), then run only `prepare`, `brief` (with carries), the verifier, and `bun $gate verify`—no base merge, no fixer on red, no review, no record. Print `last fix <commit>: verified <outcome>, not reviewed`. If the outcome is red or blocked (excluding proven base failures), stop immediately and proceed to step 2—never fix forward or start another closing verification round.
2. Print [decisions](SKILL.md#decisions), then ask the user once (whatever the `End`) with applicable options:
   - **Resume for K more rounds**: `bun $gate resume` if stalled, set `M = K`, continue. Recommend when a repeat judgment is weak or spans different functions.
   - **Merge with known limits** *(only when closing verification is green)*: add a `Known limits` section to the PR body (open majors + unreviewed fix + drafted redesign issue via `agent-ready-issue`), run `gh pr ready <number>`, and enter [hand over](handover.md) at step 2 with step 4 answered (Merge for `ask`/`send`; ready-to-merge for `stop`). State that this accepts every printed decision's default. Recommend when a hotspot stalls again after its class fix or `diverging:` fires after a resume.
   - **Stop**: leave PR and worktree as-is. Recommend when `bloat:` fires so the PR can be split into stacked PRs.
