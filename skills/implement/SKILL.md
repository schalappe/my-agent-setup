---
name: implement
description: "Implement a piece of work based on a spec or set of tickets."
disable-model-invocation: true
---

Implement the work described by the user in the spec or tickets.

If the user passes a ticket reference, fetch it from the issue tracker and state its title before starting. If the reference is ambiguous, ask.

Call the Skill tool with "tdd" where possible, at pre-agreed seams.

Run typechecking and single focused test files yourself, regularly. The full test suite and the repo's gates go to a `verifier` once, at the end.

Once done, call the Skill tool with "code-review" to review the work.

Commit your work to the current branch.

Hand off with an acceptance table, one row per criterion: `criterion | revision | command | result counts | status`. Copy the status verbatim from the verifier: `pass`, `blocked`, `bypassed prerequisite`, or `not verified`.

- Synthetic interactions (scripted events, mocks, injected state) are never reported as physical ones.
- Baseline attribution ("not new", "also fails on develop") is `unproven` until reproduced on the base revision.
- A required full run is satisfied only by one passing full invocation, not by pieced-together partial runs.
- List out-of-scope defects found along the way with their tracking status: existing issue, filed, or unfiled.
