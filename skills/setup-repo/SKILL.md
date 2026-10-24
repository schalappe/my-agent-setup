---
name: setup-repo
description: "Configure a repo for the engineering skills: issue trackers, triage labels, and domain doc layout. Run before first use, or again to update an already configured repo."
disable-model-invocation: true
---

# Setup Repo

Write the per-repo configuration the engineering skills read:

- **Issue trackers**: where tickets live (GitHub by default, optionally a second tracker such as YouTrack)
- **Triage labels**: the strings for the `triage` verdict labels
- **Domain docs**: where `GLOSSARY.md` and ADRs live, and the rules for reading them

Explore, present what you found, confirm with the user, then write.

## Process

### 1. Explore

Read what exists; assume nothing:

- `git remote -v`: GitHub, GitLab, or none?
- Root `AGENTS.md` / `CLAUDE.md`: does either exist, and does it already point at `docs/agents/` (an `## Agent skills` block or any other link)?
- `.mcp.json`: an MCP server for another tracker (YouTrack, Jira, Linear) hints at a second tracker.
- `GLOSSARY.md`, `GLOSSARY-MAP.md`, `docs/adr/`, `src/*/docs/adr/`
- `docs/agents/`: present means **update mode** (step 3b).
- `.scratch/`: a local-markdown tracker already in use.
- Is the `triage` skill installed? This decides whether Section B runs.
- Monorepo signals: `pnpm-workspace.yaml`, a `workspaces` field in `package.json`, or `packages/*` with its own `src/`. Absent means single-context, which is almost every repo.

### 2. Present findings and ask

Summarise what's present and missing, then take the sections in order, one answer each. Lead each with the recommended answer so the user can accept it in a word. Skip a section exploration already settled (B when `triage` isn't installed, C without monorepo signals). In update mode, infer each answer from the existing files and ask only about gaps.

**Section A: Issue trackers.** Skills like `to-tickets`, `triage`, and `to-spec` read and write tickets there.

Primary tracker, proposed from the remote: **GitHub** (`gh`, the default), **GitLab** (`glab`), **Local markdown** (`.scratch/<feature>/`, for repos without a remote), or **Other** (the user describes the workflow in a paragraph; record it as prose).

Then ask whether a **second tracker** holds some tickets (recommended: **no** unless exploration found one). When yes, record for it:

- which ticket kinds live where (e.g. kari-banking: business requests and UAT defects in YouTrack, implementation issues on GitHub), and that a topic may exist in both, so both are checked;
- access path (CLI or MCP server from `.mcp.json`) and how a ticket is referenced (`project-<n>`);
- comment language and title conventions;
- assignee when a ticket is closed or handed back.

Record comment language and assignee for the primary tracker too when they differ from English and the user. Write all of it to `docs/agents/issue-tracker.md`.

**Section B: Triage labels.** Ask one question:

> Keep the default triage labels? (recommended: **yes**)

Defaults: `needs-triage`, `needs-info`, `ready-for-agent`, `wontfix`, each string equal to its name. Only on **no** (usually because the tracker already uses other names, e.g. `bug:triage`) collect the overrides, so `triage` applies existing labels instead of creating duplicates.

**Section C: Domain docs.** Default to **single-context** (one `GLOSSARY.md` + `docs/adr/` at the root); write it without asking. Offer **multi-context** (a root `GLOSSARY-MAP.md` pointing to per-context `GLOSSARY.md` files) only when exploration found monorepo signals.

### 3a. Confirm (first setup)

Show drafts of the `## Agent skills` block and of `docs/agents/issue-tracker.md`, `domain.md`, and `triage-labels.md` (the last only when Section B ran). Let the user edit before writing.

### 3b. Confirm (update mode)

For each existing `docs/agents/*.md`, compare it section by section with what this version would write:

- heading in the template, body unchanged from an older template: replace;
- heading in the template, body edited by hand: show both, ask;
- heading absent from the template (hand-written, e.g. "Blockers and grouping"): keep verbatim;
- template section no longer written (e.g. "Pull requests as a triage surface"): propose removal.

Show the full diff and write only on approval. Files this skill never writes (e.g. `pr-stacks.md`) stay untouched.

Tracker labels this version dropped (e.g. `ready-for-human`) go away: list the open tickets carrying each one with a proposed new label (`ready-for-agent` when briefed, else `needs-triage`), and on approval relabel them, then delete the label from the tracker and from any hand-written section of the docs.

### 4. Write

Edit `CLAUDE.md` if it exists, else `AGENTS.md`; if neither exists, ask which to create. Skip the block when the file already points at `docs/agents/`; update an existing `## Agent skills` block in place.

```markdown
## Agent skills

### Issue tracker

[one-line summary of where tickets live]. See `docs/agents/issue-tracker.md`.

### Triage labels

[one-line summary of the labels]. See `docs/agents/triage-labels.md`.

### Domain docs

[single-context or multi-context]. See `docs/agents/domain.md`.
```

Include the `### Triage labels` sub-block only when Section B ran. Then create each configured label the tracker lacks (`gh label create` / `glab label create`).

Seed templates in this folder:

- [issue-tracker-github.md](./issue-tracker-github.md), [issue-tracker-gitlab.md](./issue-tracker-gitlab.md), [issue-tracker-local.md](./issue-tracker-local.md): primary tracker
- [triage-labels.md](./triage-labels.md): label mapping (only if `triage` is installed)
- [domain.md](./domain.md): domain doc rules and layout

Write a second tracker, or an "Other" primary, as prose sections in `issue-tracker.md` from the Section A answers.

### 5. Done

Tell the user which skills now read these files, and that they can edit `docs/agents/*.md` by hand; re-running this skill updates them without losing those edits.
