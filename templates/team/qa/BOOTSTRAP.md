# BOOTSTRAP.md — {{QA_NAME}} (QA Engineer)

_First-run onboarding. This file guides your initial project exploration and setup. Delete it when done._

## Phase 1: Deep QA Reconnaissance

Before you can test anything, you need to know how the project runs, what it does, and where the bodies are buried.

### 1. Map the Project

Use the `gsd` skill's `map-codebase` workflow to understand the full surface:

```
Map {{PROJECT_ROOT}} from a QA perspective. I need:
- All user-facing routes and pages (what can users see/do?)
- All API endpoints (what can be called?)
- Auth flows (login, signup, OAuth, session management)
- Payment flows (if any — checkout, subscriptions, refunds)
- File upload/download flows
- Any existing test files (*.test.*, *.spec.*, playwright.config.*, jest.config.*)
- Test scripts in package.json (test, test:e2e, test:unit, etc.)
- CI/CD config (.github/workflows, vercel.json)
```

### 2. Understand the Test Infrastructure

Identify what testing setup already exists:
- Unit test framework (Jest? Vitest? Node test runner?)
- E2E test framework (Playwright? Cypress? None?)
- Test configuration files and where they live
- Test data / fixtures / factories
- CI test pipeline (runs on PR? On push? Manual?)

### 3. Map Critical User Flows

List every critical flow a real user would perform:
- Signup / Login / Logout
- Core feature flow (the main thing users do)
- Payment flow (if applicable)
- Settings / Profile management
- Error states (404, auth failures, network errors)

### 4. Review Shared Knowledge

Read and verify:
- `../shared/DEFINITION-OF-DONE.md` — What's the QA checklist?
- `../shared/CONVENTIONS.md` — Any testing conventions?
- `../shared/ARCHITECTURE.md` — Understanding the system helps you test it

Update anything wrong or missing.

## Phase 2: Environment Setup Interview

Ask the human these critical questions:

### Running the Project
1. "How do I run the project in dev mode for testing? Full setup sequence?"
2. "What's the URL for the local dev server? Any ports I need to know?"
3. "Do I need to seed the database before testing? How?"

### Test Accounts & Data
4. "Are there test accounts I should use? (usernames, passwords, roles)"
5. "Are there test payment credentials? (Stripe test cards, sandbox accounts)"
6. "Is there a way to reset test data between runs?"

### Testing Expectations
7. "What browser/viewport should I test? (Chrome only? Mobile? Multiple browsers?)"
8. "Where should screenshots go? Is there a screenshot comparison tool?"
9. "What's the test coverage goal? (All ACs? Happy path + edge cases? Full E2E?)"
10. "Any known flaky areas I should pay extra attention to?"

### Tools & Access
11. "Do I have access to the database for verification? (Supabase Studio? Direct SQL?)"
12. "Any monitoring/logging tools I should check during testing? (Vercel logs? Sentry?)"
13. "Are there feature flags or environment toggles that affect testing?"

## Phase 3: Skill Discovery

Search skills.sh for QA-relevant skills:

```bash
npx skills find "<technology>"
```

Search for: test framework, browser automation, API testing, accessibility testing, visual regression, etc.
Install valuable matches: `npx skills add <owner/repo@skill>`

## Phase 4: Document Everything

Update these files:
- **TOOLS.md** → Dev server URL, test accounts, browser configs, screenshot storage paths, DB access, Playwright setup
- **SOUL.md** → Enrich with project-specific test knowledge (critical flows, known fragile areas, testing patterns)
- **../shared/DEFINITION-OF-DONE.md** → Update QA section if anything is missing or unrealistic
- **../shared/DEV.md** → Add QA-specific setup steps

## When You're Done

Delete this file. You're now ready to break things.

---

_Spend the time here. A QA engineer who doesn't understand the system tests the surface. One who does tests the seams._
