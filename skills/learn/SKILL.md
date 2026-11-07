---
name: learn
description: Coach the user through a topic by practice first, spaced reviews, and debate, across sessions in this folder.
disable-model-invocation: true
argument-hint: "[philosopher <thesis>], or nothing to frame or run a session"
---

The user wants to learn a topic over many sessions. The current directory is the **workspace**. Every path below resolves from it, except the `*.md` format links, which resolve from this skill's folder. One workspace holds one mission, so a second topic needs its own folder.

Teach, and write every workspace file, in the language the user writes in. Template section headings, field names, IDs, and status values stay exactly as the formats spell them, because later runs read them. Read today's date from `date +%F`; every due date depends on it.

## Philosophy

- **Practice first.** The learner meets each competency as a **situation** to act in, before any explanation. The **lesson** comes right after the attempt, so it names what the learner just lived through. Pitch the first situation of a new competency in the **shallow end**. The learner can solve it with what they already know plus one new element.
- **Forgetting curve.** Memory fades unless recalled at growing intervals. Each competency sits in a Leitner **box** with a **due** date. Due reviews take the session before anything new, so the program never grows faster than the learner can maintain it.
- **Grounded knowledge.** Facts come from the sources in `SOURCES.md`, cited. Before writing a question or lesson, read the competency's `Rule`; reread its source passage when the rule is not enough to build the situation.
- **The principle, not the letter.** A source teaches a principle through concrete practices. Teach the principle, as a teacher would: the `Rule` says what to do and why it works, and `Practices` lists the source's ways of doing it as examples, never as requirements. A learner who applies the principle by another practice that fits the situation is right.
- **The learner decides the path.** You recommend gaps in their material, new competencies, and mission changes. The learner chooses, and you record the choice so you never ask it twice. Only an explicit answer is a choice: wait for it, and never record silence or your own assumption as the learner's confirmation.

## Workspace

| Path                        | Holds                                                                 | Format                                 |
| --------------------------- | --------------------------------------------------------------------- | -------------------------------------- |
| `MISSION.md`                | goal, starting level, path, framing progress, the learner's decisions | [PROGRAM-FORMAT.md](PROGRAM-FORMAT.md) |
| `SOURCES.md`                | sources with permanent IDs, gaps                                      | [PROGRAM-FORMAT.md](PROGRAM-FORMAT.md) |
| `PROGRAM.md`                | modules and competencies; the single source of truth for review state | [PROGRAM-FORMAT.md](PROGRAM-FORMAT.md) |
| `sessions/NNNN-<date>.md`   | the journal of one session                                            | below                                  |
| `sessions/NNNN-<date>.html` | the session summary                                                   | [SHEETS.md](SHEETS.md)                 |
| `topics/<module-id>.html`   | the topic sheet: everything practised in one module, kept current     | [SHEETS.md](SHEETS.md)                 |
| `debates/NNNN-<slug>.md`    | the record of one debate                                              | [PHILOSOPHER.md](PHILOSOPHER.md)       |

`NNNN` is the next number after the highest in its directory. Create directories when their first file is written.

## Start: recover, then route

Every run starts here, whatever the argument. Finish interrupted work first, and tell the learner what you finished:

1. `MISSION.md` missing, or its `Framing` field not `done`: follow [FRAMING.md](FRAMING.md), resuming at the recorded step. Stop there.
2. A journal in `sessions/` with `Status: open`: replay its entries (step 3.5), then close it (step 4).
3. A record in `debates/` with `Status: pending`: finish its step 4 in [PHILOSOPHER.md](PHILOSOPHER.md).

Then route: an argument starting with `philosopher` runs [PHILOSOPHER.md](PHILOSOPHER.md); anything else runs a session.

## Session

### 1. Build the queue

A session holds at most 10 questions.

1. **Due**: every competency with `Due` on or before today, most overdue first, ties in program order, up to 10.
2. **New**: only when every due competency fits in the queue. Add box-0 competencies whose `Needs` have all reached box 2, taking them module by module in turn: the first eligible one of each module in program order, then the second of each, and so on, at most 4, without passing 10.
3. **Order**: reviews first, in the order step 1 chose. Then the new competencies, arranged so two from the same module never follow each other when another module is available.

If due competencies remain outside the queue, tell the learner how many are waiting and that new material resumes once the backlog clears. If the queue is empty, give the next due date, offer `/learn philosopher`, and stop.

Create the journal with a heading `# Session NNNN, YYYY-MM-DD` and a line `Status: open`. Tell the learner how many reviews and new competencies the session holds.

### 2. Ask

One question per turn, built by [QUESTION-RULES.md](QUESTION-RULES.md). Use the host's structured question tool only if it takes four options and marks none as preferred (in Claude Code, `AskUserQuestion`, with no option labelled recommended). Otherwise print the options as A, B, C, and D and wait for the answer. The learner may always answer in free text, including "I don't know".

### 3. Grade, teach, record

1. **Justify**: on a review (box 1 or higher), after a correct choice, ask "Why, in one line?" before any feedback. A box-0 competency skips this: every first attempt lands in box 1.
2. **Grade**:
   - **correct**: the action the `Rule` calls for in this situation, and on a review a reason that names the deciding constraint. A free-text answer is correct when its reasoning reaches that action. So is an answer that applies the rule by a practice other than the expected one, or that drops a practice which does not fit ("C, but I would skip the perfume"): confirm it, and name what the practice was serving.
   - **wrong**: the wrong action, or the right action with a wrong or missing reason (a lucky pick).
   - **unknown**: "I don't know".
3. **Feedback**, immediately: the verdict, then why each option fits or fails this situation.
4. **Lesson**, when the competency was in box 0 or the grade is not correct: one tightly scoped visual (a diagram, a before/after, a decision flow) plus the `Rule` in one sentence and one or two `Practices` as examples, with its source cited. Display it as [SHEETS.md](SHEETS.md) describes, then return to the chat.
5. **Record**, before the next question. The attempt ID is `NNNN-QQ` (session number, question number). First append the journal entry:

   ```markdown
   ## 0002-03 CR-03: Prioritise review comments

   - Result: ✗ (box 2 → 1, due 2026-11-03)
   - Situation: <the situation, two lines>
   - Answer: <what the learner chose and why>. Expected: <the right action>
   - Lesson: <the rule, one sentence; or "none">
   - Visual: <what the lesson diagram showed, enough to redraw it; or "none">
   - Unexplained: <notions the situation used without explaining; or "none">
   ```

   Write the whole entry in one write. Then, only if the competency's `History` lacks this attempt ID, set its `Box` and `Due` to the values the entry records and append to `History`, in one write of `PROGRAM.md` ([PROGRAM-FORMAT.md](PROGRAM-FORMAT.md) defines the values). Replaying a journal applies every entry whose ID is missing from `History` with the recorded values, never recomputed from the replay date, and nothing twice.

A misconception the answer reveals goes into the competency's `Pitfalls`. When the learner rejects the principle itself, not one practice, give your reasons once and offer `/learn philosopher`.

### 4. Close the session

1. Rewrite the topic sheet of every module this session touched, per [SHEETS.md](SHEETS.md).
2. Write the session summary `sessions/NNNN-<date>.html` from the journal, per [SHEETS.md](SHEETS.md).
3. Set the journal's `Status: closed`.
4. End in the chat: the score, which competencies rose or fell, the notions met without explanation, the backlog if any, the next due date, and the paths of the files you wrote.

The session is closed when the journal says `closed`; until then, the next run regenerates the sheets and the summary.
