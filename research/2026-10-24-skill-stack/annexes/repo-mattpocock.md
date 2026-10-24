# mattpocock/skills vs the user's stack

Repo: `$S/repos/mattpocock-skills` (HEAD 5beb35b, 2026-10-19). Paths below are relative to that repo unless prefixed `~/.agents/`.
Usage counts come from the four session digests (claude, omp, pi-a, pi-b; 1,499 sessions, 2026-07-23 to 2026-10-24), summing `skills[name]` and `skills["/name"]`.

**Bottom line.** Matt and the user agree on almost everything except one point: how to ask questions. The user already runs Matt's ticket core (triage → implement → tdd → review → pr) on kari-banking and has improved on it locally. Only one clause is worth back-porting ("typecheck regularly" for implementers). Of the missing skills, none is worth installing as-is. The real gain is cutting: the planning layer above tickets is installed but unused (wayfinder, to-spec, to-tickets, improve-codebase-architecture, setup-matt-pocock-skills), and triage carries a 1,232-word duplicate of `agent-ready-issue`.

**Deliberate removals (do not re-add).** `code-review` (54 calls, 45 sessions) and `implement-spec` (21 calls, 10 sessions) are absent on purpose. Commit `2d49e50` ("own implement, branch-review and tdd") renamed `code-review` to `branch-review`, added a Correctness axis, and deleted `implement-spec` after folding it into `implement`. The historical calls all predate that commit. `teach` was dropped in `9525b83` "after three months of usage data".

---

## 1. Philosophy, with citations, against ~/.agents/AGENTS.md

| Matt's position | Citation | User's AGENTS.md | Fit |
|---|---|---|---|
| Small, composable skills you own, not a framework that "owns the process" (GSD, BMAD, Spec-Kit) | README.md:17-19 | "Question each layer… keep it only if a real constraint requires it" (:59-60) | Aligned |
| No new skill if the behaviour composes from existing ones | .out-of-scope/new-skills.md:9 | "Keep one obvious way to do it and remove the second" (:14) | Aligned. Matt's catalog breaks this rule itself (see §4). |
| A change must fix an observed failure, not a hypothetical one | SCOPE.md:9 | "fix small problems you find while working" (:47) | Aligned. The user's local edits are failure-driven (see §2). |
| Misalignment is the main failure. Fix it by being grilled before every change. | README.md:113-128 ("Use them _every_ time") | "Ask only when the decision is mine" (:43); "keep going" (:38) | **Conflict on frequency** |
| Grilling uses plain-text questions, never the harness question tool, and has no question cap | .out-of-scope/native-question-tool.md:3-9; question-limits.md:3-7 | "Use the ask tool: one decision, the options, and your recommendation" (:44) | **Direct conflict.** The user has already forked here: the local `implement` "asks the user with the ask tool". |
| Shared language (glossary) cuts verbosity and tokens | README.md:130-158 | "Reuse the project's existing terms: one name per concept" (:68) | Aligned |
| Feedback loops (types, browser, tests, red-green) are the speed limit | README.md:167-183 | `verifier`, "Never report success when verification is red" (:88, :98) | Aligned. The user is stricter on evidence. |
| Invest in design every day: deep modules | README.md:185-203 | "delete complexity instead of moving it" (:61) | Aligned |
| A user-invoked skill orchestrates; a model-invoked skill holds reusable discipline; operative cross-references say "call the Skill tool" | README.md:211; .agents/invocation.md:5-22 | (no equivalent) | Worth adopting as a convention in `writing-for-agents`. It already ships with Matt's text. |
| Decide context moves (continue / clear / handoff / subagent / compact) only at phase boundaries | skills/engineering/ask-matt/PHASE-BOUNDARIES.md:3-25 | Delegation rules (:83-90), nothing on phase boundaries | One reusable idea (see §3, ask-matt row) |

**Inference.** Matt's workflow is shaped for the maintainer of a public repo: label state machines, AFK agent briefs, external PRs as a triage surface, an `.out-of-scope/` knowledge base. The *ticket-centric core* still fits the user, and they use it: triage 14 calls in 9 sessions, implement plus implement-spec 41 calls, almost all on kari-banking in October. What does not fit is the *planning layer above the tickets* (wayfinder, to-spec, to-tickets), which shows zero effective use. Issues are written through the user's own `agent-ready-issue` instead (44 calls).

---

## 2. Locally refined skills (tdd, implement, pr, triage)

