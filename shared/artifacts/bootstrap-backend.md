# Backend Exploration Report

## Stack

| Layer | Technology | Version | Notes |
|-------|-----------|---------|-------|
| Runtime | Node.js | ≥22.5.0 | Uses `node:sqlite` (DatabaseSync) — requires Node 22+ |
| Language | JavaScript (ESM) | — | All `.mjs` files, `import`/`export` syntax, top-level await in bin |
| Database | SQLite (via node:sqlite) | — | `DatabaseSync` synchronous API, WAL mode for concurrency |
| CLI Framework | Custom (`bin/stask.mjs`) | — | Manual argv parsing, subcommand dispatch via dynamic `import()` |
| CLI Prompts | `@clack/prompts` | ^1.2.0 | Only used in `setup` wizard |
| Terminal Colors | `picocolors` | ^1.0.0 | Lightweight color output |
| Slack Integration | Slack Web API (HTTP) | — | Raw `https.request` calls, no SDK |
| GitHub Integration | `gh` CLI | — | Shell out to `gh api`, `gh pr create` |
| Linear Integration | `linear` CLI | — | Shell out to `linear issue mine --json` |
| Testing | Node.js built-in test runner | — | `node --test`, `node:test` assertions |
| Package Manager | npm | — | Published as `@web42/stask` on npm |

## Data Model

### Core Tables

| Table | Columns | Purpose |
|-------|---------|---------|
| `tasks` | `task_id` (PK), `task_name`, `status`, `assigned_to`, `spec`, `qa_report_1/2/3`, `type`, `parent_id` (FK→tasks), `blocker`, `worktree`, `pr`, `qa_fail_count`, `pr_status`, `created_at`, `updated_at` | Central task tracker with CHECK constraints on status and type |
| `log` | `id` (PK), `task_id` (FK), `message`, `created_at` | Immutable audit log — triggers prevent UPDATE and DELETE |
| `active_sessions` | `task_id` (PK, FK), `agent`, `session_id`, `claimed_at` | Session-level locking to prevent agent collisions |
| `slack_row_ids` | `task_id` (PK, FK), `row_id` | Cache mapping task_id → Slack List row ID for sync |
| `sync_state` | `task_id` (PK, FK), `slack_last_ts`, `db_last_ts` | Timestamp-based conflict resolution for bidirectional Slack sync |
| `inbox_items` | `item_id` (PK), `sub_id` (FK), `source_type`, `event_type`, `source_id`, `title`, `body`, `url`, `author`, `status`, `related_task_id`, `fingerprint`, `occurred_at`, `source_raw`, `processed_at`, `action_taken` | Inbox subscription engine event store |
| `inbox_subs` | `sub_id` (PK), `source_type`, `target_id`, `poll_interval`, `active`, `last_poll_at`, `cursor` | Subscription config for GitHub/Linear polling |

### Triggers

| Trigger | Purpose |
|---------|---------|
| `validate_status_transition` | Enforces legal status transitions (state machine). E.g., Done is terminal, Backlog→To-Do only, etc. |
| `enforce_in_progress_requirements` | Parent tasks going To-Do→In-Progress must have a worktree set |
| `enforce_ready_for_review_requirements` | Parent tasks going to RHR must have QA report, worktree, and PR set |
| `update_timestamp` | Auto-updates `updated_at` on any task mutation |
| `log_no_update` / `log_no_delete` | Makes log entries immutable — no UPDATE or DELETE allowed |
| `enforce_subtask_parent_ref` | Subtasks must reference an existing parent task |
| `enforce_unique_subtask_id` | Subtask IDs must be unique within parent scope |
| `enforce_qa_fail_limit` | qa_fail_count cannot exceed 3 |

### Status State Machine

```
Backlog → To-Do (requires spec)
        → Blocked

To-Do → In-Do (requires subtasks + approval + worktree for parents)
      → Blocked

In-Progress → Testing (for parents: all subtasks Done)
            → Blocked

Testing → Ready for Human Review (for parents: requires worktree clean/pushed + PR)
        → In-Progress (QA fail loop-back)
        → Blocked

Ready for Human Review → Done (terminal)
                       → In-Progress (review rejection)
                       → Blocked

Blocked → Backlog, To-Do, In-Progress, Testing, Ready for Human Review
```

## API Surface

