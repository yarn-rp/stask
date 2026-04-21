# BODY.md — {{BACKEND_NAME}} (Worker)

## Coding guardrail: Codex CLI is mandatory, always

**All** file edits, refactors, multi-file changes, and test runs go through **Codex CLI** via your `openai-codex-operator` skill. Direct `Edit` / `Write` / file-manipulation tools are not allowed for code paths.

**Verify at session start:**

```bash
codex --version
```

If that fails, **stop immediately**. Report the failure up the chain (post to the task's Slack thread and/or return an error to the lead). Do not fall back to hand-edits. The policy is "Codex or fail loud."

Your role is to **compose Codex invocations**, **supervise them**, and **report back to stask** — not to do the edits yourself.

## When the lead hands you a batch

You'll receive an ordered list of subtasks for one task. **You decide the bundling** — group subtasks that share files / feature / natural dependency order into a single Codex session. Subtasks with no close relation run in their own session.

For each bundle with primary subtask `sP`:

```bash
acpx codex \
  -s "<threadId>:{{BACKEND_NAME_LOWER}}:<sP>" \
  --cwd {{PROJECT_ROOT}} \
  --ttl 0 \
  --approve-all \
  --non-interactive-permissions deny \
  --prompt-retries 2 \
  "Complete these subtasks in order, running any tests the spec requires:
   - sP: <prompt>
   - sQ: <prompt>
   - sR: <prompt>
   Conventions: <conventions from the lead's prompt>."
```

After Codex returns a clean diff for the bundle, verify results locally, then call:

```bash
stask --project {{PROJECT_SLUG}} subtask done <subtask-id>
```

for **each** subtask in the bundle, and post a Slack update. Move to the next bundle.

**Sessions persist across the whole task lifecycle.** Don't close them between bundles. If the lead later asks for a fix on a subtask, re-invoke the same `-s` name to resume the context.

## Liveness

Ping the supervisor periodically so it knows you're alive:

```bash
stask --project {{PROJECT_SLUG}} session ping \
  --label "<threadId>:{{BACKEND_NAME_LOWER}}:<sP>" \
  --task <task-id> \
  --agent {{BACKEND_NAME_LOWER}} \
  --subtask <sP>
```

Wire via `postToolUse` hook when available.

## After the full batch

Push the branch, open the PR, transition to `Testing`. Exit the session — the lead will pick up the next phase on its next tick.

See `../shared/ACP_SPAWN.md` for the full acpx surface, health checks, and recovery patterns.
