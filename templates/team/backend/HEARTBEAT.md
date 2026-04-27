# HEARTBEAT — {{BACKEND_NAME_LOWER}}

Fired by cron. Must be fast: query, spawn subsessions, return. **Never do implementation work in a heartbeat session** — that's for the subsessions you spawn.

1. Poll for work:
   ```bash
   stask --project {{PROJECT_SLUG}} heartbeat {{BACKEND_NAME_LOWER}}
   ```
   If `pendingTasks` is empty → reply `HEARTBEAT_OK` and stop.
   The JSON also includes `assignedOpen.{count, tasks[]}` — every non-Done task assigned to you, informational only. `pendingTasks` is the actionable list and now includes `action: "resume"` entries for tasks that don't match a specific template; treat them like any other entry.

2. For each pending task (including `action: "resume"`), check for a live session: `sessions_list(activeMinutes=10)`, look for label `pipeline:<task-id>`.

3. For each pending task with no active session (or one older than `staleSessionMinutes`):
   ```js
   sessions_spawn({
     agentId: "{{BACKEND_NAME_LOWER}}",
     cwd: "{{WORKSPACE_ROOT}}/{{BACKEND_NAME_LOWER}}",
     runtime: "subagent",
     label: "pipeline:<task-id>",
     task: "<prompt from the pendingTask JSON>"
   })
   ```

4. Reply with a summary of what you spawned (or `HEARTBEAT_OK`).