Source: `$S/history/mattpocock-drift.diff`, a diff against upstream HEAD. In all four skills the local copy is a superset of upstream in substance (implement is rewritten). **Nothing to back-port, with one small exception:** upstream `implement` says "Run typechecking regularly". Local implement has no such step for implementer subagents, so type errors surface only at the verifier's final gates. Add one clause to the implementer bullet list. Upstream's newest changes (1.3.0: implement-spec graduation, GLOSSARY rename, CHANGELOG.md:13-33) are already absorbed.

| Skill | What the user changed | Why it likely matters (inferred) |
|---|---|---|
| **tdd** | Added "Run only the focused test… Full suites and the repo's gates go to a `verifier`". Retargeted refactoring to `branch-review`. | Keeps the red-green loop cheap, and matches AGENTS.md:86-88 (main runs one focused test file, verifier runs gates). Upstream would leave the agent running full suites inside the loop. |
| **implement** | Upstream is 103 words ("Implement the work…"). Local is 967 words: one skill for one ticket or for a spec's task graph; conductor/subagent split; `git status --porcelain` baseline to catch edits that stray from the worktree; absolute paths inside worktrees; frozen install per worktree; ask-tool escalation; re-review of fix commits; verifier once; acceptance table with verbatim statuses. | Absorbs `implement-spec` (one obvious way). Each added rule reads like a scar from a real failure (wrong-tree edits, hooks without `node_modules`, fixes that regress, unchecked "not new" claims). The most valuable divergence. |
| **pr** | Added a screenshot-publishing recipe: `git mktree` + `commit-tree`, pushed to `pr-assets/<n>`, linked by commit. "Never ask the user to attach them." | Lets the agent attach visual evidence by itself on private repos (Gists fail, per the text). Directly serves "verify what the user does". |
| **triage** | Added a verifier brief with a setup deadline and progress reports. Each brief claim states its evidence type (static / mocked / live); "Mocks never prove persistence behavior". | Moves the evidence discipline upstream into the brief, so implementers know what is actually proven. |

**Triage: lock status.** Commit `fff0bd4` removed triage (and pr) from `.skill-lock.json`, but `~/.agents/skills/triage/` is still there. That is the correct move: README.md:95's `npx skills@latest update` would overwrite local edits on any locked skill. The user now owns it.

**Triage: open issues in the user's fork.**
- *Duplicate, one name per concept.* `triage/AGENT-BRIEF.md` (1,232 words) restates `agent-ready-issue` (333 words, written by the user, 44 calls): durable over precise, behavioural over procedural, testable acceptance criteria, explicit scope. **Recommend:** step 5 says "Call the Skill tool with `agent-ready-issue`" (keep the evidence-type line) and delete AGENT-BRIEF.md.
- *Maintainer ceremony.* `OUT-OF-SCOPE.md` (714 words), the AI disclaimer on every comment, and external-PR triage are built for a public repo. kari-banking has no outside contributors (inference). **Recommend:** trim them.
- *Observed failure* (corrections.jsonl, 2026-10-24 07:19, kari-banking): "il y a un ticket Youtrack qui est en attente de réponse du métier ? Ce ticket ne devrait pas être en triage. Il devrait être need info." `docs/agents/issue-tracker.md` in kari-banking says to check YouTrack, but the triage skill only reads GitHub labels. **Recommend:** one line in step 1: a linked YouTrack ticket awaiting the business moves the issue to `needs-info`. This is exactly the kind of failure that clears Matt's SCOPE.md:9 bar, but it belongs in the user's fork.

---

## 3. Upstream skills the user does not have

Coupling: Pi and OMP both honour `disable-model-invocation` (pi `docs/skills.md:53`; omp `src/capability/skill.ts:25-30`), so user-invoked skills behave the same across all three harnesses.

