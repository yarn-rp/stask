# HEARTBEAT.md — {{LEAD_NAME}} (Solo Project Agent)

You are the **only actor on this project**. No workers, no QA persona. You own every task end to end: spec → code → QA → PR → merge.

This heartbeat must be fast. Read state, advance what you can by one phase, check session health, return.

---

## Step 1 — Read pipeline state

```bash
stask --project {{PROJECT_SLUG}} heartbeat {{LEAD_NAME_LOWER}}
```

Parse the JSON. It returns a flat `pendingTasks` list — each entry has a suggested `action` (`requirements-analysis` / `plan` / `build` / `qa` / `create-pr` / `review-qa-failure`) and a prompt.

If there's nothing pending, reply `HEARTBEAT_OK` and stop.

---

## Step 2 — Supervise live acpx sessions

Each active task has up to three long-lived acpx sessions, all backed by `{{ACP_AGENT}}`:

| Label | Purpose | Lifetime |
|---|---|---|
| `<threadId>:explore` | Requirements analysis + codebase Q&A | From spec start until task Done |
| `<threadId>:code` | Implementation; subtasks run sequentially inside | From first subtask until task Done |
| `<threadId>:qa` | Verification; fresh session (no coding context) | From Testing until task Done |

Health-check each before acting:

```bash
stask --project {{PROJECT_SLUG}} session health --label "<threadId>:<phase>"
# Exit 0 alive · 1 hung · 2 missing
```

Recovery:
- `alive` → continue.
- `hung` → `acpx {{ACP_AGENT}} cancel -s "<label>"`, then re-invoke with the original prompt.
- `missing` → re-invoke with the original prompt; same `-s` name resumes the session.

See `../shared/ACP_SPAWN.md` for the full acpx surface.

---

## Step 3 — Advance phases

For each entry in `pendingTasks`, execute the `action`:

### 3a · `requirements-analysis` (Backlog task)

1. Transition the task to `Requirements Analysis`.
2. Spawn (or resume) the exploration session:
   ```bash
   acpx {{ACP_AGENT}} -s "<threadId>:explore" --cwd {{PROJECT_ROOT}} --ttl 0 \
     "Initial explore for task <id>: <brief from Slack>. Find related code, prior art, risks."
   ```
3. Dialog loop: one or two clarifying questions in Slack per tick; feed answers back via `--no-wait`:
   ```bash
   acpx {{ACP_AGENT}} -s "<threadId>:explore" --no-wait "<follow-up>"
   ```
4. When you have enough, write the spec, post to the thread, transition → `Ready for Human Review`. **Keep the `T:explore` session alive** — you'll reuse it for PR review follow-ups.

### 3b · `plan` (Approved / To-Do, no subtasks)

1. Read the approved spec.
2. Create ordered subtasks (`stask subtask create …`) and assign each to yourself.
3. Transition parent → `In-Progress`. The next tick will surface `build` actions.

### 3c · `build` (In-Progress subtask)

Run the subtask inside the task's coding session:

```bash
acpx {{ACP_AGENT}} -s "<threadId>:code" --cwd {{PROJECT_ROOT}} --ttl 0 \
  "Subtask <id>: <name>. Scope: <from spec>. Conventions: <repo conventions>."
```

One `T:code` session per task. Subtasks run **sequentially** inside it — subsequent subtasks reuse the same `-s` and inherit file context from prior ones. Verify the diff + tests, then:

```bash
stask --project {{PROJECT_SLUG}} subtask done <subtask-id>
```

When the last subtask completes, push the branch, open nothing yet — transition parent → `Testing`. Next tick will fire `qa`.

### 3d · `qa` (Testing parent)

Start a **fresh** session (no coding context):

```bash
acpx {{ACP_AGENT}} -s "<threadId>:qa" --cwd {{PROJECT_ROOT}} --ttl 0 \
  "Verify task <id>. Spec file <id>. Acceptance criteria: <list>. Test each AC, capture evidence."
```

On retry after a failure, close + reopen the session for a clean slate:

```bash
stask --project {{PROJECT_SLUG}} session acp-close --label "<threadId>:qa"
# …then re-spawn with the same -s name
```

Write the QA report to `shared/qa-reports/<slug>.md` and submit:

```bash
stask --project {{PROJECT_SLUG}} qa <taskId> --report shared/qa-reports/<slug>.md --verdict PASS
```

### 3e · `create-pr` (Testing + QA passed)

1. Re-enter `T:explore` for code spelunking / diff review.
2. Craft a PR body (Summary / Changes / Testing / Acceptance Criteria).
3. `gh pr create --draft --base main --head <branch> --title "…" --body "…"`.
4. Transition → `Ready for Human Review`.

### 3f · `review-qa-failure` (In-Progress with logged QA fail)

1. Review the latest QA report in `T:explore` (retains prior context).
2. Create fix-subtasks assigned to yourself.
3. Next tick runs them via `T:code` (session resumes).
4. Re-enters `T:qa` afterwards; close + reopen `T:qa` before re-verifying.

---

## Step 4 — Infrastructure sanity

```bash
stask --project {{PROJECT_SLUG}} list --status "Ready for Human Review"
stask --project {{PROJECT_SLUG}} list --status Blocked
```

Ping {{HUMAN_NAME}} only for tasks waiting on human input that haven't been pinged yet.

---

## Step 5 — At task close

When a task flips to `Done`, close all three acpx sessions:

```bash
stask --project {{PROJECT_SLUG}} session acp-close --task <taskId>
```

---

## Step 6 — Return

Reply with a short summary: phases advanced, sessions resumed/reopened, items awaiting human review. **Never hand-edit code** — if `acpx {{ACP_AGENT}} --version` fails, report up the chain and stop.
