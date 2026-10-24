# pstack (cursor/plugins, by poteto) vs ~/.agents

Paths below are relative to `$S/repos/cursor-plugins/pstack/` unless absolute. "Local" means `/Users/schalappe/.agents`.

## Verdict in one paragraph

Don't install pstack, and don't install any of its skills as-is. Most of its skills route through `poteto-mode` (3,152 words, 23 playbooks), a model-roles file (`pstack-models.mdc`), multi-vendor model panels (Opus + Grok) and Cursor cloud agents. That is the opposite of the user's "little compute, no ceremony" constraint. The value is in roughly 600 words of ideas spread across about ten files. Absorb those into AGENTS.md, `review-round/gate.ts`, `unslop`, `tdd`, `retro`, and two small new skills (`verify-app` generator, `benchmark-checklist`). Everything else is skip.

## 1. poteto's philosophy (facts, cited)

- **Depth before speed. Less code, higher quality.** "if you want to go fast, go deep first" (README.md:5). "pstack helps you write less, but higher quality code" (README.md:7).
- **Parallelism is earned by verification.** "when you can go deep on one agent and trust it to write good, verifiable code, you can truly parallelize" (README.md:9). Loops come last: "Make the loop autonomous only after all four hold" (docs/guide/07-overnight.md:9-16).
- **Model diversity as a review signal.** "Different models have different blind spots, so a finding two models raise independently is high-confidence signal" (docs/guide/04-design.md:69). Default panel is Opus 5.5 + Grok (README.md:43).
- **No planning skill. Plan through code.** "i don't believe in planning. the best spec is code" (README.md:271). "Prototypes answer the open questions ... the written plan comes last" (docs/guide/04-design.md:5). Adversarial review of a plan with no code "invent[s] theoretical risks" (04-design.md:89).
- **Prompt = goal + falsifiable done check + proof wanted + known facts + constraints** (docs/guide/02-poteto-mode.md:42-48). Hold back your theory of the cause at first (02:56-59).
- **Proof is an artifact, not prose.** "'It compiles' is not evidence" (06-verify-and-ship.md:3). "An artifact beats a plausible explanation" (06:27). "A confident reply without evidence is a warning sign" (06:17).
- **Verification is infrastructure.** A committed per-project skill drives the real app, then a small control CLI replaces throwaway scripts (06:51-82).
- **Fix the environment, not the prompt.** The ladder is architecture, then types/lint, then test, then docs. "Nothing fails when an agent skips a rule, so this comes last" (09-make-it-yours.md:35-40).
- **Autonomy with a hard stop at irreversible actions.** "Reversible work and external actions (team chat, ticket updates, kicking off evals) proceed without asking" (skills/poteto-mode/SKILL.md:83). "Green is not the same as safe" (06:158).
- **Steer with principle names.** 24 principles (README.md:225; not 28) act as vocabulary (08-principles.md:5).

**Comparison (inference).** The values match AGENTS.md almost line for line. The differences are scale and cost: poteto runs a fleet (Cursor Projects, cloud VMs, a 23-playbook router, two-vendor panels at xhigh), while the user runs one person, three harnesses and a cheapest-model-per-step `review-round`. poteto rejects planning; the user has `to-spec`, `to-tickets` and `wayfinder`. That is a philosophical disagreement, not a gap.

## 2. Installability (verified vs assumed)

**Verified from the `skills` CLI docs** (`vercel-labs/skills`, fetched with `gh api`, `docs/commands.md` and `docs/creating-skills.md`):
- A tree URL to a *single skill* directory is documented (commands.md:24-25). A tree URL to a container such as `cursor/plugins/tree/main/pstack` is not documented. `-s/--skill <name>` picks single skills (commands.md:70). `-g` installs globally. Symlink is the default, `--copy` is optional (commands.md:72, 122).
- Discovery walks `skills/` up to three levels and also reads `.claude-plugin/marketplace.json` or `plugin.json` (creating-skills.md:49-58, 120-140).

**Verified from the clone.** `cursor-plugins/.claude-plugin/marketplace.json` maps `pstack` to `./harness/pstack/claude-code`. That is a generated copy whose SKILL.md files add a line such as "read [the Claude Code adapter](../../docs/harness/claude-code.md)" (diff of `how`). So `npx skills add cursor/plugins --skill how` most likely resolves to the harness copy through the manifest. If no skills are found in standard locations, a recursive search runs (creating-skills.md:140), so `pstack/skills/how` could also match. Which one wins is inference.

