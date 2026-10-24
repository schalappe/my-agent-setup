---
name: explain
description: Explain how code works or why it is shaped the way it is, with cited evidence.
disable-model-invocation: true
---

# Explain

Pick the mode from the question. **How** covers runtime behaviour, flow, and where things live. **Why** covers motivation, tradeoffs, and history. If the target is vague, state your reading in one line and proceed.

Read `GLOSSARY.md` and the ADRs for the area first; explain in their vocabulary and plain words.

## How

Read the code yourself. Only for a cross-cutting subsystem (several services, packages, or layers), spawn 2-3 read-only explorer subagents in one message, each with a distinct angle (entry points and flow, data and state, integration and failure paths), then reconcile their findings against the code and write one answer.

Write for an engineer new to the area; drop empty sections:

- **Overview**: 1-2 paragraphs, what it is and why it exists.
- **Key concepts**: the types and abstractions needed to follow the rest.
- **How it works**: the longest section. Trigger, steps, data movement, decision points, in prose with file paths and function names. Add a mermaid or ASCII diagram only when it clarifies a multi-component flow.
- **Where things live**: the files someone needs to start working here.
- **Gotchas**: surprising behaviour, pitfalls, history.

## Why

1. **Anchor in the code.** File and line range, key symbols. `git blame -L <start>,<end> <file>`, `git log --follow --oneline -- <file>`, `git log -S '<literal>'` for when a value appeared, PR numbers from commit subjects, then `gh pr view <n> --json title,body,comments,reviews,closingIssuesReferences`. Trace back past the latest commit: the current shape accretes from older decisions.
2. **Follow linked tickets** in the tracker named by the repo's `docs/agents/issue-tracker.md`: GitHub by default, a second tracker such as YouTrack only when that file declares it. Check ADRs, comments, and tests near the target too.
3. **Answer with the evidence tiered:**
   - **Found**: someone wrote the reason down. Cite it (PR, ticket, commit, ADR, `file:line`).
   - **Inferred**: indirect evidence converges. Hedge it and show the chain ("given A and B, C is likely").
   - **Competing hypotheses**: when several stories fit, list each with evidence for and against; leave the winner open.
   - **Unknown**: name what you searched and with which terms. "Searched X, Y, and Z and found nothing" is a valid, useful answer.

   Code is evidence of what it does, never of its own intent. A hypothesis embedded in the question is one candidate to test, not a conclusion to confirm. When sources contradict, show both.
4. **If the question precedes a change**, end with **Preserve / Change / Avoid / Risk**: what must survive, what is free to change, what history warns against, what could break.
