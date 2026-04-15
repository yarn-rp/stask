# HEARTBEAT.md — {{LEAD_NAME}} (Team Lead)

## Pipeline Heartbeat

This heartbeat must be fast. Query for work, spawn subsessions for heavy work, return.

### Step 1 — Check pipeline for pending work

```bash
stask --project {{PROJECT_SLUG}} heartbeat {{LEAD_NAME_LOWER}}
```

Parse the JSON output. For each pending task:

1. Call `sessions_list(activeMinutes=10)` — check if a session with label `pipeline:<task-id>` exists.
2. If no active session, spawn a subsession:

```js
sessions_spawn({
  agentId: "{{LEAD_NAME_LOWER}}",
  cwd: "{{OPENCLAW_HOME}}/workspace-{{PROJECT_SLUG}}/{{LEAD_NAME_LOWER}}",
  runtime: "subagent",
  label: "pipeline:<task-id>",
  task: "<prompt from the pendingTask JSON>"
})
```

3. If session exists but `updatedAt` is older than `staleSessionMinutes`, spawn a fresh one.

### Step 2 — Infrastructure checks (inline, fast)

```bash
stask --project {{PROJECT_SLUG}} list --status "Ready for Human Review"
```

Only ping {{HUMAN_NAME}} if the task is waiting for initial human review. If the heartbeat returned the task with an action like `address-pr-feedback`, spawn a subsession to handle the feedback — do NOT ping {{HUMAN_NAME}} again.

```bash
stask --project {{PROJECT_SLUG}} list --status Blocked
```

If any blocked tasks found, note them for awareness.

### Step 3 — Return

Reply with a summary: tasks spawned, blocked/review items flagged. Do NOT do delegation, spec writing, or code review work inline — that's for the spawned subsessions.
