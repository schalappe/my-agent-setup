---
name: scout
description: "Use before implementing a ticket, to find what it really needs, ensure system fit across open tickets, settle its open decisions with the user, and rewrite it as ready for an unattended agent or retire it."
disable-model-invocation: true
---

# Scout

A ticket states a local target. It rarely states the **fog of war** (what the implementer must know to reach it) or its **system fit** (how it interacts with the rest of the codebase and other open tickets). Examples are callers that must change together, tests that pin today's behavior, a governing text, another open ticket rewriting the same code or deleting the same feature, or a rule already decided globally. An implementer who discovers these facts mid-way loses a day or ships incompatible code. Scout finds them before implementation starts and changes no code. It ends with coherent, self-contained tickets an unattended agent can finish without new scope, or with the ticket retired.

Scout is the only path to `ready-for-agent`. It takes any open ticket, whatever its label, including one already marked `ready-for-agent`. `triage` sends its real tickets here.

## Preflight

Read the repo's `docs/agents/issue-tracker.md` and `docs/agents/triage-labels.md` first. They win over this skill. If either doc is missing, tell the user to run `/setup-repo`.

The cold read (step 4) runs on GPT-6.2 Astra. Check its route before step 1: `orchestrator_capabilities` under T3 Code (`codex` / `gpt-6.2-astra`), `bun ~/.agents/skills/review-round/peer.ts --check` elsewhere. If neither route works, stop and tell the user; never fall back to another model.

## Outcomes

| Outcome | Meaning | Tracker action |
|---|---|---|
| ready | The fog checklist is answered, the cold read is clean, and no decision is open | rewrite the body (and title if scope changed), label `ready-for-agent` |
| split | More than one outcome, or more than one agent session of work | rewrite as parent, file child tickets, each scouted to ready |
| blocked | Ready, but another ticket must land first | rewrite, wire the native blocking edge, label `ready-for-agent` |
| needs-info | A decision only the reporter or the business can make | post the open questions, label `needs-info` |
| fixed | Already implemented, here or elsewhere | comment with the evidence, close |
| duplicate | Another ticket covers it | merge its unique facts into the survivor, close as duplicate |
| wontfix | Contradicts the governing rules, or out of the product's scope | comment with the citation, label `wontfix`, close |

When the fog is too thick for one ticket (the destination itself is undecided), say so and point to `/wayfinder`.

## Steps

1. **Read.** Read the whole ticket (body, comments, labels, dates) and every linked ticket on every tracker. Treat earlier scout or triage notes as established. If the ticket carries `ready-for-agent`, swap that label for `needs-triage` now and tell the user, so no agent picks it up during scouting. This is the only tracker change before step 6. Record the base commit (`git rev-parse --short origin/<default branch>`) and create a temp dir (`d=$(mktemp -d)`) to record `updatedAt` timestamps on GitHub: `bun ~/.agents/skills/scout/check-coherence.ts <owner/repo> <issue>... --record "$d/snapshot.json"`. If a target was edited minutes ago or looks actively scouted in another session, flag it to the user before duplicating work.

