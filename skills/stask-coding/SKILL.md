---
name: stask-coding
description: How to spawn a Claude Code coding session from inside an OpenClaw subsession — the invocation recipe, the canonical stask-framework prompt template, and the post-return verification pattern. Use whenever you need to hand a coding / QA / exploration task off to Claude.
---

# stask-coding — Driving Claude Code sessions from inside OpenClaw subsessions

You are an OpenClaw outer agent about to spawn a Claude Code session. This skill covers:

1. **How** to invoke `claude` (the flags are non-negotiable for headless subsession use).
2. **What** to put in the prompt when the work is a stask coding task (spec + subtask(s) + closing command, in stask-framework language).
3. **What** to do after Claude returns (verify state before advancing the pipeline).

Read all three sections. Flags in Section A are not optional; the template in Section B is the default for stask coding work; Section C is how you keep the pipeline honest.

---

## Section A — Invoke Claude Code

**Pick cwd based on whether the task has a worktree:**

### Task has a worktree (In-Progress, Testing, most real work)

`cd` into the worktree. Claude runs entirely inside the isolated checkout — no chance of touching the main repo or bleeding across tasks.

```bash
cd <WORKTREE_PATH> && claude \
  --agent <your-lowercase-name> \
  --permission-mode bypassPermissions \
  --add-dir <WORKTREE_PATH> \
  --output-format stream-json --verbose --include-partial-messages \
  -p '<your prompt>'
```

The worktree is a git checkout of the same repo on the task's branch — it already contains the code, specs, `.claude/agents/`, `.claude/skills/`, and everything else Claude needs. No `--add-dir` to project root required.

### Task has no worktree yet (Backlog / To-Do / bootstrap exploration)

Fall back to the project root. Used for spec drafting, initial exploration, codebase scans — anything before a worktree has been created.

```bash
cd <PROJECT_ROOT> && claude \
  --agent <your-lowercase-name> \
  --permission-mode bypassPermissions \
  --add-dir <PROJECT_ROOT> \
  --output-format stream-json --verbose --include-partial-messages \
  -p '<your prompt>'
```

### Why each flag

| Flag | Why it's non-negotiable |
|------|-------------------------|
| `--agent <name>` | Loads your identity + preloaded role skills from `.claude/agents/<name>.md`. Without this, the inner session has no role context. |
| `--permission-mode bypassPermissions` | You are running inside a subsession — there is no human to click "approve" on tool prompts. Without this, Bash / Write / cross-dir Read are silently denied and your session returns "I can't do that". This is the #1 cause of seemingly-hung sessions. |
| `--add-dir <cwd>` | Explicit grant for the chosen cwd (worktree or project root). Keeps Claude scoped — it can't stray into the main checkout when you launched it in a worktree. |
| `--output-format stream-json --verbose --include-partial-messages` | Streams every thought, tool call, and partial message to stdout as JSON lines. The outer subsession's bash monitor sees continuous output and won't kill your session as "hung". Without streaming, long tool uses look like silence. |
| `-p '<prompt>'` | Non-interactive print mode — required for programmatic invocation. |

### Why the worktree, not the project root

- **Isolation.** Each stask task has its own git worktree on its own branch. Launching Claude inside it means any file it edits is on that branch — no risk of accidentally writing to `main` or another task's branch.
- **No ambiguous "cd before editing" step.** Previous guidance had Claude cd into the worktree *inside* its session. Easy to forget, and a forgotten cd means edits land in the wrong checkout. Launching with cwd = worktree removes the step entirely.
- **Preload still works.** `.claude/agents/` and `.claude/skills/` are committed to the repo, so they exist in every worktree. `--agent <name>` resolves the same way.

### Timing

Real coding / QA / exploration runs take **minutes**. A complete backend exploration or a full QA pass can run 10–30 minutes. **This is normal.** Do NOT kill a session just because wall-clock time is passing. Only kill it if stdout has been completely silent for 2+ minutes *despite* the streaming flags above (that indicates the inner claude crashed, not a long tool use).

If you need a longer-running session, increase your Bash tool timeout. Don't start polling and second-guessing — either wait or re-spawn cleanly.

### Parsing the output

`stream-json` emits one JSON object per line. Each line has a `type` field — `system`, `assistant`, `user`, `result`, etc. The final object with `type: "result"` carries the end-of-session summary including whether the session exited successfully and any accumulated text.

If you need the plain-text final answer for your own summary, parse the last `result` line, or re-run with `--output-format text` for a simpler one-shot response (you lose streaming visibility).

---

## Section B — Build the prompt (stask-framework language)

This section applies **when the task is a stask coding task** (implementing a subtask, running QA against a spec, drafting a spec, addressing PR feedback — anything keyed to a task in the stask tracker). For one-off research, bootstrap exploration, or non-stask adhoc work, skip to the "Non-stask tasks" note at the end and free-form your prompt.

