# HEARTBEAT — {{LEAD_NAME_LOWER}}

Fired by cron. Must be fast: query, spawn subsessions, return. **Never do delegation, spec writing, or code review inline** — that's for the subsessions you spawn.

1. Poll for work:
   ```bash
   stask --project {{PROJECT_SLUG}} heartbeat {{LEAD_NAME_LOWER}}
   ```

2. For each entry in `pendingTasks` (actions: `delegate`, `create-pr`, `review-qa-failure`, `request-approval`, `resume` — treat them all the same), check for a live session: `sessions_list(activeMinutes=10)`, look for `pipeline:<task-id>`. If none:
   ```js
   sessions_spawn({
     agentId: "{{LEAD_NAME_LOWER}}",
     cwd: "{{WORKSPACE_ROOT}}/{{LEAD_NAME_LOWER}}",
     runtime: "subagent",
     label: "pipeline:<task-id>",
     task: "<prompt from the pendingTask JSON>"
   })
   ```
   The JSON also includes a slim `summary: { totalAssignedOpen, awaitingApproval }` so you can see your full plate at a glance — informational only, doesn't drive spawning. The `request-approval` action means an unapproved task needs the human pinged in Slack; the prompt walks the spawned agent through it and includes a cooldown so you won't re-ping every tick.

3. Infrastructure checks (inline, fast):
   ```bash
   stask --project {{PROJECT_SLUG}} list --status "Ready for Human Review"
   stask --project {{PROJECT_SLUG}} list --status Blocked
   ```
   Ping {{HUMAN_NAME}} only for initial reviews; for PR-feedback actions spawn a subsession.

4. Reply with summary.
