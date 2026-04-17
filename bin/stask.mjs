#!/usr/bin/env node
/**
 * stask — Unified task + Slack CLI for the OpenClaw agent team.
 *
 * Usage: stask <command> [args...]
 * Run `stask --help` for the full command list, or `stask <cmd> --help`
 * for command-specific docs.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ─── Help text (defined early so --help can be served before any I/O) ─

function printTopHelp() {
  console.log(`stask — SQLite-backed task lifecycle CLI with Slack sync

USAGE
  stask <command> [args...]
  stask <command> --help        Show command-specific help
  stask --version               Print the installed version
  stask update [--check]        Update stask to the latest npm release

CORE LIFECYCLE
  create        Create a new task in Backlog
  transition    Move a task to the next status (with side effects)
  assign        Reassign a task to an agent or human
  subtask       Manage subtasks (create | done)
  qa            Submit a QA verdict (PASS | FAIL | PASS_WITH_ISSUES)
  spec-update   Re-upload an edited spec
  delete        Delete a task and its subtasks (DB + Slack)

QUERIES (read-only)
  list          List tasks, filterable by status / assignee / parent
  show          Show task details (with optional audit log)
  log           View the audit log
  heartbeat     Get pending work for an agent (JSON)
  inbox         Manage inbox subscriptions and items

SYNC
  sync          Run one bidirectional Slack ↔ DB sync cycle
  sync-daemon   Manage the background sync daemon (start | stop | status)
  session       Manage session locks (claim | release | status)

MULTI-PROJECT
  init          Create a new stask project
  projects      List or inspect registered projects
  heartbeat-all Get pending work for an agent across ALL projects

TEAM BOOTSTRAP
  setup         Interactive wizard: scaffold workspace, Slack apps, cron, openclaw.json
  teardown      Remove workspace, agents, cron jobs, and .stask/ for a project

MAINTENANCE
  update        Upgrade stask to the latest version on npm

GLOBAL FLAGS
  --project <name>     Target a specific project (otherwise auto-detected from cwd)
  --help, -h           Show help (top-level or per-command)
  --version, -v        Print version

ENVIRONMENT
  STASK_PROJECT        Same as --project <name>
  STASK_HOME           Override the stask home directory (default: ~/.stask)
  STASK_NO_DAEMON      Skip auto-starting the sync daemon

EXAMPLES
  stask create --name "Add dark mode" --type Feature
  stask list --status In-Progress --assignee gilfoyle
  stask transition T-042 In-Progress
  stask subtask create --parent T-042 --name "Style toggle" --assign gilfoyle
  stask qa T-042 --report ./qa-report.md --verdict PASS
  stask --project mobile show T-042 --log
  stask update --check

Report issues at: https://github.com/yarn-rp/stask/issues
`);
}

const HELP = {
  inbox: `stask inbox — Manage inbox subscriptions and items.

USAGE
  stask inbox list [--status X] [--source github|linear] [--priority high|medium|low] [--json]
  stask inbox show <item-id>
  stask inbox subscribe <source> <target> [--interval <seconds>] [--filter <json>]
  stask inbox unsubscribe <sub-id>
  stask inbox subs [list] [--json]
  stask inbox poll

DESCRIPTION
  The inbox aggregates external signals (PR comments, GitHub issues, Linear updates)
  into actionable items. Subscriptions poll sources on an interval; the poller
  daemon runs them and writes new items to the inbox.

EXAMPLES
  stask inbox subscribe github yarn-rp/stask --interval 300
  stask inbox list --source github --status open
  stask inbox show I-017
`,

  create: `stask create — Create a new task.

USAGE
  stask create --name "<title>" [--type Feature|Task|Bug] [--overview <text>]

DESCRIPTION
  Tasks always start in Backlog with no spec and no assignee. Attach a spec
  later with: stask spec-update <task-id> --spec <path>
  The task is mirrored to Slack as part of the same transaction.

FLAGS
  --name <title>       Task title (required)
  --type <type>        Feature | Task | Bug (default: Task)
  --overview <text>    Short overview displayed in Slack

EXAMPLES
  stask create --name "Add dark mode toggle" --type Feature
  stask create --name "Fix race in heartbeat" --type Bug --overview "Two agents claim the same row"
`,

  transition: `stask transition — Transition a task's status with DB-enforced validation.

USAGE
  stask transition <task-id> <new-status>

VALID STATUSES
  Backlog → To-Do | Blocked
  To-Do → In-Progress | Blocked
  In-Progress → Testing | Blocked
  Testing → Ready for Human Review | In-Progress | Blocked
  Ready for Human Review → Done | In-Progress | Blocked
  Blocked → Backlog | To-Do | In-Progress | Testing | Ready for Human Review

SIDE EFFECTS
  - Auto-creates worktrees for In-Progress
  - Opens PR when ready for review
  - Cascades subtask states
  - Auto-assigns based on role configuration
  - Runs configured guards before applying

EXAMPLES
  stask transition T-042 In-Progress
  stask transition T-042 "Ready for Human Review"
`,

  assign: `stask assign — Reassign a task to an agent or human.

USAGE
  stask assign <task-id> <name>

DESCRIPTION
  Useful for assigning to bot/app users (Richard, Gilfoyle, etc.) which can't
  be set through Slack's UI user picker. Syncs the change to Slack.

EXAMPLES
  stask assign T-042 gilfoyle
  stask assign T-042 yan
`,

  subtask: `stask subtask — Manage subtasks.

USAGE
  stask subtask create --parent <task-id> --name "<title>" --assign <agent> [--type Task|Bug]
  stask subtask done <subtask-id>

DESCRIPTION
  create  Adds a subtask under a parent task and assigns it to an agent.
  done    Builder marks their subtask Done. When all siblings are Done,
          the parent auto-transitions to Testing.

EXAMPLES
  stask subtask create --parent T-042 --name "Style toggle" --assign gilfoyle
  stask subtask done T-042.1
`,

  qa: `stask qa — Submit a QA verdict for a task.

USAGE
  stask qa <task-id> --report <path> [--screenshots <dir>] [--verdict PASS|FAIL|PASS_WITH_ISSUES]

DESCRIPTION
  Records a QA report (Markdown) and optional screenshots dir against a task.
  The verdict drives the next transition:
    PASS                  → Ready for Human Review
    PASS_WITH_ISSUES      → Ready for Human Review (flagged)
    FAIL                  → back to In-Progress, reassigned to builder

EXAMPLES
  stask qa T-042 --report ./qa/T-042.md --verdict PASS
  stask qa T-042 --report ./qa/T-042.md --screenshots ./qa/T-042/ --verdict FAIL
`,

  'spec-update': `stask spec-update — Re-upload an edited spec for a task.

USAGE
  stask spec-update <task-id> --spec <path>

DESCRIPTION
  Replaces the canonical spec attached to the task. Recomputes the content
  hash and re-syncs to Slack so the thread stays current.
`,

  delete: `stask delete — Delete a task (and its subtasks).

USAGE
  stask delete <task-id> [--force]

DESCRIPTION
  Atomically removes the task, its subtasks, log entries, session claims,
  and Slack rows. Refuses to delete tasks in In-Progress or Testing unless
  --force is passed.
`,

  list: `stask list — List tasks (filterable, table or JSON output).

USAGE
  stask list [--status X] [--assignee Y] [--parent Z] [--json]

EXAMPLES
  stask list --status In-Progress
  stask list --assignee gilfoyle --json
  stask list --parent T-042
`,

  show: `stask show — Show task details.

USAGE
  stask show <task-id> [--log]

FLAGS
  --log    Append the audit log for this task
`,

  log: `stask log — View the audit log.

USAGE
  stask log [<task-id>] [--limit N]

DESCRIPTION
  Without a task-id, shows the most recent N log entries across all tasks
  (default: 50). With a task-id, shows entries for that task only.
`,

  heartbeat: `stask heartbeat — Get pending work for an agent (JSON output).

USAGE
  stask heartbeat <agent-name>

DESCRIPTION
  Session-aware: skips tasks that another live session has already claimed.
  Designed to be polled by agent runtimes on a cron schedule.

EXAMPLES
  stask heartbeat gilfoyle
`,

  'heartbeat-all': `stask heartbeat-all — Get pending work for an agent across ALL projects.

USAGE
  stask heartbeat-all <agent-name>

DESCRIPTION
  Iterates over every project registered in ~/.stask/projects.json, runs
  heartbeat for each project that configures the agent, and returns the
  combined JSON result.
`,

  'pr-status': `stask pr-status — DEPRECATED.

This command has been superseded by the Inbox Subscription Engine.
Use the inbox commands instead:

  stask inbox list --source github
  stask inbox show <item-id>

This command is preserved for reference; removal scheduled for v0.3.0.
`,

  session: `stask session — Manage session locks.

USAGE
  stask session claim <task-id> --agent <name> --session-id <id>
  stask session release <task-id> [--session-id <id>]
  stask session status [<task-id>]

DESCRIPTION
  Session locks prevent two agent runtimes from claiming the same task.
  Stale claims are auto-cleaned based on heartbeat freshness.
`,

  sync: `stask sync — Run one bidirectional sync cycle (Slack ↔ DB).

USAGE
  stask sync [--json]

DESCRIPTION
  Pulls Slack list edits into the DB and pushes outbound DB changes to Slack.
  Useful for one-shot reconciliation; for continuous sync use sync-daemon.
`,

  'sync-daemon': `stask sync-daemon — Manage the background sync daemon.

USAGE
  stask sync-daemon start    Start the daemon (forks detached)
  stask sync-daemon stop     Stop the daemon (SIGTERM via PID file)
  stask sync-daemon status   Check whether the daemon is running

DESCRIPTION
  The daemon runs sync cycles continuously so Slack and the DB stay in sync
  without manual polling. Mutation commands auto-start the daemon if it's
  not already running. Disable with STASK_NO_DAEMON=1.
`,

  init: `stask init — Create a new stask project.

USAGE
  stask init <project-name> --repo <path> [--worktrees <path>] [--specs <path>]

DESCRIPTION
  Creates .stask/ in the target repo with a scaffolded config.json and
  .gitignore, and registers the project in ~/.stask/projects.json.

FLAGS
  --repo <path>        Path to the repository root (required)
  --worktrees <path>   Where to place per-task worktrees (default: <repo>/.claude/worktrees)
  --specs <path>       Where to store spec files (default: <repo>/.stask/specs)
`,

  projects: `stask projects — List and inspect registered stask projects.

USAGE
  stask projects                 List all registered projects
  stask projects --json          List all projects as JSON
  stask projects show <name>     Show project details + task count
  stask projects remove <name>   Remove a project from the registry
`,

  setup: `stask setup — Interactive wizard to bootstrap a complete engineering team project.

USAGE
  stask setup [path]
  stask setup [path] --only channel,list,canvas,bookmark,welcome,skills,cron,openclaw,verify,inbox

DESCRIPTION
  Guides you through creating Slack channels and lists, registering Slack apps,
  installing skills, scheduling agent cron jobs, and writing openclaw.json.
  Use --only to re-run specific phases.
`,

  teardown: `stask teardown — Remove a team setup created by 'stask setup'.

USAGE
  stask teardown <slug> [--force]

DESCRIPTION
  Reverses everything setup created:
    1. Removes agents from openclaw.json
    2. Removes heartbeat cron jobs
    3. Removes agent directories (~/.openclaw/agents/<id>/)
    4. Removes workspace (~/.openclaw/workspace-<slug>/)
    5. Removes .stask/ from the repo
    6. Unregisters from ~/.stask/projects.json
    7. Removes the Slack token from ~/.stask/config.json
    8. Removes the setup state file

  Does NOT delete Slack apps or channels — those must be removed manually
  from api.slack.com.
`,

  update: `stask update — Upgrade stask to the latest version on npm.

USAGE
  stask update [--check] [--version <semver>] [--dry-run]

DESCRIPTION
  Compares the installed version against @web42/stask on the npm registry.
  Without flags, runs:
    npm install -g @web42/stask@latest
  to upgrade in place.

FLAGS
  --check              Only report whether an update is available; do not install
  --version <semver>   Install a specific version instead of latest
  --dry-run            Print the npm command that would be run, but don't execute

EXAMPLES
  stask update --check
  stask update
  stask update --version 0.2.17
`,

  test: `stask test — Run the test suite.

USAGE
  stask test [suite]

DESCRIPTION
  Runs node --test against test/<suite>.test.mjs, or test/*.test.mjs if
  no suite is given.
`,
};

function printCommandHelp(cmd) {
  const text = HELP[cmd];
  if (!text) {
    console.error(`No help available for "${cmd}". Run "stask --help" for the command list.`);
    process.exit(1);
  }
  console.log(text);
}

const _isHelpFlag = (s) => s === '--help' || s === '-h' || s === 'help';

// ─── Extract --project flag before module loading ─────────────────
// Must happen before env.mjs is imported since it resolves project root at import time.
{
  const idx = process.argv.indexOf('--project');
  if (idx !== -1 && idx + 1 < process.argv.length) {
    process.env.STASK_PROJECT = process.argv[idx + 1];
    // Remove --project <name> from argv so commands don't see it
    process.argv.splice(idx, 2);
  }
}

// ─── --version / -v (handle before anything else) ─────────────────
{
  const a = process.argv[2];
  if (a === '--version' || a === '-v' || a === 'version') {
    const pkgPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    console.log(`stask ${pkg.version}`);
    process.exit(0);
  }
}

// ─── Top-level / nested help (handle before project resolution) ───
{
  const top = process.argv[2];
  const second = process.argv[3];
  const third = process.argv[4];

  if (!top || _isHelpFlag(top)) {
    printTopHelp();
    process.exit(0);
  }
  // `stask <cmd> --help`
  if (second && _isHelpFlag(second)) {
    printCommandHelp(top);
    process.exit(0);
  }
  // `stask <cmd> <sub> --help` (subtask/inbox)
  if (third && _isHelpFlag(third)) {
    printCommandHelp(top);
    process.exit(0);
  }
}

// Commands that don't need a project context (work with global registry only)
const NO_PROJECT_COMMANDS = new Set(['init', 'projects', 'heartbeat-all', 'setup', 'teardown', 'update']);

const _cmd = process.argv[2];
if (NO_PROJECT_COMMANDS.has(_cmd)) {
  // Skip project resolution — these commands handle it themselves
  const mod = await import(`../commands/${_cmd}.mjs`);
  await mod.run(process.argv.slice(3));
  process.exit(0);
}

const { loadEnv, CONFIG } = await import('../lib/env.mjs');

// Auto-load env before anything else
loadEnv();

// ─── Auto-start sync daemon (lazy guardian) ───────────────────────

function ensureSyncDaemon() {
  const pidFile = path.resolve(CONFIG.staskHome, 'sync-daemon.pid');
  try {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
    process.kill(pid, 0); // Check if alive — throws if dead
  } catch (_) {
    // Not running — start it
    import('../commands/sync-daemon.mjs').then(mod => {
      mod.startDaemon();
    }).catch(() => {});
  }
}

// Don't auto-start for sync-daemon commands (avoid recursion), read-only queries,
// or subprocess invocations (heartbeat-all spawns child stask processes)
const READ_ONLY = new Set([
  'heartbeat', 'heartbeat-all', 'list', 'show', 'log',
  'session', 'pr-status', 'projects',
]);
if (_cmd && _cmd !== 'sync-daemon' && _cmd !== '--help' && _cmd !== '-h'
    && !READ_ONLY.has(_cmd) && !process.env.STASK_NO_DAEMON) {
  ensureSyncDaemon();
}

// ─── Subcommand dispatch ───────────────────────────────────────────

const COMMANDS = {
  'inbox':          () => import('../commands/inbox.mjs'),
  'create':         () => import('../commands/create.mjs'),
  'transition':     () => import('../commands/transition.mjs'),
  'subtask':        null, // nested — handled below
  'qa':             () => import('../commands/qa.mjs'),
  'heartbeat':      () => import('../commands/heartbeat.mjs'),
  'list':           () => import('../commands/list.mjs'),
  'show':           () => import('../commands/show.mjs'),
  'log':            () => import('../commands/log.mjs'),
  'pr-status':    () => import('../commands/pr-status.mjs'),
  'spec-update':    () => import('../commands/spec-update.mjs'),
  'session':        () => import('../commands/session.mjs'),
  'delete':         () => import('../commands/delete.mjs'),
  'assign':         () => import('../commands/assign.mjs'),
  'sync':           () => import('../commands/sync.mjs'),
  'sync-daemon':    () => import('../commands/sync-daemon.mjs'),
  // Multi-project commands (also handled as NO_PROJECT_COMMANDS above for init/projects/heartbeat-all)
  'heartbeat-all':  () => import('../commands/heartbeat-all.mjs'),
};

const SUBTASK_COMMANDS = {
  'create': () => import('../commands/subtask-create.mjs'),
  'done':   () => import('../commands/subtask-done.mjs'),
};

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  // Handle nested "subtask" commands
  if (cmd === 'subtask') {
    const subCmd = args[1];
    if (!subCmd) {
      printCommandHelp('subtask');
      process.exit(1);
    }
    if (!SUBTASK_COMMANDS[subCmd]) {
      console.error(`Unknown subtask command: ${subCmd}`);
      console.error(`Run "stask subtask --help" for usage.`);
      process.exit(1);
    }
    const mod = await SUBTASK_COMMANDS[subCmd]();
    await mod.run(args.slice(2));
    return;
  }

  // Run tests via `stask test [suite]`
  if (cmd === 'test') {
    const { execFileSync } = await import('child_process');
    const { fileURLToPath } = await import('url');
    const testDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../test');
    const suite = args[1];
    const pattern = suite ? `${testDir}/${suite}.test.mjs` : `${testDir}/*.test.mjs`;
    try {
      execFileSync(process.execPath, ['--test', pattern], { stdio: 'inherit' });
    } catch (err) {
      process.exit(err.status || 1);
    }
    return;
  }

  const loader = COMMANDS[cmd];
  if (!loader) {
    console.error(`Unknown command: ${cmd}`);
    console.error(`Run "stask --help" for usage.`);
    process.exit(1);
  }

  const mod = await loader();
  await mod.run(args.slice(1));
}

main().catch(err => {
  console.error(`FATAL: ${err.message}`);
  process.exit(1);
});
