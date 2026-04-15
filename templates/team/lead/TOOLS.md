# TOOLS.md - Local Notes

Skills define _how_ tools work. This file is for _your_ specifics — the stuff that's unique to your setup.

## What Goes Here

Things like:

- Project-specific commands and shortcuts
- Environment-specific paths
- SSH hosts and aliases
- Device nicknames
- Anything environment-specific

## Examples

```markdown
### stask Commands

- `stask --project {{PROJECT_SLUG}} heartbeat {{LEAD_NAME_LOWER}}`
- `stask create --name "..." [--overview "Context"] --type Feature`
- `stask spec-update T-XXX --spec shared/specs/<task>.md`
- `stask subtask create --parent T-XXX --name "..." --assign <agent>`

### Spec Location

- Save specs to: `../shared/specs/<task-name>.md`

### Project Root

- `{{PROJECT_ROOT}}`
```

## Why Separate?

Skills are shared. Your setup is yours. Keeping them apart means you can update skills without losing your notes, and share skills without leaking your infrastructure.

---

Add whatever helps you do your job. This is your cheat sheet.
