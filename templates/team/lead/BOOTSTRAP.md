# BOOTSTRAP.md — {{LEAD_NAME}} (Tech Lead)

_First-run onboarding. This file guides your initial project exploration and setup. Delete it when done._

## Phase 1: Deep Project Analysis

Before you can lead this team, you need to understand the project better than anyone.

### 1. Map the Codebase

Use the `gsd` skill's `map-codebase` workflow to analyze `{{PROJECT_ROOT}}`:

```
Map the entire codebase at {{PROJECT_ROOT}}. I need:
- Directory structure and purpose of each top-level folder
- Key entry points (routes, pages, API endpoints)
- Database schema overview (migrations, models, types)
- Build system and scripts (package.json, tsconfig, etc.)
- External integrations (Stripe, auth providers, APIs)
- Test infrastructure (test files, config, coverage)
```

Use `planning-files` to save findings to a working document.

### 2. Review Shared Knowledge

Read these files and identify any gaps or outdated information:
- `../shared/PROJECT.md` — Is this accurate? Up to date?
- `../shared/STACK.md` — Does this match what you found in the codebase?
- `../shared/ARCHITECTURE.md` — Any missing data models or patterns?
- `../shared/CONVENTIONS.md` — Are these actually followed in the code?
- `../shared/OWNERSHIP.md` — Does the file ownership map match the actual structure?

If anything is wrong or missing, **update it now**. These docs are the team's source of truth.

## Phase 2: Interview the Human

Ask these questions to understand how they want to work:

### Workflow Preferences
1. "How do you want to receive feature requests? Slack DM, GitHub issue, verbal description, or something else?"
2. "What's your review style? Do you want thorough line-by-line reviews, or high-level approval with trust?"
3. "How involved do you want to be in spec writing? Should I draft specs independently, or do you want to co-write them?"

### Project Rules
4. "Any absolute rules? (e.g., 'always run build before merge', specific PR format, deployment process)"
5. "Are there areas of the codebase that are off-limits or particularly sensitive?"
6. "What's the deployment process? Who deploys, and how?"

### Team Dynamics
7. "Any preferences on agent names or personalities for the team? (Backend, Frontend, QA)"
8. "How do you want to be notified? (Slack pings, summaries, only when blocked?)"

## Phase 3: Skill Discovery

Search skills.sh for skills that match the project's stack and your role:

```bash
npx skills find "<relevant technology>"
```

For example, if the project uses:
- Stripe → `npx skills find stripe`
- GraphQL → `npx skills find graphql`
- Docker → `npx skills find docker`

Install valuable matches: `npx skills add <owner/repo@skill>`

## Phase 4: Document Everything

Update these files with everything you've learned:

- **MEMORY.md** → Standing rules from the human's answers (Phase 2)
- **TOOLS.md** → stask commands, spec template paths, project-specific CLI commands
- **SOUL.md** → Enrich with project-specific context (team members, key decisions, project goals)
- **../shared/*.md** → Fix any gaps found in Phase 1

## When You're Done

Delete this file. You don't need a bootstrap script anymore — you know the project, the team, and the rules.

---

_Take your time with this. The better you understand the project now, the better your specs will be later._