**Assumed, not run (nothing installed).** A single installed skill would have dangling links (`../../docs/harness/claude-code.md`, poteto-mode's "Subagents section", `pstack-models.mdc`). OMP and Pi get no adapter. **Conclusion:** installation is technically possible but pointless. Every skill worth having needs rewriting anyway, so copy the text by hand into your own files and keep no lock entry.

## 3. Per-skill table

Word counts come from `$S/history/inv-pstack.md` (SKILL.md / all .md). Coupling key: **M** = `pstack-models.mdc` + multi-vendor panel, **P** = refers to `poteto-mode` sections or playbooks, **C** = Cursor-only (cloud agents, Automations, `.cursor/` transcripts, `create-skill`, `/loop`), **S** = ships scripts.

| skill | words | purpose | coupling | local overlap | verdict | reason |
|---|---|---|---|---|---|---|
| interrogate | 697/2959 | multi-model adversarial diff review, lead buckets findings | M, P | review-round, branch-review | fold-into-existing-skill | rubric adds missing defect classes; mechanism duplicates review-round |
| how | 399/1047 | subsystem walkthrough via 2-4 explorers + explainer | M, P | built-in Explore agent, research | skip | 0 "how does / comment ça marche" prompts in the session digests' user messages; Explore + research cover it |
| why | 1316/7886 | code archaeology across 7 MCP evidence categories | M, P, C (MCP discovery) | research | fold-into-AGENTS.md | sweep is team-sized; the epistemics are the gem |
| create-verification-skill | 1059/2426 | generate project `verify-<app>` skill: Launch/Doctor/Drive/Evidence/Cleanup + feature map | C (paths only) | verifier agent, review-round step 1 | adapt | fills a real structural gap (see 4.2) |
| maintain-verification-skill | 765 | daily audit of the feature map, one PR | P (light) | none | fold-into-existing-skill (the new verify generator) | daily cadence is team-sized; one upkeep line suffices |
| technical-writing | 1517 | Diátaxis + Google style + STE + Global English | none | unslop (33 rules), writing-for-agents, pr | fold-into-existing-skill (unslop) | 70% duplicates unslop; Diátaxis + Global English are new |
| architect | 815/2235 | design via how + arena, then implement | M, P, arena | codebase-design, prototype | skip | needs arena panel; usage-first idea already in codebase-design |
| blast-radius | 706 | find off-diff breakage, prove the one safety fact by running code | refs why/arena | branch-review (Correctness) | fold-into-AGENTS.md | one sharp idea, rest is review |
| correct | 435 | mine repeated mistakes, fix at highest enforcement level | none | retro, agents-md | fold-into-existing-skill (retro) | retro already has the ladder; add the proof step |
| figure-it-out | 653 | design a bespoke playbook for big or unattended work | P | wayfinder, implement, diagnosing-bugs | skip | meta-ceremony on top of poteto-mode |
| in-your-own-words | 48 | restate the user's goal | none | grilling | skip | a one-line prompt; a skill adds a description to every session |
| sharpen | 118 | rewrite a prompt deeper, not bigger | none | none | as-is (optional) | cheap, manual-only, no overlap; useful for briefs and Rnc |
| show-me-your-work | 1097 | TSV decision log + cross-model audit | P, C (transcripts) | review-round state files | skip | ceremony for overnight fleets |
| teach | 1018 | how + why woven into a lesson | M, P | none | skip | user deleted a `teach` skill on 2026-10-24 ("supprime: ... teach", corrections.jsonl; commit 9525b83) |
| typescript-best-practices | 437/1818 | TS rules table (unions, brands, no `as`, exhaustiveness) | principle refs, `paths:` | caveman-comments (docs only) | adapt | the user writes TS daily; rules are concrete |
| no-comments | 401 | spawn Comment Sicko to delete comments | C (custom agent), P | caveman-comments, AGENTS.md comment rule | skip | AGENTS.md:74-76 already says it |
| benchmark-checklist | 880 | 7 questions to vet a perf number | P (playbook refs) | diagnosing-bugs (perf) | adapt | real use: kari-banking perf-test-gates session (corrections.jsonl, 2026-10-15) |
| create/maintain-formal-verification-skill | 993 / 1239 | TLA+/prover target + project skill | refs statechart | none | skip | heavy; no evidence of need; revisit only for a ledger race |
| tdd | 489 | failing test first, for bug fixes | none | tdd (local, mattpocock-derived) | fold-into-existing-skill | 2 lines worth back-porting |
| bro | 40 | plain restatement | none | bro | as-is (already) | byte-identical except a trailing newline |
| unslop | 891 | AI-tell removal | none | unslop | skip back-port | local is ahead (adds `check.ts` + Jev); upstream diff is wording only |
| swarm | 458 | N workers over slices, one report | M, C (`environment: "cloud"`) | Agent tool fan-out | skip | Claude Code fans out natively; no cloud |
| arena | 708 | N candidates, judge, graft | M | none | skip | N × xhigh runs breaks the compute budget |
| automate-me | 1074 | mine transcripts into a `<you>-mode` skill | C (`.cursor/projects`, `create-skill`) | retro, AGENTS.md (built from history, commit 7e9eece) | skip | already done by hand |
| benny (3 skills) | 2220+2009+1648 | Slack triage → repro → draft PR | C (Automations) | triage | skip | Cursor Automations + Slack only |
| poteto-mode | 3152/19145 | router over 23 playbooks + principle index | C, S, M | AGENTS.md + implement + review-round | skip | the whole stack; reproduce-the-author risk |
| poteto-help | 2451/3647 | help desk for pstack | C | none | skip | only useful with pstack installed |
| make-bot-ui | 786 | webhook UI for Grok Bot | C (Automations webhooks) | none | skip | Grok Bot only |
| ketchup / ketchup-video | 1197 / 521 | catch-up + decisions waiting on you (video variant) | none / image-video gen | AGENTS.md "Talking to me" | fold-into-AGENTS.md | one rule is worth it; the skill is not |
| setup-pstack | 951 | write model-role file | M, C | none | skip | only for pstack |
| statechart | 1426 | TLA+ to Mermaid statechart | S (21 .mjs) | none | skip | niche, heavy |
| recall | 883 | rebuild context from transcripts + why sweep | C (transcript path) | retro, session digests | skip | Cursor path; why-sweep cost |
| reflect | 715/3107 | 3 reviewers + synthesizer improve skills | C, M | retro | skip | retro does this single-agent |
| principle-* (24) | 54-451 each | named rules indexed by poteto-mode | P | AGENTS.md | fold-into-AGENTS.md (5 rules) | see §5 |
| agents: poteto-agent, comment-sicko | 198 / 362 | delegate wrapper, comment reviewer | P | verifier, general-purpose | skip | tied to poteto-mode |

## 4. What exactly to change

### 4.1 interrogate into review-round (fold, about 110 words added)

**Why not the mechanism.** interrogate's value is cross-vendor diversity (SKILL.md:9, 42). review-round already separates reviewer (Fable, fresh `claude -p`, review-round/SKILL.md:91) from writer, and commit 206083a pins it to Claude. A Grok reviewer would add a vendor and double review tokens. Skip it.

**Why not the code-quality lens.** `references/code-quality-review.md` demands "code judo" restructuring and 1k-line blockers (lines 5, 21-23, 43): the oscillation review-round/SKILL.md:111 avoids. Skip it.

**What to fold:**
- **`gate.ts:53` `REVIEW_TASK`** (the prompt every slice gets, so each word costs slices × rounds). After "missing or incorrect tests for changed behavior", add about 60 words drawn from `interrogate/references/rubric.md:14, 25-27, 53`:
  > "Also report: a state-changing operation that breaks when it runs twice or after a crash halfway; a guard, retry, cast, or fallback that hides a broken invariant instead of fixing its cause; a check that reads a proxy (cache, mtime, self-report) instead of the real value. For a possible null or bad input, trace the caller before reporting."
  Cost: about 80 tokens × slices × rounds. A typical 2-slice, 3-round loop adds about 500 input tokens, which is negligible next to the 26k base (SKILL.md:91).
- **review-round/SKILL.md:113 (Fix step rejection reasons)**, from `lead-judgment.md:9-19`, about 30 words: add "the finding is hypothetical (the caller cannot reach that state; trace it) or is a preference with no concrete failure ('I would have done it differently')". This strengthens the Opus fixer's rejection test and cuts rounds lost to nitpick inflation.
- Run the change on one real PR and compare the findings and round count with the previous loop before keeping it. That follows poteto's own "eval skill edits" rule (09:74-88).

### 4.2 create-verification-skill (adapt, target about 450 words, new local skill `verify-app`)

**The gap (fact).** review-round step 1 makes the verifier re-derive launch, scenarios and evidence every round: "write 2–5 concrete scenarios ... start the real service against its real dev database" (review-round/SKILL.md:67-69, dispatch at :75). `verifier.md` is a generic 252-word executor. Nothing in the repo remembers *how* to launch kari-banking, which seeds to load, or which selectors are stable. A project-local verify skill would shorten every verifier brief, and it is exactly the "build the lever" idea at the right scale.

Changes:
- Keep §1 "Interview the repo, not the user" and the five Launch / Doctor / Drive / Evidence / Cleanup sections (SKILL.md:13-32). Drop "Helpers" as its own section and fold it into Drive.
- Write the result to the project's skills dir (`.agents/skills/verify-<app>/` or `.claude/skills/`), not `.cursor/skills/`.
- Cleanup: reuse verifier.md:28 wording ("kill by recorded PID"), which already matches SKILL.md:31.
- Feature map: cap it at 3-5 features, one short file each with "how to reach it / drive / proof / gotchas". Drop the bundled 1,367-word example and give the shape in five lines.
- Keep §4 "prove the generated skill once end to end" verbatim. It is the only part that stops a dead skill from shipping.
- Replace maintain-verification-skill with one line in the generated skill: "When a route, command, or seed changes, update the matching feature file in the same PR. If a drive fails on a feature the code still has, fix the map. If the code lost it, report a regression."
- Wire it in: review-round step 1 and verifier briefs say "if the repo has a `verify-<app>` skill, the scenarios use its Launch and Drive recipes".

### 4.3 technical-writing into unslop (fold, about 120 words)

unslop already covers filler, plain words, active voice, dashes, colons, jargon and dense sentences (rules 13-14, 23, 26-33). Add only what is missing:
- **Rule 34, one mode per document (Diátaxis).** Tutorial, how-to, reference or explanation. Don't mix them; split and link (technical-writing:30-49).
- **Rule 35, one reading only (Global English).** Keep "only" and "not" next to the word they change. Make every "it" and "this" point at one noun. Don't drop the verb in the second clause. No "a/b" or "(s)" (technical-writing:78-87).
- **Rule 36, condition before the instruction.** "To delete X, run Y." (technical-writing:56, 69).

This helps an author writing in a second language most. Keep the `N. **Name.** definition` shape so `check.ts` reads the new rules.

### 4.4 tdd back-port (fold, about 50 words)

Add to the local `tdd` "Rules of the loop", from pstack tdd:23, 27:
- "Prefer no new test over a bad one. A test that mostly checks mocks, needs heavy infrastructure for a small fix, or pins implementation proves less than running the real command."
- "When a failing test is impractical, use the closest executable check (a script, a CLI run, a browser repro) and report it as the before/after evidence."

### 4.5 correct into retro (fold, about 25 words)

retro already ranks fixes as mechanical check versus rule ("Automated checks", "Coding standards"). Add: "Prove each new check fails on a real past mistake from the session or git history before proposing it" (correct:26).

### 4.6 typescript-best-practices (adapt, target about 350 words)

- Inline the three `type-system-discipline` bullets (brand, parse at boundary, derive from schema) and delete the principle links.
- Drop the rows "Real tests" (covered by tdd) and "Structured telemetry" (covered by logging-best-practices).
- Keep `paths: ["**/*.ts","**/*.tsx"]` only after checking that each harness honors `paths:`. Not verified for Claude Code, OMP or Pi. Otherwise make it model-invocable through its description.
- Copy only `references/patterns.md` examples for brands and exhaustiveness. Trim the rest.

### 4.7 benchmark-checklist (adapt, target about 600 words)

- Remove the Perf issue / Hillclimb / Opening a PR playbook references (SKILL.md:34, 36-39).
- Keep the claim-first step, the seven questions and the verdict vocabulary (faster / slower / no measurable difference / inconclusive).
- Replace Linux-only tools with macOS equivalents next to them (`sysctl -n hw.ncpu` for `nproc`, Instruments or `sample` for `perf`, `py-spy` for Python, `bun --cpu-prof` for Bun).
- Description: "Use before reporting or acting on a measured speedup, regression, or test-gate timing."

### 4.8 AGENTS.md additions (from why, blast-radius, ketchup)

See §5 for the principle rules. Three more, about 70 words in total:
- (why/epistemics.md, "Sycophancy Trap" + "Unknown" tier) Under "Talking to me": "Treat a cause I suggest as one hypothesis and check it independently. 'Searched X, Y, Z and found nothing' is an answer: name what you searched."
- (blast-radius:34, 37) Under "Design": "For a risky change, name the one fact that makes it safe and prove it by running code, not by argument."
- (ketchup:15-30) Under "Talking to me": "End a long run with every decision waiting on me, each with your pick, its evidence, and its risk, decidable from the reply alone."

## 5. The 24 principles as a set vs AGENTS.md

**Structural note (fact).** Five principle files are near-empty. For example, `principle-exhaust-the-design-space` has a one-sentence body that only makes sense together with its description, and `encode-lessons`, `guard-the-context-window`, `laziness-protocol` and `migrate-callers` have 50-90-word bodies. The rule lives in the README index row (README.md:230-255) and in poteto-mode's inline index. The files are anchors for the router, not standalone guidance. That confirms they are a corpus, not install candidates.

**Already covered by AGENTS.md (no action):** boundary-discipline (AGENTS.md:68), never-block-on-the-human (Acting without me), prove-it-works (AGENTS.md:92-93), guard-the-context-window (Delegation), redesign-from-first-principles / subtract-before-you-add / outcome-oriented-execution / migrate-callers (AGENTS.md:58-62), fix-root-causes (partly, through "now is better than never" and "errors never pass silently").

**Complements AGENTS.md lacks, as candidate one-line rules.** In order of value; take the top 5 at most, about 120 words.
1. **attack-the-premise** (principle-attack-the-premise/SKILL.md:9-19): "After two fixes that share one assumption fail the same check, write the assumption down and test it before a third fix."
2. **make-operations-idempotent** (SKILL.md:9-22): "Every state-changing operation must survive running twice and a crash halfway. Check both before calling it done." (High value for a fintech ledger.)
3. **test-behavior-not-implementation** (SKILL.md:11-16): "A test must fail when the behavior breaks and keep passing when only the internals change."
4. **fix-root-causes, legitimate-state test** (SKILL.md:17): "Before adding a guard, ask whether that state is legitimate. If it should never exist, fix what produced it."
5. **explain-the-number** (SKILL.md:9-15): "Never report a measured number without its run count, its spread, and what limits it."
6. (lower, skip unless space) separate-before-serializing (SKILL.md:9-16) "remove the sharing before adding a lock"; model-the-domain (SKILL.md:24) "a second synced boolean means a missing state machine"; minimize-reader-load (SKILL.md:18) "where X comes from, in 30 seconds".

**Budget.** §4.8 and §5 together offer about 190 words for a 1,192-word AGENTS.md that loads in every session of three harnesses. Recommendation: a hard cap of four rules, about 90 words: complements 1, 2 and 4, plus the "one safety fact" rule from §4.8. Rules 3 and 5 move into `tdd` and `benchmark-checklist`, which load only when used. Drop the sycophancy and ketchup lines unless a session shows the need.

**Contradictions:**
- **laziness-protocol** "Minimize the diff. Make the smallest change that solves the problem" vs AGENTS.md:61 "Aim for the simplest final system, not the smallest diff". The user chose the opposite on purpose. Keep AGENTS.md.
- **never-block / poteto-mode Autonomy** "external actions (team chat, ticket updates, kicking off evals) proceed without asking" (poteto-mode/SKILL.md:83) vs AGENTS.md:44, which asks before "changing anything outside the repository". Keep AGENTS.md. For a fintech, a Slack or ticket write is not reversible in practice.
- **Philosophy, not a rule:** "i don't believe in planning" (README.md:271) vs the user's spec and ticket pipeline. The partial merge worth taking is poteto's "settle open questions with a prototype before writing the plan" (04-design.md:101-109), which the local `prototype` skill already supports.
- **Cost model:** poteto-mode defaults to xhigh effort and two vendors per review (poteto-mode/SKILL.md:93-95). The user's review-round deliberately picks the cheapest reliable model per step. Not a rule conflict in AGENTS.md, but a reason to reject most of pstack.

## 6. Unresolved assumptions

- The `skills` CLI's resolution of `cursor/plugins` to the harness copy was inferred from the docs and the manifest, not run.
- Whether Claude Code, OMP and Pi honor a skill's `paths:` frontmatter was not checked.
- The 18 "pourquoi" corrections ask why *the agent* acted ("pourquoi tu as crée un nouveau issue #338?"), so they are not demand for `why`.
