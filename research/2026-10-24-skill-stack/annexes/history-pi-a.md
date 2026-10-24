# Pi history A (2026-08-08 to 2026-08-29): workflow analysis

Source: `history/pi-a.jsonl` (417 sessions) + 23 Pi rows of `corrections.jsonl` in the same range. Only the first 12 user messages (600 chars) per session are visible, so later turns are under-sampled. "Fact" = counted/quoted from the digests; "inference" = my reading.

Project mix (cwd, fact): kari-banking-front 186, kari-banking-back 97, Rnc 23, fily-api 22, ~/Lab (ad-hoc research) 21, ~/.agents 18, abatta-research 15, Pi extensions 8. Busiest days: 08-23 (80), 08-24 (63), 08-16 (56), 08-22 (54).

## 1. Workflow phases (human vs automated)

Rough split (heuristic on first message; fact for the buckets, approximate for the totals): ~165 human-driven, ~75 human-triggered templates/skill bodies, ~175 spawned by subagents/automation.

**Human-driven (~165)**
- A. Screenshot-error debugging on the running Kari app (~42 sessions with `clipboard-*.png` / `Desktop/*.png`): paste error + backend stack trace, "fix it", then "commit and push". Dominant on 08-15/16 and 08-23/24.
- B. Domain Q&A about Fineract / accounting / UX copy (~25): "Que signifie le type 'OFF_BALANCE'", "c'est quoi un VPS ?". The Q&A often ends in "create a GitHub issue" (10 sessions) or a doc update.
- C. Accounting deliverables with the finance team (27 sessions mention plan comptable/PCSFD): xlsx diff, delta, import, recette document updates, email drafts.
- D. Deploy/infra (~28): Docker package for AMD64/ARM64, Railway, Vercel, release-please, branch protection ("empêcher de faire des commits directs sur pprod et main").
- E. Agent setup in ~/.agents and ~/.pi (~30): Pi extensions (ask-user, history navigation, cli-proxy provider), AGENTS.md edits, rule/command to skill conversions, bench of AGENTS.md (08-08).
- F. Personal/non-code (Rnc 23): WhatsApp MCP analysis and updating `personnes/sara/*.md` notes.
- G. Issue-driven build: `/tdd implement the github issue #N` (8 first messages, 08-24 burst #84-#90), "implement the github issue #N" (4 + 4 `implement` skill bodies on 08-12).

**Human-triggered templates (~75, fact)**: "Commit and push the current repository changes" template (36 occurrences incl. follow-ups; 9 as session opener), `# Create Pull Request` template with `develop`/`pprod` base (12 openers, ~48 sessions mention creating a PR), `# Clean Up [gone] Branches` (6), `# Commit Changes` template, 15 tdd skill bodies, 18 impeccable skill bodies (all front repo).

**Automated / subagent-spawned (~175, fact from prompt shape)**
- Research fan-out, 08-22 10:21-10:29: ~39 sessions on one topic ("Abatta Village", land-title due diligence), each a narrowly scoped web-research prompt in French ("sources EXCLUSIVEMENT de première partie", "uniquement sources officielles ivoiriennes"), cwd `abatta-research` or /tmp; some write to `/tmp/abatta-research/agent-*.md`. Same pattern: 4 "Tu es un analyste" wallet-aggregator evidence sessions (08-19), 4 hosting-cost research sessions (Vercel/Render/Railway/Coolify, 08-14).
- Multi-axis review fan-out (~25): "Review PR #354 ... thermo-nuclear code quality", "Review PR #31 on the Spec axis only / Standards / Quality", "You are reviewing uncommitted work ... SPEC axis / STANDARDS axis". 3 axes per round, repeated (fily-api PR #354 had ~12 reviewers over 08-09; kari-back PR #31; kari-front 08-12).
- Parallel implementers with file ownership (~25): "Implement part of GitHub issue #106. You exclusively own these page files ... Other agents are editing other files concurrently", same for #105/#107, plus "Translate every French code comment ... Ownership is strictly src/app/lib/**" (3 agents, 08-24). Followed by "Adversarially review the current uncommitted implementation of issue #106. Do not edit files."
- Audit fan-outs (read-only): "Audit LECTURE SEULE" x4, "You are auditing a React SPA" x4, "Assessment A/B" design review x8 (08-23), French-copy audits x4 (08-16), "Tu corriges des libellés" x3, date-parsing contract audit back+front (08-15).
- Data chunking: `Lis le fichier /tmp/sara_analysis/prompt_aa.txt` x4 (chunks aa-ad), "Tu analyses une conversation WhatsApp" x12 (map-reduce over a long chat).
- Resolve PR review comments: "Resolve all the conversation in PR #354" x3.
- Pipeline in one line (inference): issue -> `/tdd` or `implement` -> parallel owned-file agents -> 3-axis review agents -> "resolve conversations" -> commit/push template -> `create-pr` template -> release-please. The user already automates everything after "pick the issue".

## 2. Skill usage (sessions with the skill loaded; fact)

caveman-commit 112, unslop 65, research 51 (almost all subagents), caveman-comments 47, diagnosing-bugs 40, impeccable 33 (+4 `/impeccable`; 100% front repo), find-docs 31, subagents 26, code-review 24, codebase-design 18, create-pr 17, tailwind-v4 16, mcp-client 15, agent-ready-issue 13, supabase 10 (fily-api only), background-terminals 10, tdd 9 (+8 `/tdd`, +15 bodies), verify 7, domain-modeling 4, implement 4, writing-adrs 2, thermo-* 5, ponytail 3, grilling/to-spec/wayfinder/find-skills 1 each.

**Used historically, now absent from ~/.agents/skills (fact: not in `ls`)**: create-pr (17; replaced by `pr` body skill + `/pr` command template), tailwind-v4 (16; was just converted from rules/ on 08-23, used only in front), subagents (26), background-terminals (10), code-review + thermo-nuclear-code-quality-review (24+5; merged on 08-23, then `branch-review` appeared), verify (7), supabase (10), ponytail (3, removed 08-09), find-skills (1). Still present: implement, to-spec, wayfinder, grilling, domain-modeling, tdd, research.

**Barely used though present (fact)**: grilling 1, to-spec 1, wayfinder 1, domain-modeling 4, writing-adrs 2, implement 4 (08-12 only). The user rarely plans with skills; he plans in free-form chat or via GitHub issues.

## 3. Recurring ad-hoc tasks with no skill

1. **Screenshot + backend trace debugging loop** (~42): "I have this error when I try to create a client on '/clients/new' /var/folders/.../clipboard-...png"; "When I try to activate a client I have an error: ... On the backend I have : Platfor..."; "verify if this type of error is present in the other page (always verify the contract wit the backend)". `diagnosing-bugs` loads (40) but the user adds the cross-page/contract sweep by hand.
2. **Commit, branch, push, PR chain** (~130 messages): "create a new branch, commit, push and create a PR into develop", "commit and push", "stag, commit and push". Covered by templates, but typed manually every time.
3. **Domain explanation questions** (~25): "Que signifie le type 'OFF_BALANCE'", "Qu'est-ce que veut dire un agent crédit lorsqu'il y a un compte épargne et un prêt?", "explique les differents de 'Nouveau produit de crédit'". Followed by a fix such as a wording change ("mauvaise traduction ... Corrige dans l'ensemble de l'application").
4. **French UI copy / i18n audit** (91 sessions mention French/English/translate): "dans la page '/organization#holidays' il y a encore de l'anglais", "I see a lot of 'Option système non traduit'", "The comment should be only on english, but I see some french comments, fix all of them". Run as audit fan-outs.
5. **Issue authoring from a diagnosis** (10, plus 4 `agent-ready-issue` loads): "Based on this mail create agithub issue after diagnostic the bug", "create github issue for the PCSFD change on the front and back (front, label is in french where in back is english)", "create github issues to fix them (no more than 3 issues)".
6. **Finance-team spreadsheet round trips** (27): "l'équipe comptable à porter une nouvelle version du plan comptable @...xlsx, dis moi quel est le delta"; "extraire ... les comptes de classe 9 en fichier excel"; then update the recette document.
7. **Test/recette scenario document upkeep** (11): "Dans le document de recette ... il est marqué qu'on ne peut pas faire onboarding"; "Le plan comptable a été intégré, met à jour le document de recette".
8. **Deploy and packaging** (28): "Faire un package avec la dernière version du back et la dernière version du front"; "J'aimerais déployer ce front sur Vercel et le connecter au back-end ... Railway"; "Why I have 20 workflow, I don't need a release creation, just a tag version".
9. **Architecture challenge** (5): "architecturally what is the purpose of @src/app/lib/live-data.tsx ... it seem to be a bottleneck"; "not code file should be larger than 500 lines ... Search all files too big"; "restructure the tree of file ... regroup similar files in the same subfolder".
10. **WhatsApp MCP relationship notes** (26, Rnc): "utilise le MCP WhatsApp pour recuillir tous les nouveau[x messages]", "mets à jour les deux fiches". Uses `mcp-client` (15).
11. **Agent-setup chores** (~30): "transform the rule @rules/tailwind-v4.md into a skill", "Update @AGENTS.md based on this example", "the AGENTS.MD is too long, remove useless or redundant information".

## 4. Intervention points (fact unless marked)

- Before work: screenshot/log paste (the user is the only source of runtime truth); business ground truth ("la source de vérité, c'est la feuille PCSFD V 110826").
- After a diagnosis: asks for explanation first ("what is the conclusion... root cause?"), then "fix it" / "apply the secure fix". Pattern is diagnose, then approve, then fix (about 15 sessions).
- Choice points via `ask_user` tool (109 calls in 56 sessions) and numbered answers ("Q1. a Q2. Persist inside Q3. a ...").
- After each change: "commit and push" in nearly every session; he never lets the agent decide to ship. He also gates by branch ("Also don't allow direct push on develop, on via PR").
- Review: he triggers review rounds then says "fix the issue found" / "open conversation on the PR, one for each issue found" / "resolve all conversation ... I mean fix them not close them".
- Scope: "no more than 3 issues", "Apply uniquement: 11 suppressions ... 56 changements".
- Verification is by the human in the live app (screenshots), not by a verifier (inference: no `verifier` calls appear; `verify` skill in 7 sessions only).

## 5. Correction themes (23 Pi rows; ~13 real corrections, rest noise: image resize, "create a branch")

1. **Fix not working / incomplete diagnosis (5)**: "Your patch don't seem to work: I test on ... products"; "what is the conclusion, the debug seem not finish, you don't tell me the root cause ?!"; "did this patch work on all browser ??"
2. **Wrong hypothesis, backend ignored (1-2)**: "your hypotheses are bad ... but did you look at the backend error"; "before change anything, tell me witch the best approch, because the fallback to /users/{id} don't seem appropriate".
3. **Not ambitious / too prudent (2)**: "stop be prudent ... destroy everything to rebuild it more stronger"; "audi everything, we don't make a demo apps".
4. **UX/copy quality (4)**: "the error is still not clear enough ... do not precise what type of account are expected"; "'Superutilisateur' is cringe just use 'Administrateur'"; "I see a lot of 'Option système non traduit'".
5. **Verbose/over-long outputs (2)**: "the AGENTS.MD is too long, remove useless or redundant information"; "Why I have 20 workflow, I don't need a release creation".
6. **Literal instruction misread (2)**: "When I say resolve, I mean fix them not close them ????!!!!"; "d'ou tu sort l'information que son anniversaire est le 16 ?" (hallucinated source). Also "Pourquoi tu ne parles de USD dans le document ?" (missed existing app state).
7. **Language convention (3)**: "first convert in english, not french"; "all the .md file are in english why the @CONTEXT.md are in french"; French comments in code.
8. **Unverified claim**: "It is the first time is see that, are sure ?" (index.html).

## 6. Implications for the skill stack

- **Fact**: the user's heaviest repeated flow is issue -> `/tdd` or implement -> commit/push -> PR. Skills used most are the cheap, mechanical ones (caveman-commit 112, unslop 65, caveman-comments 47). Heavy planning skills (grilling, to-spec, wayfinder) are nearly unused in Pi.
- **Fact**: he already runs map-reduce subagent fan-outs: parallel research, 3-axis review, owned-file parallel implementers, adversarial reviewers, audit fan-outs. Skills `subagents` and `background-terminals` that supported this are gone, but the prompts show the pattern persisted (the ownership-split prompt text is the reusable artifact).
- **Inference**: `diagnosing-bugs` should require (a) read the backend error/trace first, (b) state the root cause explicitly before proposing a fix, (c) sweep sibling pages/endpoints for the same contract bug. Evidence: corrections 1 and 2 and the "verify if this type of error is present in the other page" follow-up.
- **Inference**: a "fix is done" gate that reproduces the user's exact screenshot scenario would address corrections 1 (patch did not work). A verifier-driven browser check fits his existing manual loop.
- **Inference**: a thin "ship" flow (branch, commit, push, PR to the right base, `develop` vs `pprod`) already exists as templates; no new skill needed, but the base-branch rule (no direct push on develop/pprod) belongs in repo AGENTS.md, not a skill.
- **Inference**: UI copy/i18n audit (French-first, domain terms like "agent de crédit", no raw enum codes) recurs in 91 sessions and is only covered by `impeccable` (front-only, project-local). A tiny glossary rule per repo (`GLOSSARY.md`, domain-modeling) may be cheaper than a skill.
- **Inference**: finance-team xlsx diff (plan comptable) and recette document upkeep are Kari-specific recurring tasks; better as a repo doc/script than a global skill.
- **Fact**: research prompts for subagents are rewritten by hand each time ("sources EXCLUSIVEMENT officielles", "rédige le rapport dans /tmp/..."). The `research` skill (51 loads) covers it; check it enforces source-class constraints and an output path.
- **Inference**: do not re-add create-pr, tailwind-v4, supabase, code-review (superseded by branch-review). `AGENTS.md` should stay short: the user repeatedly asked to trim it.
