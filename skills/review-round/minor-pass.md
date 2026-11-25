# Minor pass

Runs once per loop when `gate.ts` first prints `converged` and `$dir/minor-pass` does not exist (if it exists, go to [hand over](handover.md)). `gate`, `dir`, `wt`, `N`, `p` are set per [SKILL.md](SKILL.md#resolve-context-every-round).

1. Run `bun $gate ready`. Exit 0 → no minors owed: [hand over](handover.md). Exit 1 naming `round-K.json` → read its `minor` list. Check [Land](handover.md#land) step 1's base listing: if any file overlaps, merge base, push, and return to [Loop](SKILL.md#loop).
2. `touch "$dir/minor-pass"`. Dispatch Opus (medium) in `wt` with the PR body, minor findings, and their patch paths to fix or reject each per [Fix](SKILL.md#3-fix) (no commit).
3. Nothing changed → report rejections and [hand over](handover.md). Otherwise `git add -A && git commit -m "chore(review): minor fixes" && git push`, then run one follow-up round skipping base-listing and fixers (even on red/blocked) and stopping after `bun $gate reviewed $N`.
4. Green with 0 critical/major → record it, `bun $gate` prints `converged`: [hand over](handover.md) (new minors go to the human).
5. Otherwise revert all-or-nothing (in order):
   1. Append each critical/major finding to `$dir/decisions.md` as `decision:` (fix in follow-up or accept).
   2. `git revert --no-edit <minor-fixes-commit> && git push`.
   3. Record the round with those findings in `$p/fix.json` under `rejected` (`reason: "decision: minor pass reverted"`).
   4. `bun $gate` prints `converged` (tree restored) → [hand over](handover.md); else print `git status --porcelain` and take [stopped loop](stopped.md#stopped-loop).

Report each minor's outcome (fixed, rejected + reason, or reopened after revert).
