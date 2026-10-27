---
name: scout
description: Find what a ticket needs before anyone implements it, settle open decisions with the user, then rewrite or retire the ticket.
disable-model-invocation: true
---

# Scout

A ticket states the target. It rarely states the **fog of war**, meaning what the implementer must know to reach the target. Examples are callers that must change together, tests that pin today's behavior, a rule a text imposes, numbers nobody computed, or another ticket that already covers part of the work. An implementer who discovers these facts mid-way can lose a day. Scout finds them before implementation starts and changes no code. It ends with a ticket an unattended agent can finish without new scope, or with the ticket retired.

Scout is the only path to `ready-for-agent`. It takes any open ticket, whatever its label, including one already marked `ready-for-agent`. `triage` sends its real tickets here.

## Trackers

Read the repo's `docs/agents/issue-tracker.md` and `docs/agents/triage-labels.md` first. They win over this skill. If either doc is missing, tell the user to run `/setup-repo`.

## Outcomes

| Outcome | Meaning | Tracker action |
|---|---|---|
| ready | The fog checklist is answered and no decision is open | rewrite the body, label `ready-for-agent` |
| split | More than one outcome, or more than one agent session of work | rewrite as parent, file child tickets, each scouted to ready |
| blocked | Ready, but another ticket must land first | rewrite, record the blocking edge, label `ready-for-agent` |
| needs-info | A decision only the reporter or the business can make | post the open questions, label `needs-info` |
| fixed | Already implemented, here or elsewhere | comment with the evidence, close |
| duplicate | Another ticket covers it | merge its unique facts into the survivor, close as duplicate |
| wontfix | Contradicts the governing rules, or out of the product's scope | comment with the citation, label `wontfix`, close |

When the fog is too thick for one ticket (the destination itself is undecided), say so and point to `/wayfinder`.

## Steps

1. **Read.** Read the whole ticket (body, comments, labels, dates) and every linked ticket on every tracker. Treat earlier scout or triage notes as established. If the ticket carries `ready-for-agent`, swap that label for `needs-triage` now and tell the user, so no agent picks it up during scouting. This is the only tracker change before step 5. Record the base commit that the scouting reads (`git rev-parse --short origin/<default branch>`).

2. **Map the fog.** Work through the [fog checklist](#fog-checklist) against the code, the domain docs, the trackers, and primary sources (local copies first, then the web). When you scout several tickets, give each ticket, or each group of tickets with one root cause, to a read-only subagent. Brief it with the ticket, the base commit, the docs that govern the area, the checklist, and the evidence labels. Re-check yourself every claim that changes an outcome (fixed, duplicate, conflict, wontfix) before keeping it. Done when every checklist item has an answer with its evidence label, or `n/a` with the reason.

3. **Settle decisions.** For each open decision, find what the governing docs, ADRs, and primary texts say. Then ask the user with the ask tool. Give one decision per question, the options, your recommendation with its citation, and one concrete example, in the words the UI or glossary uses. Explain the stakes in plain terms first, because a decision the user cannot follow is not settled. A decision only the reporter or the business can make becomes a needs-info question. Done when no decision that changes the implementation is open, or each remaining one is a needs-info question.

4. **Show the plan.** Give the outcome with its evidence, the rewritten body, and every tracker action you will take: labels, closures, new tickets, edits to linked tickets, comments. Wait for the user's go; apply their corrections.

5. **Act**, in this order, so a crash never leaves a ticket marked ready with a stale body:
   1. Rewrite the body ([Ticket body](#ticket-body)). On a tracker the repo doc declares as the business or reporter tracker, keep the reporter's text and post the result as a comment in that tracker's language instead.
   2. File new tickets, edit linked tickets, close duplicates and retired tickets.
   3. Set the outcome's label last.
   4. Comment on every tracker involved: the outcome, what changed in the ticket, and the decisions taken with who took them.

Done when every tracker involved shows the outcome, the label or state, and the comment.

A second run starts from the existing **Scout map**: it re-checks the areas that changed since its base commit and keeps the rest.

## Fog checklist

Answer each item for the ticket at hand. Search by domain concept (`GLOSSARY.md` terms), not by the ticket's wording.

- **Relevance.** Is it already implemented, in code, a merged PR, or a closed ticket? Does an open ticket duplicate, overlap, contradict, or block it? Is the feature or configuration in the product's scope at all?
- **Rules.** What do the domain docs, ADRs, and governing texts (regulation, accounting standards, contracts) require here? Does the ticket comply? Cite section and source.
- **Reach.** Every entry point that triggers the behavior (API, jobs, UI, batch, other services) and every reader and writer of the data it touches. Which must change together?
- **Data.** What the change needs, whether it exists today, whether a migration is required, and what happens to existing records.
- **Expected values.** Compute every number the acceptance criteria need, and show the arithmetic. Cover the edges the domain has (precisions, calendars, empty, error, permission states).
- **Root cause** (bugs). Pinned with evidence, or ranked hypotheses with the evidence for each and the cheapest way to tell them apart.
- **Tests.** Which existing tests pin today's behavior and will break or contradict the ticket; which new tests are needed, at which seam; which harness runs them, on what infrastructure, in how much wall-clock time. When acceptance is expensive, find a cheaper faithful check.
- **Docs.** Which docs, ADRs, and examples must change with the code.
- **Size.** List the files, migrations, tests, and gates the work touches, and rate it S, M, L, or XL. If it holds more than one outcome or more than one session of work, propose a split into tracer-bullet tickets.

Evidence labels, one per claim: **static** (read in code or docs), **mocked** (test with doubles), **live** (observed on a running system), **source** (cited from a text). Mocks never prove persistence.

## Ticket body

Call the Skill tool with `agent-ready-issue` and write its template in full: the durable contract. Keep every fact the reporter supplied (reproduction, screenshots, links). Then append:

```markdown
## Decisions
- Decision — who took it, when, citation

## Size and plan
S/M/L/XL — what is touched, the order of work, the gates to run and their wall-clock cost.

## Scout map (base <commit>, <date>)
Snapshot for the implementer; re-check an area if the code there has moved since the base commit.
- Entry points, readers, and writers to change — evidence label
- Tests to update or add, with their expected values — evidence label
- Docs to update
- References: doc sections, texts, related tickets
```

The **Scout map** is the one place in the ticket where file paths and test names belong: it is a dated snapshot, while the template above it stays true after a refactor.
