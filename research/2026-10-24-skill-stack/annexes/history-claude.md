# Claude Code history: real workflow (114 sessions, 2026-09-24 to 2026-10-24)

Source: `$S/history/claude.jsonl`, `corrections.jsonl` (34 claude entries). Digests keep only the first 12 user messages and skill counts, so late-session steering is under-counted.

## 0. Shape of the data (fact)
- cwd: kari-banking 69 sessions (+3 worktrees), Rnc (personal writing/relationship use, no code) 25, ~/.agents 14, fily-verify 1. Median 4 user turns, max 33.
- Tools: Bash 3444, Agent 225 (46 sessions), Edit 193, Skill 64 (33 sessions), AskUserQuestion 28 (17 sessions), SendMessage 28, YouTrack MCP ~50 calls.
- ~25 Rnc sessions use a WhatsApp MCP for private reading and advice. No skill is used there (0 skills). Nothing to absorb, except that `mcp-client` is asked for by name in prose.

## 1. Workflow phases observed (kari-banking, Oct 15-24)
A highly regular pipeline, one fresh session per step, usually after `/clear` (11):
1. Intake: YouTrack ticket (business side, French) read via MCP, then `/triage` (6 sessions slash, 7 calls total), e.g. `/triage` then `#166`, `/triage en français`. Prose follow-ups group issues under parents: "regroupre les issues sans parents sous des issues parents selon les thèmes", "Récupère l'ensemble des issues, exclut les issues childs et les issues parents, et regroupe...".
2. Build: `/implement #N` (13 sessions) or `/implement-spec #N` (3). Inside it, agent-triggered: `tdd` 10, `code-review` 22 (13 sessions), `pr` 25 sessions, `agent-ready-issue` 3. So one `/implement` = tdd + code-review + pr, with Agent subagents (`<task-notification>` in 247 user turns).
3. Review: `/review-round 5` (21 sessions, args 3 to 6), one session per PR, in a separate fresh context. Ends with "mark PR ready".
4. Merge/cleanup: `/clean-gone` (4), plus prose "Supprime tous les worktrees" / "remove all worktrees" (15 mentions of worktree).
5. Ship in prose: "commit and push" 6x, "commit et push" 2x, "push and open/create a PR" 5x; `caveman-commit` auto-triggered 3x.
6. Meta, once a week: `/retro` (4), then "applique tout (1 à 6). Pour le 7 propose des solutions".
Infra seen: `/model` 4, `/advisor` 1, `/bro` 3 (plain-language restate).
Idea/spec stage (grilling, to-spec, to-tickets, wayfinder) is nearly absent in this harness: wayfinder 3 (1 session, mentions in ~/.agents analysis), grilling/to-spec/to-tickets 0. Tickets come from the business side (YouTrack), not from a grill session (inference).

## 2. Skill usage
| Skill | Calls / sessions | Mode |
|---|---|---|
| pr | 25 / 25 | agent-triggered (from implement / review-round) |
| review-round | 22+23 = 45 / 21 slash + 7 Skill | manual slash, then agent re-loads |
| code-review | 22 / 19 | agent-triggered, **now absent** |
| /implement | 13 / 13 | manual |
| tdd | 10 / 10 | agent-triggered |
| logging-best-practices | 9 / 2 | agent |
| implement-spec | 8+3 / 3 | manual, **now absent** |
| writing-for-agents | 6 / 6 | agent, mostly with `/retro` |
| /triage | 6 / 6 (+6 Skill in 1 session) | manual |
| /retro, /clean-gone | 4, 4 | manual |
| bro, caveman-commit, agent-ready-issue, mcp-client | 4, 3, 3, 3 | mixed |
| technical-writing, verification-recipe, security-and-hardening, explain, poteto-mode | 4,2,2,3,1 | **now absent**; mostly from the exploration sessions (reading skill files), not real use (inference) |

- Used historically, now absent (fact, from inventory): code-review, implement-spec, technical-writing, verification-recipe, security-and-hardening, explain, poteto-mode, runpod, claude-api (built-in).
- Local skills with zero calls in this harness (fact): agents-md (2, only in analysis sessions), codebase-design, diagnosing-bugs, domain-modeling, grilling, grill-with-docs, improve-codebase-architecture, impeccable, prototype, research, to-spec, to-tickets, setup-matt-pocock-skills, unslop (1), branch-review (1, analysis), writing-adrs (1, docs cleanup).
- Odd: `/bro` failed once ("( /bro ??? how that don't exist)"): the command was not available in that session.

## 3. Recurring ad-hoc tasks without a skill
1. **Commit + push (+ PR)**, ~14 prose requests: "commit and push", "stop here, just commit and push the fix previous and create a PR", "push et ouvre la PR en draft". Absorbable as a one-line AGENTS.md rule or a `ship` step; caveman-commit already handles the message.
2. **Worktree cleanup**, ~8 requests: "Supprime tous les worktrees", "remove all worktrees", "Tu peux supprimer le Worktree que tu as déjà créé". User already proposed the rule ("Once the branch is pushed, remove the worktree"), now in AGENTS.md. `/clean-gone` covers only branches (fact).
3. **Explain without jargon / "I don't understand"**, ~10: "explique moi sans jargon technique l'issue #195", "don't understand ? explain it ?", plus `/bro`. A global rule (lead with plain words, define terms) exists but is still violated.
4. **Issue hygiene on GitHub + YouTrack**, ~10: "create issues about the two tracked failures...", "Créer un ticket Youtrack par rapport à cela", "corrige #1 et #9", group-under-parent. No skill covers parent/child grouping or YouTrack link-back (inference: partly `triage` + `to-tickets`).
5. **Docs freshness after a milestone**, 2 large: "beaucoup de documentations qui ne sont pas à jour", "Oui, mets à jour les docs", "docs/operations/pprod-reinstall.md -> supprime". One-off, not a pattern yet.
6. **Short approvals**: "oui" / "do it" / "ok fais le" (35 short turns). See section 4.