| Skill | Words (SKILL / all) | Purpose | Harness coupling | Overlap with local | Verdict | Reason |
|---|---|---|---|---|---|---|
| ask-matt | 1958 / 2657 | Router over Matt's catalog | Neutral | None; maps a catalog the user doesn't have | **Skip; fold one idea** | It routes to code-review, implement-spec, handoff and grill-me, so it would be "a router that lies" (upstream AGENTS.md:21). Fold PHASE-BOUNDARIES as one sentence into AGENTS.md's delegation section: "Change context (clear / subagent / handoff) only at a phase boundary; mid-phase, continue or delegate." |
| code-review | 1086 | 2-axis review | Neutral | `branch-review` (superset, 3 axes) | **Skip** | Deliberately replaced in 2d49e50 |
| implement-spec | 435 | Spec task graph via subagents | Neutral | `implement` (superset) | **Skip** | Deliberately folded in 2d49e50 |
| wizard | 673 + template.sh | Bash script that walks a human through manual setup (dashboards, secrets) | Bash; `gh secret` | None | **Skip, revisit on need** | Model-invoked, so its description costs tokens in every session. No observed demand; if a manual cutover comes up, install it user-invoked. |
| grill-me | 22 | `Call the Skill tool with "grilling"` | Neutral | `grilling` (model-invoked, already triggers on "grill") | **Skip** | Pure alias: a second way to do the same thing |
| handoff | 144 | Write a handoff doc to $TMPDIR | Neutral | None as a skill | **Skip** | 0 demand in 92 days. Subagents with context pointers cover it. |
| teach | 1522 / 2815 | Multi-session teaching workspace | Neutral | None | **Skip** | Removed in 9525b83 after usage data |
| to-questionnaire | 470 | Markdown questionnaire for a third party | Neutral | None | **Adapt only if needed** | The YouTrack "questions for the business team" flow is the real fit. A paragraph in kari-banking's `issue-tracker.md` (plain French, one question per idea, most important first) does the job without a skill. |
| wait-what | 60 | Re-pitch the last message in simple English plus GLOSSARY terms | Neutral | `bro` (40 words, 8 calls) | **Fold-into-existing (optional)** | Same need. Matt adds "use GLOSSARY.md vocabulary". Add that clause to `bro` if wanted. |
| git-guardrails-claude-code | 302 + script | PreToolUse hook blocking push, reset --hard, etc. | Claude Code only; jq | Claude permission deny rules | **Skip** | Frozen. Matt's own record says it is bypassed by `git -C` and fails open without jq (.out-of-scope/frozen-misc-skills.md:16-18). Native deny rules plus AGENTS.md:44 cover the need. |
| setup-pre-commit | 332 | Husky + lint-staged + Prettier | npm/Node | `retro` already flags missing guardrails | **Skip** | Wrong stack (the user prefers bun, uv, Python) and frozen |
| migrate-to-shoehorn | 415 | `as` → shoehorn in TS tests | TS lib | None | **Skip** | Niche, frozen |
| scaffold-exercises | 442 | Matt's course exercise layout | `ai-hero-cli` | None | **Skip** | Private tooling |
| in-progress/chief-of-staff | 607 | Long-running goal via subagents plus a dated wiki | Neutral | `implement` conductor; AGENTS.md:83 | **Skip** | Restates the user's delegation rules. One idea: date every memory claim and cite its commit. |
| in-progress/claude-handoff | 222 | Handoff and launch `claude --bg` | Claude Code only | None | **Skip** | Beta, single-harness |
| in-progress/loop-me | 415 | Grill out personal workflow specs | Neutral | `grilling` | **Skip** | Beta; personal-life loops, not dev work |
| in-progress/setup-ts-deep-modules | 1110 + config | dependency-cruiser enforcing package entry points | TS only | `codebase-design` | **Skip for now** | Beta. Good pattern (deep modules as a lint rule); revisit if kari-banking front gets package boundaries. |
| in-progress/writing-beats / -fragments / -shape | 852 / 595 / 1026 | Article drafting by grilling | Neutral | `unslop` | **Skip** | The Rnc sessions are personal notes and reply drafting, not articles (0 article-shaped prompts found) |

---

## 4. Installed byte-identical skills: weight vs what they deliver

