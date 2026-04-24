/**
 * stask create — Create a new task.
 *
 * Usage:
 *   stask create --name "Task Name" [--type Feature|Task|Bug] [--overview <text>]
 *
 * Tasks always start in Backlog. No spec, no assignee.
 * Attach a spec later via: stask spec-update T-XXX --spec <path>
 */

import { withTransaction } from '../lib/tx.mjs';
import { syncTaskToSlack } from '../lib/slack-row.mjs';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--name' && argv[i + 1]) args.name = argv[++i];
    else if (argv[i] === '--type' && argv[i + 1]) args.type = argv[++i];
    else if (argv[i] === '--overview' && argv[i + 1]) args.overview = argv[++i];
  }
  return args;
}

export async function run(argv) {
  const args = parseArgs(argv);

  if (!args.name) {
    console.error('Usage: stask create --name "Task Name" [--type Feature|Task|Bug] [--overview <text>]');
    process.exit(1);
  }

  // syncTaskToSlack is the single source of truth for task-creation side
  // effects: it creates the Slack list row AND seeds+persists the thread
  // ref, throwing on any failure. Every creation path (this command,
  // subtask-create, inbox actions) inherits the same hard-fail guarantee.
  const result = await withTransaction(
    (db, libs) => {
      const taskId = libs.trackerDb.getNextTaskId();
      libs.trackerDb.insertTask({
        task_id: taskId,
        task_name: args.name,
        status: 'Backlog',
        type: args.type || 'Feature',
      });
      libs.trackerDb.addLogEntry(taskId, `${taskId} "${args.name}" created. Status: Backlog.`);
      const taskRow = libs.trackerDb.findTask(taskId);
      return { taskId, taskRow };
    },
    async ({ taskRow }, db) => {
      const sync = await syncTaskToSlack(db, taskRow, null, { overview: args.overview || null });
      return sync.slackOps;
    }
  );

  console.log(`Created ${result.taskId}: "${args.name}" | Status: Backlog | Assigned: Unassigned`);
}
