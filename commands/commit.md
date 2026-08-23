---
description: Stage changes and create a conventional git commit
allowed-tools: Bash(git add:*), Bash(git status:*), Bash(git commit:*)
---

# Commit Changes

## Context

- Current branch: !`git branch --show-current`
- Git status: !`git status`
- Changes: !`git diff HEAD`
- Recent commits (match style): !`git log --oneline -10`

## Task

Create a single commit for the changes above.

### Validation

If no changes to commit (clean working tree), report "Nothing to commit" and stop.

### Commit Message Format

Use conventional commits: `type(scope): description`

**Types:**

- `feat` - New feature
- `fix` - Bug fix
- `docs` - Documentation only
- `refactor` - Code restructuring (no behavior change)
- `test` - Adding/updating tests
- `chore` - Maintenance, dependencies, tooling

**Rules:**

- Subject line under 72 characters
- Use imperative mood ("add" not "added")
- Focus on *why* not *what* in body (if needed)

Stage all relevant changes and commit. Do not output any text besides tool calls.
