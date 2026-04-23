# Spec: Bootstrap Team — Explore Codebase & Set Up Agents

## Overview

Replace the ad-hoc bootstrap chat flow with a structured stask task. After `stask setup` completes, a bootstrap task is auto-created with this spec attached and subtasks pre-defined for each agent. The welcome message links directly to the task thread, where all bootstrap discussion happens.

**Why:** The current bootstrap process (reply-in-thread → free-form exploration) has inconsistent results: agents forget to write output, forget to notify lead, make wrong path decisions, and skip enrichment steps. This spec-driven approach ensures every bootstrap follows the same rigorous process.

---

## Technical Architecture

The bootstrap task is created by `stask setup` at the end of the wizard (after Slack setup, before the welcome message). It:

1. Runs `stask create --name "Bootstrap Team — Explore Codebase & Set Up Agents"` → creates task in Backlog with Slack thread attached
2. Attaches this spec via `stask spec-update T-XXX --spec shared/specs/bootstrap-team.md`
3. Creates subtasks for each agent via `stask subtask create --parent T-XXX --name "..." --assign <agent>`
4. Transitions task to To-Do via `stask transition T-XXX "To-Do"`
5. Posts welcome message with direct link to the task thread

**Thread Model:** All bootstrap discussion happens in the Slack thread attached to the parent task. Each agent posts their questions/findings in that thread (not DMs). The thread URL is included in the welcome message.

---

## Backend Plan (Berlin)

### Subtask: Backend Exploration

**What to do:**
1. Spawn Claude Code session (as Berlin) following the `stask-coding` skill
2. Deep exploration of backend codebase:
   - API surface: all routes, server actions, webhooks, middleware (method, auth, purpose)
   - Data layer: schema, tables, relationships, RLS policies, migrations (in order)
   - External integrations: payment, auth, email, storage (config location, key patterns)
   - Shared utilities: auth helpers, error handling, validation, logging
   - Code patterns: auth checks, error returns, input validation (flag variations)
   - Tech debt candidates: duplicated logic, inconsistent patterns, risky queries
3. Write structured report to `../shared/artifacts/bootstrap-backend.md`
4. Update your own `SOUL.md` (fill in "Your Stack") and `TOOLS.md` (add commands/paths)
5. Post questions in the **parent task thread** (not DMs) — list anything you couldn't determine from code
6. Run `stask subtask done` when complete

**Required Deliverables:**
- `../shared/artifacts/bootstrap-backend.md` with sections: Stack, Data Model, API Surface, External Integrations, Patterns Observed, Tech Debt Candidates, Questions for Human, Recommended Scope
- Updated `SOUL.md` with actual backend stack
- Updated `TOOLS.md` with project-specific commands/paths
- Questions posted in parent task thread

---

## Frontend Plan (Tokyo)

### Subtask: Frontend Exploration

**What to do:**
1. Spawn Claude Code session (as Tokyo) following the `stask-coding` skill
2. Deep exploration of frontend codebase:
   - Component architecture: pages, components, layout structure
   - State architecture: UI state, domain state, server state, derived state (where each lives)
   - Data flow: how data moves from API → state → components
   - Styling: CSS framework, theme system, dark mode, responsive patterns
   - Routing: client-side vs server-side, protected routes, redirects
   - External integrations: analytics, error tracking, feature flags
   - Tech debt candidates: unused components, inconsistent patterns, hard-coded values
3. Write structured report to `../shared/artifacts/bootstrap-frontend.md`
4. Update your own `SOUL.md` (fill in "Your Stack") and `TOOLS.md` (add commands/paths)
5. Post questions in the **parent task thread** (not DMs)
6. Run `stask subtask done` when complete

**Required Deliverables:**
- `../shared/artifacts/bootstrap-frontend.md` with sections: Stack, Component Architecture, State Architecture, Data Flow, Styling System, Routing, External Integrations, Tech Debt Candidates, Questions for Human, Recommended Scope
- Updated `SOUL.md` with actual frontend stack
- Updated `TOOLS.md` with project-specific commands/paths
- Questions posted in parent task thread

---

## QA Plan (Helsinki)

### Subtask: QA Audit

**What to do:**
1. Spawn Claude Code session (as Helsinki) following the `stask-coding` skill
2. Codebase QA audit:
   - Existing tests: test framework, coverage areas, test patterns, gaps
   - Manual testing surface: critical user flows, edge cases, error states
   - Accessibility: a11y patterns, missing ARIA, color contrast issues
   - Performance: slow queries, unoptimized renders, missing caching
   - Security: input validation, XSS/CSRF protection, secret handling
   - Tech debt candidates: flaky tests, missing error handling, untested code paths
