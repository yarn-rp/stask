/**
 * stask session — Manage session locks and ACP session liveness.
 *
 * Task-level locks (unchanged):
 *   stask session claim <task-id> --agent <name> --session-id <id>
 *   stask session release <task-id> [--session-id <id>]
 *   stask session status [<task-id>]
 *
 * ACP session liveness (label-keyed, for acpx coding sessions):
 *   stask session ping --label <name> [--task <task-id>] [--agent <agent>] [--subtask <subtask-id>]
 *   stask session health --label <name> [--hang-timeout <minutes>] [--json]
 *   stask session acp-list [--task <task-id>] [--agent <agent>] [--json]
 *   stask session acp-close --label <name>
 *   stask session acp-close --task <task-id>    # close all sessions for a task
 */

import { withDb } from '../lib/tx.mjs';
import {
  claimTask,
  releaseTask,
  getSessionStatus,
  cleanStaleSessions,
  pingAcpSession,
  acpSessionHealth,
  listAcpSessions,
  closeAcpSession,
  closeAcpSessionsForTask,
} from '../lib/session-tracker.mjs';

const SUBCOMMANDS = new Set([
  'claim', 'release', 'status',
  'ping', 'health', 'acp-list', 'acp-close',
]);

function parseArgs(argv) {
  const args = { subcommand: argv[0], positional: [] };
  for (let i = 1; i < argv.length; i++) {
    const tok = argv[i];
    const next = argv[i + 1];
    if (tok === '--agent' && next) { args.agent = next; i++; }
    else if (tok === '--session-id' && next) { args.sessionId = next; i++; }
    else if (tok === '--label' && next) { args.label = next; i++; }
    else if (tok === '--task' && next) { args.taskId = next; i++; }
    else if (tok === '--subtask' && next) { args.subtaskId = next; i++; }
    else if (tok === '--hang-timeout' && next) { args.hangTimeout = Number(next); i++; }
    else if (tok === '--json') { args.json = true; }
    else if (!tok.startsWith('-')) { args.positional.push(tok); }
  }
  if (!args.taskId && args.positional.length > 0) args.taskId = args.positional[0];
  return args;
}

function die(msg) {
  console.error(msg);
  process.exit(1);
}

export async function run(argv) {
  const args = parseArgs(argv);

  if (!args.subcommand || !SUBCOMMANDS.has(args.subcommand)) {
    die('Usage: stask session <claim|release|status|ping|health|acp-list|acp-close> [...]');
  }

  await withDb((db) => {
    switch (args.subcommand) {
      case 'claim': return runClaim(db, args);
      case 'release': return runRelease(db, args);
      case 'status': return runStatus(db, args);
      case 'ping': return runPing(db, args);
      case 'health': return runHealth(db, args);
      case 'acp-list': return runAcpList(db, args);
      case 'acp-close': return runAcpClose(db, args);
    }
  });
}

// ─── Task-level locks ──────────────────────────────────────────────

function runClaim(db, args) {
  if (!args.taskId || !args.agent || !args.sessionId) {
    die('Usage: stask session claim <task-id> --agent <name> --session-id <id>');
  }
  const result = claimTask(db, args.taskId, args.agent, args.sessionId);
  if (result.ok) {
    console.log(result.message);
  } else {
    console.error(`BLOCKED: ${result.message}`);
    process.exit(1);
  }
}

function runRelease(db, args) {
  if (!args.taskId) die('Usage: stask session release <task-id> [--session-id <id>]');
  const result = releaseTask(db, args.taskId, args.sessionId);
  console.log(result.message);
}

function runStatus(db, args) {
  const cleaned = cleanStaleSessions(db);
  if (cleaned > 0) console.error(`Cleaned ${cleaned} stale session(s)`);

  const sessions = getSessionStatus(db, args.taskId);
  if (sessions.length === 0) {
    console.log(args.taskId ? `No active session for ${args.taskId}.` : 'No active sessions.');
    return;
  }

  console.log('Task ID     Agent       Session ID                       Age   Stale');
  console.log('─'.repeat(75));
  for (const s of sessions) {
    const staleFlag = s.isStale ? 'YES' : '';
    console.log(
      `${s.task_id.padEnd(12)}${s.agent.padEnd(12)}${s.session_id.padEnd(33)}${String(s.ageMinutes + 'm').padEnd(6)}${staleFlag}`
    );
  }
}

// ─── ACP session liveness (label-keyed) ───────────────────────────

function runPing(db, args) {
  if (!args.label) die('Usage: stask session ping --label <name> [--task <task-id>] [--agent <agent>] [--subtask <subtask-id>]');
  const result = pingAcpSession(db, args.label, {
    taskId: args.taskId,
    agent: args.agent,
    subtaskId: args.subtaskId,
  });
  if (!result.ok) {
    die(`ping failed: ${result.error}`);
  }
  console.log(`${result.created ? 'created' : 'pinged'} ${result.label}`);
}

function runHealth(db, args) {
  if (!args.label) die('Usage: stask session health --label <name> [--hang-timeout <minutes>] [--json]');
  const result = acpSessionHealth(db, args.label, args.hangTimeout);
  if (args.json) {
    console.log(JSON.stringify(result));
  } else {
    const age = result.ageMinutes != null ? ` (${result.ageMinutes}m since last ping)` : '';
    console.log(`${result.status}${age}`);
  }
  if (result.status === 'hung') process.exit(1);
  if (result.status === 'missing') process.exit(2);
}

function runAcpList(db, args) {
  const rows = listAcpSessions(db, { taskId: args.taskId, agent: args.agent });
  if (args.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  if (rows.length === 0) {
    console.log('No ACP sessions tracked.');
    return;
  }
  console.log('Label                                Task       Agent       Subtask   Last Ping');
  console.log('─'.repeat(92));
  for (const r of rows) {
    console.log(
      `${r.label.padEnd(37)}${(r.task_id || '-').padEnd(11)}${r.agent.padEnd(12)}${(r.subtask_id || '-').padEnd(10)}${r.last_ping_at}`
    );
  }
}

function runAcpClose(db, args) {
  if (args.label) {
    const result = closeAcpSession(db, args.label);
    console.log(result.ok ? `closed ${result.label}` : `no session named ${args.label}`);
    return;
  }
  if (args.taskId) {
    const result = closeAcpSessionsForTask(db, args.taskId);
    console.log(`closed ${result.removed} session(s) for ${result.taskId}`);
    return;
  }
  die('Usage: stask session acp-close --label <name>   OR   --task <task-id>');
}
