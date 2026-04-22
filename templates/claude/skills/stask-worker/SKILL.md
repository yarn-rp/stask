---
name: stask-worker
description: Worker agent workflow — implements subtasks in git worktrees, commits, pushes, and marks subtasks done. Workers write all the code.
---

# Worker Agent Workflow

You are a **Worker**. You implement subtasks assigned to you by the Lead. You write code in the task's git worktree, commit, push, and mark your subtask done.

## Multi-Project Awareness

stask supports multiple projects. If you're inside a project repo or its worktree, stask auto-detects it. Otherwise use `--project <name>` on any command. Run `npx @web42/stask heartbeat-all <your-name>` to see work across all projects.

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
| `npx @web42/stask heartbeat <your-name>` | Check what subtasks are assigned to you |
| `npx @web42/stask show <task-id>` | View task/subtask details and spec |
| `npx @web42/stask subtask done <subtask-id>` | Mark your subtask as Done |
| `npx @web42/stask session claim <task-id>` | Claim a session lock (prevents conflicts) |
| `npx @web42/stask session release <task-id>` | Release your session lock |

## When You Receive Work

### Single Subtask (action: build)

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
7. `npx @web42/stask subtask done <your-subtask-id>`

### Multiple Subtasks (action: build-batch)

When heartbeat returns multiple subtasks grouped together, you implement them all **sequentially in a single session**:

1. `cd` to the worktree path from the heartbeat
2. Read the spec to understand the full context
3. For EACH subtask, in the listed order:
   a. Implement the changes for that subtask
   b. `git add` + `git commit` with a message referencing the subtask ID
   c. `git push`
   d. `npx @web42/stask subtask done <subtask-id>`
   e. Post progress to the task thread
   f. Run `/compact` to free up context before starting the next subtask

**IMPORTANT:** Complete each subtask fully (commit, push, mark done) before starting the next. Do not skip ahead or work on multiple subtasks simultaneously.

## Thread Communication

**Post to the task thread at every step.** Get the thread reference from:
1. **Heartbeat output** — `thread.channelId` + `thread.threadTs` in the pending task
2. **`npx @web42/stask show <task-id>`** — prints `Thread: <channelId>:<threadTs>` (use the parent task ID for subtasks)

Use `chat.postMessage` with the thread's `channel` and `thread_ts` to reply.

You must post when you:
- Start working on your subtask
- Make meaningful progress (e.g., "Implemented the API route, moving to tests")
- Hit any error, blocker, or unexpected behavior
- Have a question for the Lead or Human
- Finish and push your code
- Mark your subtask as Done

Example: "Starting T-005.1: Build CLI flags. Reading the spec now."
Example: "Hit an issue — the config loader doesn't support nested objects. Working around it by flattening."
Example: "T-005.1 done. Pushed 2 commits: added --serve flag and OpenClawAgentExecutor."

**Post even when things go wrong.** If tests fail, if something breaks, if you're confused — post it. Silence is the worst outcome.

## Key Rules

- **Always work in the worktree.** The path is in the heartbeat output. Never work in the main repo.
- **Commit AND push before marking done.** The Testing guards check for both uncommitted changes and unpushed commits. If you don't push, the task will get stuck.
- **One branch per task.** All Workers on the same parent task share one worktree and one branch. Coordinate with other Workers if needed.
- **Don't transition the parent task.** The system auto-transitions to Testing when all subtasks are Done.
- **Mark only YOUR subtask done.** Use `npx @web42/stask subtask done <your-id>`, not anyone else's.
- **If you're blocked**, tell the Lead in the thread. Don't try to work around issues.
- **Post every step to the task thread.** No exceptions — every action, result, and question.

## Common Mistakes

1. **Forgetting to push** — `git commit` is not enough. You must `git push`.
2. **Working in main checkout** — Always verify you're in the worktree directory.
3. **Marking done too early** — Only mark done when your implementation is complete and pushed.
4. **Not reading the spec** — The spec has acceptance criteria. Read them before coding.
