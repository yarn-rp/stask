/**
 * stask approve — Human approves task spec, reassigns to Lead.
 *
 * Usage: stask approve <task-id>
 */

import { CONFIG, getWorkspaceLibs } from '../lib/env.mjs';
import { withTransaction } from '../lib/tx.mjs';
import { syncTaskToSlack } from '../lib/slack-row.mjs';
import { getLeadAgent } from '../lib/roles.mjs';

export async function run(argv) {
  const taskId = argv[0];

  if (!taskId) {
    console.error('Usage: stask approve <task-id>');
    process.exit(1);
  }

  const leadName = getLeadAgent();
  if (!leadName) { console.error('ERROR: No agent with role "lead" in config.'); process.exit(1); }

  const result = await withTransaction(
    (db, libs) => {
      const task = libs.trackerDb.findTask(taskId);
      if (!task) throw new Error(`Task ${taskId} not found`);
      if (task['Status'] !== 'To-Do') throw new Error(`${taskId} is "${task['Status']}". Must be "To-Do" to approve.`);
      if (task['Assigned To'] !== CONFIG.human.name) throw new Error(`${taskId} is assigned to ${task['Assigned To']}, not ${CONFIG.human.name}.`);

      libs.trackerDb.updateTask(taskId, { assigned_to: leadName });
      libs.trackerDb.addLogEntry(taskId, `${taskId} "${task['Task Name']}": Spec approved by ${CONFIG.human.name}. Assigned: ${leadName}.`);

      const updated = libs.trackerDb.findTask(taskId);
      return { taskId, taskRow: updated, taskName: task['Task Name'] };
    },
    async ({ taskRow }, db) => {
      const { slackOps } = await syncTaskToSlack(db, taskRow);
      return slackOps;
    }
  );

  console.log(`${taskId}: "${result.taskName}" | Spec approved | Assigned: ${leadName}`);
}
