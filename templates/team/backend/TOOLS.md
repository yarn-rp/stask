# TOOLS.md — {{BACKEND_NAME}} (Backend Engineer)

_Environment-specific tools and references. Update during bootstrap._

## Project Root

`{{PROJECT_ROOT}}`

## Local Development

_Fill in during bootstrap:_
- **Dev server:** `npm run dev` at `http://localhost:3000`
- **Database:** _(Supabase CLI? Docker? Connection URL?)_
- **Seed data:** _(command to seed/reset?)_
- **Environment:** _(copy .env.example to .env.local)_

## Key Commands

```bash
# Check for pending work
stask --project {{PROJECT_SLUG}} heartbeat {{BACKEND_NAME_LOWER}}

# Mark subtask done (after commit + push)
stask subtask done <subtask-id>

# OpenCode invocation
cd {{PROJECT_ROOT}} && opencode run -m {{BACKEND_MODEL}} \
  -f {{OPENCLAW_HOME}}/workspace-{{PROJECT_SLUG}}/{{BACKEND_NAME_LOWER}}/skills/<skill>/SKILL.md \
  -- 'task description'
```

## Database Access

_Fill in during bootstrap:_
- **Studio URL:** _(e.g., http://127.0.0.1:54323)_
- **Migrations dir:** _(e.g., supabase/migrations/)_
- **New migration:** _(e.g., supabase migration new <name>)_
- **Reset:** _(e.g., supabase db reset)_

## Test Credentials

_Fill in during bootstrap:_
- **Test user:** _(email/password)_
- **Stripe test cards:** _(4242... for success, 4000... for decline)_
- **API keys location:** _(e.g., .env.local)_

---

_Add project-specific backend tools as you discover them._
