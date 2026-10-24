# Pi history, second half (pi-b): 417 sessions, 2026-08-29 to 2026-09-14

Source: `$S/history/pi-b.jsonl` (+21 Pi rows of `corrections.jsonl` in the same range). Classification is by first user message (regex), so counts are approximate (+/- 10). Heavy days: 08-29 (58), 08-30 (107), 08-31 (47), 09-07 to 09-10 (165). 227 sessions have a single user turn (mostly automation); 73 have 2, 56 have 3, 61 have 4+.
Caveat: the `skills` field counts SKILL.md reads/loads, not necessarily explicit user invocations. In the sample opened (`Work on the github issue #120` session), the agent loaded `caveman-commit` itself from `.pi/agent/skills/`. So big counts for unslop/caveman-* mean "auto-loaded by instruction", not "user typed it" (fact for that sample; inference for the rest).

## 1. Workflow phases (human vs automated)

| Class | Sessions | Notes |
|---|---|---|
| Automated / subagent-spawned | ~130 | 114 delegated prompts + 16 "# Clean Up [gone] Branches" |
| Human-triggered skill body (slash command expanded) | 48 | create-pr 11, unslop 11, impeccable 11, wayfinder 8, tdd 4, triage 3 |
| Human free-text | ~239 | the rest, incl. a few residual subagent prompts |

