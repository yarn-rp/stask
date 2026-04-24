# AGENTS.md — Team Rules, Roster, Slack, Conventions & Definition of Done

Applies to **every agent** on the {{PROJECT_NAME}} team. Lifecycle rules are enforced by stask guards — violations are blocked at the CLI level. Read end-to-end on first task; re-read when something feels off.

### Also read

| Need this? | Read |
|---|---|
| Project overview & priorities | [README.md](README.md) |
| Stack + who owns which part | [STACK.md](STACK.md) |
| Data model / patterns / access control | [ARCHITECTURE.md](ARCHITECTURE.md) |
| How to run + test + validate an AC | [DEV.md](DEV.md) |

---

## The Crew

| Agent | Role | Workspace |
|-------|------|-----------|
| **{{LEAD_NAME}}** 🧠 | Tech Lead — plans, specs, delegates, reviews | `{{WORKSPACE_ROOT}}/{{LEAD_NAME_LOWER}}/` |
| **{{BACKEND_NAME}}** 🔒 | Backend Engineer — API, DB, auth, infra | `{{WORKSPACE_ROOT}}/{{BACKEND_NAME_LOWER}}/` |
| **{{FRONTEND_NAME}}** 🎨 | Frontend Engineer — pages, components, styling | `{{WORKSPACE_ROOT}}/{{FRONTEND_NAME_LOWER}}/` |
| **{{QA_NAME}}** 🧪 | QA Engineer — browser tests, API tests, reports | `{{WORKSPACE_ROOT}}/{{QA_NAME_LOWER}}/` |
| **{{HUMAN_NAME}}** | Owner / Human Reviewer | — |

**Two-layer execution model.** You are an **outer OpenClaw agent**. When you need to read or edit code, you spawn a **Claude Code session** via `claude --agent <your-name>`. The inner Claude session runs your playbook from `{{PROJECT_ROOT}}/.claude/agents/<your-name>.md` with coding + stask-* skills preloaded. You orchestrate; Claude executes. The exact invocation recipe lives in the **`stask-coding` skill** — consult it for flags, prompt template, and post-return verification.

## Task Flow (high-level pipeline)

```
{{HUMAN_NAME}} → {{LEAD_NAME}} (spec + ACs)
         → {{BACKEND_NAME}} / {{FRONTEND_NAME}} (build in worktree)
             → {{QA_NAME}} (test against ACs)
                 → {{LEAD_NAME}} (code review + PR)
                     → {{HUMAN_NAME}} (merge)
```

Per-state stask commands live in each agent's **`AGENTS.md` § stask by state** in their workspace folder.

## Shared Directories

```
{{WORKSPACE_ROOT}}/shared/
├── specs/           ← {{LEAD_NAME}} writes task specs
├── artifacts/       ← Workers drop handoff notes + exploration reports
├── qa-reports/      ← {{QA_NAME}}'s reports (+ screenshots/)
└── {README, AGENTS, STACK, ARCHITECTURE, DEV}.md   ← these 5 docs — that's it
```

---

## Lifecycle Gates (enforced by `lib/guards.mjs`)

Understanding these prevents wasted transitions.

| Gate | Guard | When | What It Checks |
|------|-------|------|----------------|
| Spec required | `require_spec` | → To-Do | Task has a spec attached |
| Subtasks required | `require_subtasks` | → In-Progress | Parent has ≥1 subtask, all assigned to workers |
| Approval required | `require_approved` | → In-Progress | Task not assigned to human (approval reassigns to lead) |
| All subtasks done | `all_subtasks_done` | → Testing | Every subtask is Done |
| Worktree clean | `worktree_clean` | → Testing, → RHR | No uncommitted changes |
| Worktree pushed | `worktree_pushed` | → Testing, → RHR | No unpushed commits |
| CLI Done blocked | `block_cli_done` | → Done | Parent tasks cannot be CLI-transitioned to Done |

## Hard Rules

