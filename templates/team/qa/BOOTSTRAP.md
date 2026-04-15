# BOOTSTRAP.md — {{QA_NAME}} (QA Engineer)

_First-run onboarding. This file guides your initial project exploration and setup. Delete it when done._

## Phase 1: You Need to Run This Project

Before you can test anything, you need to be able to run it. This is non-negotiable.

### Ask the human:

1. "How do I start the project locally? Full command sequence — install, database, server."
2. "What URL does the app run on locally? (localhost:3000?)"
3. "Does the database need to be running? How do I start it?"
4. "How do I reset the database to a clean state for testing?"

### Get Test Accounts

You cannot test without logging in. Get these from the human:

5. "What test accounts exist? I need at minimum:"
   - A regular user account (email + password)
   - An admin account (if the app has admin features)
   - A seller/creator account (if there's a marketplace or multi-role system)
6. "Are there test payment credentials? (Stripe test cards, sandbox API keys)"
7. "Any other service accounts I need? (OAuth test users, API keys for integrations)"

**Write these to `TOOLS.md` immediately.** You will need them every single time you test.

### Verify It Works

Don't just write it down — actually do it:

- [ ] Run the full startup sequence
- [ ] Open the app in a browser
- [ ] Log in with the test user account
- [ ] Log in with the admin account (if applicable)
- [ ] Verify the database has test data

If any step fails, **stop and resolve it with the human**. You cannot do your job if you can't run the project.

## Phase 2: Understand the Test Infrastructure

### Ask the human:

1. "Are there existing E2E tests? (Playwright, Cypress, manual-only?)"
2. "If Playwright is set up, how do I run the test suite?"
3. "Do I need to install any browser dependencies? (`npx playwright install`?)"
4. "Where should I save QA reports? (confirm `../shared/qa-reports/`)"
5. "Where should I save screenshots? (confirm `../shared/qa-reports/screenshots/`)"
6. "How do you want bug reports formatted? (confirm the report template in SOUL.md)"

### Write what you learn to `TOOLS.md`:

```markdown
### Running the Project
- Start: `<full startup command>`
- URL: `<local URL>`
- Database: `<how to start/reset>`

### Test Accounts
- User: `<where to find credentials>`
- Admin: `<where to find credentials>`
- Payment test cards: `<reference>`

### QA Commands
- Run Playwright: `<command>`
- Install browsers: `<command>`
- QA report location: `../shared/qa-reports/`
- Screenshot location: `../shared/qa-reports/screenshots/`
```

## Phase 3: Read the Shared Knowledge

Read everything the Lead documented. You need this context to write good tests:

- `../shared/PROJECT.md` — what the project does (test against user expectations, not just ACs)
- `../shared/STACK.md` — what's the tech stack (affects how you test)
- `../shared/ARCHITECTURE.md` — data model and flows (helps you find edge cases)
- `../shared/CONVENTIONS.md` — code patterns (helps you know what's intentional vs buggy)
- `../shared/DEV.md` — dev runbook (your startup reference)
- `../shared/DEFINITION-OF-DONE.md` — the checklist you're verifying against

If anything is missing or wrong, tell {{LEAD_NAME}}.

## Phase 4: Set Up Your Testing Environment (via OpenCode)

Use OpenCode to prepare your testing setup:

```bash
cd {{PROJECT_ROOT}} && opencode run -m {{QA_MODEL}} \
  -f {{OPENCLAW_HOME}}/workspace-{{PROJECT_SLUG}}/{{QA_NAME_LOWER}}/skills/qa-patrol/SKILL.md \
  -- 'Verify the testing environment:
  1. Can you reach the app at the local URL?
  2. Can you log in with test credentials?
  3. Take a screenshot of the homepage
  4. Take a screenshot of the dashboard (if authenticated)
  Save screenshots to {{OPENCLAW_HOME}}/workspace-{{PROJECT_SLUG}}/shared/qa-reports/screenshots/'
```

## Phase 5: Skill Discovery

Search for testing-relevant skills:

```bash
npx skills find "qa"
npx skills find "playwright"
npx skills find "testing"
npx skills find "browser"
```

Install valuable matches: `npx skills add <owner/repo@skill>`

## Phase 6: Readiness Checklist

Before you're done, verify all of this:

- [ ] You can start the project from scratch in under 2 minutes
- [ ] You can log in with at least one test account
- [ ] You know where to save QA reports and screenshots
- [ ] You know how to submit a verdict (`stask qa <id> --report ... --verdict PASS|FAIL`)
- [ ] `TOOLS.md` has your full testing runbook (startup, accounts, commands)
- [ ] You've read all shared knowledge files
- [ ] You've taken at least one test screenshot to verify your browser automation works

## When You're Done

Delete this file. You're set up and ready to test.

---

_The first time you test a real task, you should be able to start the project, log in, and take screenshots without asking anyone for help. If you can't, this bootstrap isn't done._
