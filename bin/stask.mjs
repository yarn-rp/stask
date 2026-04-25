#!/usr/bin/env node
/**
 * stask — Unified task + Slack CLI for the OpenClaw agent team.
 *
 * Usage: stask <command> [args...]
 *
 * Commands:
 *   create          Create a new task (uploads spec to Slack)
 *   transition      Transition task status
 *   subtask create  Create a subtask under a parent
 *   subtask done    Mark a subtask as Done
 *   qa              Submit QA verdict
 *   heartbeat       Get pending work for an agent
 *   list            List tasks (filterable)
 *   show            Show task details
 *   log             View audit log
 *   pr-status     Poll PR for comments/merge
 *   spec-update     Re-upload edited spec
 *   session         Manage session locks (claim/release/status)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
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

// Handle --version / -v before any project resolution
{
  const v = process.argv[2];
  if (v === '--version' || v === '-v') {
    const pkgPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../package.json');
    const { version } = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    console.log(version);
    process.exit(0);
  }
}

// Commands that don't need a project context (work with global registry only)
const NO_PROJECT_COMMANDS = new Set(['init', 'projects', 'heartbeat-all', 'setup', 'teardown', 'doctor', 'update']);

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
  'event-daemon':   () => import('../commands/event-daemon.mjs'),
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

  if (!cmd || cmd === '--help' || cmd === '-h') {
    printHelp();
    process.exit(0);
  }

  // Handle nested "subtask" commands
  if (cmd === 'subtask') {
    const subCmd = args[1];
    if (!subCmd || !SUBTASK_COMMANDS[subCmd]) {
      console.error(`Usage: stask subtask <create|done> [args...]`);
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

function printHelp() {
  console.log(`stask — Unified task + Slack CLI

Usage: stask <command> [args...]

Mutation commands (DB + Slack transaction):
  inbox <list|show|subscribe|unsubscribe|subs|poll>  Manage inbox subscriptions and items
  create --name "..." [--spec <path>] [--type Feature|Bug|Task]
  transition <task-id> <status>
  subtask create --parent <id> --name "..." --assign <agent>
  subtask done <subtask-id>
  qa <task-id> --report <path> --verdict PASS|FAIL
  assign <task-id> <name>
  spec-update <task-id> --spec <path>

Read-only commands:
  list [--status X] [--assignee Y] [--parent Z] [--json]
  show <task-id> [--log]
  log [<task-id>] [--limit N]
  heartbeat <agent-name>
  pr-status <task-id>
  session claim|release|status <task-id> [--agent X] [--session-id Y]

Sync commands:
  sync                            Run one bidirectional sync cycle
  sync-daemon start|stop|status   Manage background drift-reconciler daemon
  event-daemon start|stop|status|logs  Manage Slack Socket Mode event daemon

Multi-project commands:
  init <name> --repo <path>     Create a new stask project
  projects [show <name>]        List/show registered projects
  heartbeat-all <agent-name>    Get pending work across all projects

Team bootstrap commands:
  setup [path]                  Interactive wizard: scaffold workspace, Slack apps, cron, openclaw.json
                                Add --agent <role>:<name>:<bot>:<app> (repeatable) to skip prompts for a role
  teardown <slug> [--force]     Remove workspace, agents, cron jobs, and .stask/ for a project
  doctor [--json]               Check stask/OpenClaw config for known failure modes (announce timeouts, bind mode, clobbered snapshots)
  update [--check] [--dry-run]  Upgrade stask to the latest version on npm

Global flags:
  --project <name>              Target a specific project (otherwise auto-detected from cwd)
  --version, -v                 Print stask version and exit
`);
}

main().catch(err => {
  console.error(`FATAL: ${err.message}`);
  process.exit(1);
});
