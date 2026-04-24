# DEV — Run, Test, Validate

_Filled in during bootstrap._ Everything you need to exercise {{PROJECT_NAME}} on your own machine: how to start it, how to run every test suite, and how QA proves an Acceptance Criterion actually works. Workers hit this file every build; QA hits it every test cycle.

### Also read

| Need this? | Read |
|---|---|
| What the project is, priorities | [README.md](README.md) |
| Team rules, DoD, Git/PR rules | [AGENTS.md](AGENTS.md) |
| Stack, ownership, env vars | [STACK.md](STACK.md) |
| Data model, patterns, routing | [ARCHITECTURE.md](ARCHITECTURE.md) |

---

## 1. Run Locally

### Prerequisites

_Required tools + versions + one-time setup steps._

- Node:
- Package manager:
- Database:
- Other CLIs (`gh`, `supabase`, etc.):

### First-time setup

```bash
_Step-by-step: install deps, bootstrap DB, seed, copy .env.local, etc._
```

### Start the dev server

```bash
_command to run the app_
# Dev URL: _e.g. http://localhost:3000_
```

### Common gotchas

_Non-obvious things that trip people up the first time._

-

---

## 2. Run the Test Suite

Each worker is responsible for their own unit tests (see Definition of Done in [AGENTS.md](AGENTS.md)). QA runs the end-to-end validation, not unit tests.

### All tests

```bash
_e.g. npm test_
```

### Unit tests

```bash
_e.g. npm run test:unit — per-file scope: <path>_
```

### Integration / E2E tests

```bash
_e.g. npm run test:e2e — which framework (Playwright / Cypress), how to select one test_
```

### Type check + lint (required for DoD)

```bash
_typecheck command_
_lint command_
```

### When a test fails

1. Run the failing test in isolation first.
2. Check the test output with verbose/stack traces enabled.
3. Don't mark a subtask done until the test passes.
4. If the failure blocks progress, write the findings into your handoff note and Slack {{LEAD_NAME}}.

---

## 3. Validate a Feature Works (QA patterns)

**This section is the spine of {{QA_NAME}}'s job.** For every Acceptance Criterion in a spec, you need to prove — with evidence — that the feature works.

### The loop (per AC)

1. **Read the AC.** It tells you *what* to test; don't paraphrase.
2. **Set up preconditions.** Seed DB, log in as the right role, configure env vars.
3. **Perform the action.** Exactly what the AC says.
4. **Observe.** Does the result match the AC's expected behavior?
5. **Capture evidence.** Screenshot (UI) or response body + status code (API). Save to `{{WORKSPACE_ROOT}}/shared/qa-reports/screenshots/YYYY-MM-DD-<feature>-NN.png`.
6. **Record in the QA report.** One row per AC, with result (PASS/FAIL) + evidence filename.

**A report without evidence is incomplete and will be rejected.**

### UI validation

1. Start the dev server (command above).
2. Use the `qa-patrol` skill (in your playbook) to drive the browser.
3. Test at all declared breakpoints — e.g. 375px / 768px / 1440px.
4. Test in dark mode if the project supports it.
5. Check accessibility where relevant: keyboard nav, focus ring, contrast.

### API / CLI / webhook validation

1. Start the service (command above) or use the task worktree's build output.
2. Use the `openclaw-api-tester` skill (in your playbook) to hit endpoints.
3. Cover: happy path, auth rejection, invalid input, boundary values.
4. For webhooks: verify signature validation + idempotency.

### Persistent E2E suite (when the spec explicitly calls for one)

Use `playwright-pro`. Add the test file under the project's configured test directory (see Test file locations below). Commit it on the task branch.

### Test account credentials

_Filled in during bootstrap — where test creds live (1Password, .env.test, fixtures, etc.) and what accounts exist (user / admin / seller / etc.)._

| Role | How to get creds |
|------|------------------|
| | |

### Submitting the QA verdict

Once every AC has been tested and the report is written:

```bash
stask qa <task-id> --report {{WORKSPACE_ROOT}}/shared/qa-reports/<report>.md --verdict PASS
# or
stask qa <task-id> --report {{WORKSPACE_ROOT}}/shared/qa-reports/<report>.md --verdict FAIL
```

This uploads the report to Slack, attaches it to the task, and (on PASS) transitions the task to Ready for Human Review.

---

## 4. Pre-Push Checklist (workers, before `stask subtask done`)

Run these from inside the task worktree:

1. Unit tests for your code pass.
2. Type check passes.
3. Lint passes.
4. Manually exercised the happy path in a browser / API call (so {{QA_NAME}} doesn't find it broken on first load).
5. `git status` clean; branch pushed.

Then:
```bash
stask subtask done <subtask-id>
```
