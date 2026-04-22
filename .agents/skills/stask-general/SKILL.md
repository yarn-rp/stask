---
name: stask-general
description: Task lifecycle framework — spec-first workflow, Slack sync, status transitions, worktree isolation, and PR-based review. SQLite is the single source of truth. All operations go through the `stask` CLI. Solo project agent owns every task end to end.
---

# stask — Task Lifecycle Framework

SQLite-backed task lifecycle management with Slack sync. Every operation goes through the `stask` CLI — the database enforces all lifecycle rules via triggers and constraints, and every mutation syncs to Slack atomically.

Stask projects run a **single project agent**. That agent owns every task end to end: requirements analysis, spec, coding, QA, PR, and merge. There are no worker or QA subagents. Separation of concerns happens inside the agent via three long-lived `acpx` sessions per task (`<thread_id>:explore`, `<thread_id>:code`, `<thread_id>:qa`).

## Multi-Project Support

stask supports multiple projects. Each project lives in a repo with a `.stask/` folder at its root (like `.git/`).

- **Auto-detection:** stask walks up from cwd to find `.stask/config.json`. If you're in a project repo or its worktree, it auto-detects.
- **Explicit selection:** Use `--project <name>` flag on any command to target a specific project.
- **Project registry:** `npx @web42/stask projects` lists all registered projects.
- **Cross-project heartbeat:** `npx @web42/stask heartbeat-all <agent>` returns pending work across all projects.
- **New project:** `npx @web42/stask init <name> --repo <path>` scaffolds a new project.
- **Secrets:** `SLACK_TOKEN` comes from env var or `~/.stask/config.json` (no `.env` files).

### Multi-project commands

| Command | Purpose |
|---------|---------|
| `npx @web42/stask init <name> --repo <path>` | Create a new stask project |
| `npx @web42/stask projects [show <name>]` | List/show registered projects |
| `npx @web42/stask heartbeat-all <agent-name>` | Get pending work across all projects |
| `--project <name>` | Global flag — target a specific project |

## Core Rules

1. **Backlog tasks start without a spec.** Once a spec is attached (`stask spec-update`), the task can move to To-Do. From To-Do onward, every task must have a Spec value: `specs/<name>.md (F0XXXXXXXXX)`.
2. **SQLite is the single source of truth.** Never edit `tracker.db` directly — use `npx @web42/stask` commands only.
3. **Every parent task gets its own worktree.** The guard system creates it automatically on In-Progress.
4. **PR merge = Done.** The Human merges on GitHub, the system auto-completes the task.
5. **DB + Slack are transactional.** If Slack sync fails, the DB rolls back.
6. **All coding goes through `acpx`.** The agent must never hand-edit code files to satisfy a subtask. The configured `acp.agent` (codex, claude, or opencode) is the only coding surface.

## Roles

| Role | Responsibility |
|------|---------------|
| **Human** | Approves specs (via `spec_approved` checkbox in Slack — the only approval path), reviews PRs on GitHub, merges |
| **Lead** (solo project agent) | Owns every task end to end: requirements analysis, spec, subtasks, coding (via acpx `T:code`), QA (via acpx `T:qa`), PR, and merge |

## Task Lifecycle

```
Anyone creates task (name + type only) -> Backlog (assigned to Human, no spec)
    -> Human or agent discusses in the Slack thread
    -> Agent opens acpx <thread_id>:explore -> writes spec -> stask spec-update
    -> Spec attached -> transition to To-Do (guard: requires spec)
    -> Human approves spec (checkbox in Slack) -> reassigned to Lead
    -> Lead creates subtasks from the spec
    -> Lead transitions to In-Progress -> worktree created automatically (guard)
    -> Lead runs subtasks sequentially in acpx <thread_id>:code
    -> All subtasks Done -> auto Testing (guard: worktree clean + pushed)
    -> Lead runs QA in a fresh acpx <thread_id>:qa session and submits verdict:
        PASS -> Ready for Human Review -> draft PR created (guard)
            -> Human reviews on GitHub, leaves comments
            -> Human merges PR -> task auto-completes to Done
        FAIL (1st/2nd) -> back to In-Progress (Lead re-enters T:code for fixes)
        FAIL (3rd) -> Blocked -> escalated to Human
```

## Guards

Guards run automatically before transitions. Checks run first (read-only); if all pass, setup guards run (side effects).

| Transition | Guard | Type | What it does |
|---|---|---|---|
| -> To-Do | `require_spec` | check | Task must have a spec attached |
| -> In-Progress | `require_approved` | check | Task must not be assigned to Human |
| -> In-Progress | `setup_worktree` | setup | Creates git worktree + feature branch |
| -> Testing | `all_subtasks_done` | check | Every subtask must be Done |
| -> Testing | `worktree_clean` | check | No uncommitted changes in worktree |
| -> Testing | `worktree_pushed` | check | No unpushed commits |
| -> Ready for Human Review | `worktree_clean` | check | No uncommitted changes |
| -> Ready for Human Review | `worktree_pushed` | check | No unpushed commits |
| -> Ready for Human Review | `require_pr` | check | PR must exist |

## Status Definitions

