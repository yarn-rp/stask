# ACP_SPAWN.md — How the project agent drives `acpx`

The project agent runs **one** coding CLI via `acpx` — the headless ACP runner. `{{ACP_AGENT}}` is the backing CLI (`codex` / `claude` / `opencode`), chosen at `stask setup` and baked into these snippets. **Do not hand-swap it.**

**Hard rule:** `acpx {{ACP_AGENT}} --version` must succeed before any session is opened. If it doesn't, fail loud in Slack and halt the task — no silent fallback to hand-edits.

---

## Two ways to invoke acpx

There are two valid surfaces. **You almost always want Method A** (OpenClaw sub-agent). Method B exists for scripts, one-offs, and debugging.

### Method A (preferred) — OpenClaw `Sub-agent` tool, `runtime: "acp"`

This is how the project agent invokes acpx **from inside a heartbeat turn**. OpenClaw wraps the ACP session behind the sub-agent tool, yields your turn while the session runs, and wakes you back up with the result when the session finishes. That yield IS your blocking mechanism — there's no polling, no forgetting.

```
Sub-agent({
  runtime: "acp",
  mode:    "session",
  thread:  true,                      // REQUIRED for mode="session"
  label:   "<threadId>:<phase>",      // e.g. "1727883456.1:explore"
  cwd:     "<worktree-or-workspace>",
  task:    "<prompt>"
})
```

Required fields:
- **`runtime: "acp"`** — routes through the `{{ACP_AGENT}}` acpx backend configured at setup.
- **`mode: "session"`** — named, persistent session (the only mode that resumes across turns).
- **`thread: true`** — binds the ACP session to the current Slack thread so streamed events land in the right place. **`mode: "session"` fails without this.** If you see `errorCode: "thread_required"`, you forgot this flag.
- **`label`** — the session name. Always `<threadId>:<phase>`; `<phase>` is one of `explore`, `code`, `qa` (plus the bootstrap-only `T0:explore`).
- **`cwd`** — working directory for the ACP agent. For `T:code` and `T:qa`, **always** the task's worktree path (from `heartbeat` output, field `worktree.path`) — acpx edits files relative to `cwd`, so running outside the worktree means edits land on `main`. For `T:explore` before the task has a worktree (Backlog/To-Do), use the repo root.
- **`task`** — the prompt. Same content you'd pass as the trailing positional arg to `acpx`.

Lifecycle inside a heartbeat tick:
1. You call the tool.
2. OpenClaw yields your turn.
3. When the ACP session completes the turn, OpenClaw wakes you with the tool result (transcript + any files written).
4. You read the result and decide what to do next.

**You do not poll.** You do not `yield` manually expecting to wake yourself up. The wake is OpenClaw's job. If you yield without the sub-agent tool yielding for you, the next cron tick is your only re-entry — that's the "forgetting" failure mode.

### Method B (escape hatch) — direct `acpx` CLI via Bash

Use this only from scripts, manual debugging sessions, or setup tooling — **not** from the project agent's heartbeat. Bash calls block stdout until the turn returns.

```bash
acpx {{ACP_AGENT}} \
  -s "<threadId>:<phase>" \
  --cwd "<worktree-or-workspace>" \
  --ttl 0 \
  --approve-all \
  --non-interactive-permissions deny \
  --prompt-retries 2 \
  "<prompt>"
```

Flag equivalents to Method A's fields: `-s` ↔ `label`, `--cwd` ↔ `cwd`, positional arg ↔ `task`. `--ttl 0` keeps the session alive across the task lifecycle. `--approve-all` is required under cron.

**Never** use `--no-wait` for `T:code` or `T:qa`. The only legitimate use of `--no-wait` is queuing a follow-up into an already-running `T:explore` session (e.g. {{HUMAN_NAME}} answered before the last turn returned). Firing `--no-wait` and moving on is how the agent "forgets" about a running turn and drops work on the floor.

---

## Session naming

Every task gets **three** acpx sessions, all keyed by the Slack thread id `T`:

| Label | Purpose | Lifetime |
|---|---|---|
| `<T>:explore` | Requirements analysis, codebase Q&A, spec drafting, PR-review follow-ups | Start of task → Done |
| `<T>:code` | Implementation. Subtasks run **sequentially** inside one session so context carries across them | In-Progress → Done |
| `<T>:qa` | Verification. **Fresh** session — does not inherit `<T>:code` context | Testing → Done; closed + reopened on retry |

All use `--ttl 0` and are re-invoked by name; named-session persistence handles crash recovery.

---

## The blocking-with-monitoring invariant (read twice)

You never fire-and-forget. There are two layers to this:

**Layer 1 — OpenClaw blocks you.** With `mode: "session"` + `thread: true`, OpenClaw yields your turn and wakes you with the result when the ACP session completes its turn. Do not add `wait: false`. Do not switch to `mode: "run"` to dodge this. The yield IS the block.