| Command | Type | Purpose |
|---------|------|---------|
| `stask create` | Mutation | Create task in Backlog, optionally attach spec (uploads to Slack) |
| `stask transition <id> <status>` | Mutation | Transition task status with guard validation, side effects (worktree/PR creation, auto-assign, cascade) |
| `stask subtask create --parent <id> --name <name> --assign <agent>` | Mutation | Create subtask under parent |
| `stask subtask done <subtask-id>` | Mutation | Mark subtask Done; auto-transitions parent to Testing if all siblings Done |
| `stask assign <task-id> <name>` | Mutation | Reassign task to agent/human, syncs to Slack |
| `stask spec-update <task-id> --spec <path>` | Mutation | Re-upload spec file, update DB and Slack |
| `stask qa <task-id> --report <path> --verdict <PASS\|FAIL>` | Mutation | Submit QA report (uploads to Slack), increment fail count on FAIL |
| `stask delete <task-id> [--force]` | Mutation | Delete task + subtasks + Slack rows (blocks In-Progress/Testing unless --force) |
| `stask list [--status X] [--assignee Y] [--parent Z] [--json]` | Read-only | List tasks with filters |
| `stask show <task-id> [--log]` | Read-only | Show task details + optional log |
| `stask log [<task-id>] [--limit N]` | Read-only | View audit log |
| `stask heartbeat <agent-name>` | Read-only | Get pending work JSON for an agent (session-aware) |
| `stask heartbeat-all <agent-name>` | Read-only | Aggregate heartbeat across all projects |
| `stask pr-status <task-id>` | Read-only | Check PR merge status (DEPRECATED — use inbox) |
| `stask session claim\|release\|status` | Session | Manage agent session locks on tasks |
| `stask sync [--json]` | Sync | Run one bidirectional Slack↔DB sync cycle |
| `stask sync-daemon start\|stop\|status` | Daemon | Manage background sync daemon (PID file, detached process) |
| `stask inbox list\|show\|subscribe\|unsubscribe\|poll` | Inbox | Manage inbox subscriptions and items |
| `stask init <name> --repo <path>` | Setup | Create new stask project, scaffold `.stask/` |
| `stask setup [path]` | Setup | Interactive wizard: workspace, Slack, cron, OpenClaw |
| `stask teardown <slug>` | Setup | Remove all setup artifacts |
| `stask doctor [--json]` | Setup | Health checks for common misconfigurations |
| `stask projects [show <name>]` | Setup | List/show registered projects |
| `stask update [--check]` | Setup | Upgrade stask via npm |
| `stask test [suite]` | Dev | Run test suite via `node --test` |

## External Integrations

| Integration | Auth Method | Operations Used |
|-------------|-----------|-----------------|
| Slack (Web API) | Bot token (`SLACK_TOKEN`), resolved via layered env/config | `files.upload`, `chat.postMessage` (threads), `lists.setListItem`, `lists.deleteListItem`, `conversations.create`, `conversations.invite`, `conversations.archive`, `canvas.create`, `canvas.edit`, `bookmarks.add` |
| GitHub | `gh` CLI (keychain/config auth) | `gh api` (PR list, comments, merge status), `gh pr create --draft`, `git fetch`, `git push`, `git worktree add/remove` |
| Linear | `linear` CLI (API key from `linear auth login`) | `linear issue mine --json` |

### Slack Sync Details

- **Direction**: Bidirectional — DB↔Slack List
- **Conflict resolution**: Timestamp-based — most recent wins (`sync_state` table tracks `slack_last_ts` and `db_last_ts`)
- **Sync daemon**: Forked detached process, configurable interval (default 60s), PID file for single-instance
- **Thread notifications**: `postThreadUpdate()` — best-effort Slack thread messages with 3-attempt exponential backoff
- **File uploads**: Specs and QA reports uploaded as Slack files, stored as `filename (F0XXXXXXXXX)` in DB

### GitHub Integration Details

- **Worktree management**: `git worktree add` for task isolation, `git worktree remove` on Done
- **Branch naming**: `{type-prefix}/{slug}` (feature/bug/chore), collision handling appends task ID
- **Base branch**: Prefers `dev`, falls back to `main`
- **PR creation**: Draft PR via `gh pr create --draft`, auto-populates title/body from spec + QA report

## Patterns Observed