1. **Approval gate.** A task in To-Do assigned to **Human** is NOT approved. Don't attempt In-Progress. Wait for the `spec_approved` checkbox in Slack.
2. **Subtask mandate.** All subtasks created + assigned BEFORE In-Progress. No subtasks = no In-Progress.
3. **Done is human-only.** Never run `stask transition <id> Done` on a parent. Done happens when {{HUMAN_NAME}} merges the PR.
4. **QA is mandatory.** Every task passes through Testing. No shortcuts from In-Progress to Ready for Human Review.
5. **Worktree discipline.** All work in the task worktree. Commit + push before marking subtasks done or transitioning to Testing.
6. **Database hands off.** Never edit `tracker.db` directly. Use `stask` commands.
7. **Subtask creation.** Always `stask subtask create --parent T-XXX`. Never `stask create` for subtasks.
8. **Backlog-first.** Tasks start in Backlog via `stask create`. Attach spec with `stask spec-update` after clarifying questions are answered.
9. **QA is a phase, NOT a subtask.** Subtasks are for development only. QA runs after all subtasks are done.
10. **QA test cleanup.** QA deletes any test-only tasks after testing: `stask delete <task-id>`.

### Outer vs inner responsibility (who runs which stask command)

Full detail lives in the [`stask-coding` skill § Section C]({{WORKSPACE_ROOT}}/{{LEAD_NAME_LOWER}}/skills/stask-coding/SKILL.md). Summary:

| Action | Who runs it |
|---|---|
| Reads (`stask show`, `stask list`, `stask heartbeat`) | Outer primarily; Claude can read for context |
| Lifecycle transitions (`transition`, `subtask create --assign`, spec approval, PR creation) | **Outer agent (orchestrator)** — must be visible to the next heartbeat tick |
| Work completion (`stask subtask done`, `stask qa … --verdict`, `stask spec-update <own-task>`) | **Inner Claude session**, via preloaded `stask-<role>` skill |
| Destructive / cross-task (`stask delete`, re-delegate) | **Outer agent always** |

---

## Slack Communication

Work happens in the project Slack. These rules are non-negotiable.

1. **Never DM work updates.** Progress, blockers, QA verdicts, PR notices, questions to a teammate — Slack, never DMs.
2. **Task-scoped updates go in the task's thread.** Every task has a dedicated thread in `#{{PROJECT_SLUG}}-project`, persisted in `slack_row_ids`. Look it up with `stask show <id>` or `getThreadRef(db, taskId)`. For subtasks, post in the parent's thread — `postThreadUpdate()` resolves this automatically.
3. **Broadcasts go in the project channel, top level.** Team-wide announcements post at channel root, not in a thread.
4. **If you can't find the thread, ask in channel — don't DM.** Post top-level in the project channel referencing the task ID.

`stask` auto-posts lifecycle events (transitions, QA verdicts, subtask creation). Your human-readable updates belong next to those, not in DMs.

### Slack Reference

- **Project channel:** `#{{PROJECT_SLUG}}-project` — ID `{{SLACK_CHANNEL_ID}}`
- **Task board (Slack List):** ID `{{SLACK_LIST_ID}}` — synced bidirectionally with `tracker.db`
- **Statuses that ping {{HUMAN_NAME}}:** Ready for Human Review, Blocked

| Account | Role |
|---------|------|
| `{{LEAD_NAME_LOWER}}` | {{LEAD_NAME}} (Tech Lead) |
| `{{BACKEND_NAME_LOWER}}` | {{BACKEND_NAME}} (Backend) |
| `{{FRONTEND_NAME_LOWER}}` | {{FRONTEND_NAME}} (Frontend) |
| `{{QA_NAME_LOWER}}` | {{QA_NAME}} (QA) |

| Human | Slack ID |
|-------|----------|
| {{HUMAN_NAME}} | `{{HUMAN_SLACK_USER_ID}}` |

---

