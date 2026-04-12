/**
 * thread-notify.mjs — Post lifecycle alerts to task Slack threads.
 *
 * Best-effort: failures are logged but never throw.
 * All mutations should call postThreadUpdate() after committing.
 */

import { getWorkspaceLibs } from './env.mjs';
import { getThreadRef } from './slack-row.mjs';

/**
 * Post an update message to a task's Slack thread.
 *
 * Resolves the thread for the root task (uses parent if subtask).
 * No-op if the task has no thread reference.
 *
 * @param {string} taskId - The task ID (parent or subtask)
 * @param {string} message - The message to post
 * @param {Object} [db] - Optional DB handle (avoids re-opening)
 */
export async function postThreadUpdate(taskId, message, db) {
  try {
    const libs = await getWorkspaceLibs();
    const _db = db || libs.trackerDb.getDb();

    // Resolve to parent task for thread lookup
    const task = libs.trackerDb.findTask(taskId);
    const rootId = (task && task['Parent'] !== 'None') ? task['Parent'] : taskId;

    const threadRef = getThreadRef(_db, rootId);
    if (!threadRef) return;

    await libs.slackApi.postMessage(threadRef.channelId, message, {
      threadTs: threadRef.threadTs,
    });
  } catch (err) {
    console.error(`WARNING: Thread notification failed for ${taskId}: ${err.message}`);
  }
}
