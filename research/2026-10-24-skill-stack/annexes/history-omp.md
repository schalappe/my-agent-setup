# OMP history report (551 sessions, 2026-07-23 to 2026-10-23)

Sources: `history/omp.jsonl` (first 12 user messages per session, 600 chars), 93 OMP rows in `corrections.jsonl`. Counts are message-level regex counts on those digests (undercounts: later turns are truncated). Facts carry a quote or count; inferences are marked **[inf]**.

Population: kari-banking (back/front/root/kb-* worktrees) about 350 sessions (63%), fily-verify/fily-* about 65, Rnc (personal writing/relationship notes, no code) 54, .agents/skills/my-pi-setup about 35, small projects (weathflow, schalappe.github.io, whatsapp-mcp, wallet) about 30. 240 sessions have 1 user message; only 33 have 8 or more. Tool totals: bash 9.3k, read 8.9k, grep 3.7k, edit 3.0k, wait 2.7k, `task` (subagents) 1.2k, `ask` 225.

## 1. Workflow phases observed

Fact: the dominant loop is "ticket -> agent -> PR -> review -> merge", driven by **issue numbers in plain prose, not skills**.

| Phase | What the user types | Count |
|---|---|---|
| Intake | `Look at the YouTrack ticket '...' and tell me if it still relevant` (UAT bug triage, Sept 14 burst of about 25) | YouTrack 65 mentions; "still relevant" 30 |
| Intake | `work on the issue://NNN` / `issue://NNN` | 34 / 70 |
| Intake | email from the accounting team pasted: "qu'en penses-tu ? impact sur la roadmap ?" | about 15 |
| Plan/design | roadmap, phase docs, ADRs, "what is missing to implement phase X" | roadmap 16, ADR 24 |
| Build | agent works alone; user adds `fix adjacent` / `fix the out of scope` / `all at once` | 9 / 30 |
| Ship | `stage, commit, push and create a new PR into develop` | 68, plus 17 "Commit and push the current repository..." and 6 "# Commit Changes" command expansions |
| Open PR | "# Create Pull Request" command 7; `draft PR` 17; `develop -> pprod` PR 12 |  |
| Review | `Code Review Request` template 14; `Use a sub-agent reviewer to review pr://N and fix the issue found. Use another sub-agent to verify the fix and loop until there is no issue.` (about 8, Oct 7-10); `Review the PR stack` 4; `/skill:review-round` 5-6 |  |
| Stack | `gstack` / "PR stack" 15 |  |
| Close | `comment and close the YouTrack ticket (in french), don't forget to assign to me` 13; "close properly the github issue with comment that explain what was implement" 2 |  |
| Clean | `# Clean Up [gone] Branches` command | 25 |

Trend: Sept = ticket-by-ticket fixes with manual ship prose; Oct = agent-run loops (sub-agent reviewer/verifier, PR stacks via child issues, 4-7 hour runs: "The agent is running for 7 hour ??", "Où es-tu ? Ça fait 4 heures").

## 2. Skill usage

Fact (digest `skills` field, noisy: many hits come from sessions editing skills, e.g. the 2026-09-26 and 10-14 `.agents` sessions):
- Genuinely invoked by the user: **review-round** (about 6 sessions, `/skill:review-roun` x5), **impeccable** (about 6 sessions, kari-banking-front and schalappe.github.io), **agents-md** (about 3), **unslop** (about 8 sessions, incl. "applique /unslop sur les changements"), **tdd** (1: `/tdd on issue://141`), `bro` (1).
- Used historically, now absent locally: **create-pr**, **pr-guide** (typed bare: `pr-guide`), **implement-spec** (about 4 sessions), **code-review**, **thermo-code-review**, **ponytail** / ponytail-review / ponytail-help, **tailwind-v4**, **subagents**, **typesafe-ai** (external, installed once Sept 21), **pr** (6 hits in one fily-verify session). Not re-add candidates by themselves.
- Local skills with zero OMP invocations in 92 days: agent-ready-issue, branch-review, caveman-comments, caveman-commit, codebase-design, diagnosing-bugs, domain-modeling, find-docs, grill-with-docs, grilling, improve-codebase-architecture, logging-best-practices, mcp-client, prototype, research, retro, setup-matt-pocock-skills, to-spec, to-tickets, triage (only 2 hits, both in skill-editing sessions), wayfinder, writing-for-agents, implement (1, editing session). Caveat **[inf]**: auto-loading by the agent from descriptions may not show in this field, so "never typed" is certain, "never loaded" is not.
- Only local command: `commands/clean-gone.md`, used 25 times (the single most-used asset). The ship/commit/create-pr commands were deleted ("chore: remove obsolete ship command"), yet their text still appears as expanded prompts 30 times (17+7+6), so older sessions used them.

