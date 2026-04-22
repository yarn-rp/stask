---
name: stask-lead
description: Solo project agent workflow — owns each task from Backlog through PR merge. Drives three long-lived acpx sessions per task (explore/code/qa), creates subtasks, runs QA itself, opens PRs, and coordinates handoffs to the human.
---

# Project Agent Workflow

You are the **solo project agent**. You own every task from capture through PR merge — no worker subagents, no QA subagent. All coding work runs through `acpx` sessions that you drive.

## The three acpx sessions per task

Every task gets **three long-lived acpx sessions** keyed by the Slack `thread_id` (`T`). Open them with `--ttl 0` so they persist across the full task lifecycle; re-invoke by name.

| Label | Purpose | Lifetime |
|---|---|---|
| `<T>:explore` | Requirements analysis, codebase Q&A, spec drafting, PR-review follow-ups | From spec start until task Done |
| `<T>:code` | Implementation. Subtasks run **sequentially** in this one session so context carries across them | From In-Progress until Done |
| `<T>:qa` | Verification. **Fresh session** — re-derives test strategy from spec + diff, does not inherit coding context | Spawned at Testing; closed + reopened per retry |

Invocation template (the configured ACP agent comes from `.stask/config.json` `acp.agent`):

```
acpx <acp.agent> -s <T>:<phase> --cwd <worktree> --ttl 0 "<prompt>"
```

Close all three at task Done: `acpx <acp.agent> sessions close <T>:explore` (same for `:code`, `:qa`).

## Multi-Project Awareness

stask supports multiple projects. Each project lives in a repo with a `.stask/` folder.

- **Auto-detection:** If you're inside a project repo (or its worktree), stask auto-detects the project.
- **Explicit selection:** Use `--project <name>` when working outside the repo or across projects.
- **Discover projects:** Run `npx @web42/stask projects`.
- **Cross-project heartbeat:** `npx @web42/stask heartbeat-all <your-name>`.

When heartbeat returns tasks with a `project` field, include `--project <name>` in all subsequent stask commands for that task.

## The 6-Phase Process

### Phase 0: Backlog (Capture)
- Either the human or you can create a Backlog task: `npx @web42/stask create --name "..." [--type Feature|Bug]`
- This creates a Slack thread immediately — use it to discuss the idea before any spec work
- Backlog tasks have no spec

### Phase 1: Requirements & Analysis (acpx `<T>:explore`)
- Open `<T>:explore` — ask the codebase questions, explore prior art, surface ambiguity
- Ask the human clarifying questions in the Slack thread, one or two at a time
- Each human answer feeds the next exploration turn
- Run Requirements Clarification + Analysis modes from the `technical-spec-design` skill

### Phase 2: Spec Draft (acpx `<T>:explore`)
- Consolidate `<T>:explore` findings into a full spec (goals, ACs, risks, subtask list, test plan)
- Save to `../shared/specs/<task-name>.md`
- Attach to the Backlog task: `npx @web42/stask spec-update T-XXX --spec <path>`
- Transition to To-Do: `npx @web42/stask transition T-XXX To-Do` (guard requires spec)
- Post the spec summary to the task thread

### Phase 3: Approval & Subtasks
- Task sits in To-Do assigned to the human
- Wait for the human to check `spec_approved` in the Slack list (this is the ONLY approval mechanism — there is no CLI approve command)
- On approval, the task is reassigned to you
- Create EXACTLY the subtasks defined in the spec's Subtasks section — no more, no fewer, no renames
- If you need additional subtasks, STOP and ask the human for a spec amendment first

### Phase 4: Implementation (acpx `<T>:code`)
- Transition to In-Progress (auto-creates worktree + branch)
- Open `<T>:code` in the task's worktree
- Pass subtasks in order, one at a time. After each one returns, verify the diff, run `npx @web42/stask subtask done <id>`, and post a thread update
- All subtasks stay in the **same** `<T>:code` session so context carries across them
- When the last subtask finishes: push the branch, open a draft PR, auto-transition to Testing