## 4. Intervention points
- Fact: 28 AskUserQuestion calls (17 sessions); 9 digest turns are "Heads up" side-agent notes asking the user to decide (OHADA articles unreviewed, overdraft account 25111 netting forbidden by RCSFD, UC2 schedule changes by one installment, PDF rounding). These are real business decisions, so they are legitimate stops, but they come from `/review-round`, with the user as relay.
- Re-steering after a plan or report: "applique les trois propositions", "ok fais le", "oui, passe la PR en ready", "crée le groupe 1 et 2 uniquement" (user picks from a menu the agent offered).
- Re-explaining context: "To give you some context, we were trying to make the test faster..." after an Escape killed a session (1 session recovered by hand); "Background (from the session that started this one)" handoffs.
- Starting every step by hand: `/clear` then a slash command with an issue number; ~40 manual launches in 9 days. Inference: the chain triage -> implement -> review-round has no automatic handoff, the user is the scheduler.
- Business-domain questions from the user's side: user reads French accounting terms and corrects the agent's legal reasoning ("La loi lui permet de saisir le bien... On ne peut pas automatiquement dire...").

## 5. Correction themes (21 real corrections + 13 notification noise out of 34)
| Theme | n | Quotes |
|---|---|---|
| Question treated as instruction (violates "questions are read-only") | 3 | "I ask you ??? I don't say to do anything ???"; "non, show me before anython"; "Juste explique-moi." |
| Scope creep / unrequested action | 4 | "pourquoi tu as crée un nouveau issue #338? ... l'objectif était justement de reduire scope"; "If it isn't a dead code so why did you delete ?!"; "stop here, just commit and push" |
| Asking what could be looked up | 2 | "Pourquoi tu me poses cette question lorsque il y a un ticket Youtrack qui est en attente de réponse du métier ?"; "En fait je ne comprends pas ta question que tu poses" |
| Deferring ("later") instead of fixing | 2 | "do it now, not later... Don't create debt"; "corrige #354 aussi dans cette PR" |
| Jargon, unclear reports | 3 | "don't understand ? explain it ? ... Spotted, not fixed -> explain it"; "( /bro ??? how that don't exist)" |
| Incomplete or wrong retrieval | 2 | "tu n'as recuperer tous les issues ??"; "hypothèses non résolues ??" |
| Wrong tracker state (triage vs need-info) | 1 | "Ce ticket ne devrait pas être en triage. Il devrait être need info." |
| Cleanup left undone | 2 | "Tu peux supprimer le Worktree que tu as déjà créé si ce n'est pas déjà fait"; "faire le ménage sur Docker" |
| Rnc: over-interpretation / bad inference | 4 | "Je ne suis pas d'accord avec toi"; "il est nul à chier..." (personal use, outside the dev stack) |
- No language-switch correction found in this harness; the user mostly writes English in dev prompts and French for domain talk (fact). The "reply in French" rule exists and `/triage en français` was typed by hand once (inference: the rule is not reliably applied).
- False success: no direct "you lied" quote. Closest, via side-agent notes: "la PR pourra quand même être marquée prête" while "l'interface n'est jamais testée dans le navigateur" (fact, 1 note).

## 6. Implications for the skill stack
1. **review-round is the load-bearing skill** (21 slash, 45 calls) and the main source of interruptions (fact). Gap: it can mark a PR ready without browser verification, and it surfaces domain decisions as "Heads up" notes the user must relay (fact). Candidate: hard gate "no ready without UI evidence when UI changed", and batch the decisions into one list at the end (inference).
2. **implement bundles tdd + code-review + pr** (fact). `code-review` is absent now, so the agent probably uses `branch-review` or built-in review; check that `/implement` still resolves its code-review step (inference, verify in SKILL.md).
3. **No automatic chain** triage -> implement -> review-round -> clean-gone; user re-launches each after `/clear` (fact). A single "next ticket" driver is the only automation likely to save real time; a general pipeline would add ceremony (inference, against principle 2).
4. **Triage under-delivers on tracker state and completeness**: wrong state (need-info), asking questions already answered in YouTrack, missing issues in listing (3 corrections, fact). Does not know YouTrack as a source (inference).
5. **Read-only rule is not holding in practice** (3 quotes, fact). AGENTS.md already has "Questions are read-only"; the failure is behavioral, so a hook or a sharper line, not a new skill (inference).
6. **Plain-language explanation keeps being requested** (10 mentions + `/bro`). A one-line AGENTS.md default for status reports ("what changed, why it matters, decision needed") may remove most of them (inference).
7. **Ship step** (commit, push, PR, remove worktree) is ~14+8 prose requests: merge into one AGENTS.md sentence, not a skill (inference).
8. **Idea/design skills (grilling, to-spec, to-tickets, domain-modeling, codebase-design, diagnosing-bugs) have 0 invocations here** (fact). Do not conclude they are useless: work arrives as business tickets already written; diagnosing-bugs is likely replaced by plain "why is X" prompts (inference). Weak evidence either way.
9. `retro` is used weekly and feeds AGENTS.md edits (fact); it is a high-value, cheap loop, keep.
10. Domain correctness (OHADA/BCEAO/RCSFD) is a recurring source of risk: unreviewed web research sent to the business team (fact, side-agent note). A "cite primary source, mark unverified" rule is already in AGENTS.md; it was not applied (inference).
