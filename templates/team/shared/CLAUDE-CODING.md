# CLAUDE-CODING.md — How to drive Claude Code sessions from here

Coding work in this project runs through **Claude Code** invoked from inside the OpenClaw subsessions you (the outer agent) are running in. This doc is the canonical recipe — if it's not written here, don't improvise.

## The recipe

```bash
cd {{PROJECT_ROOT}} && claude \
  --agent <your-lowercase-name> \
  --permission-mode bypassPermissions \
  --add-dir {{PROJECT_ROOT}} \
  --output-format stream-json --verbose --include-partial-messages \
  -p '<your prompt>'
```

Example — Helsinki running a QA scan:

```bash
cd {{PROJECT_ROOT}} && claude \
  --agent {{QA_NAME_LOWER}} \
  --permission-mode bypassPermissions \
  --add-dir {{PROJECT_ROOT}} \
  --output-format stream-json --verbose --include-partial-messages \
  -p 'Run a smoke test against the running app and save screenshots to ../shared/qa-reports/screenshots/'
```

## Why each flag

| Flag | Why it's non-negotiable |
|------|-------------------------|
| `--agent <name>` | Loads your identity + preloaded role skills from `.claude/agents/<name>.md`. Without this, the inner session has no role context. |
| `--permission-mode bypassPermissions` | You are running inside a subsession — there's no human to click "approve" on tool prompts. Without this, Bash / Write / cross-dir Read are silently denied and your session returns "I can't do that". This is the #1 cause of seemingly-hung sessions. |
| `--add-dir {{PROJECT_ROOT}}` | The project root is almost certainly outside your workspace cwd. `--add-dir` grants inner claude read/write access to it explicitly. |
| `--output-format stream-json --verbose --include-partial-messages` | Streams every thought, tool call, and partial message to stdout as JSON lines. The outer subsession's bash monitor sees continuous output and won't kill your session as "hung". Without streaming, long tool uses look like silence. |
| `-p '<prompt>'` | Non-interactive print mode — required for programmatic invocation. |

## Timing expectations

Real coding / QA / exploration runs take **minutes**. A complete backend exploration or a full QA pass can run 10–30 minutes. **This is normal.** Do NOT kill a session just because wall-clock time is passing. Only kill it if stdout has been completely silent for 2+ minutes despite streaming flags (that indicates the inner claude crashed, not a long tool use).

If you need a longer-running session, increase your Bash tool timeout. Don't start polling and second-guessing — either wait or re-spawn cleanly.

## Parsing the output

`stream-json` emits one JSON object per line. Each line has a `type` field — `system`, `assistant`, `user`, `result`, etc. The final object with `type: "result"` carries the end-of-session summary including whether the session exited successfully and any accumulated text.

If you need the plain-text final answer for your own summary, parse the last `result` line, or re-run with `--output-format text` for a simpler one-shot response (you lose streaming visibility).

## Who runs stask commands

Two layers, clean split:

| Action | Who runs it |
|---|---|
| Read (show, list, heartbeat) | Outer agent primarily; Claude can read for context |
| Lifecycle transitions (transition, subtask create --assign, spec-update triage, spec_approved checks, PR creation) | **Outer agent (orchestrator).** These need to be visible to the next heartbeat tick. |
| Work completion (subtask done, qa submit, session ping, spec-update for your own current task) | **Claude.** Claude's stask-* skill is preloaded for exactly this. |
| Destructive / cross-task (delete, re-delegate, Done transitions on parent tasks) | **Outer agent always.** |

## Prompting Claude to close its work

When you write the prompt passed to `claude -p '...'`, **name the stask command(s) Claude should run when done**. Examples:

- *Worker subtask:* `"Implement subtask T-042.1 per the spec. When tests pass and you've pushed, run \`stask subtask done T-042.1\` per the stask-worker skill."`
- *QA pass:* `"Test T-042 against the ACs. When done, write the report to shared/qa-reports/... and submit via \`stask qa T-042 --report <path> --verdict PASS\` per the stask-qa skill."`
- *Lead spec draft:* `"Draft the spec for T-042 to shared/specs/T-042.md. When ready, run \`stask spec-update T-042 --spec shared/specs/T-042.md\` per the stask-lead skill."`

Claude's agent file already says "close your work via the stask-* skill" in general terms. Naming the specific command in the prompt makes the contract unambiguous and removes the guess-the-closing-step failure mode.

## Verify after Claude returns

Don't trust Claude's self-report alone — check stask state before deciding what to do next:

```bash
stask --project {{PROJECT_SLUG}} show <task-id>
```

Confirm the expected mutation actually landed. If Claude reported success but state disagrees (subtask still In-Progress, verdict not attached, etc.), Claude probably hit a CLI error that got swallowed in the stream. Re-spawn with a corrective prompt ("confirm you ran `stask subtask done T-042.1`") or run the command yourself to unstick the pipeline. Never advance the task on a claimed-done that state doesn't back up.

## What this replaces

Earlier iterations of this team ran coding work through `opencode run -m <model> -f <skill>/SKILL.md -- '<prompt>'`. That's gone. Every coding invocation is now `claude --agent <name> ...` with the flags above. The role playbook + skills that used to be attached via `-f` now preload automatically via `.claude/agents/<name>.md`.
