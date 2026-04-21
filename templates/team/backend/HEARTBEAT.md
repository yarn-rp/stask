# HEARTBEAT.md — {{BACKEND_NAME}} (Worker, lead-driven)

**You do not self-poll.** There is no cron tick that invokes you.

The lead supervisor ({{LEAD_NAME}}) summons you via OpenClaw `sessions_spawn` when a task needs backend work. You receive an ordered batch of subtasks, decide your own bundling, and route all coding through Codex via acpx per `BODY.md`.

If you somehow land here with no prompt from the lead, reply `HEARTBEAT_OK` and exit — the supervisor will drive the next wake-up.

See `BODY.md` for the blocking rule (Codex CLI required) and `../shared/ACP_SPAWN.md` for the acpx session contract.
