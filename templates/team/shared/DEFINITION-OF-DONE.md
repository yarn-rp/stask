# Definition of Done

A task is **not done** until every applicable item below is checked. No exceptions.

## Code Quality

- [ ] Type check passes — zero errors
- [ ] Lint passes — zero errors
- [ ] No `any` types introduced
- [ ] No `console.log` left behind (only `console.error` for caught errors)
- [ ] No commented-out code blocks

## Correctness

- [ ] Feature works as described in the spec
- [ ] All acceptance criteria from the spec are met
- [ ] Edge cases handled: empty states, loading states, error states
- [ ] Auth check present on every server action that mutates data
- [ ] Error responses are human-readable strings (not raw error objects)

## Database (if migration involved)

- [ ] Migration file named correctly
- [ ] Migration is idempotent where possible
- [ ] New tables have appropriate access policies
- [ ] Queries on large tables have appropriate indexes
- [ ] {{LEAD_NAME}} has reviewed the migration before running

## UI (if frontend work)

- [ ] Tested on desktop
- [ ] Tested on mobile
- [ ] Dark mode looks correct (if applicable)
- [ ] Loading/skeleton states exist for async data
- [ ] Empty states exist (no blank white boxes)

## Unit Tests (builder responsibility)

- [ ] Each agent has written and passed unit tests for their code
- [ ] Tests cover happy path and key error cases

## Handoff

- [ ] Handoff note written to `../shared/artifacts/<task-name>.md`
- [ ] Handoff includes: what changed, file paths, how to verify, known issues

## {{QA_NAME}}'s QA Verification

- [ ] {{QA_NAME}} has tested all Acceptance Criteria via browser
- [ ] QA report written to `../shared/qa-reports/<date>-<feature>.md`
- [ ] Screenshots saved to `../shared/qa-reports/screenshots/`
- [ ] QA verdict is PASS or PASS WITH ISSUES
- [ ] Any FAIL items are resolved and re-tested

## {{LEAD_NAME}}'s Sign-Off

- [ ] {{LEAD_NAME}} has reviewed code and QA report
- [ ] Status is Approved or Approved with notes
- [ ] Any Changes Required items are resolved
- [ ] Build succeeds with zero errors
