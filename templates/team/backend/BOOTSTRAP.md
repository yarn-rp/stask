# BOOTSTRAP.md — {{BACKEND_NAME}} (Backend Engineer)

_First-run onboarding. This file guides your initial project exploration and setup. Delete it when done._

## Phase 1: Deep Backend Analysis

You need to understand every server-side system before writing a single line of code.

### 1. Map the Backend

Use OpenCode to scan your domain:

```bash
cd {{PROJECT_ROOT}} && opencode run -m {{BACKEND_MODEL}} \
  -f {{OPENCLAW_HOME}}/workspace-{{PROJECT_SLUG}}/{{BACKEND_NAME_LOWER}}/skills/agentic-coding/SKILL.md \
  -- 'Map the backend of {{PROJECT_ROOT}}. Focus on:
  - API routes — all endpoints, their methods, auth requirements
  - Server actions — what they do, how they validate
  - Database client setup — connection patterns, middleware
  - Migrations — all migrations in order, current schema state
  - Shared utilities — auth, error handling, payments
  - Middleware — what it intercepts and why
  - CLI packages — any CLI tools in the monorepo'
```

### 2. Understand the Database

Investigate the data model:
- Read migration files in order to understand the data model evolution
- Check for RLS policies / access control on all tables
- Identify indexes, foreign keys, and constraints
- Note any stored procedures or database functions

### 3. Map External Integrations

For each integration found (Stripe, auth provider, external APIs, etc.):
- How is it configured? (env vars, SDK initialization)
- What are the key patterns? (webhook handling, idempotency)
- Where are secrets stored?
- Any non-obvious gotchas?

### 4. Review Shared Knowledge

Read and verify what {{LEAD_NAME}} documented:
- `../shared/STACK.md` — Does the backend stack match what you found?
- `../shared/ARCHITECTURE.md` — Are data models accurate?
- `../shared/CONVENTIONS.md` — Are server-side conventions followed?

**Update anything that's wrong or missing.** You are the backend authority.

## Phase 2: Environment Setup Interview

Ask the human these critical questions. Don't proceed until you have answers.

### Local Development
1. "How do I run the project locally? What's the full setup sequence?"
2. "What environment variables do I need? Is there a .env.example?"
3. "How do I run the database locally? (Supabase CLI? Docker? Remote?)"
4. "How do I reset/seed the database for testing?"

### Testing & Credentials
5. "Are there test accounts? (user credentials, admin accounts)"
6. "Where are payment test keys? Any test card numbers I should use?"
7. "Is there seed data or a script to populate test data?"

### Deployment & Operations
8. "What's the deployment workflow? (Vercel auto-deploy? Manual? Staging?)"
9. "How do database migrations get applied in production?"
10. "Any gotchas? (migration order, env var quirks, rate limits)"

### Write what you learn:

Update `TOOLS.md` with:
- DB connection commands
- API endpoint patterns
- Migration workflow
- Test credentials location (not the actual secrets — just where to find them)
- Deployment steps

Update shared docs if {{LEAD_NAME}} missed anything:
- `../shared/DEV.md` — local dev runbook
- `../shared/ENV.md` — environment variables
- `../shared/ARCHITECTURE.md` — data model corrections

## Phase 3: Skill Discovery

Search for backend-relevant skills:

```bash
npx skills find "<technology>"
```

Search for your stack: database ORM, payment processor, auth system, API framework, etc.
Install valuable matches: `npx skills add <owner/repo@skill>`

## Phase 4: Verify You Can Run It

Before you're done, actually verify:

- [ ] You can run the project locally (dev server starts, no errors)
- [ ] You can connect to the database
- [ ] You can run migrations
- [ ] You know where test credentials live
- [ ] `TOOLS.md` has everything you need to do your job
- [ ] `../shared/STACK.md` accurately reflects the backend stack
- [ ] `../shared/ARCHITECTURE.md` has the correct data model

## When You're Done

Delete this file. You now know the backend inside out.

---

_Don't rush this. Missing a database pattern or auth flow now means bugs later._
