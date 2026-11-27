---
name: branch-review
description: "Use when the user wants a review of a branch, a PR, work-in-progress changes, or everything since a fixed point (\"review since X\")."
---

Three-axis review of `git diff <fixed-point>...HEAD` through parallel GPT-6.2 Astra peers ([model roles](../review-round/harness.md#model-roles)):

- **Standards**: conformance to documented repo standards + Fowler smell baseline ([smells.md](smells.md)).
- **Spec**: faithful implementation of the originating issue/spec (missing requirements, scope creep, wrong behavior).
- **Correctness**: callers, states, failure paths, mutation check in a throwaway worktree.

If no issue tracker is configured, tell the user to run `/setup-repo`.

## Process

### 1. Pin the fixed point

Use the fixed point the user gave (SHA, branch, tag, `main`, `HEAD~5`); ask if omitted. Verify `git rev-parse <fixed-point>`, non-empty diff, and the GPT-6.2 Astra peer route (`orchestrator_capabilities` under T3; `bun ~/.agents/skills/review-round/peer.ts --check` outside T3).

Build one diff command (`git diff <fixed-point>...HEAD`) excluding generated files (`git check-attr linguist-generated diff`, generated clients/specs) via `':(exclude)<path>'` and record the excluded list + `git log <fixed-point>..HEAD --oneline`. Collect gate results and evidence paths; any missing or failing required gate blocks a clean verdict.

### 2. Identify spec and standards sources

- **Spec** (first match): issue refs in commit messages → user-given path → matching file under `docs/`, `specs/`, or `.scratch/` → ask user (if none, skip the Spec axis).
- **Standards**: every repo file documenting coding standards (`CODING_STANDARDS.md`, `CONTRIBUTING.md`, `REVIEW.md`, etc.) plus [smells.md](smells.md). Documented repo standards always override baseline smells; baseline smells are labelled judgement calls, never hard violations; skip anything tooling enforces.

### 3. Spawn the axes in parallel

Write `standards.prompt`, `spec.prompt`, and `correctness.prompt` in `d=$(mktemp -d)` (save fetched spec beside them). Every prompt includes: diff command, commit list, excluded generated paths, gate results/evidence, and the ending rule: *"Report a finding only after reproducing it (command + output) or citing code (file, line, quoted lines). Keep each finding to a few lines; report every finding."*

- **Standards**: append `~/.agents/skills/branch-review/smells.md` + standards-file list. Ask for (a) documented-standard breaches citing file + rule, and (b) baseline smells quoting the hunk (repo overrides baseline; skip tool-enforced checks).
- **Spec**: spec path/contents. Ask for missing/partial requirements, scope creep, and wrong implementations, quoting the spec line.
- **Correctness**: spec path/contents (when present). Ask to check callers outside the diff (`git grep`), UI/read states (loading, empty, error, refused, forbidden), write failure paths (validation, partial success, retry, concurrency), dependency-bump changelogs/lockfiles, and condition-inversion mutations in a throwaway worktree of `HEAD` (removing it after). Zero findings is valid.

Dispatch in parallel ([harness.md](../review-round/harness.md#harness-operations)):
- **Under T3 Code**: `delegate_task` (`codex`, `gpt-6.2-astra`, `reasoningEffort: "high"`, `mode: "async"`) per axis, reading `$d/<axis>.prompt` from repo root without editing tracked files. If an axis fails or `t3_thread_read(view: "activity")` shows 0 tool calls, rerun once then report failed.
- **Outside T3 Code**:
  ```bash
  for axis in standards spec correctness; do
    bun ~/.agents/skills/review-round/peer.ts --access shell --add-dir "$d" --trace "$d/$axis.jsonl" \
      < "$d/$axis.prompt" 2> "$d/$axis.log" > "$d/$axis.json" &
  done
  wait
  ```
  Read `jq -r .result "$d/<axis>.json"` and print `.tool_calls` + `.opened`. Rerun once if missing, `.is_error`, or `.tool_calls == 0`, then report failed. Never write an axis's report yourself.

### 4. Aggregate

Present each report verbatim (or lightly cleaned) under `## Standards`, `## Spec`, and `## Correctness`—never merge or rerank across axes so one passing axis never masks another failing one. End with a one-line summary: counts per axis, worst issue within each axis, and any missing/failing gate.
