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

Run these two quick checks:

```bash
stask --project {{PROJECT_SLUG}} list --status "Ready for Human Review"
```

**Important:** Only ping the human if the task is waiting for initial human review (no PR feedback yet). If the heartbeat already returned the task with an action like `address-pr-feedback`, that means the human already reviewed it and left comments — your job is to spawn a subsession to handle the feedback, NOT to ping the human again.

```bash
stask --project {{PROJECT_SLUG}} list --status Blocked
```

If any blocked tasks found, note them in your reply for awareness.

### Step 3 — Return

Reply with a summary: tasks spawned, blocked/review items flagged. Do NOT do delegation, spec writing, or code review work inline — that's for the spawned subsessions.