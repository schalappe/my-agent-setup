# Stalled or capped loop

Reached from the [loop](SKILL.md#loop) when the gate prints `stalled`, or after `M` rounds without exit 0. `gate`, `dir`, `wt`, `N`, and `p` are set as in [SKILL.md](SKILL.md#resolve-context-every-round).

## Class fix

A hotspot means the fixes patched symptoms: each round found another case of one rule the code never states. Dispatch one Opus subagent (high) with the absolute path of `wt`, the PR body, and every critical and major finding the rounds recorded on the hotspot file (from their `round-N.json`). It names, in one sentence, the invariant those findings share, enforces it once where every path passes, and deletes the case-by-case code the earlier fixes added. An invariant that needs a schema, contract, or product change is rejected with `decision:` ([Fix](SKILL.md#3-fix)), and findings that share no invariant leave the code unchanged: either way take the [stopped loop](#stopped-loop). Otherwise commit `fix(review): <file> class fix`, push, `bun $gate resume`, and run the next round.

## Stopped loop

A stalled or capped loop ends on a fix that no verification covered, since every round ends with its fix. Close that gap before asking:

1. Closing verification, unless the latest round's `verify-N.json` is green on the current `tree` (the fixer changed nothing): set `N`, `p`, and `tree` as [Resolve context](SKILL.md#resolve-context-every-round) does, skipping its `status` line (the status names this very code, and following it leads back here), then run only `prepare`, the brief with its carries, the verifier, and `bun $gate verify`: no base merge, no fixer on red, no review, no record. Print `last fix <commit>: verified <outcome>, not reviewed`. A later round on the same code reuses that `verify-N.json`.
2. Print the [decisions](SKILL.md#decisions) first, so the question is answered with them in view. Then ask the user once (ask tool), whatever the End, with the options that apply:
   - Resume for K more rounds → `bun $gate resume` when stalled, set `M` to K, and run the next round. Recommend it when the judge's reason for a pair is weak (it hinges on wording rather than one code path), or when the two findings of a pair sit in different functions: the reviewer may be re-reading a fix that worked.
   - Merge with known limits, offered only when that verification is green → add a `Known limits` section to the PR body that names each open major and the fix that was verified and not reviewed, draft one redesign issue with the `agent-ready-issue` skill and link it there, then `gh pr ready <number>` and [hand over](handover.md) from its step 2, where this choice answers step 4: Merge for `ask` and `send`, and for `stop` the PR is landed up to ready to merge, as `stop` always means. Choosing it accepts the default of every decision just printed; the option says so. Recommend it when a hotspot stalls the loop again after its class fix: more rounds there change nothing.
   - Stop → the loop stops and the PR stays as it is.
