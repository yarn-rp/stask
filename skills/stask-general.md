---
name: stask-general
description: Task lifecycle framework — spec-first workflow, Slack sync, status transitions, worktree isolation, and PR-based review. SQLite is the single source of truth. All operations go through the `stask` CLI.
---

# stask — Task Lifecycle Framework

SQLite-backed task lifecycle management with Slack sync. Every operation goes through the `stask` CLI — the database enforces all lifecycle rules via triggers and constraints, and every mutation syncs to Slack atomically.

## Core Rules

1. **No task exists without a spec uploaded to Slack.** Every task must have a Spec value: `specs/<name>.md (F0XXXXXXXXX)`.
2. **SQLite is the single source of truth.** Never edit `tracker.db` directly — use `stask` commands only.
3. **Every parent task gets its own worktree.** The guard system creates it automatically on In-Progress.
4. **PR merge = Done.** The Human merges on GitHub, the system auto-completes the task.
5. **DB + Slack are transactional.** If Slack sync fails, the DB rolls back.

## Roles

| Role | Responsibility |
|------|---------------|
| **Human** | Approves specs (via Slack checkbox), reviews PRs on GitHub, merges |
| **Lead** | Creates subtasks, delegates, coordinates fixes |
| **Worker(s)** | Implements subtasks in worktrees, marks them done |
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
| `stask create --spec <path> --name "..." [--type Feature\|Bug\|Task]` | Create task (auto-uploads spec to Slack) |
| `stask approve <task-id>` | Human approves spec (reassigns to Lead) |
| `stask transition <task-id> <status>` | Transition status (guards enforce prerequisites) |
| `stask subtask create --parent <id> --name "..." --assign <agent>` | Create subtask under parent |
| `stask subtask done <subtask-id>` | Worker marks subtask Done (auto-cascades parent) |
| `stask qa <task-id> --report <path> --verdict PASS\|FAIL` | Submit QA verdict with report |
| `stask assign <task-id> <name>` | Reassign a task |
| `stask spec-update <task-id> --spec <path>` | Re-upload edited spec |

### Read-only commands

| Command | Purpose |
|---------|---------|
| `stask list [--status X] [--assignee Y] [--json]` | List tasks (filterable) |
| `stask show <task-id> [--log]` | Show task details + subtasks + audit log |
| `stask log [<task-id>] [--limit N]` | View audit log |
| `stask heartbeat <agent-name>` | Returns pending work for an agent (JSON) |
| `stask pr-status <task-id>` | Poll PR for comments/merge status |
| `stask session claim\|release\|status <task-id>` | Manage session locks |

### Sync commands

| Command | Purpose |
|---------|---------|
| `stask sync` | Run one bidirectional sync cycle |
| `stask sync-daemon start\|stop\|status` | Manage background sync daemon |

## Rules for All Agents

1. **Never edit tracker.db directly.** Use `stask` commands only.
2. **Every task needs a spec.** No exceptions.
3. **Work in the task worktree.** Never in the main repo checkout.
4. **Commit and push before marking done.** Guards will block Testing if you don't.
5. **PR merge = Done.** Never manually transition to Done.
6. **All PR comments go through the Human.** External comments need explicit triage.
7. **Workers mark their own subtasks Done** via `stask subtask done <id>`.
8. **Reference specs by Slack file ID** (e.g., `F0XXXXXXXXX`), never by local path.