## 3. Recurring ad-hoc tasks with no skill

1. **Ship: stage, commit, push, open PR into develop** (68 prose + 17 + 6 + 7 command expansions; also "create a new PR from develop into pprod" 12, "don't touch the unstaged file" 3).
   - "stage, commit, push and create a new PR into develop"
   - "create a new PR from develop to pprod"
   - "commit and PR séparée (tous les fichhiers non stage)"
2. **Ticket triage against the live app** (about 30): "is it still relevant", reproduce, fix on new branch, PR, comment ticket in French, close and assign.
   - "Look at the YouTrack ticket 'karibanking-51 ...' and tell me if it still relevante"
   - "comment and close the YouTrack ticket (in french), don't forget to assign to me" (13)
   - "Try reproduce ... If you cannot reproduce it and there is no proof in the code that a bug exists, we close the ticket"
3. **Fix the "adjacent / out-of-scope / pre-existing" findings the agent only reports** (9 plus corrections): "fix adjacent", "Fix the out of scope found", "fix the pre-existing baseline breaks, don't wait", "I don't understand the constat hors périmètre, can you fix them ?".
4. **File issues for findings / parent+children** (about 12): "open issues for all the problem found", "file the problem found", "create new issue for all the new finding".
5. **Review a PR/stack with sub-agents and loop to zero** (about 12): see section 1 quote; "Review the PR stack (front only) with GPT6.1-Sol".
6. **Explain in plain words** (Restate x6, "no jargon" x12): "Restate your last message. Stop using jargon and speak coherently. State it more simply and concisely, like one human talking to another." This is already an AGENTS.md concern ("plain words") but is not holding.
7. **Deep-dive docs on Fineract internals** (about 8): "Propose un document markdown qui explique en profondeur comment fonctionne le Maker Checker...".
8. **Merge PDFs** (9 sessions, Rnc/.agents): "Peux concatener en un seul PDF, les fichier suivant: ...". Pure utility; a one-line AGENTS.md hint or tiny script would absorb it.
9. **Model/harness configuration and comparison** (about 15, .agents/skills/my-pi-setup): "présente moi tous les rôles dans omp...", ForgeCode vs Pi, WATCHDOG.yml, hx language servers. Config work, not a skill.
10. **Update a project card after repo changes** (schalappe.github.io, 3): "Le projet 'X' a récemment été mis à jour. Peux-tu regarder les changements et mettre à jour sa fiche projet ?".
11. **Mail from accounting team -> impact on roadmap + YouTrack ticket with proposed reply** (about 10). Skill candidate only if it recurs outside one client **[inf]**.

## 4. Intervention points (where the user steps in)

- Kicks every task: issue number, then the ship sentence. Fact: 145 single-word steering replies ("yes", "all", "1", "continue", "do it"); `ask` tool used 225 times (agent-asked decisions).
- Stops long runs: "state of agent", "stop the agent", "Are the subagent stuck ?" (3), "are you stuck ?", "still waiting ?", 7-hour and 4-hour runs.
- Scope boundary: "Don't need to review the frontend", "don't touch the unstaged file", "Do nothing yet. You're only thinking".
- Decision gates he resents: "If there is a decision you don't ask a question. If there is something to confirm, use 'ask user'"; "why did you stop if you are not done ? finish all remain task".
- Verification choice: "don't need to rerun the unit test, run the full integration test" / "don't need to run the full integration test, open a PR" (contradictory over time, driven by cost; he reports full-test bottleneck: Oct 12 "running of all the tests is a bottleneck").
- Domain truth that the agent cannot know: XOF currency, "le produit est fait pour les SFD de BCEAO", accounting team answers.
- Manual testing and screenshots he supplies (about 18 mentions of screenshot/capture, many image attachments).

## 5. Correction themes (93 OMP correction rows; counts approximate)