2. **Map the fog and system fit.** Work through the [fog checklist](#fog-checklist) against the code, the domain docs, the trackers, and primary sources (local copies first, then the web). Use the shared-surface list from `check-coherence.ts` to inspect every open `ready-for-agent` ticket touching the same code, tests, tables, permissions, or contracts—across all epics and milestones, not just siblings. When you scout several tickets, give each ticket, or each group of tickets with one root cause, to a read-only subagent. Brief it with the ticket, the base commit, the docs that govern the area, the checklist, and the evidence labels. Re-check yourself every claim that changes an outcome (fixed, duplicate, conflict, wontfix) before keeping it. Done when every checklist item has an answer with its evidence label, or `n/a` with the reason.

3. **Settle decisions.** For each open decision, find what the governing docs, ADRs, primary texts, and prior global decisions say. Then ask the user with the ask tool. Give one decision per question, the options, your recommendation with its citation, and one concrete example, in the words the UI or glossary uses. Explain the stakes in plain terms first, because a decision the user cannot follow is not settled. A decision only the reporter or the business can make becomes a needs-info question. Done when no decision that changes the implementation is open, or each remaining one is a needs-info question.

4. **Cold read.** Draft each body ([Ticket body](#ticket-body)) to `$d/draft-<n>.md` and run `bun ~/.agents/skills/scout/check-coherence.ts <owner/repo> <issue>... --draft <n>:$d/draft-<n>.md` to catch unwired prose blockers, non-self-contained back-references, and unreviewed shared surfaces before dispatching Astra. Write the draft with the brief below to `$d/cold-read-N.prompt`. Dispatch a fresh read-only GPT-6.2 Astra peer on it ([model roles](../review-round/harness.md#model-roles)): under T3 Code, `delegate_task` (`codex`, `gpt-6.2-astra`, `reasoningEffort: "high"`, `mode: "async"`, follow `next`) told to read that file and work read-only in the repo; elsewhere, `cd <repo> && bun ~/.agents/skills/review-round/peer.ts --access read --trace "$d/cold-read-N.jsonl" < "$d/cold-read-N.prompt"`. A different model family reads the draft, so it does not share the drafter's blind spots. The peer gets the draft and the repo only: none of your notes, none of this conversation. Brief: play the implementer and list every question you would have to ask before finishing, every contradiction you meet, and every acceptance criterion you cannot test. If a cold read fails or makes 0 tool calls (`t3_thread_read(view: "activity")` under T3 Code; `is_error` or `tool_calls == 0` from `peer.ts`), rerun once with a fresh Astra peer, then stop and tell the user—never treat a failed or zero-tool-call run as clean. Answer each item in the draft from evidence, or settle it as a decision (step 3). Cold-read a changed draft once more with a fresh Astra peer; what the second read still raises goes to the user as decisions.

   **Cross-ticket pass.** When scouting multiple tickets, or when a ticket shares a surface with other open `ready-for-agent` tickets, run one combined read-only Astra pass over the set of drafts, their proposed `blocked_by` graph, and any overlapping open `ready-for-agent` ticket bodies. Brief: find contradicting contracts, broken intermediate states (a ticket whose tests fail until a later ticket lands), missing `blocked_by` edges, duplicated rules, and ownerless hand-offs. Resolve every finding before step 5. Done when both the ticket cold reads and any cross-ticket pass raise nothing that changes the implementation.

5. **Show the plan.** Give the outcome with its evidence, the rewritten body (and title if changed), the landing order and `blocked_by` edges, and every tracker action you will take: labels, closures, new tickets, parent updates, edits or invalidations of linked/overlapping tickets, and comments. Wait for the user's go; apply their corrections.

6. **Act**, in this order, so a crash never leaves a ticket marked ready with a stale body:
   1. **Concurrent-edit guard.** On GitHub, run `bun ~/.agents/skills/scout/check-coherence.ts <owner/repo> <issue>... --check-snapshot "$d/snapshot.json"`. If any ticket to edit changed since step 1, stop on it, compare with the live version, and ask the user which decision wins instead of overwriting.
   2. **Body is the sole contract.** Rewrite each body ([Ticket body](#ticket-body)) and update its **title** whenever scope or outcome changed. Put every scope boundary, ordering rule, and contract detail in the body—never leave coordination rules ("whichever lands second removes X") only in a comment. On a tracker the repo doc declares as the business or reporter tracker, keep the reporter's text and post the result as a comment in that tracker's language instead.
   3. File new tickets, edit linked/overlapping tickets and **parent summaries** (states, order, decisions), wire native `blocked_by` edges (per `docs/agents/issue-tracker.md`), and close duplicates and retired tickets.
   4. Set the outcome's label last.
   5. Comment on every tracker involved: the outcome, what changed in the ticket, the decisions taken with who took them, and (when step 4 ran) that GPT-6.2 Astra cold-read this version at the base commit.

Done when every tracker involved shows the outcome, the updated title/parent/blocking edges, the label or state, and the comment.

A second run starts from the existing **Scout map**: it re-checks the areas that changed since its base commit and keeps the rest.

## Fog checklist

Answer each item for the ticket at hand. Search by domain concept (`GLOSSARY.md` terms) **and by touched surface** (files, methods, tables, permissions, routes, error codes, guard tests).

- **Relevance.** Is it already implemented, in code, a merged PR, or a closed ticket? Does any open ticket—across all parents and milestones—duplicate, overlap, contradict, delete a premise of, or block it? Is the feature or configuration in the product's scope at all?
- **Rules.** What do the domain docs, ADRs, and governing texts (regulation, accounting standards, contracts) require here? Does the ticket comply? Cite section and source.
- **System fit.** Keep the application coherent over time rather than only hitting the ticket's local target:
  - *One operation, one rule:* if the same check, contract, or error shape appears in multiple tickets, one ticket exposes the shared operation and the others call it. Follow system-wide decisions instead of inventing local exceptions.
  - *Delete before patching:* if another open ticket (or first principles) removes the mechanism this ticket patches, drop the dead scope instead of building code and tests that will be deleted next.
  - *Green intermediate states:* every ticket in a sequence must pass its own tests on its own (e.g. an explicit temporary allowlist in ticket 1 that following tickets drain to empty).
- **Reach.** Every entry point that triggers the behavior (API, jobs, UI, batch, other services) and every reader and writer of the data it touches. Which must change together?
- **Data.** What the change needs, whether it exists today, whether a migration is required, and what happens to existing records.
- **Expected values.** Compute every number the acceptance criteria need, and show the arithmetic. Cover the edges the domain has (precisions, calendars, empty, error, permission states).
- **Hostile states.** For each behavior the ticket adds or changes, state what must happen when it fails halfway, runs twice, races another actor (a second user, a job, the same user acting during a wait), is interrupted (a closed tab, a killed process), or meets existing records that break the new rule. Check the sibling actions on the same object too (reject and delete beside approve). Each case gets an expected behavior in the body, or becomes a decision.
- **Consistency.** Read the criteria against each other, each example against its rule, and the ticket against the repo's conventions (`AGENTS.md`, UI rules) and **all overlapping open tickets** (not only siblings), their expected values included. Read a blocked ticket against the code as its blockers will leave it, not as it stands today.
  - *Shared-surface ordering:* two open tickets rewriting the same method, table, error contract, or guard test must be ordered with a native `blocked_by` edge.
  - *Two-sided hand-offs:* for every item deferred to `#X` in `Out of scope`, read `#X`'s body and verify it explicitly owns that case. If not, absorb it here, update `#X`, or file a new `needs-triage` ticket—leave nothing ownerless.
  - *Self-contained body:* write every rule in full in this ticket's body; never delegate it via "same as `#X`".
  - *Invalidated ready tickets:* if this ticket changes or breaks a premise of an already-`ready-for-agent` ticket, update that ticket in the same plan (and cold-read it if its contract changed) or swap it back to `needs-triage` with the reason.
- **Feasibility.** A criterion that depends on something the repo does not control (a model, a browser, a platform, an upstream library, an external service) needs **live** evidence that it can pass, or a decision on the fallback when it does not.
- **Authorizations.** What the run will need that only the user grants: a migration that deletes data and its override label, a reset of a shared local stack, a deploy or any change outside the repo, a final verification longer than an hour. Settle each as a decision, so the run never stops to ask for it.
- **Root cause** (bugs). Pinned with evidence, or ranked hypotheses with the evidence for each and the cheapest way to tell them apart.
- **Tests.** Which existing tests pin today's behavior and will break or contradict the ticket; which new tests are needed, at which seam; which harness runs them, on what infrastructure, in how much wall-clock time. When acceptance is expensive, find a cheaper faithful check.
- **Docs.** Which docs, ADRs, and examples must change with the code.
- **Size.** List the files, migrations, tests, and gates the work touches, and rate it against one agent session of work: L fills the session, M about half of it, S about a quarter, XS a few lines in one file. `/implement` budgets a run from these sizes, so a rating that is too low overloads the run's single review. If it holds more than one outcome or more than one session of work, rate it XL and propose a split into tracer-bullet tickets: `/implement` sends an XL ticket back here instead of planning it.

Evidence labels, one per claim: **static** (read in code or docs), **mocked** (test with doubles), **live** (observed on a running system), **source** (cited from a text). Mocks never prove persistence.

## Ticket body

Call the Skill tool with `agent-ready-issue` and write its template in full: the durable contract. Keep every fact the reporter supplied (reproduction, screenshots, links). Then append:

```markdown
## Decisions
- Decision — who took it, when, citation

## Size and plan
XS/S/M/L/XL — what is touched, the order of work, the gates to run and their wall-clock cost.

## Scout map (base <commit>, <date>)
Snapshot for the implementer; re-check an area if the code there has moved since the base commit.
- Entry points, readers, and writers to change — evidence label
- Tests to update or add, with their expected values — evidence label
- Docs to update
- References: doc sections, texts, related tickets
```

The **Scout map** is the one place in the ticket where file paths and test names belong: it is a dated snapshot, while the template above it stays true after a refactor.

The gates in **Size and plan** run every test the Scout map lists as pinning today's behavior. A pinned test that no gate runs is marked `not gated` in the Scout map, with the reason. Implementers and verifiers run the gates, not the map, so a pinned test left out of them silently goes unrun.