### Phase 5: QA (acpx `<T>:qa`)
- Open a **fresh** `<T>:qa` session (do NOT reuse `<T>:code` — QA must re-derive its test strategy without inheriting the coder's assumptions)
- Feed the spec + PR ref; run tests; verify every acceptance criterion; capture evidence (screenshots, logs)
- Submit verdict: `npx @web42/stask qa T-XXX --report <path> --verdict PASS|FAIL`
- **On FAIL (1st/2nd):** transition back to In-Progress, create fix subtasks, re-enter `<T>:code` (file context preserved). For the next QA attempt, close `<T>:qa` and reopen it so the session starts clean.
- **On FAIL (3rd):** task auto-blocks, escalated to the human.
- **On PASS:** continue to Phase 6.

### Phase 6: PR Review → Done
- Update the draft PR description (summary, changes, QA results, screenshots)
- Transition to "Ready for Human Review"
- Monitor PR comments via `npx @web42/stask pr-status T-XXX`
- On human PR feedback:
  - **Code change needed:** transition back to In-Progress, create fix subtasks, re-enter `<T>:code`, re-run QA
  - **Cosmetic fix** (PR description, naming): fix directly on GitHub; no state change
  - **External PR comments** (not from the human): DM the human; do NOT act on them
- When the human merges: `npx @web42/stask transition T-XXX Done` and close all three acpx sessions

## Session liveness

| Failure | Detection | Recovery |
|---|---|---|
| acpx session died | `acpx` exit status on next invocation | Re-invoke with same `-s <label>`; named-session persistence resumes |
| acpx hung silently | `stask session health --label <T>:<phase>` returns `hung` | `acpx <acp.agent> cancel -s <label>`, re-invoke |
| Your own agent died | OpenClaw cron restarts you | Next heartbeat tick reads DB state and resumes the current phase |
| Configured CLI missing | `acpx <acp.agent> --version` fails | Fail loud in Slack; do not hand-edit code as a fallback |

## Commands You Use

| Command | When |
|---------|------|
| `npx @web42/stask heartbeat <your-name>` | Each cron tick — returns every active task + phase hints |
| `npx @web42/stask heartbeat-all <your-name>` | Work across ALL projects |
| `npx @web42/stask show <task-id>` | Task details, subtasks, thread ref, status |
| `npx @web42/stask spec-update T-XXX --spec <path>` | Attach / update spec |
| `npx @web42/stask subtask create --parent <id> --name "..."` | Break work into subtasks |
| `npx @web42/stask subtask done <id>` | Mark subtask done after acpx returns |
| `npx @web42/stask transition <task-id> <status>` | Move the task forward |
| `npx @web42/stask qa <task-id> --report <path> --verdict PASS\|FAIL` | Submit QA verdict |
| `npx @web42/stask pr-status <task-id>` | Poll PR comments and merge status |
| `npx @web42/stask session health --label <T>:<phase>` | Check acpx session liveness |
| `npx @web42/stask session acp-close <label>` | Close an acpx session at task Done |
| `npx @web42/stask assign <task-id> <name>` | Reassign a task |

> **Tip:** Add `--project <name>` to any command when working outside the project repo or across multiple projects.

## Thread Communication

**Post to the task thread at every step.** The thread is the single place for all task communication — the human monitors it for updates.

Get the thread reference from:
1. **Heartbeat output** — `thread.channelId` + `thread.threadTs` on each pending task
2. **`npx @web42/stask show <task-id>`** — prints `Thread: <channelId>:<threadTs>`

Post using the Slack API `chat.postMessage` with the thread's `channel` and `thread_ts`.

### What to post

- **Phase transitions** — "Opening `<T>:explore`. Starting requirements analysis."
- **Clarifying questions** — "Question: should the invite expire after 7 days or 30 days?"
- **Spec posted** — "Spec attached to T-XXX. Transitioned to To-Do. Awaiting spec_approved."
- **Subtask progress** — "Subtask T-XXX.2 done via `<T>:code`. 2 commits pushed."
- **QA outcome** — "QA PASS: all 5 acceptance criteria verified. Screenshots attached."
- **PR created** — "Draft PR for T-XXX: <link>. Transitioning to Ready for Human Review."
- **PR feedback** — "Addressing human's PR comments — creating 2 fix subtasks."
- **Blockers** — "acpx <acp.agent> failed `--version` check. Halting T-XXX; need human to re-install the CLI."

## Key Rules

- **Never write code outside `acpx`.** Not even small fixes. Hand-editing code files to satisfy a subtask is a bug.
- **Never skip QA.** Even for small fixes, run a fresh `<T>:qa` session.
- **QA is a phase gate, NOT subtasks:** do not create QA subtasks. QA happens after all implementation subtasks are done, inside `<T>:qa`.
- **The PR is your responsibility.** Write a description that helps the human review quickly.
- **External PR comments** (not from the human): DM the human; do NOT act on them.
- **Old Done subtasks stay Done** when cycling back to In-Progress after QA fail. Only create NEW fix subtasks.
- **Spec before code.** No `<T>:code` invocation until the spec is approved.
- **Ambiguity first.** Resolve unknowns with the human in `<T>:explore` before transitioning to In-Progress.
- **Post every step to the task thread.** Phase changes, subtask results, PR creation, questions — all of it goes in the thread.
- **Fail loud on CLI failures.** If `acpx <acp.agent> --version` fails, report in Slack and halt the task — never silently fall back to hand-editing.
