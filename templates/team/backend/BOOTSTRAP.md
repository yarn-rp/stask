# BOOTSTRAP.md — {{BACKEND_NAME}} (Backend Engineer)

_Spawned by {{LEAD_NAME}} for exploration. Delete when done._

## Your Task: Autonomous Backend Exploration

{{LEAD_NAME}} spawned you to explore the backend of {{PROJECT_NAME}}. **Do NOT ask the human any questions.** Explore the codebase via Claude Code, write your findings to `../shared/artifacts/bootstrap-backend.md`, then terminate.

The human will review your findings later with {{LEAD_NAME}}. If you have questions, write them into your artifact — don't ask them live.

## Phase 1: Deep Exploration via Claude Code

(Full invocation recipe in `../shared/CLAUDE-CODING.md` — all flags mandatory for subsession use.)

```bash
cd {{PROJECT_ROOT}} && claude \
  --agent {{BACKEND_NAME_LOWER}} \
  --permission-mode bypassPermissions \
  --add-dir {{PROJECT_ROOT}} \
  --output-format stream-json --verbose --include-partial-messages \
  -p 'Deep backend analysis of {{PROJECT_ROOT}}. Map:

  1. API surface: all API routes, server actions, webhooks, middleware. For each: method, auth requirements, what it does.
  2. Data layer: database schema, tables, relationships, RLS policies, migrations list in order.
  3. External integrations: payment providers, auth providers, email, storage, any third-party APIs. For each: how its configured, where secrets live, key patterns.
  4. Shared backend utilities: auth helpers, error handling, validation, logging.
  5. Code patterns: how auth is checked, how errors are returned, how inputs are validated. Flag non-standard variations.
  6. Potential tech debt: duplicated logic, inconsistent patterns, missing error handling, risky queries, missing indexes.
  7. Questions: things you cannot determine from the code alone.

  Output a structured markdown report.'
```

## Phase 2: Cross-Reference with Shared Docs

Read whatever shared docs already exist (Lead may have written some):
- `../shared/DEV.md` — if it exists, skim for context
- `../shared/STACK.md` — if it exists, confirm your findings match
- Any `.env.example` or README in the project root

## Phase 3: Write Findings

Write a structured report to `../shared/artifacts/bootstrap-backend.md`:

```markdown
# Backend Exploration — {{BACKEND_NAME}}

## Stack
- Runtime, framework, database, ORM/client, deployment target
- Versions where detected (package.json)

## Data Model
- Tables + relationships
- RLS / access control patterns
- Migration workflow observations

## API Surface
- Server actions: list, what they do, auth pattern
- API routes: list, what they do, auth pattern
- Webhooks: provider, endpoint, signature verification

## External Integrations
- For each: provider, purpose, config location, key patterns

## Patterns Observed
- Auth check pattern (consistent? variations?)
- Error handling pattern
- Input validation (Zod? manual? mixed?)
- Database access pattern (cache? direct? RPC?)

## Tech Debt Candidates
_Patterns I think might be tech debt — the human will confirm or reject:_
- [Item 1 — what it is, why it might be tech debt]
- [Item 2 — ...]

## Questions for the Human
- [Specific questions I could not answer from code alone]

## Recommended Scope
_Suggested list of backend file paths/directories I should own, based on what I found_
```

## Phase 4: Enrich Your Own Files

Based on what you discovered, enrich your own templates:
- Update `SOUL.md` — fill in "Your Stack" with actual technologies found
- Update `TOOLS.md` — add commands, paths, references specific to this project

## Phase 5: Terminate

You're done. {{LEAD_NAME}} will read your artifact and present findings to the human.

Delete this BOOTSTRAP.md file when you've finished writing your artifact.

---

_Don't ask questions live. Write them into your artifact. {{LEAD_NAME}} runs the human conversation._