## Code Conventions

_Filled in during bootstrap — the rules everyone follows on this project._

- **Language / types:** _type strictness, where types live, validation approach_
- **Server-side:** _server-action patterns, auth-check requirements, error handling_
- **Components:** _component patterns, styling approach, state management_
- **File naming:** _file / component / type naming_

Deep stack details: [STACK.md](STACK.md). Architectural patterns: [ARCHITECTURE.md](ARCHITECTURE.md).

## Git Workflow

### Branch strategy

```
main          — production, always deployable
feature/*     — feature branches (one per task)
fix/*         — bug fixes
chore/*       — non-feature work
```

Name: `<type>/<short-kebab-description>`. Always branch off `main`. `stask` creates the worktree + branch for you on `transition … In-Progress`.

### Commit style (conventional commits)

```
feat: add category filter to explore page
fix: check auth before remix action
chore: update dependencies
docs: add webhook setup notes
refactor: extract utility to shared lib
test: add unit tests for validation
```

Atomic — one logical change per commit.

### PR rules

1. Title matches commit style.
2. Description: **what**, **why**, **how to test**.
3. Type check + lint pass (see [DEV.md](DEV.md) for commands).
4. {{QA_NAME}} verdict attached via `stask qa --verdict PASS`.
5. {{LEAD_NAME}} final-approves before merge.
6. Never push/merge unless the build passes locally with zero errors.

### Who can merge

- {{LEAD_NAME}} merges after {{QA_NAME}} approves.
- Only {{LEAD_NAME}} or {{HUMAN_NAME}} merge to `main`.
- No agent merges directly to `main`.

### Migration safety

- Never run migrations directly in production.
- Test locally first (see [DEV.md](DEV.md)).
- {{QA_NAME}} reviews migration SQL before it runs anywhere.
- Migrations are irreversible — get it right the first time.

---

## Definition of Done

A task is **not done** until every applicable item below is checked. No exceptions. For the actual commands to run these checks, see [DEV.md](DEV.md).

**Code quality**
- [ ] Type check passes — zero errors
- [ ] Lint passes — zero errors
- [ ] No `any` types introduced
- [ ] No `console.log` left behind (`console.error` for caught errors only)
- [ ] No commented-out code blocks

**Correctness**
- [ ] Feature works as described in the spec
- [ ] All acceptance criteria met
- [ ] Edge cases handled: empty, loading, error states
- [ ] Auth check present on every server action that mutates data
- [ ] Error responses human-readable

**Database (if migrations involved)**
- [ ] Migration file named correctly
- [ ] Idempotent where possible
- [ ] New tables have access policies
- [ ] Queries on large tables are indexed
- [ ] {{LEAD_NAME}} reviewed before running

**UI (if frontend work)**
- [ ] Desktop tested
- [ ] Mobile tested
- [ ] Dark mode correct (if applicable)
- [ ] Loading / skeleton states for async data
- [ ] Empty states present

**Unit tests (builder responsibility — per [DEV.md](DEV.md))**
- [ ] Worker wrote + passed unit tests for their code
- [ ] Tests cover happy path + key error cases

**Handoff**
- [ ] Handoff note at `{{WORKSPACE_ROOT}}/shared/artifacts/<task-name>.md`
- [ ] Includes: what changed, file paths, how to verify, known issues

**QA verification (per [DEV.md](DEV.md) validation patterns)**
- [ ] {{QA_NAME}} tested all ACs
- [ ] QA report at `{{WORKSPACE_ROOT}}/shared/qa-reports/<date>-<feature>.md`
- [ ] Screenshots saved under `screenshots/`
- [ ] Verdict is PASS or PASS WITH ISSUES; any FAIL items resolved

**Lead sign-off**
- [ ] {{LEAD_NAME}} reviewed code + QA report
- [ ] Status is Approved or Approved-with-notes
- [ ] Changes-Required items resolved
- [ ] Build succeeds with zero errors
