# Framing: the first run

Framing turns a goal, and any material the learner brings, into `MISSION.md`, `SOURCES.md`, and `PROGRAM.md`. [PROGRAM-FORMAT.md](PROGRAM-FORMAT.md) defines their formats.

The `Framing` field of `MISSION.md` records the step in progress. On a resumed run, keep what the learner already confirmed, read the files written so far, and continue from that step.

## 1. Mission

Create `MISSION.md` with `Framing: mission` at the first answer, and fill it in as the learner answers, so an interrupted interview resumes where it stopped. Interview the learner one question at a time until each point below has an answer:

- the concrete outcome they want and why (push past "understand X" to what changes in their work or life);
- what they already know and do;
- the material they have, if any: files, links, courses.

Done when the learner confirms the drafted `MISSION.md`. Set `Framing: knowledge`.

## 2. Knowledge

The path follows from the material:

- **Objective path** (no material, or the learner wants you to find it): search high-trust primary sources for what the mission requires, read them, and list them in `SOURCES.md` as `reference`.
- **Material path** (the learner brings material): read all of it and list each file in `SOURCES.md` as `provided`. For a PDF, get the page count from the host's PDF reader or `pdfinfo`, then read every page, in ranges, with the reader or `pdftotext -layout`. Pages with no extractable text (scans, figures) need the reader's page images. If a page cannot be read by any available means, name the pages and stop: framing waits until the learner supplies a readable copy.

On the material path, compare what the material covers with what the mission needs, then report each gap in plain words with why it matters: "your PDF never covers running a meeting, and a tech lead runs several a week". Recommend enrichment where a gap blocks the mission, and let the learner choose gap by gap. An accepted gap gets researched `reference` sources; a declined gap stays out of the program, and the other gaps keep their own decisions. Record each choice in `MISSION.md` `Decisions` and in `SOURCES.md` `Gaps`. Raise a declined gap again only if it blocks a situation in a later session.

Done when every page of every source is read and every gap has a decision. Set `Framing: program`.

## 3. Program

Distil the knowledge into `PROGRAM.md`:

- modules that map the mission, each with a permanent ID, holding competencies phrased as actions;
- every competency carries its `Rule`, the principle distilled from the source rather than copied from it, its `Practices`, and a source locator, so later sessions teach from the workspace and reread a source only to deepen a situation;
- prerequisites in `Needs`, competencies ordered so each one's needs come first.

Show the learner the program as a visual map of modules and competencies (per [SHEETS.md](SHEETS.md), shown, not stored), and adjust it to their feedback.

Done when the learner accepts the program and `PROGRAM.md` is written. Set `Framing: done` last.

## 4. Hand-off

Tell the learner the workspace is ready, what each file holds, and that the next `/learn` starts their first session. Start a session now only if they ask.
