---
description: Commit changes and push branch
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git add:*), Bash(git commit:*), Bash(git push:*)
---

Commit and push the current repository changes.

Steps:
1. If the working tree is clean, report `Nothing to ship` and stop.
2. Stage changes with `git add -A`.
3. Inspect staged changes and create one concise Conventional Commit.
4. Push to the current branch's upstream.
   - If no upstream exists, push with upstream tracking.
   - If no remote exists, commit only and report `Committed; no remote to push`.

Do not open PRs or print URLs.
