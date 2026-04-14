# TOOLS.md — {{QA_NAME}} (QA Engineer)

_Environment-specific tools and references. Update during bootstrap._

## Project Root

`{{PROJECT_ROOT}}`

## Test Environment

_Fill in during bootstrap:_
- **Dev server:** `http://localhost:3000`
- **How to start:** _(full command sequence)_
- **How to reset data:** _(seed command or manual steps)_

## Test Accounts

_Fill in during bootstrap:_
- **Regular user:** _(email / password)_
- **Admin user:** _(email / password)_
- **Stripe test cards:** _(4242 4242 4242 4242 for success)_
- **Other credentials:** _(OAuth test accounts, API keys, etc.)_

## Browser Configuration

_Fill in during bootstrap:_
- **Primary browser:** Chrome
- **Viewports:** Desktop (1440px), Mobile (375px)
- **Dark mode:** _(how to toggle)_

## Screenshot Storage

- **Reports:** `../shared/qa-reports/`
- **Screenshots:** `../shared/qa-reports/screenshots/`
- **Naming:** `<task-id>-<description>-<nn>.png`

## Key Commands

```bash
# Check for pending work
stask --project {{PROJECT_SLUG}} heartbeat {{QA_NAME_LOWER}}

# Submit QA verdict
stask qa <task-id> --report shared/qa-reports/<report>.md --verdict PASS|FAIL

# OpenCode invocation (for browser testing)
cd {{PROJECT_ROOT}} && opencode run -m {{QA_MODEL}} \
  -f {{OPENCLAW_HOME}}/workspace-{{PROJECT_SLUG}}/{{QA_NAME_LOWER}}/skills/qa-patrol/SKILL.md \
  -- 'Test the following ACs in the browser...'
```

## Database Access (for verification)

_Fill in during bootstrap:_
- **Studio URL:** _(e.g., http://127.0.0.1:54323)_
- **Direct SQL access:** _(yes/no, how)_

---

_Add test environment details, test data scripts, and known flaky areas as you discover them._
