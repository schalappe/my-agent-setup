---
name: retro
description: "Use when the user asks for a retrospective on a coding session or on a repo's recent review-round loops, to find what in the agent's environment (navigation, checks, REVIEW.md, AGENTS.md, tooling) should change."
disable-model-invocation: true
---

The user has asked for a **retrospective**: on one session, or a periodic one over the repo's recent `review-round` loops. You propose improvements to the coding agent's **environment**, then apply only the ones the user approves.

## Steps

1. Call the Skill tool with `writing-for-agents` for the writing style guide.

2. Read the primary sources:
   - **Session logs**, when a session is in scope. This may mean searching session logs on this machine. If the user names no session and asks for no repo retro, default to the current one.
   - **Review-round state**: run `bun ~/.agents/skills/review-round/noise.ts <repo>`, then read the recent `round-*.json`, `stall.json`, and `pre-existing.md` under `$(git rev-parse --git-common-dir)/review/`.
   - **Steering files**: the repo's `AGENTS.md` and `REVIEW.md`.

3. Look for candidates for improvement in these categories.

- **Navigation**: how easy was it for the agent to find the right files? Are there hidden dependencies between files? Would a **navigation pointer** make it easier? _Use when_ the session took a long time to find a piece of information.
- **Automated checks**: are there automated checks that could catch errors the agent made? Linting, typing, tests, filesystem linters? Read the repo's own check command first (its `package.json`/build-tool `lint`/`check` scripts, its CI workflow), so a check that already exists but sits unwired or silently broken is the finding, not a reinvention. A repo with no **guardrail** (no pre-commit hook and no CI job running its lint/typecheck/test command) is itself a finding: an un-linted repo is a standing missed opportunity, not a neutral default. _Use when_ the agent made a mistake an automated check could have caught, or the repo has no guardrail at all.
- **Review rules**: should the **reviewer agent** get a new rule, or lose or clarify one? Classify the violation first: a **mechanical** one (a fixed syntactic pattern, a banned API, an import shape, a file-location rule) gets a deterministic check, full stop: a custom rule in the repo's own linter, a new pre-commit hook, a CI job, or a test, whichever the repo's language and existing guardrail make cheapest. Default to building the check over writing the rule. Reserve `REVIEW.md` for genuine **judgement calls** (cross-file consistency, "matches the surrounding style"), repo-specific definitions of failure, and recurring false positives (the same rejection reason in `noise.ts` across 2 or more loops goes under `## Do not flag`). _Use when_ the reviewer missed a mistake or kept flagging non-issues.
- **Global AGENTS.md**: are there any steering instructions that should move to `REVIEW.md` (or an automated check) instead? _Use when_ the AGENTS.md file is particularly large - in the repo OR the user's global scope.
- **Tool economy**: did the agent make expensive tool calls that could be streamlined? Is there any custom tooling (CLI's, MCP's) that is particularly token-inefficient? _Use when_ the agent made an expensive tool call.
- **No-ops**: prune `AGENTS.md` and `REVIEW.md`. Delete a line when:
  1. the path or symbol it names no longer exists in the repo;
  2. a linter, CI job, or `gate.ts` `REVIEW_TASK` already enforces it;
  3. it is now expressible as a mechanical check (build the check, then delete the prose);
  4. it duplicates another line, changes no behavior, or keeps `REVIEW.md` over its ~60-line cap.

  _Use when_ the steering files are large, or on every periodic retro.
- **Information access**: look for opportunities to increase the agent's access to information. Teeing dev server logs, readonly access to third-party services. _Use when_ a crucial piece of information was not available to the agent.

4. Prove each proposed new check by running it against a real past mistake from the session, a review round, or git history: it must fail there. Drop a check you cannot prove.

5. **Propose.** Present numbered candidates in severity order. For each, name the target (`AGENTS.md`, `REVIEW.md`, or a mechanical check), say whether it is an add, a promotion (prose to check), or a prune, and cite its evidence. Change nothing yet.

6. **Apply on approval.** Apply only the candidates the user approves (by number, or all). Keep `REVIEW.md` in the format below and within its cap; keep `AGENTS.md` within the `agents-md` rules.

## Reference

### Implementation vs Review

Remember that all work goes through two stages: implementation and review. The implementation agent has the most **context pressure**. They are responsible for exploration, writing code, and debugging failures.

The review agent has the least context pressure - it receives a diff, so no exploration needed. It often does not need to write code or debug.

This means that the review agent should be responsible for imposing review rules, not the implementation agent.

### Files

You have access to several files in the repo:

- `CLAUDE.md`/`AGENTS.md`: these files are pushed to the context window of any agent working in this repo. They should be used incredibly sparingly, usually only for **navigation pointers** to other files.
- `REVIEW.md` (repo root): read during review, not implementation. It holds only rules grounded in a real incident, a reviewer miss, or a repeated rejection. Cap it at ~60 lines. Use any of these four sections, in this order:

  ```markdown
  ## What failure looks like
  <repo-specific definitions of a real defect>
  ## Always check
  <judgement calls the reviewer must make on every diff>
  ## Do not flag
  <recurring false positives, each with the reason>
  ## Skip paths
  <generated or vendored paths the reviewer ignores>
  ```
- Docs: use docs as references files, pointed to by other files. Look for existing docs before writing new ones.
- Skills: use skills for docs (since their description goes into the agent's context window), or for user-invoked commands. Follow the advice in the `writing-for-agents` skill.
