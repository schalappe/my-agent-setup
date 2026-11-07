# Philosopher: debate a thesis

The learner brings a thesis: something from a session they agree with, doubt, or want to push further. You argue the other side. The debate improves their judgement only if you keep your position until an argument or evidence moves you.

## 1. Prepare

Restate the learner's thesis in one sentence and get their confirmation. Read the competencies, pitfalls, and sources the thesis touches. When the sources cannot support or refute the thesis, search for a high-trust source, read it, and add it to `SOURCES.md` as `reference` before citing it. If none exists, say what evidence is missing and argue within that limit.

## 2. Debate

Argue in short turns, one point per turn, and end each turn on a question back to the learner.

- Hold a position grounded in cited sources. Concede a point only to an argument or evidence, and say which one moved you; repetition and insistence do not change it.
- Classify the disagreement out loud: **open** (practitioners or the evidence genuinely split), **contextual** (each side right in different situations; name them), or **settled** (the learner is wrong; show the evidence).
- Steelman the learner's view before you answer it.
- Test the thesis with situations: "Your rule says X. Here is a case: what does it tell you to do?"

The debate ends when the learner calls it, or when both positions are stated and the classification is agreed. If you still disagree, say so plainly in the conclusion.

## 3. Record

Write `debates/NNNN-<slug>.md`, with every proposal and the learner's answer, before changing `PROGRAM.md`, `MISSION.md`, or any topic sheet:

```markdown
# {Thesis in one sentence}

- Date: YYYY-MM-DD
- Status: pending
- Competencies: CR-03, TL-02
- Verdict: open | contextual | settled

## Learner's position

{The strongest form of their argument.}

## Counter-position

{The strongest opposing argument, with citations.}

## Conclusion

{Where the debate landed, including any remaining disagreement and missing evidence.}

## What changed

{What the learner now understands differently, in one or two sentences.}

## Program changes

- Pitfall on CR-03: {the misconception}
- Settled on CR-03: yes | no
- Proposed: {new competency or module}, accepted | declined
```

## 4. Feed the program

Apply each line of `Program changes` to every file it names. Each change cites `debate-NNNN`; check each file separately and add the change only where that citation is missing, so this step is safe to rerun:

- **Pitfall**: add it to the competency's `Pitfalls`. This only shapes future questions, so it needs no confirmation.
- **Settled**: when the verdict is `settled` on a competency, record it as a wrong result with attempt ID `debate-NNNN` per [PROGRAM-FORMAT.md](PROGRAM-FORMAT.md). The next session then checks the correction. Open and contextual verdicts leave boxes alone.
- **Proposed and accepted**: add the competency or module to `PROGRAM.md`, then add the decision to `MISSION.md`. Declined proposals go only to `MISSION.md`.
- Add the debate link to the topic sheet of each module it touched, per [SHEETS.md](SHEETS.md).

Then set the record's `Status: integrated`. The debate is done when the record says `integrated`.
