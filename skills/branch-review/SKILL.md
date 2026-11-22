---
name: branch-review
description: "Use when the user wants a review of a branch, a PR, work-in-progress changes, or everything since a fixed point (\"review since X\")."
---

Three-axis review of the diff between `HEAD` and a fixed point the user supplies:

- **Standards**: does the code conform to this repo's documented coding standards?
- **Spec**: does the code faithfully implement the originating issue / spec?
- **Correctness**: does the changed code behave right for every caller, every state, and every failure path?

The axes run as **parallel sub-agents** so they don't pollute each other's context, then this skill aggregates their findings. Each sub-agent is a headless peer process (`bun ~/.agents/skills/review-round/peer.ts`), never an in-session subagent: it runs on GPT-6.2 Sol through `codex exec`, never on Claude Opus 5.5, which writes the code ([model roles](../review-round/harness.md#model-roles)), so it does not share the writer's blind spots. It runs in Claude Code, in Codex, or under T3 Code (Claude, Codex, or Gemini).

The issue tracker should have been provided to you. If not, tell the user to run `/setup-repo`.

## Process

### 1. Pin the fixed point

Whatever the user said is the fixed point (a commit SHA, branch name, tag, `main`, `HEAD~5`, etc.). If they didn't specify one, ask for it.

Capture the diff command once: `git diff <fixed-point>...HEAD` (three-dot, so the comparison is against the merge-base). Also note the list of commits via `git log <fixed-point>..HEAD --oneline`.

Before going further, confirm the fixed point resolves (`git rev-parse <fixed-point>`), the diff is non-empty, and `bun ~/.agents/skills/review-round/peer.ts --check` passes (one short real run of the peer: it prints the engine and model, or what failed). A bad ref, an empty diff, or a missing reviewer should fail here, not inside three parallel sub-agents.

Exclude generated files from the text diff: anything `git check-attr linguist-generated diff` marks generated or `-diff`, plus obviously generated API clients and specs. Append `':(exclude)<path>'` pathspecs to the diff command and list the excluded paths separately; reviewers check them with targeted queries (`git diff --stat`, `git grep` for a specific symbol) instead of reading them.

Collect every gate result for the reviewed revision, failures included, and the gate evidence record if the repo writes one. A required gate that is missing or failing blocks a "correct" or "complete" verdict on any axis.

### 2. Identify the spec source

Look for the originating spec, in this order:

1. Issue references in the commit messages (`#123`, `Closes #45`, GitLab `!67`, etc.), fetched via the workflow in the tracker doc.
2. A path the user passed as an argument.
3. A spec file under `docs/`, `specs/`, or `.scratch/` matching the branch name or feature.
4. If nothing is found, ask the user where the spec is. If they say there isn't one, the **Spec** sub-agent will skip and report "no spec available".

### 3. Identify the standards sources

Search the repo for every file that documents how code should be written. When `CODING_STANDARDS.md` or `CONTRIBUTING.md` exists, it must be on the list.

On top of whatever the repo documents, the Standards axis always carries the **smell baseline**: a fixed set of Fowler code smells (_Refactoring_, ch.3) that applies even when a repo documents nothing. Two rules bind it:

- **The repo overrides.** A documented repo standard always wins; where it endorses something the baseline would flag, suppress the smell.
- **Always a judgement call.** Each smell is a labelled heuristic ("possible Feature Envy"), never a hard violation. Like any standard here, skip anything tooling already enforces.

The smells themselves are in [smells.md](smells.md); step 4 hands that file to the Standards reviewer.

### 4. Spawn the three sub-agents in parallel

Write each prompt to a file in a fresh directory outside the repo (`d=$(mktemp -d)`; `standards.prompt`, `spec.prompt`, `correctness.prompt`), with the spec saved beside them when it came from the tracker. Prompts carry paths, never your conversation. Run the three together, from the repository root, as one long shell command, and wait for it the way [harness.md](../review-round/harness.md#harness-operations) says (Correctness runs tests and can outlast a foreground call):

```bash
for axis in standards spec correctness; do
  bun ~/.agents/skills/review-round/peer.ts --access shell --add-dir "$d" --trace "$d/$axis.jsonl" \
    < "$d/$axis.prompt" 2> "$d/$axis.log" > "$d/$axis.json" &
done
wait
```

Each report is `jq -r .result "$d/<axis>.json"`. `--add-dir "$d"` lets the reviewers read the spec and gate files there: their file tools are confined to the repository otherwise. A shell is allowed (`--access shell`) because every axis reads the diff with `git`, and Correctness also runs tests in a throwaway worktree. A report that is missing, has `.is_error` true, or has `.tool_calls` at 0 (an axis that answered without reading anything looks exactly like a clean review): rerun that axis once, then report it as failed with the tail of its log. Print each axis's `.tool_calls` and `.opened` (the files it read whole) beside its report, so the reader sees what it read. Never write an axis's report yourself.

Each brief ends with: "Report a finding only after reproducing it (command and output) or citing the code that proves it (file, line, quoted lines)."

**Standards sub-agent prompt** should include:

- The full diff command, commit list, excluded generated paths, and gate results (with the evidence record path if any).
- The list of standards-source files you found in step 3, **plus the smell baseline**: build the prompt file by appending `~/.agents/skills/branch-review/smells.md` (`cat ~/.agents/skills/branch-review/smells.md >> "$d/standards.prompt"`), since the sub-agent has no other access to it.
- The brief: "Report, per file/hunk where relevant, (a) every place the diff violates a documented standard: cite the standard (file + the rule); and (b) any baseline smell you spot: name it and quote the hunk. Distinguish hard violations from judgement calls: documented-standard breaches can be hard, but baseline smells are always judgement calls, and a documented repo standard overrides the baseline. Skip anything tooling enforces. Keep each finding to a few lines; report every finding."

**Spec sub-agent prompt** should include:

- The diff command, commit list, excluded generated paths, and gate results (with the evidence record path if any).
- The path or fetched contents of the spec.
- The brief: "Report: (a) requirements the spec asked for that are missing or partial; (b) behaviour in the diff that wasn't asked for (scope creep); (c) requirements that look implemented but where the implementation looks wrong. Quote the spec line for each finding. Keep each finding to a few lines; report every finding."

**Correctness sub-agent prompt** should include:

- The diff command, commit list, excluded generated paths, and gate results (with the evidence record path if any).
- The path or fetched contents of the spec, when there is one, so intended behaviour is not reported as a bug.
- The brief: "Hunt for behaviour the diff gets wrong. For every changed or removed symbol, find its callers outside the diff (`git grep`) and check each still works. For every changed read or screen, check each state it can reach: loading, empty, error, refused by a business rule, forbidden. For every write, check the failure paths: validation refusal, partial success, retry, concurrent change. For each condition the diff adds, invert it in a throwaway worktree of `HEAD` (never the shared checkout, other reviewers read it), run the focused tests there, then remove the worktree; a mutation that stays green names a missing test. For a dependency bump, check that the changelog was read, each package changes on its own, and the lockfile diff holds only the intended changes. Report each defect with the file and line, the input or state that triggers it, and the wrong result. Zero findings is a valid result. Keep each finding to a few lines; report every finding."

If the spec is missing, skip the Spec sub-agent and note this in the final report. The Correctness sub-agent always runs.

### 5. Aggregate

Present the three reports under `## Standards`, `## Spec`, and `## Correctness` headings, verbatim or lightly cleaned. Do **not** merge or rerank findings, because the axes are deliberately separate (see _Why three axes_).

End with a one-line summary: total findings per axis, the worst issue _within each axis_ (if any), and any missing or failing required gate. Don't pick a single winner across axes: that's the reranking the separation exists to prevent.

## Why three axes

A change can pass one axis and fail another:

- Code that follows every standard but implements the wrong thing → **Standards pass, Spec fail.**
- Code that does exactly what the issue asked but breaks the project's conventions → **Spec pass, Standards fail.**
- Code that follows the conventions and matches the spec but breaks an untouched caller, or forgets the error state of a screen → **Standards and Spec pass, Correctness fail.**

Reporting them separately stops one axis from masking another.
