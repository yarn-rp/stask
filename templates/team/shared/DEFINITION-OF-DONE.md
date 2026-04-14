# Definition of Done

A task is **not done** until every applicable item below is checked. No exceptions.

## Code Quality

- [ ] Type check passes — zero TypeScript errors
- [ ] Lint passes — zero lint errors
- [ ] No `any` types introduced
- [ ] No `console.log` left behind (only `console.error` for caught errors)
- [ ] No commented-out code blocks

## Correctness

- [ ] Feature works as described in the spec
- [ ] All acceptance criteria from the spec are met
- [ ] Edge cases handled: empty states, loading states, error states
- [ ] Auth check present on every action that mutates data
- [ ] Error responses are human-readable strings (not raw error objects)

## Database (if migration involved)

- [ ] Migration file named correctly
- [ ] Migration is idempotent where possible
- [ ] New tables have RLS policies
- [ ] Queries on large tables have appropriate indexes
- [ ] Lead has reviewed the migration before running

## UI (if frontend work)

- [ ] Tested at desktop resolution
- [ ] Tested at mobile resolution
- [ ] Dark mode looks correct
- [ ] Loading/skeleton states exist for async data
- [ ] Empty states exist (no blank white boxes)
- [ ] `revalidatePath` called on correct routes after mutations

## Payments / Integrations (if applicable)

- [ ] Uses correct client initialization (not direct instantiation)
- [ ] Fee calculation uses shared utilities
- [ ] Webhook signature verified
- [ ] Tested with test mode / sandbox

## Unit Tests (builder responsibility)

- [ ] Each agent has written and passed unit tests for their code
- [ ] Tests cover happy path and key error cases

## Handoff

- [ ] Handoff note written to `../shared/artifacts/<task-name>.md`
- [ ] Handoff includes: what changed, file paths, how to verify, known issues

## QA Verification

- [ ] QA has tested all Acceptance Criteria
- [ ] QA report written to `../shared/qa-reports/<date>-<feature>.md`
- [ ] Screenshots saved to `../shared/qa-reports/screenshots/`
- [ ] QA verdict is PASS or PASS WITH ISSUES
- [ ] Any FAIL items are resolved and re-tested

## Lead Sign-Off

- [ ] Lead has reviewed code and QA report
- [ ] Build succeeds with zero errors
- [ ] Any Changes Required items are resolved