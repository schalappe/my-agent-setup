---
name: pr-guide
description: Build the reader's guide for the current branch's pull request — an HTML page (reading order, change map, diagrams, review-loop report) plus the final PR body — and mark the PR ready when the review loop converged. Last step of the PR workflow (create-pr → /loop review-round → pr-guide). Use after a review loop or when the user asks to explain or document a PR.
---

# PR guide

Produce the document a human reviewer reads before the diff. It goes to an HTML page built from `skill://pr-guide/template.html` (every guide looks the same) and, in condensed markdown form, to the PR body.

## Resolve context

- Branch: `git branch --show-current`
- PR of the current branch: `gh pr view --json number,title,url,baseRefName,body,isDraft`
  - No PR → stop and say exactly: `No PR for branch <branch>; run /skill:create-pr first.`
- Repo slug: `gh repo view --json nameWithOwner --jq .nameWithOwner`
- Review state: `dir=$(git rev-parse --git-dir)/review`
  - `status` = content of `$dir/status` when present; else `capped` when any `round-*.json` exists; else `unreviewed`
  - Load every `$dir/round-*.json` (`ls | sort -V`)
- Diff: `git fetch origin <base>`; `mb=$(git merge-base origin/<base> HEAD)`; `git diff --stat $mb`, `git diff $mb`, `git log --oneline $mb..HEAD`

## Understand the change

Read the whole diff. When the diff alone does not explain a choice, read the surrounding code. Then write the content below. Every section answers a question the reviewer would ask; skip a section rather than pad it. Name things by what they do, not by how they are built.

- **intent** — two to four sentences: what changed, why, visible effect. From the PR body and the diff.
- **reading order** — files in the order that makes the change easiest to follow: contract or entry point first, then implementation, then tests. One line each on why it is there.
- **change map** — one row per meaningful file or group: what changed (not line by line), lines added and removed.
- **flow** — one mermaid diagram (`sequenceDiagram` or `flowchart`) only when runtime flow, data flow, or state transitions changed. Otherwise none.
- **decisions** — choices in the diff that had alternatives: choice, alternative, why. Omit when there were none worth naming.
- **review report** — from the round files: per round checks/findings/major/fixed/rejected; each rejected finding with its reason; minor findings left for the human.
- **check by hand** — three to six concrete things the human should verify that automation did not: behavior without tests, risky edges, UI, migrations, configuration, the rejected findings if any are debatable.

## Build the page

Read `skill://pr-guide/template.html`. Replace every `{{slot}}`. Fragments use only the template's classes and elements; the only inline style allowed is the bar widths.

| Slot | Content |
|---|---|
| `title`, `repo`, `pr_number`, `pr_url`, `base` | From the PR |
| `status_class` | `ready` (status converged), `stalled`, `capped`, `unreviewed` |
| `status_label` | `Ready for your review` / `Draft: review loop stalled, N major findings remain` / `Draft: review loop capped after N rounds` / `Draft: not reviewed` |
| `generated` | `YYYY-MM-DD HH:MM` local time |
| `stats_files`, `stats_added`, `stats_removed`, `stats_commits`, `stats_rounds` | Numbers from diff stat, log, round files |
| `intent` | One or more `<p>` |
| `reading_order` | `<li><span class="path">path/to/file.ts</span><span class="why">why it comes here</span></li>` |
| `change_map` | `<tr><td class="path">path or group</td><td>what changed</td><td class="bar"><div class="track"><span class="add" style="width:60%"></span><span class="del" style="width:40%"></span></div><span class="count">+120 −80</span></td></tr>` — widths are the row's added/removed share of `added+removed` |
| `flow_section` | `<section id="flow"><h2>How it flows now</h2><pre class="mermaid">…</pre></section>` or empty string |
| `decisions` | `<li>Choice. <span class="reason">Alternative: …; why: …</span></li>` or `<li class="empty">No alternatives worth naming.</li>` |
| `rounds` | `<tr><td>1</td><td class="verify green">green</td><td>4</td><td>2</td><td>1</td><td>1</td></tr>` (`verify red` for red); status unreviewed → `<tr><td colspan="6">Review loop not run.</td></tr>` |
| `rejected` | `<li><span class="path">file:line</span> title <span class="reason">— reason</span></li>` or `<li class="empty">None.</li>` |
| `minors` | `<li><span class="path">file:line</span> title</li>` or `<li class="empty">None.</li>` |
| `check_by_hand` | `<li><span>One concrete verification.</span></li>` — the inner `<span>` is required, it carries the highlight |

Write the page to `~/.omp/pr-guides/<owner>-<repo>/pr-<N>.html` (`mkdir -p`), then `open` it.

## Update the PR

Write the body to a temporary file, then `gh pr edit <N> --body-file <file>`; delete the file. Keep any existing `Closes #` / `Refs #` line.

````markdown
## Intent

…

## Read in this order

1. `path` — why

## Changes

| Where | What changed |
|---|---|
| `path` | … |

## Review loop

<status label>. Rounds: N. Fixed: N. Rejected: N (listed below). Minor left for the human: N.

- Rejected: `file:line` title — reason

## Validation

One bullet per entry of the last green round's `verified` list (checks and live scenarios); `Not run` when unreviewed.

## Check by hand

- …

Closes #123
````

When `status` is `converged` and the PR is a draft: `gh pr ready <N>`. Any other status leaves the PR a draft.

## Output

```
Guide: <path>
PR: <url> — ready | draft (stalled: N major findings remain) | draft (capped after N rounds) | draft (not reviewed)
```
