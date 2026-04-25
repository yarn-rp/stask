# stask

SQLite-backed task lifecycle CLI with Slack sync — designed for AI agent teams.

stask enforces a spec-first workflow where tasks flow through defined statuses (To-Do, In-Progress, Testing, Ready for Human Review, Done) with guards that prevent illegal transitions. A human approves specs and merges PRs; AI agents (Lead, Workers, QA) handle everything in between. Every mutation syncs bidirectionally with a Slack List.

## Prerequisites

- Node.js 20+
- [GitHub CLI](https://cli.github.com/) (`gh`)
- A Slack app with Lists API access (`SLACK_TOKEN`)

## Install

```bash
npm install -g @web42/stask
```

## Setup

1. Create the global data directory:

```bash
mkdir -p ~/.stask
```

2. Copy the example config and customize it:

```bash
cp config.example.json ~/.stask/config.json
# Edit ~/.stask/config.json with your paths, Slack IDs, and agent names
```

3. Create a `.env` file with your Slack credentials:

```bash
cat > ~/.stask/.env << 'EOF'
SLACK_TOKEN=xoxb-your-slack-bot-token
LIST_ID=your-slack-list-id
EOF
```

4. Run any command to initialize the database:

```bash
stask list
```

## Quick Start

```bash
# Create a task (uploads spec to Slack)
stask create --spec specs/my-feature.md --name "Add login page"

# Human approves (or via Slack checkbox)
stask approve T-001

# Lead creates subtasks and starts work
stask subtask create --parent T-001 --name "Build form component" --assign worker-1
stask transition T-001 In-Progress

# Worker marks subtask done (after commit + push)
stask subtask done T-001.1

# QA submits verdict
stask qa T-001 --report qa-reports/t001.md --verdict PASS

# Lead creates PR, transitions to review
stask transition T-001 "Ready for Human Review"

# Human merges PR on GitHub -> task auto-completes
```

## Agent Integration

The `skills/` folder contains role-specific documentation for AI agents:

- **`skills/stask-general.md`** — Full framework overview, lifecycle, guards, CLI reference
- **`skills/stask-lead.md`** — Lead agent workflow and decision trees
- **`skills/stask-worker.md`** — Worker agent workflow and worktree rules
- **`skills/stask-qa.md`** — QA agent testing workflow and report format

Add the relevant skill file to your agent's context to teach it the stask workflow.

## Config

Config lives at `~/.stask/config.json`. See `config.example.json` for the full schema.

| Field | Description |
|-------|-------------|
| `specsDir` | Directory where spec markdown files live |
| `projectRepoPath` | Git repository for worktrees and PRs |
| `worktreeBaseDir` | Where task worktrees are created |
| `human` | Human reviewer (name, Slack ID, GitHub username) |
| `agents` | Agent definitions (name, role, Slack user ID) |
| `slack` | Slack List column IDs, status option IDs, type option IDs |

## Event daemon

stask ships a Slack Socket Mode event daemon that delivers Slack list changes to the local DB in ~1s (vs. the hourly drift-reconciler polling loop).

```
stask event-daemon start       # Start (detached, survives shell exit)
stask event-daemon stop        # Stop
stask event-daemon status      # Check if running
stask event-daemon logs        # Tail the last 40 log lines
```

The daemon is started automatically by `stask setup` and connects using the lead agent's `xapp-` token.

### Add a new event handler

Three steps:

1. **Create a handler file** at `lib/event-daemon/handlers/<name>.mjs`:

```js
export default {
  eventType: 'reaction_added',   // Slack event type
  name: 'my-handler',            // unique name for logs

  match(event, ctx) {
    return event.reaction === 'white_check_mark';
  },

  async handle(event, ctx) {
    // ctx: { db, slackApi, logger, openclaw, config, leadName }
    ctx.logger.info(`[my-handler] reaction: ${event.reaction}`);
  },
};
```

2. **Register it** in `lib/event-daemon/registry.mjs`:

```js
import myHandler from './handlers/my-handler.mjs';
export const HANDLERS = [ listReconcile, myHandler ];
```

3. **Add the event type** to `templates/team/lead/manifest.json` under `settings.event_subscriptions.bot_events`, then reinstall the Slack app via `stask setup --only verify`.

Handlers are isolated: if one throws, sibling handlers still run.

## License

MIT