Entry-point agnostic: it does not matter how you acquired the stask context (Lead delegated to you via `sessions_spawn` with a task string, you woke up from a heartbeat tick, a human DM'd you, PR feedback came in). By the time you reach this skill, you already know your task ID, spec, subtasks, and the command to close each subtask. The skill tells you how to write the `claude -p` prompt given that context.

### Canonical prompt template

Claude is already launched with cwd = the task's worktree (Section A), so the prompt treats the worktree as "here" — it does not tell Claude to `cd`. The Worktree line in CONTEXT is informational only (so Claude knows what branch / path it is in and can reference them in commit messages, reports, etc.).

```
CONTEXT
- Task: <taskId> — <taskName>
- Spec: <specFileId or specs/<taskId>.md>         (read via `stask show <taskId>` or open the file directly)
- Worktree: you are in <path> on branch <branch>   [informational — this is your cwd]

SUBTASKS YOU OWN
- <subtaskId>: <name>      [read the spec section with the same ID]
- <subtaskId>: <name>
... (enumerate in stask language — IDs must match `stask show` output)

WORKFLOW PER SUBTASK
1. Read the relevant section of the spec
2. Implement (all edits land in this worktree on branch <branch>)
3. git add <files you changed>; git commit -m "<ref subtask ID>"
4. git push
5. <exact closing stask command — copy-paste, e.g. `stask subtask done T-042.1`>
6. /compact   (between subtasks, to manage context)

CLOSE
When all assigned subtasks are done, report back with a short summary and
list the stask commands you ran. The outer agent will verify state.
```

### Mandatory vs optional sections

- **Task** — mandatory. Always name the task ID and title.
- **Spec** — mandatory for any implementation / QA work. Pass the Slack file ID if available, otherwise the local path under `specs/`. Tell Claude how to read it. For spec-drafting tasks there's no spec yet — replace with "Deliverable: write a spec to specs/<taskId>.md" and use `stask spec-update <taskId> --spec <path>` as the closing command.
- **Worktree** — mandatory when the task has a worktree (any task In-Progress or Testing). Because you already launched Claude with cwd = worktree, this section is informational ("you are in <path> on branch <branch>"), not a directive. Omit entirely for pre-worktree tasks (Backlog / To-Do exploration) — Claude is in the project root and there's nothing to say about a worktree that doesn't exist.
- **Subtasks** — mandatory when any exist. For QA tasks that test the whole parent at once, collapse into a single "SCOPE" block (the whole task, not enumerated subtasks).
- **Workflow** — adapt per role. Workers get implement + git + push + subtask done. QA gets test-each-AC + write report + `stask qa <id> --verdict`. Lead gets draft spec + `stask spec-update` or code-review + `stask transition`. **Always name the closing stask command verbatim. Never include a `cd` step — Claude is already in the right cwd.**
- **Close** — mandatory. Always ask Claude to list the stask commands it ran so you can cross-check in Section C.

### How to derive fields if your entry-point didn't hand them to you

```bash
stask --project <slug> show <taskId>       # task name, spec file ID, parent, subtasks, worktree
stask --project <slug> list                # broader view of your queue
```

### Closing commands by role (canonical, copy-paste)

| Role / situation | Closing command |
|---|---|
| Worker implementing a subtask | `stask subtask done <subtaskId>` |
| QA submitting a verdict | `stask qa <taskId> --report <path> --verdict PASS\|FAIL` |
| Lead attaching a drafted spec | `stask spec-update <taskId> --spec shared/specs/<taskId>.md` |
| Lead responding to PR feedback | (edit files, commit, push; no stask-level close) |
| Lead creating a PR after QA PASS | `gh pr create ...` then `stask transition <taskId> "Ready for Human Review"` — **but this is orchestrator work; you run it yourself, don't delegate to Claude** |

### Non-stask tasks (no template)

For bootstrap exploration, research questions, or one-off queries where there's no task / spec / subtask, just free-form the prompt — Section A's invocation recipe still applies, Section B doesn't.

---

## Section C — After Claude returns

### Who runs what

| Action | Who runs it |
|---|---|
| Read (show, list, heartbeat) | Outer agent primarily; Claude can read for context |
| Lifecycle transitions (transition, subtask create --assign, spec approval triage, PR creation, Done) | **Outer agent (orchestrator).** These must be visible to the next heartbeat tick. |
| Work completion (subtask done, qa submit, session ping, spec-update for your own current task) | **Claude**, via its preloaded stask-* role skill. |
| Destructive / cross-task (delete, re-delegate) | **Outer agent always.** |

### Verify before advancing

Do not trust Claude's self-report alone. Check stask state:

```bash
stask --project <slug> show <taskId>
```

Confirm the expected mutation actually landed — subtask flipped to Done, QA verdict attached, spec file ID set, worktree clean, pushed, etc. If Claude claimed success but state disagrees, Claude probably hit a CLI error that got swallowed in the stream.

Recovery:
- **Re-spawn with a corrective prompt:** `"Confirm you ran \`stask subtask done T-042.1\` — the subtask still shows In-Progress."`
- **Run the command yourself** if you have a clear read on what Claude actually did (commit pushed, report file exists, etc.). Never advance the task on a claimed-done that state doesn't back up.

---

## Quick-reference one-liner

Task has a worktree (the common case):
```bash
cd <WORKTREE_PATH> && claude --agent <name> --permission-mode bypassPermissions --add-dir <WORKTREE_PATH> --output-format stream-json --verbose --include-partial-messages -p '<prompt per Section B>'
```

No worktree yet (spec drafting, bootstrap exploration):
```bash
cd <PROJECT_ROOT> && claude --agent <name> --permission-mode bypassPermissions --add-dir <PROJECT_ROOT> --output-format stream-json --verbose --include-partial-messages -p '<prompt per Section B>'
```

After it returns: `stask show <taskId>` and cross-check before advancing.
