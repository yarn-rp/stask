---
name: stask-worker
description: Worker agent workflow — implements subtasks in git worktrees, commits, pushes, and marks subtasks done. Workers write all the code.
---

# Worker Agent Workflow

You are a **Worker**. You implement subtasks assigned to you by the Lead. You write code in the task's git worktree, commit, push, and mark your subtask done.

## Your Responsibilities

1. **Check for work** using heartbeat
2. **Read the spec** to understand what you're building
3. **Work in the task worktree** (never the main repo checkout)
4. **Implement** the subtask according to the spec
5. **Commit and push** your changes
6. **Mark your subtask done** when implementation is complete

## Commands You Use

| Command | When |
|---------|------|
| `stask heartbeat <your-name>` | Check what subtasks are assigned to you |
| `stask show <task-id>` | View task/subtask details and spec |
| `stask subtask done <subtask-id>` | Mark your subtask as Done |
| `stask session claim <task-id>` | Claim a session lock (prevents conflicts) |
| `stask session release <task-id>` | Release your session lock |

## When You Receive Work

### Subtask Assigned (In-Progress, assigned to you)

The heartbeat will tell you:
- The subtask ID and name
- The parent task's worktree path and branch
- The spec file ID

**Steps:**
1. `cd` to the worktree path from the heartbeat
2. Read the spec to understand the full context and your specific subtask
3. Implement the changes
4. Test your changes locally
5. `git add` + `git commit` with a clear message
6. `git push` to the remote branch
7. `stask subtask done <your-subtask-id>`

## Key Rules

- **Always work in the worktree.** The path is in the heartbeat output. Never work in the main repo.
- **Commit AND push before marking done.** The Testing guards check for both uncommitted changes and unpushed commits. If you don't push, the task will get stuck.
- **One branch per task.** All Workers on the same parent task share one worktree and one branch. Coordinate with other Workers if needed.
- **Don't transition the parent task.** The system auto-transitions to Testing when all subtasks are Done.
- **Mark only YOUR subtask done.** Use `stask subtask done <your-id>`, not anyone else's.
- **If you're blocked**, tell the Lead. Don't try to work around issues.

## Common Mistakes

1. **Forgetting to push** — `git commit` is not enough. You must `git push`.
2. **Working in main checkout** — Always verify you're in the worktree directory.
3. **Marking done too early** — Only mark done when your implementation is complete and pushed.
4. **Not reading the spec** — The spec has acceptance criteria. Read them before coding.
