# TOOLS.md - Local Notes

Skills define _how_ tools work. This file is for _your_ specifics — the stuff that's unique to your setup.

## What Goes Here

Things like:

- Project-specific commands and shortcuts
- QA report storage locations
- Browser testing URLs
- Test account credentials location

## Examples

```markdown
### stask Commands

- `stask --project {{PROJECT_SLUG}} heartbeat {{QA_NAME_LOWER}}`
- `stask qa <task-id> --report <path> --verdict PASS|FAIL`

### Project Root

- `{{PROJECT_ROOT}}`

### Report Location

- Reports: `../shared/qa-reports/`
- Screenshots: `../shared/qa-reports/screenshots/`
```

## Why Separate?

Skills are shared. Your setup is yours. Keeping them apart means you can update skills without losing your notes, and share skills without leaking your infrastructure.

---

Add whatever helps you do your job. This is your cheat sheet.
