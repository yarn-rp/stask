/**
 * stask subtask create — Create a subtask under a parent task.
 *
 * Usage: stask subtask create --parent <task-id> --name "..." --assign <agent> [--type Task|Bug]
 */

import { getWorkspaceLibs } from '../lib/env.mjs';
import { withTransaction } from '../lib/tx.mjs';
import { syncSubtaskToSlack } from '../lib/slack-row.mjs';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--parent' && argv[i + 1]) args.parent = argv[++i];
    else if (argv[i] === '--name' && argv[i + 1]) args.name = argv[++i];
    else if (argv[i] === '--assign' && argv[i + 1]) args.assign = argv[++i];
    else if (argv[i] === '--type' && argv[i + 1]) args.type = argv[++i];
  }
  return args;
}

export async function run(argv) {
  const args = parseArgs(argv);

  if (!args.parent || !args.name || !args.assign) {
    console.error('Usage: stask subtask create --parent <task-id> --name "Name" --assign <agent> [--type Task|Bug]');
    process.exit(1);
  }

  const result = await withTransaction(
    (db, libs) => {
      const parent = libs.trackerDb.findTask(args.parent);
      if (!parent) throw new Error(`Parent task ${args.parent} not found`);
      if (parent['Status'] !== 'To-Do') throw new Error(`Parent ${args.parent} is "${parent['Status']}". Must be "To-Do" to create subtasks.`);

      const subtaskId = libs.trackerDb.getNextSubtaskId(args.parent);
      const parentSpec = parent['Spec'];

      libs.trackerDb.insertTask({
        task_id: subtaskId,
        task_name: args.name,
        status: 'To-Do',
        assigned_to: args.assign,
        spec: parentSpec,
        type: args.type || 'Task',
        parent_id: args.parent,
      });

      libs.trackerDb.addLogEntry(subtaskId, `${subtaskId} "${args.name}" created under ${args.parent}. Assigned: ${args.assign}.`);

      const taskRow = libs.trackerDb.findTask(subtaskId);
      return { subtaskId, taskRow, parentSpec };
    },
    async ({ taskRow, subtaskId }, db) => {
      try {
        const { slackOps } = await syncSubtaskToSlack(db, taskRow);
        return slackOps;
      } catch (err) {
        throw new Error(`Slack sync failed for subtask ${subtaskId} (parent: ${args.parent}, name: "${args.name}"): ${err.message}`);
      }
    }
  );

  const specFileId = result.parentSpec.match(/\((\w+)\)$/)?.[1] || result.parentSpec;
  console.log(`Created ${result.subtaskId}: "${args.name}" | Parent: ${args.parent} | Assigned: ${args.assign} | Spec: ${specFileId}`);
}
