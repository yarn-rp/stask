# SLACK.md — {{PROJECT_NAME}} Slack Configuration

## Workspace

- **Name:** _(fill after Slack setup)_
- **Team ID:** _(fill after Slack setup)_
- **Project Channel:** #{{PROJECT_SLUG}}-project _(create this channel)_

## Team Apps

| Agent | Role | App ID | User ID |
|-------|------|--------|---------|
| {{LEAD_NAME}} | Tech Lead | _(from Slack app)_ | _(from auth.test)_ |
| {{BACKEND_NAME}} | Backend Engineer | _(from Slack app)_ | _(from auth.test)_ |
| {{FRONTEND_NAME}} | Frontend Engineer | _(from Slack app)_ | _(from auth.test)_ |
| {{QA_NAME}} | QA Engineer | _(from Slack app)_ | _(from auth.test)_ |
| {{HUMAN_NAME}} | Human | — | _(your Slack user ID)_ |

## Slack List (Project Board)

- **List ID:** _(create a Slack List and add the ID here)_
- **Sync:** Every 60 seconds via stask sync-daemon

## Task Sync

Tasks are synced bidirectionally between `tracker.db` and the Slack List:
- **DB → Slack:** Status, assignee, spec, PR, QA reports
- **Slack → DB:** Human-initiated changes (spec approval, status overrides)
- **Conflict resolution:** Most recent timestamp wins

## File Registry

Uploaded files (specs, QA reports, etc.) are tracked in `.stask/FILE_REGISTRY.json`.
