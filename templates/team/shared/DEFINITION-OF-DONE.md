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

## Unit tests

- [ ] Unit tests for the spec's acceptance criteria pass inside `<T>:code`
- [ ] Tests cover happy path and key error cases

## QA verification (run in fresh `<T>:qa` session)

- [ ] {{LEAD_NAME}} has verified all Acceptance Criteria in a fresh `<T>:qa` acpx session
- [ ] QA report written to `../shared/qa-reports/<date>-<feature>.md`
- [ ] Screenshots / evidence saved to `../shared/qa-reports/screenshots/`
- [ ] QA verdict is PASS (or PASS WITH ISSUES with agreed follow-ups)
- [ ] Any FAIL items are resolved and re-tested

## {{LEAD_NAME}}'s sign-off

- [ ] {{LEAD_NAME}} has reviewed code, diff, and QA report
- [ ] Draft PR description is rich (summary, changes, QA results, AC checklist)
- [ ] Any changes-required items from PR review are resolved
- [ ] Build succeeds with zero errors
