/**
 * slack-reconcile.mjs — Extracted per-item reconciliation logic.
 *
 * Both the polling sync cycle (lib/slack-sync.mjs) and the event daemon
 * (lib/event-daemon/handlers/list-reconcile.mjs) call reconcileSlackItem
 * so the two paths stay identical and idempotent.
 *
 * source: 'poll' | 'event' — logged for observability only, no behavior change.
 */

import path from 'node:path';
import { spawn } from 'node:child_process';
import { CONFIG } from './env.mjs';
import { getLeadAgent } from './roles.mjs';
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

  // Thread notification (best-effort, non-blocking).
  // First-person on approval: the bot posts as the lead, so the message
  // reads as the lead claiming the work — no @mention to nobody, no
  // "please start when you see this" addressed at thin air.
  let notificationMessage = null;
  if (wasSpecApproved) {
    notificationMessage = `*${taskId}* spec approved by human! Ready for implementation — I should start working on this soon.`;
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

  // Auto-transition To-Do → In-Progress on approval. The human ticking
  // spec_approved is the trigger; the framework should not require a
  // follow-up agent action to start the work. We shell out to
  // `stask transition` so the canonical guard chain (setup_worktree,
  // require_approved, subtask cascade, Slack sync) runs as designed —
  // bypassing it via updateTaskDirect would skip worktree creation and
  // hit the enforce_in_progress_requirements DB trigger.
  if (wasSpecApproved && updatedTask?.['Status'] === 'To-Do') {
    triggerInProgressTransition(taskId);
  }

  return 'pulled';
}

/**
 * Fire-and-forget child process: `stask transition <taskId> In-Progress`.
 * Detached + unref so the daemon doesn't block on it. stdout/stderr go to
 * the daemon log via the parent's inherited descriptors.
 */
function triggerInProgressTransition(taskId) {
  try {
    const stask = path.join(CONFIG.staskRoot, 'bin', 'stask.mjs');
    const child = spawn(process.execPath, [stask, 'transition', taskId, 'In-Progress'], {
      detached: true,
      stdio: 'ignore',
      env: process.env,
    });
    child.on('error', () => {}); // best-effort; failures fall back to next sync/heartbeat
    child.unref();
  } catch {
    // best-effort — if spawn fails (e.g. EACCES), the polling/heartbeat
    // path will surface the still-To-Do task to the lead next tick.
  }
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