3. Write structured report to `../shared/artifacts/bootstrap-qa.md`
4. Update your own `SOUL.md` (fill in "Your Stack") and `TOOLS.md` (add commands/paths)
5. Post questions in the **parent task thread** (not DMs)
6. Run `stask subtask done` when complete

**Required Deliverables:**
- `../shared/artifacts/bootstrap-qa.md` with sections: Test Stack, Existing Coverage, Manual Testing Flows, Accessibility Audit, Performance Concerns, Security Concerns, Tech Debt Candidates, Questions for Human, Recommended Test Strategy
- Updated `SOUL.md` with actual QA/test stack
- Updated `TOOLS.md` with project-specific commands/paths
- Questions posted in parent task thread

---

## Contract/API Between Them

**Shared Artifacts Directory:** `../shared/artifacts/`
- `bootstrap-backend.md` — Berlin's findings
- `bootstrap-frontend.md` — Tokyo's findings
- `bootstrap-qa.md` — Helsinki's findings

**Communication:**
- All questions posted in **parent task thread** (Slack)
- No DMs to human or other agents
- Lead monitors thread and consolidates questions for human

**File Enrichment:**
- Each agent updates their own workspace files (`SOUL.md`, `TOOLS.md`)
- Paths are workspace-relative (e.g., `/Users/yanrodriguez/.openclaw/workspace-{slug}/{agent}/SOUL.md`)

**Completion Signal:**
- Each agent runs `stask subtask done` when their artifact is written and files enriched
- Lead monitors via `stask heartbeat professor` or `stask show T-XXX`

---

## Acceptance Criteria (Testable & Explicit)

- [ ] Bootstrap task created in Backlog with this spec attached
- [ ] 4 subtasks created and assigned (Professor, Berlin, Tokyo, Helsinki)
- [ ] Task transitioned to To-Do (waiting for human spec approval)
- [ ] Welcome message includes direct link to task thread
- [ ] Berlin writes `../shared/artifacts/bootstrap-backend.md` with all required sections
- [ ] Tokyo writes `../shared/artifacts/bootstrap-frontend.md` with all required sections
- [ ] Helsinki writes `../shared/artifacts/bootstrap-qa.md` with all required sections
- [ ] All agents update their `SOUL.md` with actual stack info
- [ ] All agents update their `TOOLS.md` with project-specific commands/paths
- [ ] All agent questions posted in parent task thread (not DMs)
- [ ] All subtasks marked done via `stask subtask done`
- [ ] Lead consolidates findings and posts bootstrap summary in thread
- [ ] Human reviews artifacts and answers questions in thread

---

## QA Considerations (Helsinki's Section)

**QA Phase Gate:** This bootstrap task is special — QA is **not** a separate phase. Instead:
- Helsinki's subtask **is** the QA audit of the existing codebase
- No testing of the bootstrap task itself (it's a one-time setup task)
- Helsinki validates their own artifact completeness before marking done

**Success Metrics:**
- All three artifacts exist and have all required sections
- No "TBD" or "etc." in any artifact — all unknowns written as explicit questions
- All agents enriched their own files (SOUL.md, TOOLS.md)
- Human can review artifacts and answer all questions without needing follow-up exploration

---

## Implementation Notes (for stask setup wizard)

**Where to hook in:** After `stepWelcome` (slack-canvas.mjs), before the final outro.

**Steps:**
1. `stask create --name "Bootstrap Team — Explore Codebase & Set Up Agents" --overview "Structured bootstrap task to explore codebase and set up all agents"` → returns task ID and thread ID
2. `stask spec-update T-XXX --spec shared/specs/bootstrap-team.md`
3. Create subtasks:
   - `stask subtask create --parent T-XXX --name "Lead: Orchestrate Bootstrap" --assign professor`
   - `stask subtask create --parent T-XXX --name "Backend Exploration" --assign berlin` (or actual backend agent name)
   - `stask subtask create --parent T-XXX --name "Frontend Exploration" --assign tokyo` (or actual frontend agent name)
   - `stask subtask create --parent T-XXX --name "QA Audit" --assign helsinki` (or actual QA agent name)
4. `stask transition T-XXX "To-Do"`
5. Build task thread URL: `https://app.slack.com/client/{workspace}/{channelId}/thread/{channelId}-{threadTs}`
6. Update welcome message to link to task thread instead of prompting a reply

**Welcome Message Update:**
Replace the current "Reply in this thread to trigger bootstrap" CTA with:
```
:rocket: *Ready to get started?*

Your bootstrap task has been created: <{taskThreadUrl}|Bootstrap Team — Explore Codebase & Set Up Agents>

Click the link above to view the spec and subtasks. Approve the spec to begin — the team will explore the codebase, ask questions in this thread, and set up their workspaces.
```
