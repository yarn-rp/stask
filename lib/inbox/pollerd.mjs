/**
 * pollerd.mjs — Main daemon entry point for the inbox subscription engine.
 *
 * Runs as an openclaw cron entry (5-min interval default).
 * Reads active subs, fetches new events from each source,
 * dedupes via fingerprint, writes to inbox_items, and auto-executes rules.
 */

import { CONFIG } from '../env.mjs';
import * as trackerDb from '../tracker-db.mjs';
import { fetchGitHubEvents, addFingerprints as addGitHubFingerprints } from './sources/github.mjs';
import { fetchLinearEvents, addFingerprints as addLinearFingerprints } from './sources/linear.mjs';
import { executeAction } from './actions.mjs';
import { execSync } from 'child_process';

// Re-export action executor for direct import
export { executeAction } from './actions.mjs';

/**
 * Execute a command with exponential backoff retry for 5xx errors.
 * Retries up to 3 times with delays: 1s, 2s, 4s.
 * @param {string} cmd - Command to execute
 * @param {Object} options - execSync options
 * @param {number} maxRetries - Maximum retry attempts (default 3)
 * @returns {string} - Command output
 */
function execWithRetry(cmd, options = {}, maxRetries = 3) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return execSync(cmd, options);
    } catch (err) {
      lastError = err;
      const status = err.status;
      // Only retry on 5xx server errors
      if (!status || status < 500 || status >= 600) {
        throw err;  // Not a 5xx error, don't retry
      }
      if (attempt === maxRetries) {
        throw err;  // Exhausted retries
      }
      const delayMs = Math.pow(2, attempt) * 1000;  // 1s, 2s, 4s
      console.error(`5xx error on attempt ${attempt + 1}, retrying in ${delayMs}ms...`);
      const start = Date.now();
      while (Date.now() - start < delayMs) {
        // Busy wait (simple approach for CLI)
      }
    }
  }
  throw lastError;  // Should not reach here
}

/**
 * Run one poll cycle.
 * Called by openclaw cron or manually via `stask inbox poll`.
 *
 * @returns {{ polled: number, newItems: number, errors: string[] }}
 */
export async function pollCycle() {
  trackerDb.ensureInboxTables();

  const subs = trackerDb.getActiveSubs();
  const now = new Date();
  const newItems = [];
  const errors = [];

  for (const sub of subs) {
    // Check if subscription is due for polling
    if (sub.last_poll_at) {
      const lastPoll = new Date(sub.last_poll_at);
      const elapsed = (now - lastPoll) / 1000;
      if (elapsed < sub.poll_interval) continue;  // not due yet
    }

    try {
      let rawEvents;
      let cursor;

      switch (sub.source_type) {
        case 'github':
          ({ events: rawEvents, cursor } = fetchGitHubEvents(sub));
          rawEvents = addGitHubFingerprints(rawEvents);
          break;
        case 'linear':
          ({ events: rawEvents, cursor } = fetchLinearEvents(sub));
          rawEvents = addLinearFingerprints(rawEvents);
          break;
        default:
          errors.push(`Unknown source_type: ${sub.source_type}`);
          continue;
      }

      // Dedup and insert
      for (const event of rawEvents) {
        if (trackerDb.inboxItemExists(event.fingerprint)) continue;

        // Generate item ID
        const itemId = generateItemId();

        // Find linked task for GitHub PR events
        let relatedTaskId = null;
        if (event.pr_url) {
          const task = trackerDb.findTaskByPrUrl(event.pr_url);
          if (task) relatedTaskId = task['Task ID'];
        }

        const item = {
          item_id: itemId,
          sub_id: sub.sub_id,
          source_type: event.source_type,
          event_type: event.event_type,
          source_id: event.source_id,
          title: event.title,
          body: event.body || null,
          url: event.url || null,
          author: event.author || null,
          status: 'New',
          related_task_id: relatedTaskId,
          fingerprint: event.fingerprint,
          occurred_at: event.occurred_at,
          source_raw: event.source_raw || null,
        };

        trackerDb.insertInboxItem(item);
        newItems.push(item);

        // Auto-execute matching action rule
        try {
          trackerDb.updateInboxItemStatus(itemId, 'Processing');
          const { actionTaken, relatedTaskId: actionTaskId } = await executeAction(event);
          trackerDb.updateInboxItemStatus(
            itemId,
            'Processed',
            actionTaken,
            actionTaskId || relatedTaskId
          );
        } catch (err) {
          console.error(`Action execution error for ${itemId}: ${err.message}`);
          // Mark as New for manual review (preserve source_raw)
          trackerDb.updateInboxItemStatus(itemId, 'New', `action_error: ${err.message}`);
          errors.push(`Action error for ${itemId}: ${err.message}`);
        }
      }

      // Update subscription cursor and last_poll_at
      trackerDb.updateSubCursor(sub.sub_id, cursor, now.toISOString());
    } catch (err) {
      console.error(`Poll error for sub ${sub.sub_id}: ${err.message}`);
      errors.push(`Sub ${sub.sub_id} (${sub.source_type}): ${err.message}`);

      // Check for auth errors (401/403) — deactivate subscription
      if (err.message.includes('401') || err.message.includes('403')) {
        console.error(`Auth error detected — deactivating sub ${sub.sub_id}`);
        trackerDb.deactivateSub(sub.sub_id);

        // Post Slack alert about deactivation
        try {
          const SLACK = CONFIG.slack;
          if (SLACK?.listId) {
            const listChannelId = SLACK.listId.replace(/^F/, 'C');
            const { postMessage: slackPostMessage } = await import('../slack-api.mjs');
            await slackPostMessage(
              listChannelId,
              `⚠️ Inbox subscription *${sub.sub_id}* (${sub.source_type}: ${sub.target_id}) has been deactivated due to an authentication error. Re-authenticate and re-activate manually.`
            );
          }
        } catch { /* best-effort notification */ }
      }
    }
  }

  return { polled: subs.length, newItems: newItems.length, errors };
}

/**
 * CLI entry point: run one poll cycle and output results.
 */
export async function run(argv) {
  const result = await pollCycle();
  console.log(JSON.stringify(result, null, 2));
}

/**
 * Generate a unique inbox item ID.
 * Format: INB-{NNN} (sequential).
 */
let _itemCounter = null;
function generateItemId() {
  if (_itemCounter === null) {
    trackerDb.ensureInboxTables();
    const db = trackerDb.getDb();
    const row = db.prepare(
      "SELECT item_id FROM inbox_items WHERE item_id GLOB 'INB-[0-9]*' ORDER BY item_id DESC LIMIT 1"
    ).get();
    _itemCounter = row ? parseInt(row.item_id.slice(4), 10) + 1 : 1;
  }
  return `INB-${String(_itemCounter++).padStart(3, '0')}`;
}