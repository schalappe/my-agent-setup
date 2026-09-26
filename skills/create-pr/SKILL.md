---
name: create-pr
description: Create a draft GitHub pull request from the current branch into a specified base branch, optionally using a GitHub issue for context. First step of the PR workflow (create-pr → /loop review-round → pr-guide). Use when the user asks to open, create, or submit a PR.
---

# Create pull request

Create a **draft** pull request from the current branch into the base branch supplied by the user. The body carries only the intent: `pr-guide` writes the full description after the review loop and marks the PR ready.

## Inputs

Interpret the first argument as the base branch and the optional second argument as the GitHub issue.

If the base branch is missing, stop and say exactly:

`Usage: /skill:create-pr <base-branch> [github-issue]`

## Validation

If `git status --porcelain` is not empty, stop and say exactly:

`Uncommitted changes; commit or stash before PR.`

If the current branch is the base branch, stop and say exactly:

`Current branch matches base branch; cannot create PR.`

## Inspect context

- Current branch: `git branch --show-current`
- Existing PR for the current branch: `gh pr view --json url --jq .url` (non-zero exit means none)
- After fetching, diff: `git diff --stat <base-branch>...HEAD` and `git diff <base-branch>...HEAD`
- After fetching, commits: `git log --oneline <base-branch>..HEAD`
- If an issue was provided: `gh issue view "<github-issue>" --json number,title,body,labels,url`

If an existing PR is found, output only its URL and stop.

If an issue was provided but cannot be read, stop and report the `gh issue view` failure.

## Create the PR

1. Fetch the base branch: `git fetch origin <base-branch>`.
2. Push the current branch to its upstream. If no upstream exists, push with upstream tracking.
3. Write a concise PR title: the issue title when one was provided and it matches the diff, otherwise a summary of the branch diff.
4. Write the PR body to a temporary file.
5. Create the PR as a draft:

```bash
gh pr create --draft --base "<base-branch>" --head "<current-branch>" --title "<title>" --body-file "<temp-file>"
```

Clean up the temporary file after `gh pr create` completes.

## PR body format

````markdown
## Intent

What changed, why, and the visible effect, in two to four sentences. Use the issue context when provided. No file lists, no diagrams: `pr-guide` adds those after the review loop.

Closes #123
````

Only include `Closes #123` or `Refs #123` when an issue was provided and the diff supports that relationship.

## Output

The PR URL, then on the next line:

`Next: /model @loop` then `/loop 5 --until '~/.omp/agent/skills/review-round/gate.sh' /skill:review-round`
