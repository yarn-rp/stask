---
name: stask-general
description: Task lifecycle framework — spec-first workflow, Slack sync, status transitions, worktree isolation, and PR-based review. SQLite is the single source of truth. All operations go through the `stask` CLI.
---

# stask — Task Lifecycle Framework

SQLite-backed task lifecycle management with Slack sync. Every operation goes through the `stask` CLI — the database enforces all lifecycle rules via triggers and constraints, and every mutation syncs to Slack atomically.

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

1. **No task exists without a spec uploaded to Slack.** Every task must have a Spec value: `specs/<name>.md (F0XXXXXXXXX)`.
2. **SQLite is the single source of truth.** Never edit `tracker.db` directly — use `npx @web42/stask` commands only.
3. **Every parent task gets its own worktree.** The guard system creates it automatically on In-Progress.
4. **PR merge = Done.** The Human merges on GitHub, the system auto-completes the task.
5. **DB + Slack are transactional.** If Slack sync fails, the DB rolls back.

## Roles

| Role | Responsibility |
|------|---------------|
| **Human** | Approves specs (via `spec_approved` checkbox in Slack — the only approval path), reviews PRs on GitHub, merges |
| **Lead** | Creates subtasks, delegates, coordinates fixes |
| **Worker(s)** | Implements subtasks in worktrees (batched in a single session per parent), marks them done |
| **QA** | Tests against acceptance criteria, submits pass/fail verdict |

## Task Lifecycle

```
Lead writes spec -> uploads to Slack -> creates task (assigned to Human)
    -> Human approves spec -> assigned to Lead
    -> Lead creates subtasks -> delegates to Workers
    -> Lead transitions to In-Progress -> worktree created automatically (guard)
    -> Workers work in the task worktree (feature branch)
    -> All subtasks Done -> auto Testing (guard: worktree clean + pushed)
    -> QA submits verdict:
        PASS -> Ready for Human Review -> draft PR created (guard)
            -> Human reviews on GitHub, leaves comments
            -> Human merges PR -> task auto-completes to Done
        FAIL (1st/2nd) -> back to In-Progress (Lead re-delegates)
        FAIL (3rd) -> Blocked -> escalated to Human
```

## Guards

Guards run automatically before transitions. Checks run first (read-only); if all pass, setup guards run (side effects).

| Transition | Guard | Type | What it does |
|---|---|---|---|
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
| To-Do (Human) | Spec written, awaiting approval | Human |
| To-Do (Lead) | Spec approved, Lead creating subtasks | Lead |
| In-Progress | Workers building subtasks in worktree | Parent: Lead, Subtasks: Workers |
| Testing | QA testing with evidence | QA |
| Ready for Human Review | QA PASSED, awaiting final sign-off + PR review | Human |
| Done | PR merged, shipped | -- |
| Blocked | Halted — escalated to Human | Human |

## CLI Reference

### Mutation commands (DB + Slack transaction)

| Command | Purpose |
|---------|---------|
| `npx @web42/stask create --spec <path> --name "..." [--type Feature\|Bug\|Task]` | Create task (auto-uploads spec to Slack) |
| ~~approve~~ | Removed — approval happens via `spec_approved` checkbox in Slack only |
| `npx @web42/stask transition <task-id> <status>` | Transition status (guards enforce prerequisites) |
| `npx @web42/stask subtask create --parent <id> --name "..." --assign <agent>` | Create subtask under parent |
| `npx @web42/stask subtask done <subtask-id>` | Worker marks subtask Done (auto-cascades parent) |
| `npx @web42/stask qa <task-id> --report <path> --verdict PASS\|FAIL` | Submit QA verdict with report |
| `npx @web42/stask assign <task-id> <name>` | Reassign a task |
| `npx @web42/stask spec-update <task-id> --spec <path>` | Re-upload edited spec |

### Read-only commands

| Command | Purpose |
|---------|---------|
| `npx @web42/stask list [--status X] [--assignee Y] [--json]` | List tasks (filterable) |
| `npx @web42/stask show <task-id> [--log]` | Show task details + subtasks + audit log |
| `npx @web42/stask log [<task-id>] [--limit N]` | View audit log |
| `npx @web42/stask heartbeat <agent-name>` | Returns pending work for an agent (JSON) |
| `npx @web42/stask pr-status <task-id>` | Poll PR for comments/merge status |
| `npx @web42/stask session claim\|release\|status <task-id>` | Manage session locks |

### Sync commands

| Command | Purpose |
|---------|---------|
| `npx @web42/stask sync` | Run one bidirectional sync cycle |
| `npx @web42/stask sync-daemon start\|stop\|status` | Manage background sync daemon |

## Thread Communication

Every task has a dedicated Slack thread linked to its list item. The thread reference (`channelId` + `threadTs`) is stored in the DB and included in `npx @web42/stask show` and `heartbeat` output.

**All agents MUST post updates to the task thread at every step.** Use the Slack API `chat.postMessage` with the thread's `channel` and `thread_ts` to post replies. The thread is the single place for all task communication.

### What to post

- **Starting work** — "Starting work on T-XXX.2: Build login form"
- **Progress updates** — "Implemented the auth middleware, moving to the UI components"
- **Blockers or issues** — "Hit an issue: the API endpoint returns 500 on invalid tokens. Investigating."
- **Errors or failures** — "Tests failing on login redirect. Stack trace: ..."
- **Subtask completion** — "Subtask T-XXX.1 done. Pushed 3 commits to feature/xxx"
- **QA results** — "QA PASS: all 5 acceptance criteria verified. Screenshots attached."
- **Status transitions** — "Transitioning T-XXX to Testing"
- **Questions** — "Question for @yan: should the invite expire after 7 days or 30 days?"

### How to post

The thread reference is in the heartbeat JSON as `thread.channelId` and `thread.threadTs`. Post using the Slack API:

```
POST https://slack.com/api/chat.postMessage
{
  "channel": "<thread.channelId>",
  "thread_ts": "<thread.threadTs>",
  "text": "<your update>"
}
```

Use the `SLACK_TOKEN` from the environment for authorization.

**Post even when things go wrong.** Failed builds, test errors, unexpected behavior — all of it goes in the thread. Silence is worse than bad news.

## Rules for All Agents

1. **Never edit tracker.db directly.** Use `npx @web42/stask` commands only.
2. **Every task needs a spec.** No exceptions.
3. **Work in the task worktree.** Never in the main repo checkout.
4. **Commit and push before marking done.** Guards will block Testing if you don't.
5. **PR merge = Done.** Never manually transition to Done.
6. **All PR comments go through the Human.** External comments need explicit triage.
7. **Workers mark their own subtasks Done** via `npx @web42/stask subtask done <id>`.
8. **Reference specs by Slack file ID** (e.g., `F0XXXXXXXXX`), never by local path.
9. **Post every step to the task thread.** Every action, result, blocker, and question goes in the thread. No exceptions.
10. **Subtasks must match the spec.** Only the Lead creates subtasks, and only those listed in the spec's Subtasks section. Fix subtasks (after QA failure) are the only exception.
11. **No CLI approval.** There is no `stask approve` command. Approval happens exclusively via the `spec_approved` checkbox in Slack.