| Pattern | Where | Notes |
|---------|-------|-------|
| **DB-enforced state machine** | `tracker-db.mjs` (triggers) | All lifecycle rules in SQLite triggers and CHECK constraints. App layer can never bypass them via `updateTask()` — only `updateTaskDirect()` bypasses for external authority (inbox actions). |
| **Transaction wrapper** | `tx.mjs` | `withTransaction(fn, postCommitFn)` — runs DB mutations in a transaction, then executes Slack API calls post-commit. If Slack fails, logs error but DB change persists. |
| **Guard system** | `guards.mjs` | Two-phase: check guards (read-only validation) run first, then setup guards (side effects like worktree/PR creation). Any check failure stops the transition before side effects. |
| **Session locking** | `session-tracker.mjs` | Advisory locks per task — `claimTask()`/`releaseTask()`. Stale sessions (default 30 min) can be reclaimed. |
| **Inbox subscription engine** | `lib/inbox/` | Polls GitHub/Linear on cron, deduplicates via SHA-256 fingerprints, auto-executes deterministic rules (PR merged → Done, Yan comment → In-Progress, Linear ticket → Backlog) |
| **Lazy sync daemon** | `bin/stask.mjs` | Auto-starts sync daemon on mutation commands if not running. Read-only commands skip this. |
| **Layered config** | `env.mjs` + `resolve-home.mjs` | `STASK_HOME` env → `--project` flag → walk-up `.stask/config.json` → `~/.stask/projects.json` registry. Tokens resolved via env vars → project config → global config. |
| **Role-based auto-assign** | `roles.mjs` | Derived from `CONFIG.agents` by role. Status transitions auto-assign (To-Do→Yan, Testing→QA, etc.). |
| **JSONL error logging** | `error-logger.mjs` | Structured JSON lines to `.stask/logs/errors.jsonl` with 10MB rotation, 3 rotated files. |
| **CLI shell-out pattern** | `worktree-create.mjs`, `pr-create.mjs`, `inbox/sources/*.mjs` | Heavy use of `execSync`/`execFileSync` for git, gh, and linear CLI commands. Synchronous, blocking. |
| **Standalone script modules** | `worktree-create.mjs`, `worktree-cleanup.mjs`, `pr-create.mjs` | Run as `node worktree-create.mjs <taskId>` from guards. Side-effect scripts with their own DB access. |
| **Subtask cascade** | `commands/transition.mjs` | Parent status transitions cascade to all subtasks (drops trigger, updates, restores trigger). |
| **Heartbeat-driven dispatch** | `commands/heartbeat.mjs` | Agent-agnostic CLI that returns JSON with action prompts — OpenClaw cron calls this, agents read the output. |
| **Setup wizard** | `commands/setup.mjs` + `lib/setup/` | Multi-step interactive wizard for initial project setup: Slack app, channel, list, canvas, cron, OpenClaw config. State persisted to `~/.stask/setup-state-<slug>.json`. |

## Tech Debt Candidates

| Item | Severity | File:Line | Description |
|------|----------|-----------|-------------|
| Busy-wait retries | Medium | `lib/inbox/sources/github.mjs:38-42`, `lib/inbox/sources/linear.mjs:34-38`, `lib/inbox/pollerd.mjs:33-37` | Exponential backoff uses `while (Date.now() - start < delay)` busy-wait instead of `setTimeout`. Blocks the event loop. |
| No DB migrations | High | `lib/tracker-db.mjs` | Schema is created with `CREATE TABLE IF NOT EXISTS` — no migration system. Schema changes require manual DB recreation or risky ALTER TABLE. |
| Circular import risk | Low | `lib/env.mjs` ↔ `lib/tracker-db.mjs` | `env.mjs` imports `tracker-db.mjs` at top level, but `tracker-db.mjs` resolves config at module level via `resolve-home.mjs` (intentionally avoiding circular dep). Fragile — adding imports to `tracker-db.mjs` could break. |
| Sync daemon single-instance via PID | Medium | `lib/sync-daemon.mjs` | PID file check with `process.kill(pid, 0)` — no lock file, no stale PID cleanup beyond the check. Race condition if process crashes without cleanup. |
| Missing test coverage | High | `test/` | No tests for: `commands/*` (any CLI command), `lib/slack-sync.mjs`, `lib/slack-api.mjs`, `lib/inbox/*`, `lib/worktree-create.mjs`, `lib/pr-create.mjs`, `lib/guards.mjs`, `lib/env.mjs`, `lib/roles.mjs`. Only 7 test files covering DB triggers, sessions, roles, Slack row sync, and transactions. |
| `updateTaskDirect` bypasses triggers | Medium | `lib/tracker-db.mjs` | Used by inbox actions to bypass state machine (e.g., PR merged → Done). Necessary but risky — no audit trail for why triggers were bypassed. |
| Hard-coded base branch | Low | `lib/worktree-create.mjs:63-70`, `lib/pr-create.mjs:72-77` | Prefers `dev`, falls back to `main`. Not configurable per project. |
| Slack API without SDK | Low | `lib/slack-api.mjs` | Raw HTTPS requests, manual JSON parsing, hand-rolled retry logic. No type safety, no request validation. |
| No graceful shutdown for inbox polling | Low | `lib/inbox/pollerd.mjs` | No SIGTERM handler or cleanup. If OpenClaw kills the process mid-poll, items could be double-processed. |
| `file-uploader.mjs` incomplete | Medium | `lib/file-uploader.mjs` | Only partially implemented — `scanWorkspace` and upload logic exists but isn't called from any command. QA command uses `slack-api.uploadFile` directly instead. |
| Config loaded at import time | Medium | `lib/tracker-db.mjs:13-16` | `_configRaw` is read from disk at module import time. If config changes, the process must be restarted. No hot reload. |
| Log immutability only in triggers | Low | `lib/tracker-db.mjs` | App code can't update/delete log entries either way, but the enforcement is only in DB triggers. No API-level protection. |