1. **Jargon / not understandable** (about 14): "Restate your last message. Stop using jargon" x6; "For the decision you asked me, I don't understand what the fucking hell you're talking about"; "Je ne comprends pas la question Q1. Quelle information tu recherches ?" x3.
2. **Asking him / waiting instead of acting or verifying** (about 12): "Bah tu as l'application. Tu peux faire l'audit. Je ne sais pas pourquoi tu as besoin d'attendre"; "Shouldn't you verify B before asking to ask to leandre ?"; "Je ne comprends pas pourquoi tu ne pourrais pas modifier les codes. On n'est pas en production"; "you don't need me !"; "You making hypotheses, I want proof."
3. **Stopping early or leaving findings unfixed** (about 7): "why did you stop if you are not done ?"; "Did you forget you are in a loop?"; "fix the pre-existing baseline breaks, don't wait".
4. **Over-verification / wrong test depth, time cost** (about 8): "Don't make a test for little things like that. If you make tests, every little change will not finish."; "Pourquoi cela pendant 30 minutes et plus ? On a dit qu'on prenait que 128 images"; "I understand that we can split the `fast` pipeline and I don't understand why the whole pipeline is executed when you change a simple thing."
5. **Main agent does verification instead of delegating** (rule added Sept 16): "Can you add in the agents.md that any verification should be run with subagent no with the main agent."
6. **Wrong scope / git hygiene** (about 6): "create a new PR ... (don't touch the unstage change)", "why don't you put them in .gitignore", "commit and PR séparée".
7. **Over-engineering / dead code / premature flags** (about 5): "we won't need ... it will become dead code or a debt"; "don't use break change"; "Maybe one day we will do that, but ... I don't need currently".
8. **Wrong tech facts / sloppy references** (about 5): "mysql ???? we use postgres here !!"; "why are talking about 09-general-ledger.md ?? it is a documentation not an absolute truth"; "// ponytail" comments in code that break his comment rules; "Gate.sh command not found" (review-round); "CODING_STANDARDS.md ? gates.json ?" (review-round reads files that don't exist in other repos).
9. **Fabricated, redundant or ill-targeted questions** (about 4, Rnc): "tes questions n'ont aucun rapport avec nos discussions... déjà répondues".
10. **Ticket hygiene**: language slips ("in french please", "don't forget U ticket is in French"), assignment forgotten (4 repeats of "don't forget to assign to me").

## 6. Implications for the skill stack

- **Shipping gap (fact)**: 68+ prose requests, plus 30 command expansions from deleted commands. Removing `commit`/`ship`/`create-pr` left the same sentence typed every session. **[inf]** Absorb into AGENTS.md as a default ("when told to ship: branch if on main, stage only my files, short Conventional Commit, push, PR into develop, draft unless told ready, never touch unstaged files") or one tiny command, not three skills. Base branch rule per repo (develop, pprod, main, prod) belongs in each repo's AGENTS.md.
- **Ticket-to-closed-ticket loop (fact: about 30 + 13 close/comment)**: no skill covers "reproduce, decide, fix on branch, PR, comment/close tracker in French, assign". **[inf]** A small `ticket` skill (tracker-agnostic: YouTrack or GitHub) is the highest-payoff gap; `triage` is used 0 times for this and was dropped from the lock.
- **Findings policy (fact: 9 explicit + several corrections)**: fix adjacent/out-of-scope/pre-existing findings by default, only file an issue if redesign is needed. This is already in the global AGENTS.md ("Now is better than never") but the agent still reports instead of fixing. **[inf]** Move it into the review/implement skills' end-of-run step.
- **review-round under-delivers (fact)**: invoked about 6 times but user switched to the prose "sub-agent reviewer / sub-agent verifier, loop until no issue" about 8 times; errors: `gate.sh` exit 127 and reads of `CODING_STANDARDS.md` / `gates.json` absent in other repos; runs of 4 to 7 hours with no status ("Où es-tu ?"). **[inf]** Needs repo-agnostic gate discovery, a time/round cap and periodic status.
- **Decision handling (fact: 3+ quotes)**: user wants no hidden questions: decide when a recommendation exists, ask via `ask` once, concise and non-technical, with examples. Matches global AGENTS.md; **[inf]** worth a one-line "no jargon, example first" repeated in skills that ask questions (review-round, implement, triage).
- **Verification cost (fact)**: full tests are a recognized bottleneck; the user flips between "full integration" and "don't run it". **[inf]** A rule "run the narrowest check that covers the change; full suite only on PR-ready / verifier" avoids repeated arguing. (AGENTS.md already says gates go to the verifier; make the verifier choose scope by changed paths.)
- **Dormant skills (fact: 0 invocations)**: grilling, to-spec, to-tickets, wayfinder, research, prototype, diagnosing-bugs, branch-review, codebase-design, domain-modeling (despite 24 ADR mentions and a glossary request), agent-ready-issue. **[inf]** He plans through free conversation ("qu'en penses-tu ?", roadmap) and writes tickets via prose; skills with grill/spec ceremony do not fit his path. `agent-ready-issue` could still serve "create issues for all the findings" (about 12) and is a candidate to wire into the review/findings step instead of standing alone.
- **Non-code sessions (fact: Rnc 54, PDF merges 9, mail analysis, Lightroom notes)** use no skills and are about 15% of volume. **[inf]** Not worth a skill; PDF merge deserves at most a one-line tool hint.
- **Comment rules (fact)**: "ponytail" comments surfaced in code on Oct 2 and led to removing ponytail; `unslop` (about 8 uses) is the active enforcement tool and is working.
