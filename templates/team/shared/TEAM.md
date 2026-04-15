# {{PROJECT_NAME}} Team

## The Crew

| Agent | Role | OpenCode Model | Workspace |
|-------|------|----------------|-----------|
| **{{LEAD_NAME}}** 🧠 | Tech Lead — plans, specs, delegates, reviews | `{{LEAD_MODEL}}` | `{{LEAD_NAME_LOWER}}/` |
| **{{BACKEND_NAME}}** 🔒 | Backend Engineer — API, DB, auth, infra | `{{BACKEND_MODEL}}` | `{{BACKEND_NAME_LOWER}}/` |
| **{{FRONTEND_NAME}}** 🎨 | Frontend Engineer — pages, components, styling | `{{FRONTEND_MODEL}}` | `{{FRONTEND_NAME_LOWER}}/` |
| **{{QA_NAME}}** 🧪 | QA Engineer — browser tests, API tests, reports | `{{QA_MODEL}}` | `{{QA_NAME_LOWER}}/` |

> **Architecture:** All agents orchestrate via OpenClaw and spawn **OpenCode sessions** with skills attached via `-f` for actual code execution and testing. Agents orchestrate and review; OpenCode executes.

## Task Flow

```
{{HUMAN_NAME}} → {{LEAD_NAME}} (plan + spec with Acceptance Criteria)
        → {{BACKEND_NAME}} / {{FRONTEND_NAME}} (build + own unit tests, via OpenCode)
            → {{QA_NAME}} (QA: browser + API tests against ACs, via OpenCode)
                → {{LEAD_NAME}} (code review + QA report review)
                    → {{HUMAN_NAME}} (human review — QA screenshots + reports synced to Slack)
```

## Shared Directories

```
shared/
├── specs/           ← {{LEAD_NAME}} writes specs here before delegation
├── artifacts/       ← Builders drop outputs here
├── reviews/         ← {{LEAD_NAME}} drops review results here
├── decisions/       ← Architecture decisions logged here
├── qa-reports/      ← {{QA_NAME}}'s QA test reports
│   └── screenshots/ ← Screenshots from browser testing
├── inbox/           ← Incoming items
└── scripts/         ← Shared utility scripts
```

## Project Root

`{{PROJECT_ROOT}}`

## Ownership Map

_Fill in during project setup. Define who owns what directories/files._

| Area | Owner |
|------|-------|
| Server-side code | {{BACKEND_NAME}} |
| Client-side code | {{FRONTEND_NAME}} |
| QA reports, browser testing | {{QA_NAME}} |
| Specs, decisions, code review | {{LEAD_NAME}} |

## Shared Awareness (coordinate before touching)

_Fill in during project setup. List files that span ownership boundaries._

| File | Primary | Also involves |
|------|---------|---------------|
| | | |