Human-driven phases (counts of first messages, overlapping, approximate):
- **Ticket to branch to PR (kari front/back)**: "work on the github issue #N on a new branch" ~39, then "commit and push"/"stage, commit, push" (61 sessions mention it in later turns), then "create a new PR into develop" ~27. Release PRs "from develop into pprod" ~18 (first message), repeated per repo.
- **Tester-team report triage**: "Analyze this report from the tester team: """ Identifiant anomalie : BUG-KARI-0xx ..."""" ~28 first messages (about 09-08 to 09-11), often followed by "create a github issue", "propose a response from the tester team (in french)", then fix on a new branch.
- **PR review**: "review the PR #N" ~24, usually followed by "Is this finding really an issue, verify it" and "fix the finding(s)".
- **Screenshot bug reports from local run**: ~28 (`/var/folders/.../clipboard-*.png` pasted), then fix, then retest.
- **Audits/exploration**: slop hunt across codebases ~35 mentions, front/back feature-vs-backend audits, TanStack libs questions, perf wins, docs organization.
- **Non-code (Rnc/wallet)**: WhatsApp-via-`mcp-client` analysis of one contact (19 sessions, Rnc), Tingg/Cellulant TDR comparison and PDF conversion (wallet, ~6), subscription choice, learning Rust/TS, YouTrack MCP.

Automated pipelines (what the user already automates):
1. **Fan-out migration batches**: "You are implementing one migration batch of the 'migrate forms to TanStack Form'..." 14 sessions in git worktrees `kari-form-wt-180..193`; "Read /tmp/tsr-migration-guide.md first and follow it exactly" x3 (TanStack Router); "You are migrating hand-rolled UI patterns to newly extracted primitives" x3; "Implement the rule: TanStack Query owns remote state..." x4 (parallel variants); "Implement GitHub issue #157/#158/#159/#164/#160/#161-162/#167/#168-170 in this isolated worktree" ~9. Pattern: parent writes a brief in `/tmp/*.md`, spawns N workers each in a worktree, one commit per issue.
2. **Parallel read-only reviewers**: "Review PR #195 ... correctness bugs only" ~12 with different focus lines (TanStack Query, domain regressions, SQL perf); "You are a READ-ONLY code reviewer hunting for slop" x4 (one per repo); "Read-only backend audit against sibling ../kari-banking-front" x3; 3-way "Analyze exhaustively /tmp/sara-part-N".
3. **Design critique pair (impeccable)**: "Assessment A (design director)" x4+ and "Assessment B (deterministic detector)" x5+, spawned by `/impeccable critique`.
4. **Doc generation fan-out**: "Read /tmp/module-doc-brief.md" x4, "Create source-verified docs for exactly N modules" x4, "Own ONLY docs/<dir>/**" x4 (non-overlapping file ownership), "You are cleaning documentation in a private Apache Fineract fork" x2. Subagent prompts say "User approved comprehensive documentation cleanup" and "No commits".
5. **Wayfinder research tickets**: "You are resolving a wayfinder research ticket" x2 (the skill spawns them).
6. **Branch hygiene**: `# Clean Up [gone] Branches` 16 sessions, always right after a PR merge, in both repos (command, not skill).
7. **Smoke tests**: "Reply with exactly: OK" x3 (model/proxy check, cli-proxy 400 error debugging 09-06).
8. **Prompt-file fan-out for WhatsApp**: "Lis le fichier /tmp/sara/prompt_A_..." x8 (4 date ranges, run twice).

## 2. Skill usage (load counts in pi-b)

caveman-commit 151, unslop 111, create-pr 85, caveman-comments 45, tailwind-v4 34, agent-ready-issue 27, diagnosing-bugs 25, impeccable 24, find-docs 18, mcp-client 12, background-terminals 9, research 7, domain-modeling 7, codebase-design 6, subagents 4, grilling 4, writing-adrs 2, prototype 2, tdd 1 (+4 slash-body starts), wayfinder 8 slash-body starts, triage 3 slash-body starts.

Used historically, now absent locally (fact, per `local-inventory.md` and brief): **create-pr** (85 loads, 11 slash starts; replaced by `pr` skill or lost), **tailwind-v4** (34), **background-terminals** (9), **subagents** (4), **wayfinder** (8 starts, spawns research tickets), **triage** (3), plus one-offs spec-creation, karpathy-guidelines, `/clear`, `/settings`. Mistyped slash entries (`/quti`, `/qyut`, `/ne`, `/nzw`) are typos, not skills.
Still present: caveman-commit, unslop (local name `unslop`), caveman-comments, agent-ready-issue, diagnosing-bugs, impeccable, find-docs, mcp-client, research, domain-modeling, codebase-design, grilling, writing-adrs, prototype, tdd.
Co-loading (fact): unslop + caveman-commit + caveman-comments + codebase-design/find-docs appear together on nearly every implementation worker, i.e. loaded via AGENTS.md instruction chain, not chosen per task.

## 3. Recurring ad-hoc tasks with no (current) skill

- **Commit + push + PR with title/body (create-pr gone)**: ~60 sessions. "stage, commit, push and create a new PR into develop"; "create a new PR from develop into pprod"; "update the Pr name that don't respect the standar".
- **Release PR develop to pprod**: ~18. "create a PR from develop into pprod"; "don't need to say '0.8.0 from develop to pprod'".
- **Tester-report triage (verify real bug, ticket, reply in French)**: ~28 + follow-ups. "Analyze this report from the tester team, and tell me what you think about it"; "check is already fix and explain it to me"; "propose a response from the tester team (in french)".
- **Review-finding adjudication loop**: ~17 sessions mention "finding". "Is this finding really are issues, verify it"; "recheck the findings issues if there are real and relevant"; "post the review and fix the minor findings (1, 2, 3 and 4)".
- **Squash-merge message**: ~13 PR title/description asks. "I'm going to squash & merge it. Propose a commit message and an extended description"; "propose an extended description for the mere".
- **Fan-out parallel issues in worktrees**: ~6 parent sessions. "look at the remain child issue of #153 and look which one can be run in parallel then use subage[nts]"; "look at all the child issue of #239, and fix them in a new branch, one commit by issue".
- **Resolve PR conflicts / rebase on develop**: 6. "fix the conflict on the PR #213, the develop is the last version".
- **Local UI bug from screenshot, then retest**: ~28. "When I click on 'Decaisser' : /var/folders/.../clipboard-...png"; "retest end-to-end"; "replay all the scenario and check if everything is fix".
- **Create issue from message/screenshot**: ~14. "create a new ticket github with this information from the account team"; "Create a github issue to takle the bug"; Jira ticket for non-technical people (1).
- **Root/docs cleanliness and AGENTS.md refresh**: "tell me which one can be delete?" x2, "refresh the @AGENTS.md", "update the @AGENTS.md based on ... AGENTS.example.md", docs reorg x4.
- **Markdown to PDF, email drafts**: "convertir @analyse_tingg_... in PDF" x3; "propose un mail pour l'équipe comptable" x3.
- **Railway/deploy debugging**: "the deployment on pprod (Railway) is stuck, can connect see the log and debug"; "dockerfile invalid: docker VOLUME ..." (3).

## 4. Intervention points (where the human steps in)

1. **Task framing**: terse issue/ticket number; everything else comes from AGENTS.md and the issue (fact).
2. **After first implementation**: "commit and push" / "create a PR" (the agent does not auto-ship; consistent with AGENTS.md "only when I ask").
3. **After review**: adjudicates findings ("Is this finding really an issue"), decides scope ("fix them all").
4. **Visual QA**: pastes screenshots from local/pprod; the user is the UI tester.
5. **Decisions**: "pour le point 4 -> pas une question, je tranche directement, allons sur l'option 2".
6. **Pipeline red**: "the pipeline check:format fail, fix it" (x3), "change the title of the PR, the pipeline failed".
7. **Merge**: user squash-merges himself, asks for message; then runs the `[gone]` cleanup.
8. **Parallelism**: user asks to "use subagents" himself, wants one commit per issue.

## 5. Correction themes (21 Pi rows; ~9 genuine, rest are false positives on "don't")

- **Be bolder, not prudent / do now, don't defer to a ticket (3)**: "We are here to the best app even if that me destro eveerything to rebuild it more stronger... stop be prudent"; "pourquoi tu crée un ticket, implment le maintenant on a tout ce qu'il faut"; "Fix them all, ... if it is a bug fix it, don't need to wait".
- **Discuss before changing (2)**: "before change anything, tell me witch the best approch"; "don't start anything, let create two issues".
- **Wrong style/standard (4)**: "non unslop the code + comment"; "update the Pr name that don't respect the standar"; "Superutilisateur is cringe"; "don't need to say '0.8.0 from develop to pprod'".
- **Scope/hygiene (1)**: "(don't track the .pptx file)".
- **Challenge a claim (1)**: "It is the first time is see that, are sure ?" (agent asserted an index.html convention).
- **Repeat/clarify output format (3, Rnc)**: the promise-table request restated three times.
- **Don't re-edit on retest (1)**: "relaunch the test, don't change anything".
Fact: no correction concerns correctness of skill content; they concern initiative level and conventions.

## 6. Implications for the skill stack

- **F**: A commit/push/PR/squash-message flow is the single most repeated manual act (~60-80 sessions) and its skill (create-pr) vanished. **I**: the `pr` and `caveman-commit` pair covers it; the missing piece is a one-line "ship" routine (stage, commit, push, PR to develop; release PR develop to pprod with title standard). Prefer folding into `pr` over a new skill.
- **F**: Tester-report triage is a distinct, repeated pipeline (verify bug in code, decide real/fixed, draft ticket, French reply). **I**: a small `bug-report-triage` skill (or a section in `diagnosing-bugs`/`agent-ready-issue`) would remove the retyped prompt; the user's real need is the French reply plus an English issue.
- **F**: Worktree fan-out (migration batches, issues, doc ownership, 50+ worker sessions) is hand-built via `/tmp/*.md` briefs. **I**: valuable only as a lightweight "brief + non-overlapping ownership + one commit per issue" recipe; the `subagents` skill is gone and was loaded just 4 times, so do not rebuild heavy machinery.
- **F**: Review-finding adjudication ("is this real?") recurs ~12-17 times. **I**: `branch-review` should demand a verification step per finding (reproduce or cite code) before reporting; cheap, removes a user turn.
- **F**: `[gone]` branch cleanup ran 16 times automatically; now present as `clean-gone`. Keep.
- **F**: unslop/caveman-* loaded on almost every worker. **I**: this is repo/AGENTS.md instruction cost; check whether they should be inlined in AGENTS.md rules to avoid per-session skill reads (token efficiency).
- **F**: The user is the UI tester via screenshots. **I**: a verifier flow with a real browser on pprod/local scenarios (he asks "retest end-to-end", "replay all the scenario") matches AGENTS.md verification rules; no new skill, but verifier briefs could be templated.
- **F**: tailwind-v4, background-terminals, wayfinder, triage were used but absent. **I**: weak evidence to re-add (tailwind-v4 auto-loaded as reference, 34 loads; others low or replaced by grilling/research).
- **F**: Non-code Rnc/WhatsApp analysis uses `mcp-client` plus ad-hoc multi-part subagent prompts. **I**: out of scope for the dev skill stack.
- **I**: initiative corrections ("stop be prudent", "implement now") suggest AGENTS.md already has the rule (act without asking, no "later"); agent compliance, not new skills, is the gap.