**Cost model (fact).** User-invoked skills (`disable-model-invocation: true`) are kept out of automatic model selection in all three harnesses (OMP source: "excluded from the system prompt listing"; Pi docs: "Hide the skill from automatic model selection"; Claude Code: not listed in this session's skill list), so they cost about **zero tokens at rest**. Their body costs tokens only when invoked. Model-invoked skills pay for their description in every session. "Heavy" therefore means two things: maintenance and cognitive load for unused user-invoked skills, and per-call cost for frequently used ones.

**Lock mechanics (fact).** All 14 are lock-tracked (`.skill-lock.json`), so `npx skills@latest update` restores upstream text. Any "trim" verdict means *unlock first, then edit* (as fff0bd4 did for triage and pr), *or drop*.

| Skill | Words (SKILL / all) | Effective use, 92 days | Verdict | Reason |
|---|---|---|---|---|
| setup-matt-pocock-skills | 1030 / 2897 | 0 | **Drop** | Its output already exists and has been hand-extended (kari-banking `docs/agents/*.md`, 2,340 words, with YouTrack; fily-api). Whether it ran before the window or the docs were hand-written is unknown. Six skills keep a "run `/setup-matt-pocock-skills`" pointer, which is harmless because it fires only when config is missing. |
| wayfinder | 2075 | 0 (the 2 hits are this inventory session and an unrelated August session) | **Drop** | Built for concurrent multi-session work: GitHub child issues, assignee-as-claim, native blocking. A two-person shop with a subagent conductor (`implement`) does not need a ticket map in order to *plan*. |
| to-tickets | 917 | 0 | **Drop or keep as cold storage** | Issues are written through `agent-ready-issue` (44 calls). The task-graph idea already lives in `implement`. |
| to-spec | 493 | 0 (1 incidental) | **Drop or cold storage** | Same reason. "Synthesise the conversation into an issue" is one prompt to `agent-ready-issue`. |
| improve-codebase-architecture | 899 / 1823 | 0 | **Drop** | The user already questioned it today ("improve-codebase-architecture et codebase-design: pourquoi cela fait doublon ?", corrections 2026-10-24 11:06). Its vocabulary lives in `codebase-design` (24 sessions). The HTML report plus grilling is ceremony; "survey recent hot spots for deepening opportunities using codebase-design" is one prompt. |
| grill-with-docs | 35 | 0 | **Drop** | A one-line alias calling `grilling` and `domain-modeling`, both already model-invoked. A second way to do the same thing. The open question is whether `grilling` itself (5 calls) earns its place, given the user's preference for the ask tool. |
| prototype | 487 / 2630 | 2 | **Open request** | The user wrote "supprime: … prototype" on 2026-10-24 11:06. It is still in `skills/` and the lock (9525b83 dropped the others but not this one). Report it; don't act. |
| retro | 679 | 4, all this week on kari-banking | **Keep** | Actively used. It loads `writing-for-agents` (1,777 words) every run, by design (.out-of-scope/lazy-load-writing-for-agents.md:7). That is acceptable at 4 runs a week. |
| writing-for-agents | 1777 / 2191 | 6 | **Keep** | The user's skill-writing standard, and they edit skills often |
| diagnosing-bugs | 1427 | 68 calls / 65 sessions | **Keep** | Highest-value Matt skill. About 1.9k tokens per call is small next to a debugging session. |
| research | 131 | 59 | **Keep** | Cheap and heavily used |
| codebase-design | 851 / 1629 | 24 | **Keep** | Vocabulary layer for tdd and implement |
| domain-modeling | 493 / 1260 | 11 | **Keep** | GLOSSARY and ADR discipline. It overlaps the user's `writing-adrs` (530 words). Check that only one of them owns ADR format (not verified here). |
| grilling | 328 | 5 | **Keep, low priority** | Cheap. It conflicts in tone with the ask-tool rule; the user can steer that in AGENTS.md (native-question-tool.md:11 says this is the intended override). |

If all the drops land, about 8,200 words of SKILL bodies and their support files leave the stack (setup 2,897, wayfinder 2,075, ica 1,823, to-tickets 917, to-spec 493, grill-with-docs 35, plus prototype's 2,630 if the user confirms). Prompt tokens at rest barely change, because these skills are user-invoked. The gain is a smaller surface to keep in sync and fewer skills that each do the same thing.

---

## 5. Installability

- The generic route is README.md:92: `npx skills@latest add mattpocock/skills -a <agent>`, where the agent list includes `pi`, and you omit `-a` to choose interactively. Then README.md:95: include `setup-matt-pocock-skills`, update with `npx skills@latest update`, and re-run `add` for new skills. The bare form `npx skills add mattpocock/skills` appears in .agents/adr/0002-ship-as-a-claude-code-plugin.md:3.
- Plugin routes (`claude plugin install mattpocock-skills@claude-plugins-official`, README.md:35; Codex and Copilot marketplaces, README.md:46-67) auto-update. README.md:27 warns that installing both a plugin and skills.sh gives you every skill twice.
- **Fit for this user (inference):** stay on skills.sh. One `~/.agents/skills` directory serves three harnesses through symlinks, and a plugin would only cover Claude Code and would duplicate the skills there. The lock entries (`source: "mattpocock/skills"`, `skillFolderHash`) confirm skills.sh is the current route. Rule for local edits: **remove a skill from the lock before editing it**, or the next `update` reverts the edit.

---

## Facts vs inferences, unresolved

- Inferences: why each local edit was made (from its wording), the maintainer-shaped reading of Matt's flow, kari-banking having no outside contributors, whether the setup docs were generated or hand-written.
- Not verified: whether `domain-modeling` and `writing-adrs` give conflicting ADR formats; whether the user changed their mind on deleting `prototype` after the 11:06 discussion.
