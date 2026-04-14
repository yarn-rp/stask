# {{PROJECT_NAME}} Team

## The Crew

| Agent | Role | OpenCode Model | Workspace |
|-------|------|----------------|-----------|
| **{{LEAD_NAME}}** | Tech Lead — plans, specs, delegates, reviews | `{{LEAD_MODEL}}` | `{{LEAD_NAME_LOWER}}/` |
| **{{BACKEND_NAME}}** | Backend Engineer — API, DB, auth, integrations | `{{BACKEND_MODEL}}` | `{{BACKEND_NAME_LOWER}}/` |
| **{{FRONTEND_NAME}}** | Frontend Engineer — pages, components, styling | `{{FRONTEND_MODEL}}` | `{{FRONTEND_NAME_LOWER}}/` |
| **{{QA_NAME}}** | QA Engineer — browser tests, API tests, reports | `{{QA_MODEL}}` | `{{QA_NAME_LOWER}}/` |

> **Architecture:** All agents orchestrate via OpenClaw and spawn **OpenCode sessions** with skills attached via `-f` for actual code execution and testing. Agents orchestrate and review; OpenCode executes.

## Task Flow

```
Human → {{LEAD_NAME}} (plan + spec with Acceptance Criteria)
        → {{BACKEND_NAME}} / {{FRONTEND_NAME}} (build + own unit tests, via OpenCode)
            → {{QA_NAME}} (QA: browser + API tests against ACs, via OpenCode)
                → {{LEAD_NAME}} (code review + QA report review)
                    → Human (human review — QA screenshots + reports synced to Slack)
```

## Shared Directories

```
shared/
├── specs/           ← Lead writes specs here before delegation
├── artifacts/       ← Builders drop outputs here
├── reviews/         ← Lead drops review results here
├── decisions/       ← Architecture decisions logged here
├── qa-reports/      ← QA test reports
│   └── screenshots/ ← Screenshots from browser testing
└── scripts/         ← Utility scripts
```

## Project Root

`{{PROJECT_ROOT}}`

## Ownership Map

_Fill in during project setup. Define which agent owns which directories/files._

| Area | Owner |
|------|-------|
| _Backend files (API, DB, auth, etc.)_ | {{BACKEND_NAME}} |
| _Frontend files (pages, components, styles, etc.)_ | {{FRONTEND_NAME}} |
| `shared/qa-reports/`, browser testing, integration verification | {{QA_NAME}} |
| `shared/specs/`, `shared/decisions/`, code review, final sign-off | {{LEAD_NAME}} |

## Shared Awareness (coordinate before touching)

_Fill in during project setup. List files that span ownership boundaries._