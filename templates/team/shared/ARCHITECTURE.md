# Architecture

_Filled in during bootstrap._ How the pieces of {{PROJECT_NAME}} fit together — data model, patterns, access-control flow, routing. Read before touching unfamiliar code so you don't reinvent patterns the team already uses.

### Also read

| Need this? | Read |
|---|---|
| What the project is, priorities | [README.md](README.md) |
| Team rules, Slack, DoD | [AGENTS.md](AGENTS.md) |
| Tech stack + ownership | [STACK.md](STACK.md) |
| How to run + test + validate | [DEV.md](DEV.md) |

---

## Data Model

_List primary database tables, their relationships, and key constraints. Include a diagram or ASCII sketch if it helps._

| Table | Purpose | Key relationships |
|-------|---------|-------------------|
| | | |

## Key Patterns

_Recurring patterns — the team's "how we do X" shorthand. Flag non-standard variations._

- **Auth check pattern:** _where it's enforced, how_
- **Error handling:** _shape of errors, where they're caught_
- **Input validation:** _library or approach_
- **Data fetching:** _server components? SWR? server actions? direct DB?_
- **Caching:** _where caches live, invalidation rules_

## Access Control Flow

_How auth and permissions work end-to-end — session source, role checks, tenant scoping (if any)._

## Routing

_Map your routes / API endpoints / CLI commands and what each does._

| Route / command | Purpose | Auth required |
|-----------------|---------|---------------|
| | | |

---

## Non-Obvious Decisions

_Architectural choices that look surprising but are intentional. Newcomers should not "fix" these._

-
