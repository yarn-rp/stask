# BOOTSTRAP.md — {{QA_NAME}} (QA Engineer)

_Spawned by {{LEAD_NAME}} for exploration. Delete when done._

## Your Task: Autonomous QA Exploration + Verify the Project Runs

{{LEAD_NAME}} spawned you to explore the project from a QA perspective. **Do NOT ask the human any questions.** Explore the codebase via Claude Code, try to run the project, write your findings to `../shared/artifacts/bootstrap-qa.md`, then terminate.

The human will review your findings later with {{LEAD_NAME}}. If you have questions, write them into your artifact — don't ask them live.

## Phase 1: Try to Run the Project

Before exploring test infrastructure, verify the project can actually run. Read the project README and any `../shared/DEV.md` Lead may have written. Try to start the project via Claude Code (full recipe in `../shared/CLAUDE-CODING.md` — flags are mandatory for subsession use):

```bash
cd {{PROJECT_ROOT}} && claude \
  --agent {{QA_NAME_LOWER}} \
  --permission-mode bypassPermissions \
  --add-dir {{PROJECT_ROOT}} \
  --output-format stream-json --verbose --include-partial-messages \
  -p 'Try to run the project at {{PROJECT_ROOT}}:
  1. Read the README and package.json scripts
  2. Identify the dev server command
  3. Identify environment requirements (.env.example, .env.local, required services)
  4. Try to start the dev server
  5. If it starts, navigate to the URL and take a screenshot of the homepage
  6. Report: did it work? what failed? what was missing?

  Save any screenshots to {{OPENCLAW_HOME}}/workspace-{{PROJECT_SLUG}}/shared/qa-reports/screenshots/'
```

Record whether you could run it and any blockers. This is critical — you cannot test what you cannot run.

## Phase 2: Explore Test Infrastructure via Claude Code

```bash
cd {{PROJECT_ROOT}} && claude \
  --agent {{QA_NAME_LOWER}} \
  --permission-mode bypassPermissions \
  --add-dir {{PROJECT_ROOT}} \
  --output-format stream-json --verbose --include-partial-messages \
  -p 'QA analysis of {{PROJECT_ROOT}}. Map:

  1. Existing test files: Playwright, Cypress, Jest, Vitest — list test directories and test types.
  2. Test scripts in package.json: how to run each type of test.
  3. Critical user flows visible in the UI: auth, payments, main features.
  4. Forms and interactive elements — where users input data.
  5. Pages with auth guards — what needs login to see.
  6. Accessibility patterns in use (aria labels, keyboard nav, focus management).
  7. Responsive patterns (breakpoints, mobile-specific UI).
  8. Questions: things you cannot determine from the code alone (e.g., "what test accounts exist?", "is there a staging env?").

  Output a structured markdown report.'
```

## Phase 3: Write Findings

Write a structured report to `../shared/artifacts/bootstrap-qa.md`:

```markdown
# QA Exploration — {{QA_NAME}}

## Can I Run the Project?
- [ ] Yes / No
- What I did: [steps taken]
- Blockers (if any): [missing env vars, missing database, broken dependency, etc.]
- Dev server URL (if running): [URL]
- Homepage screenshot: [path if taken]

## Test Infrastructure
- E2E framework (if any): Playwright / Cypress / none
- Unit test framework (if any): Jest / Vitest / none
- Test scripts: `npm run test`, `npm run test:e2e`, etc.
- Test file locations

## Critical User Flows Identified
- Auth flow: [login, signup, OAuth, etc.]
- Payment flow (if applicable): [what flows, what providers]
- Main feature flows: [core actions users take]

## Testability Observations
- Auth-guarded pages: [which pages require login]
- Forms to test: [list of form-heavy pages]
- Accessibility patterns in use
- Responsive breakpoints

## Tech Debt Candidates
_Patterns I think might be tech debt — the human will confirm or reject:_
- [Item 1 — what it is, why it might be tech debt]
- [Item 2 — ...]

## Questions for the Human
_Critical gaps — these will block testing:_
- Test account credentials? (user, admin, seller)
- Test payment credentials? (Stripe test cards, sandbox keys)
- Staging environment? URL? Same credentials?
- Browser requirements? (desktop only, mobile matters, specific browsers)
- How do you want bug reports formatted?
```

## Phase 4: Enrich Your Own Files

Based on what you discovered:
- Update `TOOLS.md` with: how to run the project, test commands, screenshot paths, report paths
- Leave placeholders for test account credentials — the human will fill those in via {{LEAD_NAME}}

## Phase 5: Terminate

You're done. {{LEAD_NAME}} will read your artifact and present findings to the human.

Delete this BOOTSTRAP.md file when you've finished writing your artifact.

---

_Don't ask questions live. Write them into your artifact. {{LEAD_NAME}} runs the human conversation._
