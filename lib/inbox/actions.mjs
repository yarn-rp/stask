/**
 * actions.mjs — Action executor for the inbox subscription engine.
 *
 * Three hardcoded rules for v1 (deterministic, no LM):
 *   1. PR merged → transition linked task to Done
 *   2. Yan comment on PR → transition linked task to In-Progress
 *   2b. Non-Yan comment on PR → ask Yan (Slack message)
 *   3. Linear ticket assigned → create Backlog item
 *
 * All actions post a Slack notification to the relevant task thread.
 */

import { CONFIG } from '../env.mjs';
import { postThreadUpdate } from '../thread-notify.mjs';
import { syncTaskToSlack, getThreadRef } from '../slack-row.mjs';
import * as trackerDb from '../tracker-db.mjs';
import { postMessage as slackPostMessage } from '../slack-api.mjs';

const YAN_GITHUB = CONFIG.human.githubUsername;

/**
 * Execute the appropriate action for an inbox item.
 * Called after the item is inserted into inbox_items.
 *
 * @param {Object} item - Inbox item row
 * @returns {{ actionTaken: string, relatedTaskId: string|null }}
 */
export async function executeAction(item) {
  switch (item.event_type) {
    case 'pr_merged':
      return await handlePrMerged(item);
    case 'comment_added':
      return await handleCommentAdded(item);
    case 'ticket_assigned':
      return await handleTicketAssigned(item);
    default:
      return { actionTaken: 'no_rule_matched', relatedTaskId: null };
  }
}

/**
 * Rule 1: PR merged → transition linked task to Done.
 */
async function handlePrMerged(item) {
  const task = findLinkedTask(item);
  if (!task) {
    return { actionTaken: 'no_linked_task', relatedTaskId: null };
  }

  if (task['Status'] === 'Done') {
    return { actionTaken: 'already_done', relatedTaskId: task['Task ID'] };
  }

  try {
    // Use updateTaskDirect to bypass transition guards (PR merge is external authority)
    trackerDb.updateTaskDirect(task['Task ID'], { status: 'Done', pr_status: null });

    trackerDb.addLogEntry(task['Task ID'], `${task['Task ID']} "${task['Task Name']}": ${task['Status']} → Done. PR merged: ${item.url}`);

    // Sync to Slack
    const updated = trackerDb.findTask(task['Task ID']);
    if (updated) {
      const db = trackerDb.getDb();
      await syncTaskToSlack(db, updated);
    }

    // Post notification to task thread
    await postThreadUpdate(task['Task ID'], `PR merged → *${task['Task ID']}* moved to *Done*`);

    return { actionTaken: 'transitioned_to_done', relatedTaskId: task['Task ID'] };
  } catch (err) {
    console.error(`Action error (pr_merged → Done): ${err.message}`);
    return { actionTaken: `error: ${err.message}`, relatedTaskId: task['Task ID'] };
  }
}

/**
 * Rule 2/2b: Comment added → Yan → In-Progress; other → ask Yan.
 */
async function handleCommentAdded(item) {
  const task = findLinkedTask(item);
  if (!task) {
    return { actionTaken: 'no_linked_task', relatedTaskId: null };
  }

  const isYan = item.author === YAN_GITHUB;

  if (isYan) {
    // Rule 2: Yan commented → move back to In-Progress
    try {
      trackerDb.updateTaskDirect(task['Task ID'], { status: 'In-Progress' });

      trackerDb.addLogEntry(task['Task ID'], `${task['Task ID']} "${task['Task Name']}": ${task['Status']} → In-Progress. PR comment from Yan.`);

      // Sync to Slack
      const updated = trackerDb.findTask(task['Task ID']);
      if (updated) {
        const db = trackerDb.getDb();
        await syncTaskToSlack(db, updated);
      }

      await postThreadUpdate(task['Task ID'], `PR comment from Yan → *${task['Task ID']}* moved to *In-Progress*`);

      return { actionTaken: 'yan_comment_to_in_progress', relatedTaskId: task['Task ID'] };
    } catch (err) {
      console.error(`Action error (Yan comment → In-Progress): ${err.message}`);
      return { actionTaken: `error: ${err.message}`, relatedTaskId: task['Task ID'] };
    }
  } else {
    // Rule 2b: Non-Yan comment → ask Yan (no transition)
    await postThreadUpdate(
      task['Task ID'],
      `PR comment from *${item.author}* — what should we do with *${task['Task ID']}*?`
    );
    return { actionTaken: 'asked_yan', relatedTaskId: task['Task ID'] };
  }
}

/**
 * Rule 3: Linear ticket assigned → create Backlog item.
 */
async function handleTicketAssigned(item) {
  try {
    const taskId = trackerDb.getNextTaskId();

    const taskFields = {
      task_id: taskId,
      task_name: item.title,
      status: 'Backlog',
      type: 'Task',
    };

    trackerDb.insertTask(taskFields);
    trackerDb.addLogEntry(taskId, `${taskId} "${item.title}" created. Status: Backlog. Auto-created from Linear: ${item.url}`);

    // Sync to Slack
    const taskRow = trackerDb.findTask(taskId);
    if (taskRow) {
      const db = trackerDb.getDb();
      await syncTaskToSlack(db, taskRow);
    }

    // Post to project channel (broadcast)
    const SLACK = CONFIG.slack;
    if (SLACK?.listId) {
      const listChannelId = SLACK.listId.replace(/^F/, 'C');
      await slackPostMessage(
        listChannelId,
        `Ticket assigned to Yan: ${item.title} → Created *${taskId}* in Backlog\n${item.url}`
      );
    }

    return { actionTaken: 'created_backlog_task', relatedTaskId: taskId };
  } catch (err) {
    console.error(`Action error (ticket_assigned → Backlog): ${err.message}`);
    return { actionTaken: `error: ${err.message}`, relatedTaskId: null };
  }
}

/**
 * Find the stask task linked to an inbox item via the PR field.
 * GitHub items have pr_url; Linear items don't.
 */
function findLinkedTask(item) {
  // For GitHub items, match by PR URL stored on tasks
  if (item.source_type === 'github' && item.pr_url) {
    const task = trackerDb.findTaskByPrUrl(item.pr_url);
    return task;  // return even if null or Done — caller decides what to do
  }

  // For other sources, no auto-linking in v1
  return null;
}