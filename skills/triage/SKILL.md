---
name: triage
description: Take a ticket from report to closed loop: check it against the code and the running app, give a verdict with evidence, fix or brief it, and comment on every tracker involved.
disable-model-invocation: true
---

# Triage

Run the **ticket loop** on the ticket the user names. With no ticket named, show what needs attention first.

## Trackers

Read the repo's `docs/agents/issue-tracker.md` (written by `/setup-repo`) first. GitHub through `gh` is the default. A second tracker (e.g. YouTrack for business requests and UAT defects) is used only when that doc declares it, with its access path, comment language, assignee, and repo-specific triage rules; the doc wins over this skill. Labels map through `docs/agents/triage-labels.md`. Missing doc: tell the user to run `/setup-repo`.

## Verdicts

| Verdict | Meaning | Label |
|---|---|---|
| fixed | Already behaves as asked, or already implemented elsewhere | close |
| real | Reproduced, or the faulty code is pinned | set by `scout` |
| needs-info | A decision or answer that changes the implementation is missing | `needs-info` |
| wontfix | Out of scope, or a bug neither reproduced nor traced to code | `wontfix` + close |

An untriaged ticket carries `needs-triage` until it gets a verdict.

## Ticket loop

1. **Read.** The full ticket: body, comments, labels, dates, and every linked ticket on every tracker. Prior triage notes count as answered questions; never re-ask them. A linked ticket that already asks the business or the reporter the open question, and awaits the answer, makes this ticket needs-info: name that ticket instead of asking again.
2. **Check relevance.** Against the code, by domain concept rather than the ticket's wording (use `GLOSSARY.md` terms), and report where you looked. Then against the running app: the repo's `verify-<app>` skill if present, else the `verifier` agent, briefed with the exact scenario, a setup deadline (report the blocker when it passes), and a progress report before any second long wait.
3. **Verdict.** State it with its evidence. Each claim names its evidence type: **static** (read in code), **mocked** (test with doubles), or **live** (observed on a running system). Mocks never prove persistence. Show the verdict to the user before step 4.
4. **Act.**
   - real and small: read `~/.agents/skills/implement/SKILL.md` and fix it by that workflow.
   - real and too big: read `~/.agents/skills/scout/SKILL.md` and scout the ticket by that workflow. Scout writes the brief and sets the outcome label; it is the only path to `ready-for-agent`.
   - needs-info: post triage notes (below), label `needs-info`.
   - fixed or wontfix: no code change.
5. **Close the loop** on each tracker involved: comment in that tracker's language with the verdict and its evidence (PR or commit link for a fix), assign per the repo doc, set the state or close. A real ticket fixed in this session closes only after its PR merges or the user says so.

Done when every tracker involved shows the verdict, the label or state, and the assignee the repo doc asks for.

## Triage notes

```markdown
## Triage notes

**Established:**
- point

**Still needed from @reporter:**
- question
```

Each question is specific and answerable in one reply; "please provide more info" is not a question.

## Show what needs attention

Query each declared tracker and list, oldest first, with counts and one line per ticket:

1. Unlabeled tickets (honor the exclusions in `triage-labels.md`, e.g. grouping parents).
2. `needs-triage`.
3. `needs-info` with reporter or linked-ticket activity since the last triage notes.

Let the user pick, then run the ticket loop.