## Questions for Human

1. **@yan Is there a plan for DB migrations?** Currently the schema is `CREATE TABLE IF NOT EXISTS` with no version tracking. If columns are added or constraints changed, existing DBs won't pick up changes without manual intervention. Should I design a migration system?

2. **@yan What's the intended scope of `file-uploader.mjs`?** It has a `scanWorkspace` function that matches glob patterns (`shared/specs/*.md`, `shared/artifacts/*.md`, etc.) and an upload-to-Slack flow, but it's not called from anywhere. Should this be integrated into `sync` or a separate `stask upload` command?

3. **@yan How should inbox polling work in production?** The `pollerd.mjs` is designed as a cron entry, but there's no mechanism to prevent overlapping poll cycles if one takes longer than the interval. Should there be a lock file or DB-based lock?

4. **@yan Is the `dev` vs `main` base branch preference intentional and universal?** Both `worktree-create.mjs` and `pr-create.mjs` prefer `dev` then fall back to `main`. Some projects might use `develop` or have a different branching strategy.

5. **@yan Should the `updateTaskDirect` bypass be more restricted?** Currently it's used for inbox auto-transitions (PR merged → Done) and could theoretically be called from anywhere. Should it require an explicit `reason` parameter that gets logged?

6. **@yan What's the ownership model for the `lib/setup/` modules?** They're substantial (14 files, interactive wizard) but only used during initial project setup. Should Berlin maintain these, or are they "setup once and forget"?

## Recommended Scope

### What Berlin Should Own

- **Core lifecycle engine**: `tracker-db.mjs`, `guards.mjs`, `tx.mjs`, `validate.mjs`, `roles.mjs`, `session-tracker.mjs`
- **CLI commands**: All `commands/*.mjs` — they're the primary interface
- **Transition system**: State machine, guards, cascade logic, auto-assignment
- **Inbox subscription engine**: `lib/inbox/*` — GitHub/Linear polling and action execution
- **Sync infrastructure**: `lib/slack-sync.mjs`, `lib/slack-row.mjs`, `lib/slack-api.mjs`, `sync-daemon.mjs`
- **Error handling**: `lib/error-logger.mjs` — structured logging

### What Berlin Should NOT Touch

- **Setup wizard**: `lib/setup/*` — maintained as-needed, not a core backend concern
- **Frontend/UI**: `@clack/prompts` usage in setup — Tokyo's territory
- **QA testing**: Helsinki owns test strategy, but Berlin should add unit tests for backend modules

### Immediate Priorities

1. **Add DB migration system** — Critical for production evolution. Even a simple version-number table + ordered migration files would prevent data loss.
2. **Fix busy-wait retries** — Replace `while(Date.now())` loops with proper `setTimeout`/`await` patterns. These block the event loop.
3. **Expand test coverage** — Prioritize: `guards.mjs` (lifecycle enforcement), `tx.mjs` (transaction rollback), `roles.mjs` (auto-assignment), `commands/transition.mjs` (cascade logic).
4. **Add inbox polling lock** — Prevent overlapping poll cycles with a DB lock or PID-based mechanism.
5. **Document `updateTaskDirect` contract** — Add a mandatory `reason` field that gets logged, making bypasses auditable.