---
description: Clean up local branches deleted from remote, including worktrees
allowed-tools: Bash(git branch:*), Bash(git worktree:*), Bash(rg:*)
---

# Clean Up [gone] Branches

## Context

Gone branches: !`git branch -vv | rg '\[.*: gone\]'`
Current worktrees: !`git worktree list`

## Task

Clean up all local branches marked as `[gone]` (deleted from remote but still exist locally).

### Execution Steps

1. **Identify [gone] branches** from the context above (filtered via `rg`)
   - Branches with `+` prefix have associated worktrees

2. **For each [gone] branch**, execute sequentially:

   ```bash
   # If branch has worktree (not the main worktree), remove it first
   git worktree remove --force <worktree-path>
   # Then delete the branch
   git branch -D <branch-name>
   ```

3. **Report results**:
   - List removed worktrees and deleted branches
   - If no [gone] branches found, report "No cleanup needed"

Execute all operations using Bash tool calls. Do not use any other tools.
