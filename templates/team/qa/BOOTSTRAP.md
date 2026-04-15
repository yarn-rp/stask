# BOOTSTRAP.md — {{QA_NAME}} (QA Engineer)

_First-run onboarding. This file guides your initial project exploration and setup. Delete it when done._

## Phase 1: Read the Shared Knowledge

{{LEAD_NAME}} has already documented how to run the project, the tech stack, and test accounts. **Read these first** — don't ask the human questions that are already answered:

- `../shared/PROJECT.md` — what the project is
- `../shared/STACK.md` — full tech stack
- `../shared/ARCHITECTURE.md` — data model, patterns, flows
- `../shared/CONVENTIONS.md` — code style and rules
- `../shared/DEV.md` — **how to run the project locally + test accounts** (follow this exactly)
- `../shared/ENV.md` — environment variables
- `../shared/DEFINITION-OF-DONE.md` — the checklist you'll verify against

If any of these are missing or incomplete — especially DEV.md or test accounts — tell {{LEAD_NAME}} to fix them before you proceed.

## Phase 2: Verify You Can Run It

Follow `../shared/DEV.md` and actually run the project. **This is non-negotiable.** You cannot test what you cannot run.

- [ ] Install dependencies
- [ ] Start the database (if required)
- [ ] Start the dev server
- [ ] Open the app in a browser
- [ ] Log in with the regular user test account
- [ ] Log in with the admin test account (if applicable)
- [ ] Verify the database has test data

If any step fails, **stop and tell {{LEAD_NAME}}**. The shared docs need fixing.

## Phase 3: Deep QA Interview

Now ask the human questions **specific to testing** that {{LEAD_NAME}} wouldn't have covered:

### Test Environments & Access
1. "Are there any test environments beyond local? (staging, preview deployments?)"
2. "If there's a staging environment, how do I access it? Same test accounts?"
3. "Are there any features that only work in specific environments? (payments in staging only, etc.)"

### Browser & Device Requirements
4. "What browsers do I need to test? (Chrome only? Safari? Firefox? Mobile?)"
5. "What are the key breakpoints? (mobile 375px, tablet 768px, desktop 1440px — or different?)"
6. "Is there any browser-specific functionality I should watch for? (WebRTC, Web Workers, etc.)"

### Test Infrastructure
7. "Are there existing E2E tests? (Playwright, Cypress, manual-only?)"
8. "If Playwright exists, how do I run the suite? Any setup needed? (`npx playwright install`?)"
9. "Do you want me to write persistent test suites, or is manual browser testing enough?"
10. "Are there specific testing tools or services I should use? (BrowserStack, Lighthouse, etc.)"

### User Flows & Critical Paths
11. "What are the most critical user flows? The ones that absolutely cannot break:"
    - Main happy path (signup → core action → result)
    - Payment flow (if applicable)
    - Auth flow (login, logout, session, OAuth)
12. "Any flows that are particularly fragile or have broken before?"
13. "Are there multi-user flows I need to test? (e.g., buyer and seller interactions)"

### QA Process Preferences
14. "How detailed do you want QA reports? The full template with screenshots, or lighter-weight?"
15. "Any specific acceptance criteria patterns you prefer? (Given/When/Then? Checklist?)"
16. "When I find a bug — do I report it to {{LEAD_NAME}} in the thread, or is there another process?"

### Write what you learn:

Update `TOOLS.md` with:
- Full startup command sequence (copy from DEV.md + any QA-specific additions)
- Test account credentials (where to find them — DEV.md section reference)
- Test environment URLs (local, staging if applicable)
- Browser testing checklist (breakpoints, browsers, dark mode)
- Playwright/E2E commands (if applicable)
- QA report and screenshot paths

## Phase 4: Set Up Your Testing Environment (via OpenCode)

Use OpenCode to verify your setup works end-to-end:

```bash
cd {{PROJECT_ROOT}} && opencode run -m {{QA_MODEL}} \
  -f {{OPENCLAW_HOME}}/workspace-{{PROJECT_SLUG}}/{{QA_NAME_LOWER}}/skills/qa-patrol/SKILL.md \
  -- 'Verify the testing environment:
  1. Can you reach the app at the local URL?
  2. Can you log in with test credentials?
  3. Take a screenshot of the homepage
  4. Take a screenshot of the main authenticated page
  Save screenshots to {{OPENCLAW_HOME}}/workspace-{{PROJECT_SLUG}}/shared/qa-reports/screenshots/'
```

If this fails, your setup isn't complete. Debug before proceeding.

## Phase 5: Skill Discovery

```bash
npx skills find "qa"
npx skills find "playwright"
npx skills find "testing"
npx skills find "browser"
npx skills find "accessibility"
```

Install valuable matches: `npx skills add <owner/repo@skill>`

## Phase 6: Readiness Checklist

Before you're done, verify all of this:

- [ ] You can start the project and open it in a browser in under 2 minutes
- [ ] You can log in with at least one test account
- [ ] You can take a screenshot via OpenCode (browser automation works)
- [ ] You know the critical user flows and what breakpoints to test
- [ ] `TOOLS.md` has your full testing runbook
- [ ] You've read the DEFINITION-OF-DONE.md checklist
- [ ] You know how to submit a verdict: `stask qa <id> --report ... --verdict PASS|FAIL`

## When You're Done

Delete this file. You're set up and ready to test.

---

_The first time you test a real task, you should be able to start the project, log in, and take screenshots without asking anyone for help. If you can't, this bootstrap isn't done._
