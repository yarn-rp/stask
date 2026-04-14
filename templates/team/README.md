# Engineering Team Template

A generic, project-agnostic template for spinning up a 4-agent engineering team with OpenClaw.

## Team Structure

| Role | Purpose |
|------|---------|
| **Lead** | Tech Lead — plans, specs, delegates, reviews |
| **Backend** | Backend Engineer — API, DB, auth, integrations |
| **Frontend** | Frontend Engineer — pages, components, styling |
| **QA** | QA Engineer — browser tests, API tests, reports |

## What's Included

### Lead Agent (`lead/`)
- `SOUL.md` — Identity and 6-phase spec process
- `AGENTS.md` — Session setup, spawning logic, memory structure
- `HEARTBEAT.md` — Pipeline heartbeat for task polling
- `IDENTITY.md` — Fill in on first conversation
- `USER.md` — Learn about your human
- `BOOTSTRAP.md` — First-run onboarding script
- `MEMORY.md` — Standing rules and decisions

### Backend Agent (`backend/`)
- `SOUL.md` — Identity, scope, backend non-negotiables
- `AGENTS.md` — Session setup, OpenCode invocation
- `memory/` — Daily notes directory

### Frontend Agent (`frontend/`)
- `SOUL.md` — Identity, scope, design principles
- `AGENTS.md` — Session setup, OpenCode invocation
- `memory/` — Daily notes directory

### QA Agent (`qa/`)
- `SOUL.md` — Identity, QA workflow, report template
- `AGENTS.md` — Session setup, testing workflow
- `memory/` — Daily notes directory

### Shared (`shared/`)
- `TEAM.md` — Crew roster, task flow, ownership map
- `PROJECT.md` — Project overview (fill in per project)
- `STACK.md` — Tech stack reference (fill in per project)
- `ARCHITECTURE.md` — Data model and patterns (fill in per project)
- `CONVENTIONS.md` — Code style and rules
- `DEFINITION-OF-DONE.md` — DoD checklist
- `DEV.md` — Local development runbook (fill in per project)
- `ENV.md` — Environment variables (fill in per project)
- `GIT.md` — Git workflow and PR rules
- `OWNERSHIP.md` — File ownership map (fill in per project)
- `REVIEW-TEMPLATE.md` — Code review template
- `KNOWN-ISSUES.md` — Tech debt and known issues log
- `specs/` — Task specs (created per task)
- `decisions/` — Architecture decisions
- `reviews/` — Code review results
- `qa-reports/` — QA test reports
- `qa-reports/screenshots/` — Browser testing evidence
- `artifacts/` — Builder handoff notes
- `inbox/` — Incoming items to process
- `scripts/` — Utility scripts

## How to Use

### Option 1: Manual Copy

```bash
cp -r template /path/to/workspace-<project>/
# Then run find/replace on {{PLACEHolders}}
```

### Option 2: CLI Setup (Future)

```bash
stask setup <project-name>
# Interactive prompts for:
# - Lead name
# - Backend name
# - Frontend name
# - QA name
# - Project root path
# - Tech stack details
```

## Placeholders to Replace

All `{{PLACEHOLDER}}` values should be replaced during setup:

| Placeholder | Description |
|-------------|-------------|
| `{{LEAD_NAME}}` | Name of the Lead agent |
| `{{LEAD_NAME_LOWER}}` | Lowercase version (for paths) |
| `{{LEAD_MODEL}}` | OpenCode model for Lead |
| `{{BACKEND_NAME}}` | Name of Backend engineer |
| `{{BACKEND_NAME_LOWER}}` | Lowercase version |
| `{{BACKEND_MODEL}}` | OpenCode model for Backend |
| `{{FRONTEND_NAME}}` | Name of Frontend engineer |
| `{{FRONTEND_NAME_LOWER}}` | Lowercase version |
| `{{FRONTEND_MODEL}}` | OpenCode model for Frontend |
| `{{QA_NAME}}` | Name of QA engineer |
| `{{QA_NAME_LOWER}}` | Lowercase version |
| `{{QA_MODEL}}` | OpenCode model for QA |
| `{{PROJECT_NAME}}` | Human-readable project name |
| `{{PROJECT_SLUG}}` | URL-safe project slug |
| `{{PROJECT_ROOT}}` | Absolute path to project repo |
| `{{OPENCLAW_HOME}}` | OpenClaw home directory (usually `~/.openclaw`) |

## Process Overview

### The 6-Phase Golden Path

1. **Requirements & Analysis** — Lead resolves ambiguities with human
2. **Technical Exploration** — Spawn team for technical discovery
3. **Design & Architecture** — Consolidate findings into spec
4. **Approval & Delegation** — Human approves, subtasks created
5. **Implementation** — Workers build in worktrees
6. **QA → Review → Done** — QA tests, Lead reviews, human merges

### Key Principles

- **Spec Before Code** — No work starts without an approved spec
- **Zero Build Issues** — Build must pass with zero errors before merge
- **Ambiguity First** — Resolve unknowns before delegating
- **Worktrees** — Always work in task-specific branches
- **QA Evidence** — Every AC tested must have screenshot proof

## Skills

Skills are NOT included in the template — they live in each agent's `skills/` directory and are project-specific.

Recommended base skills to create per agent:
- **Lead:** `technical-spec-design`, `requirements-analysis`, `code-review`, `security-auditor`
- **Backend:** Project-specific backend skills (API, DB, auth, etc.)
- **Frontend:** Project-specific frontend skills (components, design system, etc.)
- **QA:** `qa-patrol` or equivalent, `api-tester`, `test-plan-generator`

## Memory Structure

Each agent has:
- `MEMORY.md` — Long-term memory (standing rules, decisions, preferences)
- `memory/YYYY-MM-DD.md` — Daily notes (created automatically)

## Next Steps

1. Copy template to new workspace
2. Replace all placeholders
3. Create agent-specific skills
4. Fill in project-specific shared docs (STACK, ARCHITECTURE, etc.)
5. Run `stask` setup for task framework integration
6. Start Phase 1 with your human

---

**Version:** 1.0.0
**Based on:** web42-network team structure (2026-03)