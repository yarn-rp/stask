# Stack & Ownership

_Filled in during bootstrap._ Answers two questions at once: **what tech are we using** and **who owns each part of it.** Check here before {{LEAD_NAME}} delegates, before you pick up unfamiliar work, or before you touch code outside your scope.

### Also read

| Need this? | Read |
|---|---|
| What the project is, priorities | [README.md](README.md) |
| Team rules, Slack, DoD | [AGENTS.md](AGENTS.md) |
| How the pieces fit together (data model, patterns) | [ARCHITECTURE.md](ARCHITECTURE.md) |
| How to run, test, validate | [DEV.md](DEV.md) |

---

## Tech Stack

### Frontend

| Layer | Technology | Version | Notes |
|-------|-----------|---------|-------|
| Framework | | | |
| Language | | | |
| UI Components | | | |
| Styling | | | |
| State Management | | | |

### Backend

| Layer | Technology | Version | Notes |
|-------|-----------|---------|-------|
| Runtime | | | |
| Language | | | |
| Database | | | |
| Auth | | | |
| API style | | | |

### External Integrations

| Provider | Purpose | Config location |
|----------|---------|-----------------|
| | | |

### Infrastructure

| | |
|---|---|
| Deploy target | |
| CI / CD | |
| Monitoring / logs | |

---

## Environment Variables

| Variable | Required | Scope | Description |
|----------|----------|-------|-------------|
| | | | |

**Rules.** Never commit `.env.local`. Never use secret keys in client components. `NEXT_PUBLIC_*` is exposed to the browser — treat as public. Set production values in the hosting dashboard.

---

## Ownership Map

Who touches what. When in doubt, check here before editing.

### {{BACKEND_NAME}} 🔒 — Backend Engineer

```
_Fill in during bootstrap. List server-side files/directories._
```

### {{FRONTEND_NAME}} 🎨 — Frontend Engineer

```
_Fill in during bootstrap. List client-side files/directories._
```

### {{QA_NAME}} 🧪 — QA Engineer

```
{{WORKSPACE_ROOT}}/shared/qa-reports/               — QA test reports
{{WORKSPACE_ROOT}}/shared/qa-reports/screenshots/   — Screenshots from browser testing
```

{{QA_NAME}} **reads but does not modify**:
- `{{WORKSPACE_ROOT}}/shared/specs/` — ACs to test against
- `{{WORKSPACE_ROOT}}/shared/artifacts/` — builder handoff notes

### {{LEAD_NAME}} 🧠 — Tech Lead

```
{{WORKSPACE_ROOT}}/shared/specs/       — Task specs ({{LEAD_NAME}} writes these)
No production code
```

### Shared Awareness (coordinate before touching)

| File / Area | Primary | Also involves |
|------------|---------|---------------|
| | | |

---

## Key Project Directories

```
_Map the most important directories of the project and what each is for — filled in after bootstrap exploration._
```

---

## Known Issues & Tech Debt

Living log. Update when you find something. **Do not fix without a spec from {{LEAD_NAME}}.**

### Format

```
[ISSUE-XXX] Short title
Severity:    critical | high | medium | low
Area:        <component or file path>
Found by:    <agent name>   Date: YYYY-MM-DD
Description: What's wrong
Workaround:  Any current workaround
```

### Open

_None logged yet._

### Do Not Touch

Things that look wrong but are intentional — document surprises newcomers shouldn't "fix":

-
