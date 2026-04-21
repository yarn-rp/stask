# ACP_SPAWN.md — Shared acpx spawn & supervise snippet

All roles that invoke a coding CLI reference this. `acpx` is the headless ACP CLI; sessions are named per `<threadId>:<agent>[:<subtask>]` and persist for the whole task lifecycle. The backing coding CLI (`{{ACP_AGENT}}`) is chosen per project at `stask setup` and baked into these snippets — **do not hand-swap it**.

**Hard rule:** `acpx {{ACP_AGENT}} --version` must succeed at session start. If it doesn't, fail loud — no silent fallback to hand-edits.

---

## Session naming

- **Lead exploration:** `<threadId>:<lead-name>` (e.g. `1727883456.1:professor`)
- **Worker bundle:** `<threadId>:<worker-name>:<primary-subtask-id>` (e.g. `1727883456.1:berlin:T-042.1`)
- **QA does not use this CLI** — no session.

The `<primary-subtask-id>` is the worker's chosen representative for a bundle of closely-related subtasks; all subtasks in the bundle share one `{{ACP_AGENT}}` context.

---

## Spawn or resume a named session

```bash
acpx {{ACP_AGENT}} \
  -s "<label>" \
  --cwd "<worktree-or-workspace>" \
  --ttl 0 \
  --approve-all \
  --non-interactive-permissions deny \
  --prompt-retries 2 \
  "<prompt>"
```

- `-s <label>` — named session. First call creates, subsequent calls resume.
- `--ttl 0` — keep alive across the whole task lifecycle.
- `--approve-all` — non-interactive cron context; use `--approve-reads` + `--allowed-tools` instead if you want tighter scopes.
- `--prompt-retries 2` — built-in retry on transient gateway errors.

## Queue a follow-up (non-blocking)

```bash
acpx {{ACP_AGENT}} -s "<label>" --no-wait "<follow-up>"
```

Ideal for the lead's exploration dialog: feed a human answer in while the coding CLI is still working on the previous question.

## Check session health from the supervisor

```bash
STATUS=$(stask --project <slug> session health --label "<label>")
# Exit codes: 0 alive, 1 hung, 2 missing
```

## Recover hung session

```bash
acpx {{ACP_AGENT}} -s "<label>" cancel            # stop in-flight prompt
# …then re-invoke acpx {{ACP_AGENT}} -s "<label>" … with the original prompt
```

## Liveness pings

Inside a live acpx session, heartbeat stask so the supervisor knows you're alive:

```bash
stask --project <slug> session ping --label "<label>" --task <task-id> --agent <agent>
```

Wire this via a `postToolUse` hook when available, otherwise call it explicitly every ~60s from long-running loops.

## No silent fallback

If `acpx {{ACP_AGENT}}` fails, fail loud and report to the supervisor. Do not hand-edit files; do not spawn a different CLI. The supervisor decides next steps (usually: prompt human, surface the error, re-run setup).

## Close sessions at task close

At `Done`:

```bash
stask --project <slug> session acp-close --task <task-id>
```

Cleans up all `<threadId>:*` rows for that task. acpx's internal session store is repo-scoped; names can be reused across tasks (different threadId prefix), so we only clear our tracker rows.

---

## Supervise loop (pseudo-code the lead runs per tick)

```text
for each active task T (threadId = TID):

  # Supervise lead exploration session
  supervise("<TID>:<lead-name>")

  # Supervise worker coding bundles
  for each worker W currently assigned subtasks on T:
    for each tracked acp_session row where label starts "TID:W:":
      supervise(row.label)

function supervise(label):
  status = stask session health --label "label"
  if status == alive:      return
  if status == hung:       acpx {{ACP_AGENT}} -s "label" cancel; resume(label)
  if status == missing:    resume(label)

function resume(label):
  acpx {{ACP_AGENT}} -s "label" --cwd ... --ttl 0 "<original prompt or continue marker>"
```
