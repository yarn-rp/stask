# Ownership Map

Who owns what. When in doubt, check here before touching anything.

## {{BACKEND_NAME}} — Backend Engineer

```
_Fill in during project setup. List backend file ownership._
```

## {{FRONTEND_NAME}} — Frontend Engineer

```
_Fill in during project setup. List frontend file ownership._
```

## {{QA_NAME}} — QA Engineer

```
shared/qa-reports/               QA test reports
shared/qa-reports/screenshots/   Screenshots from browser testing
```

QA reads (but does not modify):
- `shared/specs/` — Acceptance Criteria to test against
- `shared/artifacts/` — Builder handoff notes

## {{LEAD_NAME}} — Tech Lead

```
shared/specs/                    Task specs (Lead writes these)
shared/decisions/                Architecture decisions
shared/reviews/                  Review results
No production code
```

## Shared Awareness (coordinate before touching)

_Fill in during project setup. List files that span ownership boundaries._

| File | Primary | Also involves |
|------|---------|---------------|
| | | |