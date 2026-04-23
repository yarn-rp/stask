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

### After a spawned subsession returns

The subsession spawns a Claude Code session (see `../shared/CLAUDE-CODING.md`). When you write the prompt for Claude, **explicitly tell it which stask commands to run to close its work** — e.g. "When the spec is ready, run `stask spec-update <task-id> --spec <path>` and `stask transition <task-id> To-Do` per the stask-lead skill." Claude's agent file already instructs it to do this; naming it in the prompt makes the contract unambiguous.

Lifecycle-level mutations that you own as the orchestrator (spec approval gates, subtask creation + assignment, PR creation, transitions to Done) stay with you. Work-completion writes that close a specific session (subtask done, qa submit, spec-update for a task in your queue) can run inside Claude.

When Claude returns, **verify state** before transitioning further:
```bash
stask --project {{PROJECT_SLUG}} show <task-id>
```
Confirm the expected mutations actually landed. If Claude reported success but state disagrees, re-spawn with a corrective prompt or run the stask command yourself. Don't trust the report alone.
