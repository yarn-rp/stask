# Team AGENTS.md — {{PROJECT_NAME}}

Universal rules for every agent. stask guards enforce these at the CLI level; violations get blocked.

### Also read

- [`README.md`](README.md) — project overview, priorities
- [`STACK.md`](STACK.md) — stack, env, ownership, known issues
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — data model, patterns, routing
- [`DEV.md`](DEV.md) — run, test, validate an AC

---

## The Crew

| Agent | Role |
|-------|------|
| **{{LEAD_NAME}}** 🧠 | Tech Lead — plans, specs, delegates, reviews |
| **{{BACKEND_NAME}}** 🔒 | Backend — API, DB, auth, infra |
| **{{FRONTEND_NAME}}** 🎨 | Frontend — pages, components, styling |
| **{{QA_NAME}}** 🧪 | QA — browser tests, API tests, reports |
| **{{HUMAN_NAME}}** | Owner / Human Reviewer |

## Task flow

```
{{HUMAN_NAME}} → {{LEAD_NAME}} (spec + ACs)
         → {{BACKEND_NAME}} / {{FRONTEND_NAME}} (build in worktree)
             → {{QA_NAME}} (test against ACs)
                 → {{LEAD_NAME}} (review + PR)
                     → {{HUMAN_NAME}} (merge)
```

Per-state commands live in each agent's own `AGENTS.md` § *stask by state*.

---

## Lifecycle gates (enforced by `lib/guards.mjs`)

| Gate | When | Checks |
|------|------|--------|
| `require_spec` | → To-Do | Spec attached |
| `require_subtasks` | → In-Progress | ≥1 subtask, all assigned |
| `require_approved` | → In-Progress | `spec_approved` ticked |
| `all_subtasks_done` | → Testing | Every subtask Done |
| `worktree_clean` | → Testing, → RHR | No uncommitted changes |
| `worktree_pushed` | → Testing, → RHR | No unpushed commits |
| `block_cli_done` | → Done | Parent tasks can't be CLI-transitioned |

## Hard rules

1. Task in To-Do assigned to **Human** = NOT approved. Wait for `spec_approved` in Slack.
2. Subtasks created + assigned BEFORE In-Progress.
3. Done is human-only. Only {{HUMAN_NAME}} marks Done (by merging the PR).
4. QA is a phase, never a subtask.
5. Work in the task worktree. Commit + push before `stask subtask done` or transitioning to Testing.
6. Never edit `tracker.db` directly — always through `stask`.
7. `stask subtask create --parent T-XXX` for subtasks. Never `stask create`.
8. Tasks start in Backlog. Attach spec via `stask spec-update` once clarifying questions are answered.
9. QA deletes test-only tasks after testing: `stask delete <task-id>`.

---

## Slack

- **Channel:** `#{{PROJECT_SLUG}}-project` (`{{SLACK_CHANNEL_ID}}`)
- **Task board (List):** `{{SLACK_LIST_ID}}` — syncs bidirectionally with `tracker.db`
- **Pings {{HUMAN_NAME}}:** Ready for Human Review, Blocked

### Rules

1. **Never DM work updates.** Progress, blockers, verdicts, questions → Slack only.
2. Task-scoped updates go in the **task's thread**. Look up via `stask show <id>`.
3. Broadcasts go at channel root (weekly recap, architecture decision, release ready).
4. Can't find the thread? Ask in channel referencing task ID — never DM as fallback.

`stask` auto-posts lifecycle events to the thread. Your human-readable updates belong there too.

### Accounts

| Slack | Agent |
|---|---|
| `{{LEAD_NAME_LOWER}}` | {{LEAD_NAME}} |
| `{{BACKEND_NAME_LOWER}}` | {{BACKEND_NAME}} |
| `{{FRONTEND_NAME_LOWER}}` | {{FRONTEND_NAME}} |
| `{{QA_NAME_LOWER}}` | {{QA_NAME}} |
| `{{HUMAN_SLACK_USER_ID}}` | {{HUMAN_NAME}} |

---

## Code Conventions

_Fill in during bootstrap — project-specific rules everyone follows._

- Language / types: _type strictness, where types live, validation approach_
- Server-side: _server-action patterns, auth-check requirements, error handling_
- Components: _patterns, styling, state management_
- File naming: _conventions_

Stack → [`STACK.md`](STACK.md). Patterns → [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Git & PR

- Branches: `feature/<slug>`, `fix/<slug>`, `chore/<slug>`. Always off `main`. `stask` creates the worktree + branch on `transition … In-Progress`.
- Conventional commits: `feat: …`, `fix: …`, `chore: …`, `docs: …`, `refactor: …`, `test: …`. Atomic — one logical change per commit.
- PR: title matches commit style; description = what / why / how to test; type check + lint pass (see [`DEV.md`](DEV.md)); {{QA_NAME}} verdict attached; {{LEAD_NAME}} approves before merge.
- Only {{LEAD_NAME}} or {{HUMAN_NAME}} merges to `main`.
- Migrations: test locally first, {{QA_NAME}} reviews the SQL, irreversible once run.

---

## Definition of Done

A task is not done until every applicable item is checked. Commands → [`DEV.md`](DEV.md).

- [ ] Type check + lint pass, zero errors
- [ ] No `any`, no stray `console.log`, no commented-out code
- [ ] All ACs met; edge cases handled (empty, loading, error)
- [ ] Auth checks on every mutation; errors human-readable
- [ ] Migrations (if any) reviewed by {{LEAD_NAME}}
- [ ] UI: desktop + mobile + dark mode + loading/empty states
- [ ] Unit tests by worker, happy path + key error cases
- [ ] Handoff note at `{{WORKSPACE_ROOT}}/shared/artifacts/<task-name>.md`
- [ ] QA report at `{{WORKSPACE_ROOT}}/shared/qa-reports/<date>-<feature>.md`, screenshots for every AC, verdict PASS
- [ ] {{LEAD_NAME}} reviewed code + report; build passes

---

## Shared directories

```
{{WORKSPACE_ROOT}}/shared/
├── specs/       ← {{LEAD_NAME}} writes task specs
├── artifacts/   ← worker handoff notes
├── qa-reports/  ← QA reports + screenshots/
└── {README, AGENTS, STACK, ARCHITECTURE, DEV}.md   ← these 5 docs
```
