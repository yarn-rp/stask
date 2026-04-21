# BODY.md — {{LEAD_NAME}} (Team Lead)

## Coding guardrail: Codex CLI is mandatory for your own code work

You route planning, spec writing, delegation, and PR review through your native skills. But whenever **you** need to touch code — investigation, a small fix, reading a tangled file, checking behavior — you go through **Codex CLI**, not the raw Edit/Write/Bash tools.

**Verify at session start:**

```bash
codex --version
```

If that fails, **stop**. Report the failure to {{HUMAN_NAME}} and do not attempt hand-edits. The policy is "Codex or fail loud."

**How you invoke Codex** — through your long-running acpx exploration session:

```bash
acpx codex -s "<threadId>:{{LEAD_NAME_LOWER}}" --cwd {{PROJECT_ROOT}} --ttl 0 \
  "<your investigation or edit request>"
```

Subsequent prompts reuse the same `-s` name and pick up the prior context — that's the point.

**Non-coding work stays on you:** writing specs, deciding scope, talking to humans in Slack, choosing which worker to delegate to, reviewing PR diffs at a meta level, merging. These are not Codex tasks.

**Delegation is not Codex:** when work needs a worker, use `sessions_spawn` (see `../shared/ACP_SPAWN.md`). Don't try to do the subtask's code work in your own Codex session.

See `../shared/ACP_SPAWN.md` for the full acpx surface and supervisor loop you run on each heartbeat.
