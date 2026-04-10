/**
 * assign.mjs — Reassign a task to an agent or human.
 *
 * Usage: stask assign <task-id> <name>
 *
 * Useful for assigning to bot/app users (Richard, Gilfoyle, etc.)
 * which can't be done through Slack's UI user picker.
 * Syncs the change to Slack automatically.
 */

import { CONFIG, getWorkspaceLibs } from '../lib/env.mjs';
import { getSlackUserId } from '../lib/roles.mjs';
import { syncTaskToSlack, getSlackRowId } from '../lib/slack-row.mjs';

export async function run(argv) {
  const taskId = argv[0];
  const name = argv[1];

  if (!taskId || !name) {
    console.error('Usage: stask assign <task-id> <name>');
    console.error('');
    console.error('Available names:');
    console.error(`  ${CONFIG.human.name} (human)`);
    for (const [agent, info] of Object.entries(CONFIG.agents)) {
      console.error(`  ${agent.charAt(0).toUpperCase() + agent.slice(1)} (${info.role})`);
    }
    process.exit(1);
  }

  const libs = await getWorkspaceLibs();
  const db = libs.trackerDb.getDb();

  const task = libs.trackerDb.findTask(taskId);
  if (!task) {
    console.error(`ERROR: Task ${taskId} not found`);
    process.exit(1);
  }

  // Validate the name resolves to a known Slack user
  const displayName = name.charAt(0).toUpperCase() + name.slice(1);
  const slackUserId = getSlackUserId(displayName);
  if (!slackUserId) {
    console.error(`ERROR: Unknown user "${name}". Available: ${CONFIG.human.name}, ${Object.keys(CONFIG.agents).map(n => n.charAt(0).toUpperCase() + n.slice(1)).join(', ')}`);
    process.exit(1);
  }

  const oldAssignee = task['Assigned To'];
  if (oldAssignee === displayName) {
    console.log(`${taskId} is already assigned to ${displayName}`);
    return;
  }

  // Update DB
  libs.trackerDb.updateTaskDirect(taskId, { assigned_to: displayName });
  libs.trackerDb.addLogEntry(taskId, `Reassigned: ${oldAssignee} → ${displayName}`);

  // Push to Slack
  const updatedTask = libs.trackerDb.findTask(taskId);
  const parentId = updatedTask['Parent'];
  const parentRowId = (parentId && parentId !== 'None') ? getSlackRowId(db, parentId) : null;
  await syncTaskToSlack(db, updatedTask, parentRowId);

  console.log(`${taskId}: ${oldAssignee} → ${displayName} (synced to Slack)`);
}
