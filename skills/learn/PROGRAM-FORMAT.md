# Workspace state formats

This file defines the three Markdown files at the workspace root. Keep them plain Markdown: the learner reads them too.

## `MISSION.md`

```markdown
# Mission: {topic}

Framing: mission | knowledge | program | done

## Why

{1-3 sentences: the concrete outcome the learner is chasing. "Lead a team of five by June" beats "understand leadership".}

## Starting level

{What the learner already knows and does, in their words.}

## Path

{objective | material}: {one line, e.g. "material: the two PDFs in SOURCES.md, enriched on conflict management"}

## Decisions

- {YYYY-MM-DD}: {a choice the learner made, e.g. "declined enrichment on hiring; keep to the PDF there"}
```

`Framing` names the framing step in progress; [FRAMING.md](FRAMING.md) advances it and sets `done` last. Keep the file short enough to fit on one screen. Change the mission only after the learner confirms, and add a `Decisions` line saying what changed.

## `SOURCES.md`

```markdown
# Sources

- S1: [{title}]({url or local path}), reference: {what it covers; when to use it}
- S2: [{title}]({local path}), provided: {what it covers; its limits, e.g. "author's notes, unreviewed"}
- S3: [{title}]({url}), retired 2026-12-02: {why}

## Gaps

- {what the mission needs that no source covers}: {the learner's decision, or "open"}
```

- **IDs are permanent.** A new source takes the next number; an ID is never reused or renumbered, so citations in old summaries keep pointing at the same document.
- **reference** sources are high-trust: primary sources, recognised experts, peer-reviewed work. **provided** sources are the learner's material, taught from as they are; when one states something a reference source contradicts or that looks doubtful, say so in the lesson.
- **Retire** a source that turns out wrong or off-mission by marking it, never by deleting it. Before the next question, give each competency that cites it a new source and rule, or move it out of the program with the learner's agreement.
- Citations name the ID and a locator: `S1 p. 42` or `S4 §Resolving conflicts`.

## `PROGRAM.md`

```markdown
# Program: {topic}

## CR: Code review

### CR-01: Read a PR for intent before details

- Situation: {the kind of moment where this competency is used}
- Rule: {the principle: what to do and why it works, 1-2 sentences}
- Practices: {the source's concrete ways of applying it; or none}
- Needs: none
- Source: S3 p. 12
- Box: 0
- Due: none
- History: none
- Pitfalls: none

### CR-02: ...
```

- A **module** is a `##` heading: a short permanent ID, then its name. The ID names its topic sheet, `topics/<module-id>.html` (`topics/CR.html`, exactly as written), and prefixes its competencies. Renaming a module keeps its ID.
- A **competency** is a `###` heading: a permanent ID (module ID + number), then an action title. Write the title as something the learner does ("Prioritise review comments"), never as a definition ("What a nit is").
- `Situation` is the class of real moments where the competency matters; each question invents a fresh instance of it.
- `Rule` holds what the lessons and feedback teach, so a later run can teach without the original material at hand. Write it as a teacher sums up the source, at the level of the principle: "keep making yourself attractive to her, as before the marriage, because she notices the effort", not the source's list of grooming steps.
- `Practices` holds the source's concrete ways of applying the rule (the steps, phrases, gestures), with their locators when they differ from `Source`. They illustrate lessons and inspire options; no answer is wrong for omitting one.
- `Needs` lists competency IDs that must reach box 2 (one successful spaced review) before this one is introduced.
- `Pitfalls` lists misconceptions seen in sessions or debates, each with its origin (`0004-02`, `debate-0001`). They feed the wrong options in questions. Add one only if that origin is not already listed.
- Competencies appear in introduction order: prerequisites first.
- **Every new competency**, whichever mode creates it, starts with `Box: 0`, `Due: none`, `History: none`, `Pitfalls: none`.

## Boxes and due dates

| Box               | 0              | 1       | 2       | 3      | 4       | 5        |
| ----------------- | -------------- | ------- | ------- | ------ | ------- | -------- |
| Next review after | not introduced | 1 day   | 3 days  | 7 days | 16 days | 35 days  |
| Shown as          | new            | fragile | fragile | solid  | solid   | acquired |

Apply one result at a time:

- **Correct**: box + 1, capped at 5.
- **Wrong** or **unknown**: box 1. A misconception a debate settles counts as wrong.
- `Due` = the attempt's date + the new box's interval.
- Append `YYYY-MM-DD ✓|✗|? <attempt ID>` to `History` (`2026-11-21 ✓ 0002-03`, or `debate-0001` for a debate). The ID is what makes replaying a journal safe: a result whose ID is already in `History` is never applied again.

A competency in box 5 stays in rotation every 35 days: retention needs recall, and a miss sends it back to box 1.

The levels measure decisions made in exercises, not proven skill at work; sheets present them that way. The intervals are a reasonable starting schedule, not values taken from the literature. Change them here if the learner's results call for it.
