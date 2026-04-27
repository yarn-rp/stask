/**
 * slack-reconcile.mjs — Extracted per-item reconciliation logic.
 *
 * Both the polling sync cycle (lib/slack-sync.mjs) and the event daemon
 * (lib/event-daemon/handlers/list-reconcile.mjs) call reconcileSlackItem
 * so the two paths stay identical and idempotent.
 *
 * source: 'poll' | 'event' — logged for observability only, no behavior change.
 */

import { CONFIG } from './env.mjs';
import { getLeadAgent, getSlackUserId } from './roles.mjs';
import { getSlackRowId } from './slack-row.mjs';
import { postThreadUpdate } from './thread-notify.mjs';
import { parseSlackItem } from './slack-sync.mjs';

/**
 * Reconcile a single Slack list item against the local DB.
 *
 * @param {Object} slackItem  - Raw Slack list item from getListItems()
 * @param {Object} opts
 * @param {string} opts.source  - 'poll' | 'event' (logged only)
 * @param {Object} opts.db      - better-sqlite3 db instance
 * @param {Object} opts.libs    - workspace libs (trackerDb, slackApi, …)
 * @returns {'pulled'|'skipped'} result string
 */
export async function reconcileSlackItem(slackItem, { source = 'poll', db, libs }) {
  if (!slackItem?.id) return 'skipped';

  const taskId = resolveTaskId(db, slackItem.id);
  if (!taskId) return 'skipped'; // unknown row — creation handled by runSyncCycle

  const task = libs.trackerDb.findTask(taskId);
  if (!task) return 'skipped';

  const slackTs = slackItem.updated_timestamp || 0;
  const syncState = libs.trackerDb.getSyncState(taskId);
  const lastSlackTs = syncState?.last_slack_ts || 0;

  // Idempotency guard: skip if this exact Slack timestamp was already processed
  if (slackTs && slackTs <= lastSlackTs) {
    return 'skipped';
  }

  const parsed = parseSlackItem(slackItem);
  if (Object.keys(parsed).length === 0) {
    const currentDbTs = task['updated_at'] || '';
    libs.trackerDb.setSyncState(taskId, slackTs, currentDbTs);
    return 'skipped';
  }

  // Build diff
  const updates = {};
  let wasSpecApproved = false;

  if (parsed._spec_approved && task['Status'] === 'To-Do' && task['Assigned To'] === CONFIG.human.name) {
    const leadName = getLeadAgent();
    if (leadName) {
      parsed.assigned_to = leadName;
      updates.assigned_to = leadName;
      // Persist the approval signal so every downstream gate (subtask
      // creation, heartbeat actions, To-Do → In-Progress guard) can refuse
      // to start work until the human has explicitly ticked the box.
      // Idempotent: if already approved, preserve original timestamp.
      if (!task['spec_approved_at']) {
        updates.spec_approved_at = new Date().toISOString().replace('T', ' ').replace(/\..+$/, '');
        updates.spec_approved_by = CONFIG.human.name;
      }
      // NB: status stays 'To-Do' on approval. The lead drives the
      // To-Do → In-Progress transition after creating subtasks; that path
      // runs require_approved (now keyed off spec_approved_at) and
      // setup_worktree, neither of which we want to bypass here.
      wasSpecApproved = true;
    }
  }
  delete parsed._spec_approved;

  if (parsed.status && parsed.status !== task['Status']) updates.status = parsed.status;
  if (parsed.assigned_to && parsed.assigned_to !== task['Assigned To']) updates.assigned_to = parsed.assigned_to;
  if (parsed.type && parsed.type !== task['Type']) updates.type = parsed.type;
  if (parsed.task_name && parsed.task_name !== task['Task Name']) updates.task_name = parsed.task_name;

  if (Object.keys(updates).length === 0) {
    const currentDbTs = task['updated_at'] || '';
    libs.trackerDb.setSyncState(taskId, slackTs, currentDbTs);
    return 'skipped';
  }

  // Apply direct update (bypasses guards — human authority)
  libs.trackerDb.updateTaskDirect(taskId, updates);

  const changes = Object.entries(updates).map(([k, v]) => `${k}: ${v}`).join(', ');
  libs.trackerDb.addLogEntry(taskId, `[${source}] Pulled from Slack: ${changes}`);

  // Thread notification (best-effort, non-blocking)
  let notificationMessage = null;
  if (wasSpecApproved) {
    const assignee = updates.assigned_to || task['Assigned To'];
    const leadSlackId = getSlackUserId(assignee);
    const mention = leadSlackId ? `<@${leadSlackId}>` : `*${assignee}*`;
    notificationMessage = `*${taskId}* spec approved by human! Ready for implementation — ${mention} please start when you see this.`;
  } else {
    const parts = [];
    if (updates.status) parts.push(`status -> *${updates.status}*`);
    if (updates.assigned_to) parts.push(`assigned to *${updates.assigned_to}*`);
    if (parts.length > 0) notificationMessage = `*${taskId}* updated via Slack: ${parts.join(', ')}`;
  }
  if (notificationMessage) {
    postThreadUpdate(taskId, notificationMessage, db).catch(() => {});
  }

  const updatedTask = libs.trackerDb.findTask(taskId);
  const newDbTs = updatedTask?.['updated_at'] || '';
  libs.trackerDb.setSyncState(taskId, slackTs, newDbTs);

  return 'pulled';
}

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Reverse-lookup: Slack row ID → task ID.
 */
function resolveTaskId(db, rowId) {
  try {
    const row = db.prepare('SELECT task_id FROM slack_row_ids WHERE row_id = ?').get(rowId);
    return row?.task_id || null;
  } catch {
    return null;
  }
}
