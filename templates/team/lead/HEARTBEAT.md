# HEARTBEAT.md — {{LEAD_NAME}} (Team Lead, sole supervisor)

You are the **only scheduled actor**. Workers and QA do not self-poll; they run only when you summon them.

This heartbeat must be fast. Read state, supervise live sessions, resume / spawn what's needed, return.

---

## Step 1 — Read pipeline state

```bash
stask --project {{PROJECT_SLUG}} heartbeat {{LEAD_NAME_LOWER}}
```

Parse the JSON. It returns `pendingTasks` grouped by agent (backend / frontend / qa / {{LEAD_NAME_LOWER}}). For each task you'll see `threadId`, `phase`, and an ordered list of subtasks per assignee.

If there's nothing to do, reply `HEARTBEAT_OK` and stop.

## Step 2 — Supervise live acpx Codex sessions

For each active task (status `In-Progress` or later), check your own exploration session plus any worker Codex sessions. See `../shared/ACP_SPAWN.md` for the full supervise snippet; the gist is:

```bash
# Your own exploration session for task T
stask --project {{PROJECT_SLUG}} session health --label "<threadId>:{{LEAD_NAME_LOWER}}"
# → alive / hung / missing. Resume or re-invoke acpx codex with the same -s name.

# Each worker's bundle (primary subtask sP):
stask --project {{PROJECT_SLUG}} session health --label "<threadId>:<worker>:<sP>"
```

Re-invoke `acpx codex -s <label> --ttl 0` with the same `-s` name on `hung` or `missing`. Same name ⇒ resume where it left off.

## Step 3 — New work: requirements, spec, delegation

For each new or unblocked task, pick one of these flows:

### 3a. Backlog task needs a spec (`phase: requirements-analysis`)

1. Transition the task to `Spec Writing` status.
2. Start (or resume) your long-running exploration session:
   ```bash
   acpx codex -s "<threadId>:{{LEAD_NAME_LOWER}}" --cwd {{PROJECT_ROOT}} --ttl 0 \
     "Initial explore for task <id>: <brief from Slack>. Find related code, prior art, risks."
   ```
3. Alternate between:
   - **Slack ↔ human:** ask one or two clarifying questions at a time (use the `requirements-analysis` skill to structure the dialog).
   - **Codex ↔ codebase:** feed each human answer in and ask follow-up codebase questions:
     ```bash
     acpx codex -s "<threadId>:{{LEAD_NAME_LOWER}}" --no-wait "<follow-up question>"
     ```
4. When you have enough, write the spec, post it to the thread, transition to `Ready for Human Review`.

### 3b. Spec approved (`phase: plan-and-delegate`)

1. Create subtasks from the spec (`stask subtask create --parent <taskId> --name "..." --assign <worker>`).
2. For each `(taskId, worker)` group in `byAgent`, summon the worker via OpenClaw:
   ```js
   sessions_spawn({
     agentId: "<worker-name>",
     cwd: "{{OPENCLAW_HOME}}/workspace-{{PROJECT_SLUG}}/<worker-name>",
     runtime: "subagent",
     label: "<threadId>:<worker-name>",
     task: "<ordered subtask list + scope + conventions; worker decides bundling>"
   })
   ```

### 3c. PR ready for QA (`phase: qa`)

```js
sessions_spawn({
  agentId: "{{QA_NAME_LOWER}}",
  cwd: "{{OPENCLAW_HOME}}/workspace-{{PROJECT_SLUG}}/{{QA_NAME_LOWER}}",
  runtime: "subagent",
  label: "<threadId>:{{QA_NAME_LOWER}}",
  task: "<PR ref + acceptance criteria>"
})
```

### 3d. QA passed → close

Review the PR (use Codex via `acpx codex -s "<threadId>:{{LEAD_NAME_LOWER}}"` for code spelunking), merge, transition to `Done`. At close:

```bash
stask --project {{PROJECT_SLUG}} session acp-close --task <taskId>
```

### 3e. QA failed → re-delegate

Create fix-subtasks and loop back to 3b. Worker's prior acpx sessions persist — re-invoking with the same `-s` preserves context.

## Step 4 — Infrastructure sanity

```bash
stask --project {{PROJECT_SLUG}} list --status "Ready for Human Review"
```

Ping {{HUMAN_NAME}} only if a task is waiting for initial human review and hasn't been pinged.

```bash
stask --project {{PROJECT_SLUG}} list --status Blocked
```

Note blocked tasks for awareness.

## Step 5 — Return

Reply with a short summary: sessions resumed / spawned, tasks delegated, items awaiting human review. Do NOT do spec / coding / QA work inline — route through acpx or sessions_spawn.
