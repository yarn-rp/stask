/**
 * thread-notify.mjs — Post lifecycle alerts to task Slack threads.
 *
 * Best-effort: failures are logged but never throw.
 * All mutations should call postThreadUpdate() after committing.
 */

import { getWorkspaceLibs } from './env.mjs';
import { getThreadRef } from './slack-row.mjs';
import { logError } from './error-logger.mjs';

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

    // Retry with exponential backoff: 1s, 2s, 4s
    const MAX_RETRIES = 3;
    const BACKOFF_BASE = 1000; // 1s

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        await libs.slackApi.postMessage(threadRef.channelId, message, {
          threadTs: threadRef.threadTs,
        });
        return; // Success - exit
      } catch (err) {
        if (attempt === MAX_RETRIES - 1) {
          // Last attempt failed - log error instead of swallowing
          logError({
            source: 'thread-notify',
            operation: 'postThreadUpdate',
            taskId,
            error: err,
            retries: attempt + 1,
            metadata: { channelId: threadRef.channelId, threadTs: threadRef.threadTs, messagePreview: message.slice(0, 100) }
          });
          return;
        }
        // Wait with exponential backoff before retry
        await new Promise(resolve => setTimeout(resolve, BACKOFF_BASE * (2 ** attempt)));
      }
    }
  } catch (err) {
    // Fallback for unexpected errors
    logError({
      source: 'thread-notify',
      operation: 'postThreadUpdate',
      taskId,
      error: err
    });
  }
}