| Status | Meaning | Assigned To |
|--------|---------|-------------|
| Backlog | Idea captured, no spec yet — discuss in thread | Human |
| To-Do | Spec attached, awaiting approval | Human |
| In-Progress | Lead building subtasks via acpx `T:code` | Lead |
| Testing | Lead running QA via fresh acpx `T:qa` | Lead |
| Ready for Human Review | QA PASSED, PR open, awaiting sign-off | Human |
| Done | PR merged, shipped | -- |
| Blocked | Halted — escalated to Human | Human |

## CLI Reference

### Mutation commands (DB + Slack transaction)

| Command | Purpose |
|---------|---------|
| `npx @web42/stask create --name "..." [--spec <path>] [--type Feature\|Bug\|Task]` | Create task (Backlog if no spec, To-Do if spec provided) |
| `npx @web42/stask transition <task-id> <status>` | Transition status (guards enforce prerequisites) |
| `npx @web42/stask subtask create --parent <id> --name "..."` | Create subtask under parent |
| `npx @web42/stask subtask done <subtask-id>` | Mark subtask Done (auto-cascades parent) |
| `npx @web42/stask qa <task-id> --report <path> --verdict PASS\|FAIL` | Submit QA verdict with report |
| `npx @web42/stask assign <task-id> <name>` | Reassign a task |
| `npx @web42/stask spec-update <task-id> --spec <path>` | Re-upload edited spec |

> Approval: there is no `stask approve` command. Approval happens exclusively via the `spec_approved` checkbox in Slack.

### Read-only commands

| Command | Purpose |
|---------|---------|
| `npx @web42/stask list [--status X] [--assignee Y] [--json]` | List tasks (filterable) |
| `npx @web42/stask show <task-id> [--log]` | Show task details + subtasks + audit log |
| `npx @web42/stask log [<task-id>] [--limit N]` | View audit log |
| `npx @web42/stask heartbeat <agent-name>` | Returns pending work for the project agent (JSON) |
| `npx @web42/stask pr-status <task-id>` | Poll PR for comments/merge status |
| `npx @web42/stask session claim\|release\|status <task-id>` | Manage task-level locks |
| `npx @web42/stask session ping\|health\|acp-list\|acp-close` | acpx session liveness + cleanup |

### Sync commands

| Command | Purpose |
|---------|---------|
| `npx @web42/stask sync` | Run one bidirectional sync cycle |
| `npx @web42/stask sync-daemon start\|stop\|status` | Manage background sync daemon |

## Thread Communication

Every task has a dedicated Slack thread linked to its list item. The thread reference (`channelId` + `threadTs`) is stored in the DB and included in `npx @web42/stask show` and `heartbeat` output.

**The project agent MUST post updates to the task thread at every step.** Use the Slack API `chat.postMessage` with the thread's `channel` and `thread_ts` to post replies. The thread is the single place for all task communication.

### What to post

- **Starting a phase** — "Starting QA phase on T-XXX — opening acpx T:qa"
- **Progress updates** — "Implemented auth middleware in T:code, moving on to UI components"
- **Blockers or issues** — "Hit an issue: API returns 500 on invalid tokens. Investigating."
- **Errors or failures** — "Tests failing on login redirect. Stack trace: ..."
- **Subtask completion** — "Subtask T-XXX.1 done. 3 commits pushed to feature/xxx"
- **QA results** — "QA PASS: all 5 acceptance criteria verified. Screenshots attached."
- **Status transitions** — "Transitioning T-XXX to Testing"
- **Questions** — "Question for @human: should the invite expire after 7 days or 30 days?"

### How to get the thread reference

Every task thread has a `channelId` and `threadTs`. You can get them from:

1. **Heartbeat output** — the `thread` field in each pending task: `thread.channelId` + `thread.threadTs`
2. **`npx @web42/stask show <task-id>`** — prints `Thread: <channelId>:<threadTs>` in the task details

Always use the **parent task's** thread for subtask communication — all subtasks share the parent's thread.

### How to post

Post using the Slack API with the thread reference:

```
POST https://slack.com/api/chat.postMessage
{
  "channel": "<channelId>",
  "thread_ts": "<threadTs>",
  "text": "<your update>"
}
```

Use the `SLACK_TOKEN` from the environment for authorization.

**Post even when things go wrong.** Failed builds, test errors, unexpected behavior — all of it goes in the thread. Silence is worse than bad news.

## Rules for the Project Agent

1. **Never edit tracker.db directly.** Use `npx @web42/stask` commands only.
2. **Every task needs a spec** before leaving Backlog.
3. **Work in the task worktree.** Never in the main repo checkout.
4. **All code writes go through `acpx`.** Hand-editing code files to satisfy a subtask is a bug.
5. **Commit and push before marking done.** Guards will block Testing if you don't.
6. **PR merge = Done.** Never manually transition to Done.
7. **All PR comments go through the Human.** External comments need explicit triage.
8. **Reference specs by Slack file ID** (e.g., `F0XXXXXXXXX`), never by local path. Backlog tasks have no spec until one is attached.
9. **Post every step to the task thread.** Every action, result, blocker, and question goes in the thread. No exceptions.
10. **Subtasks must match the spec.** Only subtasks listed in the spec's Subtasks section. Fix subtasks (after QA failure) are the only exception.
11. **No CLI approval.** Approval happens exclusively via the `spec_approved` checkbox in Slack.
