# SLACK.md — {{PROJECT_NAME}} Slack Reference

Team-specific Slack configuration for the {{PROJECT_NAME}} project.

---

## Workspace

_Fill in after `stask setup` runs._

- **Channel ID:** {{SLACK_CHANNEL_ID}}

## Team Apps

| Account ID | Name | Role |
|------------|------|------|
| `{{LEAD_NAME_LOWER}}` | {{LEAD_NAME}} | Tech Lead |
| `{{BACKEND_NAME_LOWER}}` | {{BACKEND_NAME}} | Backend Engineer |
| `{{FRONTEND_NAME_LOWER}}` | {{FRONTEND_NAME}} | Frontend Engineer |
| `{{QA_NAME_LOWER}}` | {{QA_NAME}} | QA Engineer |

## User IDs

| Name | Slack User ID | Role |
|------|---------------|------|
| {{HUMAN_NAME}} | {{HUMAN_SLACK_USER_ID}} | Owner / Human Reviewer |

## Slack List (Project Board)

- **List ID:** {{SLACK_LIST_ID}}
- **Source:** `tracker.db` (SQLite)
- **Statuses that ping {{HUMAN_NAME}}:** Ready for Human Review, Blocked
