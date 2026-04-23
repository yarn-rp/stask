# HEARTBEAT.md — {{BACKEND_NAME}} (Backend Worker)

## Pipeline Heartbeat

This heartbeat must be fast. Query for work, spawn subsessions, return.

### Step 1 — Check for pending work

```bash
stask --project {{PROJECT_SLUG}} heartbeat {{BACKEND_NAME_LOWER}}
```

Parse the JSON output. If `pendingTasks` is empty, reply `HEARTBEAT_OK` and stop.

### Step 2 — Check active sessions

For each pending task, call `sessions_list(activeMinutes=10)` and check if any session label contains `pipeline:<task-id>`.

### Step 3 — Spawn or refresh

For each pending task with no active session:

```js
sessions_spawn({
  agentId: "{{BACKEND_NAME_LOWER}}",
  cwd: "{{OPENCLAW_HOME}}/workspace-{{PROJECT_SLUG}}/{{BACKEND_NAME_LOWER}}",
  runtime: "subagent",
  label: "pipeline:<task-id>",
  task: "<prompt from the pendingTask JSON>"
})
```

If a session exists but `updatedAt` is older than `staleSessionMinutes` (from the heartbeat config), spawn a fresh one to replace it.

### Step 4 — Return

Reply with a summary of what was spawned (or `HEARTBEAT_OK` if nothing to do). Do NOT do any implementation work in this session — that's for the spawned subsessions.

### After a spawned subsession returns

The subsession spawns a Claude Code session (see `../shared/CLAUDE-CODING.md`). When you write the prompt for Claude, **explicitly tell it to close its work via the preloaded stask skills** — e.g. "When you're done, run `stask subtask done <id>` per the stask-worker skill." Claude's own agent file already instructs it to do this, but naming it in the prompt makes the contract unambiguous.

When Claude returns, **verify state** before marking your own work done:
```bash
stask --project {{PROJECT_SLUG}} show <task-id>
```
Confirm the expected transition actually happened (subtask status flipped, worktree clean, PR link attached, etc.). If Claude reported success but state disagrees, Claude likely hit a permission or CLI error — re-spawn with a corrective prompt or run the stask command yourself. Don't trust the report alone.
