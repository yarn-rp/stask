# Spec: Bootstrap Team — Explore Codebase & Set Up Agents

## What to Bootstrap

After `stask setup` completes, each agent explores the codebase, documents their findings, and sets up their workspace. This is the first thing every new team member does — understand the project before touching any code.

---

## Backend Exploration (Berlin)

### What to Look For
- API surface: all CLI commands, their arguments, and what they do
- Data layer: SQLite schema, tables, relationships, triggers, migration strategy
- External integrations: Slack API, GitHub CLI, Linear CLI — how they're called, auth, error handling
- Code patterns: transaction wrapper, guard system, sync daemon, inbox polling
- Tech debt: duplicated logic, inconsistent patterns, risky queries, missing error handling

### Output Schema

Write to `../shared/artifacts/bootstrap-backend.md`:

```markdown
# Backend Exploration Report

## Stack
| Layer | Technology | Version | Notes |
|-------|-----------|---------|-------|

## Data Model
### Core Tables
| Table | Columns | Purpose |
|-------|---------|---------|
### Triggers
| Trigger | Purpose |
|---------|---------|

## API Surface
| Command | Type | Purpose |
|---------|------|---------|

## External Integrations
| Integration | Auth Method | Operations Used |
|-------------|-----------|----------------|

## Patterns Observed
| Pattern | Where | Notes |
|---------|-------|-------|

## Tech Debt Candidates
| Item | Severity | File:Line | Description |
|------|----------|-----------|-------------|

## Questions for Human
1. **@yan [QUESTION]** ...

## Recommended Scope
### What Berlin Should Own
### Immediate Priorities
```

Also update:
- Your `AGENTS.md` — add Notes/Gotchas from exploration
- `{{WORKSPACE_ROOT}}/shared/DEV.md` — fill in real build/test/lint/validation commands

Post all questions in the **parent task thread** using `@yan [QUESTION]` format. Do not mark subtask done until questions are answered.

---

## Frontend Exploration (Tokyo)

### What to Look For
- Component architecture: entry points, command structure, module hierarchy
- State architecture: where state lives (SQLite, config, CLI flags), how it flows
- Styling: terminal UI framework (`@clack/prompts`, `picocolors`), patterns used
- Data flow: how CLI input → command → DB → Slack sync works end-to-end
- Tech debt: unused modules, inconsistent patterns, hard-coded values

### Output Schema

Write to `../shared/artifacts/bootstrap-frontend.md`:

```markdown
# Frontend Exploration Report

## Stack
| Layer | Technology | Version | Notes |
|-------|-----------|---------|-------|

## Component Architecture
## State Architecture
## Data Flow
## Styling System

## Tech Debt Candidates
| Item | Severity | File:Line | Description |
|------|----------|-----------|-------------|

## Questions for Human
1. **@yan [QUESTION]** ...

## Recommended Scope
### What Tokyo Should Own
### Immediate Priorities
```

Also update:
- Your `AGENTS.md` — add Notes/Gotchas from exploration
- `{{WORKSPACE_ROOT}}/shared/DEV.md` — fill in real build/test/lint/validation commands

Post all questions in the **parent task thread** using `@yan [QUESTION]` format. Do not mark subtask done until questions are answered.

---

## QA Audit (Helsinki)

### What to Investigate

This is a **manual testing** exploration, not automated test auditing. Your job is to figure out how to actually run and test the project end-to-end:

- **How to run the project:** What commands start the app? What prerequisites are needed? What environment variables?
- **Login and credentials:** Does the app require authentication? How do you get credentials? Are there test accounts?
- **Critical user flows:** What are the main things a user does? Walk through each one manually.
- **Manual testing surface:** What can break that automated tests won't catch? Edge cases, error states, UI glitches.
- **Getting started friction:** What would block a new team member from testing the app right now?
- **Automated testing gaps:** Each worker owns their own unit tests. What's missing that needs integration or E2E coverage?

**You are not complete until you can run a basic experiment with the most straightforward feature.**

### Output Schema

Write to `../shared/artifacts/bootstrap-qa.md`:

```markdown
# QA Exploration Report

## How to Run the Project
| Step | Command | Notes |
|------|---------|-------|

## Credentials & Access
| Resource | How to Get Access | Notes |
|----------|------------------|-------|

## Critical User Flows
| Flow | Steps | Status |
|------|-------|--------|

## Manual Testing Surface
| Area | Risk | What to Test |
|------|------|-------------|

## Getting Started Blockers
| Blocker | Severity | Workaround |
|---------|----------|-----------|

## Automated Testing Gaps
| Area | Gap | Who Should Own |
|------|-----|---------------|

## Questions for Human
1. **@yan [QUESTION]** ...

## Recommended Test Strategy
```

Also update:
- Your `AGENTS.md` — add Notes/Gotchas from exploration
- `{{WORKSPACE_ROOT}}/shared/DEV.md` — fill in real build/test/lint/validation commands

Post all questions in the **parent task thread** using `@yan [QUESTION]` format. Do not mark subtask done until questions are answered.

---

## Acceptance Criteria

- [ ] Bootstrap task created with this spec attached
- [ ] 4 subtasks created and assigned (Professor, Berlin, Tokyo, Helsinki)
- [ ] Task transitioned to To-Do (waiting for human spec approval)
- [ ] Welcome message includes direct link to task thread
- [ ] Berlin writes `../shared/artifacts/bootstrap-backend.md` with all required sections
- [ ] Tokyo writes `../shared/artifacts/bootstrap-frontend.md` with all required sections
- [ ] Helsinki writes `../shared/artifacts/bootstrap-qa.md` with all required sections
- [ ] Stack populated in `{{WORKSPACE_ROOT}}/shared/STACK.md` by Lead
- [ ] `{{WORKSPACE_ROOT}}/shared/DEV.md` Project Commands table filled in
- [ ] All agent questions posted in parent task thread (not DMs)
- [ ] All subtasks marked done via `stask subtask done`
- [ ] Lead consolidates findings and posts bootstrap summary in thread
- [ ] Human reviews artifacts and answers questions in thread

---

## Implementation Notes (for stask setup wizard)

**Where to hook in:** Before `stepWelcome` (so welcome message has the thread URL).

**Steps:**
1. `stask create --name "Bootstrap Team — Explore Codebase & Set Up Agents" --overview "Structured bootstrap task to explore codebase and set up all agents"` → returns task ID and thread ID
2. `stask spec-update T-XXX --spec shared/specs/bootstrap-team.md`
3. `stask transition T-XXX "To-Do"`
4. Create subtasks:
   - `stask subtask create --parent T-XXX --name "Lead: Orchestrate Bootstrap" --assign professor`
   - `stask subtask create --parent T-XXX --name "Backend Exploration" --assign berlin`
   - `stask subtask create --parent T-XXX --name "Frontend Exploration" --assign tokyo`
   - `stask subtask create --parent T-XXX --name "QA Audit" --assign helsinki`
5. Build task thread URL: `https://app.slack.com/client/{workspace}/{channelId}/thread/{channelId}-{threadTs}`
6. Pass URL to welcome message

**Welcome Message Update:**
Replace the current "Reply in this thread to trigger bootstrap" CTA with:
```
:rocket: *Ready to get started?*

Your bootstrap task has been created: <{taskThreadUrl}|Bootstrap Team — Explore Codebase & Set Up Agents>

Click the link above to view the spec and subtasks. Approve the spec to begin — the team will explore the codebase, ask questions in this thread, and set up their workspaces.
```