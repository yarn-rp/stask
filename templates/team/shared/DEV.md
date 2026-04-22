# DEV.md — Local development runbook for {{PROJECT_NAME}}

_Bootstrap fills this in. Update when commands change._

## Prerequisites

_List required tools + versions (runtime, package manager, DB, CLI deps)._

## Starting the stack

_Step-by-step commands to get the project running locally._

## Everyday commands

```bash
# Boot
# Test
# Lint
# Type check
# Build
```

## Verifying your work

Before transitioning a task to Testing, always:

1. Type check passes.
2. Lint passes.
3. Tests relevant to the spec's ACs pass.
4. Manual smoke of the golden path (and dark mode / mobile if UI).

## Environment variables

_List all variables the project needs to boot or test. Document defaults and where to get the real values._

| Variable | Required? | Purpose | Where to get it |
|---|---|---|---|
| `SLACK_TOKEN` | Yes | stask ↔ Slack sync | `~/.stask/config.json` or env |
| ... | | | |

## Known issues & tech debt

Living document. {{LEAD_NAME}} updates this when it trips over something worth remembering. Don't fix without a spec.

### Format

```
### <short title>
- **Where:** <file paths / subsystems>
- **Symptom:** <what breaks / what's awkward>
- **Why it's not fixed yet:** <scope, risk, priority>
- **If you touch this area:** <what to watch for>
```

### Open items

_Add entries as you discover them._

## Common gotchas

_Non-obvious things that trip people up. Bootstrap seeds this; {{LEAD_NAME}} appends over time._
