# BOOTSTRAP.md — {{BACKEND_NAME}} (Backend Engineer)

_First-run onboarding. This file guides your initial project exploration and setup. Delete it when done._

## Phase 1: Deep Backend Analysis

You need to understand every server-side system before writing a single line of code.

### 1. Map the Backend

Use the `gsd` skill's `map-codebase` workflow focused on your domain:

```
Map the backend of {{PROJECT_ROOT}}. Focus on:
- app/api/ — all API routes, their methods, auth requirements
- app/actions/ — all server actions, what they do, how they validate
- db/ or supabase/ — database client setup, connection patterns
- supabase/migrations/ — all migrations in order, current schema state
- lib/ — shared utilities, especially auth, error handling, stripe
- middleware.ts — what it intercepts and why
- packages/ — any CLI or shared packages
```

### 2. Understand the Database

Run these (or equivalent) to get the current schema:
- Read migration files in order to understand the data model evolution
- Check for RLS policies on all tables
- Identify indexes, foreign keys, and constraints
- Note any stored procedures or database functions

### 3. Map External Integrations

For each integration found (Stripe, auth provider, APIs, etc.):
- How is it configured? (env vars, SDK initialization)
- What are the key patterns? (webhook handling, idempotency)
- Where are secrets stored?
- Any non-obvious gotchas?

### 4. Review Shared Knowledge

Read and verify:
- `../shared/STACK.md` — Does the backend stack match?
- `../shared/ARCHITECTURE.md` — Are data models accurate?
- `../shared/CONVENTIONS.md` — Are server-side conventions followed?

Update anything that's wrong or missing.

## Phase 2: Environment Setup Interview

Ask the human these critical questions:

### Local Development
1. "How do I run the project locally? What's the full setup sequence?"
2. "What environment variables do I need? Is there a .env.example?"
3. "How do I run the database locally? (Supabase CLI? Docker? Remote?)"
4. "How do I reset/seed the database for testing?"

### Testing & Credentials
5. "Are there test accounts? (user credentials, admin accounts)"
6. "Where are Stripe test keys? Any test card numbers I should use?"
7. "Is there seed data or a script to populate test data?"

### Deployment & Operations
8. "What's the deployment workflow? (Vercel auto-deploy? Manual? Staging?)"
9. "How do database migrations get applied in production?"
10. "Any gotchas? (migration order, env var quirks, rate limits)"

## Phase 3: Skill Discovery

Search skills.sh for backend-relevant skills:

```bash
npx skills find "<technology>"
```

Search for your stack: database ORM, payment processor, auth system, API framework, etc.
Install valuable matches: `npx skills add <owner/repo@skill>`

## Phase 4: Document Everything

Update these files:
- **TOOLS.md** → DB connection commands, API endpoint patterns, migration workflow, test credentials location, deployment steps
- **SOUL.md** → Enrich "Your Stack" section with actual technologies found, add project-specific non-negotiables
- **../shared/ARCHITECTURE.md** → Add any missing data models or patterns you discovered
- **../shared/DEV.md** → Update with actual local dev setup steps

## When You're Done

Delete this file. You now know the backend inside out.

---

_Don't rush this. Missing a database pattern or auth flow now means bugs later._
