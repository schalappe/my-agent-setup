# Visuals: lessons, session summaries, topic sheets

The learner learns from pictures first and text second. Every visual is a diagram, a decision flow, a before/after, a timeline, or an annotated example, with short text beside it.

## Self-contained HTML

Every HTML file starts as a copy of [sheet.html](sheet.html): a dark page, written to be reread on a phone, that prints light. It holds the stylesheet, the hand-lettering font (embedded, so the file opens offline), and the `rough` filter that makes diagrams look hand-drawn. Copy it with a command or a script (`cp`, or read it and write a new file), never by retyping: the embedded font is too long to reproduce by hand. Then replace only three things:

- `LANG` with the learner's language code;
- `TITLE` with the page title;
- `<!-- CONTENT -->` with the page's content.

Never edit the copied `<style>` block, and add no other style, `style` attribute, class outside the list below, script, stylesheet, font, or CDN.

## Look

The page reads like a friend's explanation sketched on a napkin: a hand-lettered title, a doodled diagram, and the one sentence that matters swiped with a highlighter. Hierarchy comes from the hand-lettered headings and from space. No cards, boxes, badges, pills, shadows, or emoji: they make a page read as generated.

Markup:

- `h1` for the title, with the score in it ("Session 4: 7/10"), then `<p class="date">`, and `<p class="moves">` with each box move in its own `<span>` (`<span>CR-03 2 → 1</span> · <span>TL-01 0 → 1</span>`) so no move breaks across lines;
- `h2` for each part, in a plain phrase ("Try to answer first", "What you learned");
- `h3` for each competency or situation, starting with `<span class="ok" role="img" aria-label="...">` or `<span class="ko" ...>` for a right or wrong answer, placed before the title so it never wraps alone (empty spans: the stylesheet draws the mark);
- `<p class="level"><span class="id">CR-03</span>fragile: review tomorrow</p>` for the competency ID and its level in words;
- `<span class="label">` for a field name inside a paragraph ("Your answer", "The pitfall");
- `<p class="rule"><mark>…</mark></p>` for the rule, the one sentence the highlighter swipes; one per competency, and `mark` on nothing else;
- `<span class="pitfall">` for a misconception;
- `<details><summary>` for a hidden answer;
- `<p class="src">` for a citation; `table` for review rows; `dl` for vocabulary; plain paragraphs for everything else, counts included ("3 competencies fragile, 1 solid").

The hand-lettering font is for headings, levels, labels, table headings, the reveal (`summary`), and diagram labels; body text stays in the system font.

## Diagrams

A diagram earns its place by showing what the text cannot: the fork where the deciding constraint sends the learner one way or the other, a before and after, a sequence. Draw it as `<svg class="sketch" viewBox="0 0 340 H" role="img" aria-label="what it shows">`, always 340 wide so labels keep their size on a phone, with the height `H` the drawing needs:

- paths, lines, and simple shapes only, with curves (`C` and `Q` commands) rather than ruler-straight lines; arrowheads as two short strokes;
- colour only through classes, never `fill` or `stroke` attributes, so the print version switches to light: no class for ordinary ink, `key` for the right path and the deciding element, `miss` for the wrong path, `faint` for secondary notes;
- ring or box the deciding element with a `key` shape, so the eye lands on it first;
- labels as `<text>` of three words or fewer, with the same classes, placed inside the `viewBox` and clear of every line; budget about 9 units of width per character (8 for `faint`), so a 12-character label needs about 110;
- at most about eight elements; one idea per diagram.

## Showing a lesson during a session

A lesson is shown, not stored. Show it with the host's inline HTML render tool when it has one. Otherwise, write the HTML to the OS temp directory and open it (`open` on macOS, `xdg-open` on Linux), then say in the chat that it is open. Keep a text fallback in the chat: the rule in one sentence, so the session continues if the page fails to open.

The journal's `Lesson` and `Visual` lines keep enough to redraw it in the session summary and the topic sheet.

## Session summary: `sessions/NNNN-<date>.html`

What happened in one session, written from the journal. Keep it short enough for the learner to reread in two minutes the next day.

1. **Header**: session number and score in the title (`Session 4: 7/10`), date, and the box moves (`CR-03 2 → 1`, `TL-01 0 → 1`).
2. **Recall first**: the session's two hardest situations, or its only one if it held a single question, each as a decision to make before reading on, with the answer and rule inside a closed `<details>` element.
3. **One entry per new competency or miss**, picture first: the `h3` and level, the lesson diagram, the rule in one sentence, then the situation in two lines, the learner's answer against the expected action, and the misconception if there was one.
4. **One row per correct review**: competency, situation in one line, box move.
5. **Met without explanation**: the notions from the journal's `Unexplained` lines, each with a one-line gloss, flagged as candidates for later sessions.

## Topic sheet: `topics/<module-id>.html`

Everything the learner has practised in one module, organised by competency, rewritten at the close of every session that touched the module. The learner opens it at work to answer "what do I do when…", so it reads by subject, never by date.

1. **Header**: module name, date updated, and the count of competencies per level (fragile, solid, acquired; see the box table in [PROGRAM-FORMAT.md](PROGRAM-FORMAT.md)), described as results in exercises.
2. **One section per competency out of box 0**, in program order, picture first: its level, a diagram, the `Rule`, its `Practices` as ways of doing it, a typical situation and the right action, its pitfalls, and the source citation.
3. **Vocabulary**: the terms of the module, one line each, in the words used in the sessions.
4. **Debates**: links to the `debates/` records that touched the module, each with its conclusion in one line.

Only practised competencies appear, so the sheet never runs ahead of the sessions. A debate can create a sheet before any competency is practised: it then holds the header and the debate links. Rewrite from the current sheet, `PROGRAM.md`, and the journal, keeping sections the session did not touch.
