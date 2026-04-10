/**
 * stask session — Manage session locks.
 *
 * Usage:
 *   stask session claim <task-id> --agent <name> --session-id <id>
 *   stask session release <task-id> [--session-id <id>]
 *   stask session status [<task-id>]
 */

import { withDb } from '../lib/tx.mjs';
import { claimTask, releaseTask, getSessionStatus, cleanStaleSessions } from '../lib/session-tracker.mjs';

function parseArgs(argv) {
  const args = { subcommand: argv[0] };
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--agent' && argv[i + 1]) args.agent = argv[++i];
    else if (argv[i] === '--session-id' && argv[i + 1]) args.sessionId = argv[++i];
    else if (!argv[i].startsWith('-') && !args.taskId) args.taskId = argv[i];
  }
  return args;
}

export async function run(argv) {
  const args = parseArgs(argv);

  if (!args.subcommand || !['claim', 'release', 'status'].includes(args.subcommand)) {
    console.error('Usage: stask session <claim|release|status> [<task-id>] [--agent X] [--session-id Y]');
    process.exit(1);
  }

  await withDb((db) => {
    if (args.subcommand === 'claim') {
      if (!args.taskId || !args.agent || !args.sessionId) {
        console.error('Usage: stask session claim <task-id> --agent <name> --session-id <id>');
        process.exit(1);
      }
      const result = claimTask(db, args.taskId, args.agent, args.sessionId);
      if (result.ok) {
        console.log(result.message);
      } else {
        console.error(`BLOCKED: ${result.message}`);
        process.exit(1);
      }
    }

    else if (args.subcommand === 'release') {
      if (!args.taskId) {
        console.error('Usage: stask session release <task-id> [--session-id <id>]');
        process.exit(1);
      }
      const result = releaseTask(db, args.taskId, args.sessionId);
      console.log(result.message);
    }

    else if (args.subcommand === 'status') {
      // Clean stale sessions first
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
  });
}
