---
description: Commit the task's changes, push, and open a PR
argument-hint: "[ready] [no-pr]"
disable-model-invocation: true
allowed-tools: Bash(git:*), Bash(gh pr:*), Bash(gh repo:*), Skill
---

`/ship` is the user's explicit request to commit, push, and open a PR. Args: $ARGUMENTS

1. On the default branch: create a task branch.
2. Stage only this task's files. Files unstaged or untracked before the task stay out unless the task created them; if unsure, list them and ask. Nothing to stage: report `Nothing to ship`.
3. Commit with a message from the `caveman-commit` skill.
4. Push with `-u` (no remote: stop after the commit). `no-pr` in args: skip step 5.
5. `gh pr create`, body from the `pr` skill, base = the base branch the repo's AGENTS.md declares (e.g. `develop`), else the default branch; `--draft` unless args contain `ready`.
6. Remove the worktree this session created for the branch, from the main worktree.
7. Report the PR URL, or the pushed branch.