**Layer 2 — You actively verify on wake.** When the Sub-agent tool returns, don't assume the work is done just because the call returned. Verify:

```bash
# 1. What does stask say?
stask --project <slug> session health --label "<T>:<phase>"
# Exit 0 = alive (still running), 1 = hung, 2 = missing (completed or never started)

# 2. What does acpx say?
acpx {{ACP_AGENT}} sessions | grep "<T>:<phase>"
# Look for the status: idle (done), running (still working), error
```

Decision matrix after Sub-agent returns:

| `session health` | `acpx sessions` | Meaning | Action |
|---|---|---|---|
| missing (2) | idle or absent | Turn completed cleanly | Read tool output, proceed to next phase |
| alive (0) | running | Turn still active — OpenClaw woke you early | **Poll every 30s** until `session health` flips to missing or hung. Do not proceed. |
| alive (0) | idle | Ping stale but turn done | Proceed; send a `stask session ping` to refresh |
| hung (1) | running | No tool activity for >`hangTimeoutMinutes` | `acpx {{ACP_AGENT}} cancel -s "<label>"`; re-invoke Sub-agent with the same label |
| any | error | acpx itself errored | Read the error, surface to Slack, halt the task |

**Polling loop** (when you land in the "still active" row):

```bash
for i in {1..60}; do
  STATUS=$(stask --project <slug> session health --label "<T>:<phase>"; echo $?)
  case "$STATUS" in
    *2) break ;;           # completed
    *1) echo "hung"; break ;;
    *)  sleep 30 ;;        # still alive, wait
  esac
done
```

60 × 30s = 30 minutes max. If you hit the cap, assume hung and cancel+retry. Never move on without a definitive "completed" or "hung" signal.

If you're writing this as an agent-level prompt rather than a shell script, the pattern is the same: after Sub-agent returns, loop `Bash(stask session health ...)` every ~30s until it reports `2` (missing/done) or `1` (hung). Only then proceed.

---

## If the turn takes a long time

That's OK. Large refactors legitimately take 30+ min. Do not cancel because time is passing — only cancel if `stask session health` reports `hung`, which is driven by lack of `postToolUse` pings, not by wall-clock duration.

## Queue a follow-up while a `T:explore` turn is still running

Narrow, explore-only pattern. {{HUMAN_NAME}} answered your last question before the previous explore turn returned — queue the next prompt so explore picks it up when the current turn completes.

Method A:

```
Sub-agent({
  runtime: "acp",
  mode:    "session",
  thread:  true,
  label:   "<threadId>:explore",
  cwd:     "<repo-root>",
  task:    "<follow-up based on {{HUMAN_NAME}}'s answer>",
  wait:    false                 // queue, don't wait
})
```

Method B: `acpx {{ACP_AGENT}} -s "<threadId>:explore" --no-wait "<follow-up>"`

Never do this on `T:code` or `T:qa`. The sub-agent returning immediately means you'll move on and forget the running turn.

## Check session health

```bash
STATUS=$(stask --project <slug> session health --label "<T>:<phase>")
# Exit codes: 0 alive, 1 hung, 2 missing
```

## Recover a hung session

```bash
acpx {{ACP_AGENT}} -s "<T>:<phase>" cancel       # stop in-flight prompt
# …then re-invoke acpx with the original prompt using the same -s label
```

A missing session is just a dead session — re-invoking recreates it, transparently.

## Liveness pings

Inside a live acpx session, heartbeat stask so the supervisor knows you're alive:

```bash
stask --project <slug> session ping --label "<T>:<phase>" --task <task-id> --agent {{LEAD_NAME_LOWER}}
```

Wire this via a `postToolUse` hook when available; otherwise call it explicitly every ~60s from long-running loops.

## No silent fallback

If `acpx {{ACP_AGENT}}` fails, fail loud in Slack and halt the task. Do not hand-edit files; do not spawn a different CLI. The human decides next steps (usually: fix the install, re-run setup).

## Close sessions at task close

When a task goes to `Done`:

```bash
stask --project <slug> session acp-close --task <task-id>
```

This cleans up all `<T>:*` tracker rows. acpx's own session store is repo-scoped; labels can be reused across tasks as long as the `<T>` prefix is unique, so we only clear tracker rows.

---

## Per-tick supervise loop (pseudo-code)

```text
for each active task T (threadId = TID):
  for phase in ["explore", "code", "qa"]:
    label = "TID:" + phase
    if not tracked(label) and phase is not relevant-to-current-status(T):
      continue
    supervise(label)

function supervise(label):
  status = stask session health --label "label"
  if status == alive:    return
  if status == hung:     acpx {{ACP_AGENT}} -s "label" cancel; resume(label)
  if status == missing:  resume(label)

function resume(label):
  acpx {{ACP_AGENT}} -s "label" --cwd <worktree> --ttl 0 "<original prompt or continue marker>"
```
