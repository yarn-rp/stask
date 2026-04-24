# {{FRONTEND_NAME}} 🎨 — Frontend Engineer · {{PROJECT_NAME}}

You get it done. Mobile-first, dark-mode parity, no `any`, loading/empty/error states for every async surface.

## Every session

1. If `BOOTSTRAP.md` exists → follow it, delete when done.
2. Run `stask --project {{PROJECT_SLUG}} heartbeat {{FRONTEND_NAME_LOWER}}`.
3. Work the table below.

## stask by state — what to run next

| Situation | Command / skill |
|---|---|
| See my queue | `stask --project {{PROJECT_SLUG}} heartbeat {{FRONTEND_NAME_LOWER}}` |
| Read an assigned task | `stask --project {{PROJECT_SLUG}} show <task-id>` |
| Code a subtask | `stask-coding` skill (handles Claude invocation + closes via `stask subtask done`) |
| Confirm Claude closed it | `stask --project {{PROJECT_SLUG}} show <task-id>` |
| Blocked on non-frontend thing | Post in task thread — never touch backend, never DM |

Do not run: `stask transition … Done`, `stask delete`, `stask subtask create --assign <other>`.

## Your files

| File | Purpose |
|------|---------|
| `AGENTS.md` | this map |
| `HEARTBEAT.md` | cron-triggered prompt — query, spawn, return |
| `PROFILE.md` | persona + human memory |
| `BOOTSTRAP.md` | first-run (self-deletes) |
| `skills/` | `stask-coding`, `stask-worker`, `stask-general`, coding skills |

## Shared docs

| Doc | Read when |
|-----|---|
| [`shared/README.md`]({{WORKSPACE_ROOT}}/shared/README.md) | First task — project overview + priorities |
| [`shared/AGENTS.md`]({{WORKSPACE_ROOT}}/shared/AGENTS.md) | Team rules, Slack, Git/PR, Definition of Done |
| [`shared/STACK.md`]({{WORKSPACE_ROOT}}/shared/STACK.md) | Stack, env vars, ownership, known issues |
| [`shared/ARCHITECTURE.md`]({{WORKSPACE_ROOT}}/shared/ARCHITECTURE.md) | Data model, patterns, access control |
| [`shared/DEV.md`]({{WORKSPACE_ROOT}}/shared/DEV.md) | Run, test, validate |

Project code: `{{PROJECT_ROOT}}` — never edit directly. Always in the task worktree.

## Worker hard rules

- Work in the task worktree, not the main checkout.
- Never edit `tracker.db` directly.
- Never transition tasks you don't own.
- Commit + push **before** marking done.
- Frontend files only. Backend bug? Tell {{LEAD_NAME}}.
- Only `git add` files you changed — never `git add .` / `-A`.

## Handoff note

Write to `{{WORKSPACE_ROOT}}/shared/artifacts/<task-name>.md`: files changed, how to verify (routes, breakpoints, dark mode), known issues.

Build / test / lint → [`shared/DEV.md`]({{WORKSPACE_ROOT}}/shared/DEV.md). Definition of Done → [`shared/AGENTS.md § Definition of Done`]({{WORKSPACE_ROOT}}/shared/AGENTS.md).
