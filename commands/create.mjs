/**
 * stask create — Create a new task.
 *
 * Usage:
 *   stask create --name "Task Name" [--type Feature|Task|Bug] [--overview <text>]
 *
 * Tasks always start in Backlog. No spec, no assignee.
 * Attach a spec later via: stask spec-update T-XXX --spec <path>
 */

import { CONFIG, getWorkspaceLibs } from '../lib/env.mjs';
import { withTransaction } from '../lib/tx.mjs';
import { syncTaskToSlack, setThreadRef } from '../lib/slack-row.mjs';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--name' && argv[i + 1]) args.name = argv[++i];
    else if (argv[i] === '--type' && argv[i + 1]) args.type = argv[++i];
    else if (argv[i] === '--overview' && argv[i + 1]) args.overview = argv[++i];
  }
  return args;
}

/**
 * Discover the list item's comment thread on the list channel.
 * Slack Lists internally use a channel (list ID with F→C prefix swap).
 * Each list item gets a thread whose ts shares the same epoch second
 * as the item's date_created.
 *
 * @param {object} slackApi - Slack API module
 * @param {string} listChannelId - List channel ID (C-prefixed)
 * @param {number} itemDateCreated - Item's date_created (Unix epoch)
 */
async function discoverListItemThread(slackApi, listChannelId, itemDateCreated) {
  const epoch = String(itemDateCreated);
  const oldest = String(itemDateCreated - 2);
  const latest = String(itemDateCreated + 5);

  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await slackApi.getChannelHistory(listChannelId, { oldest, latest, limit: 10 });
    const messages = result.messages || [];
    const match = messages.find(m => m.ts && m.ts.startsWith(epoch + '.'));
    if (match) return match.ts;
    await new Promise(r => setTimeout(r, 1000));
  }
  return null;
}

export async function run(argv) {
  const args = parseArgs(argv);

  if (!args.name) {
    console.error('Usage: stask create --name "Task Name" [--type Feature|Task|Bug] [--overview <text>]');
    process.exit(1);
  }

  const libs = await getWorkspaceLibs();

  const result = await withTransaction(
    (db, libs) => {
      const taskId = libs.trackerDb.getNextTaskId();

      const taskFields = {
        task_id: taskId,
        task_name: args.name,
        status: 'Backlog',
        type: args.type || 'Feature',
      };

      libs.trackerDb.insertTask(taskFields);

      libs.trackerDb.addLogEntry(taskId, `${taskId} "${args.name}" created. Status: Backlog.`);

      const taskRow = libs.trackerDb.findTask(taskId);
      return { taskId, taskRow };
    },
    async ({ taskRow }, db) => {
      const { slackOps } = await syncTaskToSlack(db, taskRow);
      return slackOps;
    }
  );

  // Post-commit: discover list item thread and post creation message (best-effort)
  try {
    const listChannelId = CONFIG.slack.listId.replace(/^F/, 'C');
    const db = libs.trackerDb.getDb();
    // Get the Slack item's date_created (Unix epoch) to match the thread ts
    const { getSlackRowId } = await import('../lib/slack-row.mjs');
    const rowId = getSlackRowId(db, result.taskId);
    const itemInfo = await libs.slackApi.slackApiRequest('POST', '/slackLists.items.info', {
      list_id: CONFIG.slack.listId, id: rowId,
    });
    const dateCreated = itemInfo.record?.date_created;
    if (dateCreated) {
      const threadTs = await discoverListItemThread(libs.slackApi, listChannelId, dateCreated);
      if (threadTs) {
        const msg = args.overview
          ? `*${result.taskId}: ${args.name}*\n\n${args.overview}`
          : `*${result.taskId}: ${args.name}* — Created in Backlog. Requirements discussion starts here.`;
        await libs.slackApi.postMessage(listChannelId, msg, { threadTs });
        setThreadRef(db, result.taskId, listChannelId, threadTs);
      }
    }
  } catch (err) {
    console.error(`WARNING: Thread linking failed: ${err.message}`);
  }

  console.log(`Created ${result.taskId}: "${args.name}" | Status: Backlog | Assigned: Unassigned`);
}
