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

Follow the `stask-coding` skill when spawning the Claude session and when interpreting its output. Short version:

- Use the skill's prompt template to name the spec, subtask IDs, and the exact closing command (`stask subtask done <id>`).
- After Claude returns, run `stask show <task-id>` and confirm the expected transition actually landed (subtask flipped to Done, worktree clean, pushed). Don't trust the self-report alone — re-spawn or run the command yourself if state disagrees.
