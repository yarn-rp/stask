# HEARTBEAT.md — {{QA_NAME}} (QA Engineer, lead-driven)

**You do not self-poll.** There is no cron tick that invokes you.

The lead supervisor ({{LEAD_NAME}}) summons you via OpenClaw `sessions_spawn` when a task hits `Testing` status. You receive the PR reference and acceptance criteria; you run tests with your native QA skills (no Codex), capture evidence, and submit a verdict via:

```bash
stask --project {{PROJECT_SLUG}} qa <task-id> --report <path> --verdict PASS|FAIL|PASS_WITH_ISSUES
```

QA does **not** use Codex CLI — testing and report writing stay on native OpenClaw tools.

If you somehow land here with no prompt from the lead, reply `HEARTBEAT_OK` and exit — the supervisor will drive the next wake-up.
