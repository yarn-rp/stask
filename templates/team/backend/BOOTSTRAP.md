# BOOTSTRAP.md — {{BACKEND_NAME}} (Backend Engineer)

_First-run onboarding. This file guides your initial project exploration and setup. Delete it when done._

## Phase 1: Read the Shared Knowledge

{{LEAD_NAME}} has already documented how to run the project and the tech stack. **Read these first** — don't ask the human questions that are already answered:

- `../shared/PROJECT.md` — what the project is
- `../shared/STACK.md` — full tech stack
- `../shared/ARCHITECTURE.md` — data model, patterns, flows
- `../shared/CONVENTIONS.md` — code style and rules
- `../shared/OWNERSHIP.md` — who owns what
- `../shared/DEV.md` — **how to run the project locally** (follow this to get the app running)
- `../shared/ENV.md` — environment variables

If any of these are missing or incomplete, tell {{LEAD_NAME}} to fix them before you proceed.

## Phase 2: Verify You Can Run It

Follow `../shared/DEV.md` and actually run the project. Don't skip this.

- [ ] Install dependencies
- [ ] Start the database
- [ ] Start the dev server
- [ ] Open the app in a browser
- [ ] Log in with the test account from DEV.md

If anything fails, tell {{LEAD_NAME}} — the docs need fixing.

## Phase 3: Deep Backend Interview

Now ask the human questions **specific to your domain** that {{LEAD_NAME}} wouldn't have covered:

### Database & Data Model
1. "Walk me through the database schema — what are the key tables and how do they relate?"
2. "Any tables with RLS policies or row-level security? How do they work?"
3. "Are there stored procedures, database functions, or triggers I should know about?"
4. "What's the migration workflow? How do I create a new migration? How do I test it locally before it hits production?"
5. "Any tables that are denormalized or structured in non-obvious ways? Why?"

### API & Server Actions
6. "What's the auth pattern? How does every server action/API route verify the user?"
7. "Are there any API routes that are public (no auth)? Which ones and why?"
8. "What's the error handling pattern? How should server actions return errors?"
9. "Any rate limiting, throttling, or abuse prevention in place?"

### External Integrations
10. "Walk me through each external integration (payments, auth provider, email, etc.):"
    - How is it initialized? (singleton, per-request, env var config)
    - Key patterns? (webhook handling, idempotency, retry logic)
    - Any gotchas? (API version pinning, test vs live mode, webhook signature verification)
11. "Any third-party APIs I should know about? Rate limits? Sandbox environments?"

### Backend-Specific Gotchas
12. "What's the most fragile part of the backend? What breaks if you touch it wrong?"
13. "Any performance concerns? Slow queries? N+1 problems? Large table scans?"
14. "Anything in the backend that looks wrong but is intentional? (So I don't 'fix' it)"

### Write what you learn:

Update `TOOLS.md` with:
- DB connection commands and shortcuts
- Migration workflow (create, test, apply)
- API endpoint patterns and auth flow
- Integration-specific commands (Stripe CLI, webhook forwarding, etc.)
- Backend-specific gotchas

Update shared docs if you found errors or gaps:
- `../shared/ARCHITECTURE.md` — data model corrections, integration details
- `../shared/STACK.md` — backend stack corrections
- `../shared/KNOWN-ISSUES.md` — any tech debt or known problems

## Phase 4: Map the Backend (via OpenCode)

Use OpenCode to scan your domain:

```bash
cd {{PROJECT_ROOT}} && opencode run -m {{BACKEND_MODEL}} \
  -f {{OPENCLAW_HOME}}/workspace-{{PROJECT_SLUG}}/{{BACKEND_NAME_LOWER}}/skills/agentic-coding/SKILL.md \
  -- 'Map the backend of {{PROJECT_ROOT}}. Focus on:
  - API routes — all endpoints, methods, auth requirements
  - Server actions — what they do, validation, return patterns
  - Database client setup — connection patterns, middleware
  - Migrations — list in order, current schema state
  - Shared utilities — auth, error handling, payments
  - Middleware — what it intercepts and why'
```

Cross-reference with what the human told you. Update `../shared/ARCHITECTURE.md` with anything missing.

## Phase 5: Skill Discovery

```bash
npx skills find "<your-database>"
npx skills find "<your-payment-provider>"
npx skills find "<your-auth-system>"
npx skills find "<your-framework>"
```

Install valuable matches: `npx skills add <owner/repo@skill>`

## Phase 6: Enrich Your SOUL.md

Now that you know the project, fill in the blanks in SOUL.md:
- **Your Stack** — actual technologies, versions, patterns
- **Your Scope** — actual file paths you own
- **Code Style** — project-specific rules from CONVENTIONS.md
- **Boundaries** — specific examples of what's yours vs {{FRONTEND_NAME}}'s

## When You're Done

Delete this file. You now know the backend inside out.

---

_Don't rush this. Missing a database pattern or auth flow now means bugs later._
