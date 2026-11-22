---
name: pr
description: "Use when writing or updating a pull request description, including when opening a PR."
metadata:
  credits:
    skill: show-me
    author: Dex Horthy
    organisation: Humanlayer
    url: "https://github.com/humanlayer/skills/blob/main/plugins/show-me/skills/show-me/SKILL.md"
---

Use this template for writing the PR body:

```markdown
## Summary

<diagram, diff-sketch, or tree>

## Evidence

- **Before:** <screenshot/output/failing test run>
  **After:** <screenshot/output/passing test run>

## Merge Danger

**Door:** <one-way or two-way>

<optional: description>

**Blast Radius:** <one-word description>

<optional: potential ramifications of merge>

**Revert:** <the step that undoes it, or why nothing can>
```

## Sections

Skip all preambles and keep prose brief. Use the user's domain language from `GLOSSARY.md`.

### Summary

Pick the smallest view that makes the key point clear.

Views by kind of change: pseudocode for logic, a call tree for control flow, a component tree for UI structure, a shallow file tree for layout or a refactor, Mermaid for interactions, `diff` forms when the surrounding shape already exists, the whole block when most of it is new. Read [summary-views.md](summary-views.md) for the shape of each view.

#### Guidance

Place each visual next to the short text it supports. Keep only the calls, files, props, states, and boundaries the reviewer needs to understand the change.

You may use one of these, you may use several, it is unlikely you will use all of them. Use your judgement and don't overwhelm the reviewer.

### Evidence

Concrete evidence that the change works. Show a before and after.

Screenshots are S-tier - when the environment is set up for it and the change is visual.

Publish screenshots yourself; never ask the user to attach them. Local files are not evidence. Push them to a side branch without touching the working tree, then link them pinned to that commit:

```bash
# $shots = folder of PNGs, $n = PR number
tree=$(for f in "$shots"/*.png; do printf '100644 blob %s\t%s\n' "$(git hash-object -w "$f")" "$(basename "$f")"; done | git mktree)
commit=$(git commit-tree "$tree" -m "screenshots for PR #$n")
git push origin "$commit:refs/heads/pr-assets/$n"
# in the body: ![after](https://github.com/<owner>/<repo>/blob/$commit/<file>.png?raw=true)
```

This uses the repo's normal git remote and credentials, so it works on private repos. Gists fail here (SSH host key, no HTTPS prompt). Keep the `pr-assets/<n>` branch: once nothing points to the commit, GitHub can drop it and the images break.

Execution-based evidence is A-tier. Test results, console output. Show the exact test that now fails and passes, using pseudocode.

### Merge Danger

Describe whether it's a one-way or two-way door. You can walk back through two-way doors, but not one-way doors. A PR that is cheap to roll back is lower risk. Changes that involve destructive actions or hard-to-reverse decisions are one-way doors.

The blast radius is the potential impact or scope of the changes introduced by this PR. Consider all possibilities. Examples are layout shift, breakages for consumers, mobile responsiveness, etc.

Revert names the concrete step that undoes the merge: `git revert` of the merge commit, a feature flag to turn off, a down migration. On a one-way door, say what cannot be undone (data deleted, a payment sent, a message delivered) and what limits the damage instead.
