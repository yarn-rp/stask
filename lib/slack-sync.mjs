/**
 * slack-sync.mjs — Bidirectional Slack List ↔ SQLite sync.
 *
 * Uses timestamps to determine which side changed:
 *   - Slack items have `updated_timestamp` (Unix epoch)
 *   - DB tasks have `updated_at` (ISO 8601)
 *   - `sync_state` table tracks last-known timestamps from both sides
 *
 * Conflict resolution: most recent timestamp wins.
 * Slack→DB sync skips guards/cascading (human authority).
 *
 * ALL human-editable fields are synced:
 *   Status, Assigned To, Type, Task Name, Completed checkbox
 */

import { CONFIG, getWorkspaceLibs } from './env.mjs';
import { getNameBySlackUserId, getLeadAgent } from './roles.mjs';
import { getSlackRowId, setSlackRowId } from './slack-row.mjs';
import { postThreadUpdate } from './thread-notify.mjs';
import { TRIGGERS } from './tracker-db.mjs';

const SLACK = CONFIG.slack;
const COLS = SLACK.columns;

// ─── Reverse lookup maps (built from config) ─────────────────────

const OPTION_TO_STATUS = Object.fromEntries(
  Object.entries(SLACK.statusOptions).map(([name, optId]) => [optId, name])
);

const OPTION_TO_TYPE = Object.fromEntries(
  Object.entries(SLACK.typeOptions || {}).map(([name, optId]) => [optId, name])
);

const SLACK_USER_TO_NAME = {};
SLACK_USER_TO_NAME[CONFIG.human.slackUserId] = CONFIG.human.name;
for (const [name, agent] of Object.entries(CONFIG.agents)) {
  SLACK_USER_TO_NAME[agent.slackUserId] = name.charAt(0).toUpperCase() + name.slice(1);
}

// Column ID → parser key
const COL_TO_FIELD = {};
if (COLS.status)    COL_TO_FIELD[COLS.status]    = 'status';
if (COLS.assignee)  COL_TO_FIELD[COLS.assignee]  = 'assigned_to';
if (COLS.completed) COL_TO_FIELD[COLS.completed] = 'completed';
if (COLS.type)      COL_TO_FIELD[COLS.type]      = 'type';
if (COLS.name)      COL_TO_FIELD[COLS.name]      = 'task_name';
if (COLS.spec_approved) COL_TO_FIELD[COLS.spec_approved] = 'spec_approved';

// ─── Parse Slack item → task fields ───────────────────────────────

/**
 * Extract all human-editable fields from a Slack List item.
 * Returns DB column names → values (e.g. { status, assigned_to, type, task_name }).
 */
export function parseSlackItem(item) {
  const result = {};
  if (!item?.fields) return result;

  for (const field of item.fields) {
    // Slack returns column_id in the field; match against our config
    const colId = field.column_id;
    const fieldName = COL_TO_FIELD[colId];
    if (!fieldName) continue;

    // ── Status (select) ──
    if (fieldName === 'status') {
      const optId = field.select ? field.select[0] : null;
      if (optId) {
        const status = OPTION_TO_STATUS[optId];
        if (status) result.status = status;
      }
    }

    // ── Assigned To (user) ──
    if (fieldName === 'assigned_to') {
      const userId = field.user ? field.user[0] : null;
      if (userId) {
        const name = getNameBySlackUserId(userId);
        if (name) result.assigned_to = name;
      }
    }

    // ── Type (select) ──
    if (fieldName === 'type') {
      const optId = field.select ? field.select[0] : null;
      if (optId) {
        const typeName = OPTION_TO_TYPE[optId];
        if (typeName) result.type = typeName;
      }
    }

    // ── Task Name (rich_text — use .text shortcut) ──
    if (fieldName === 'task_name') {
      const text = field.text || '';
      if (text.trim()) result.task_name = text.trim();
    }

    // ── Completed (checkbox / boolean) ──
    if (fieldName === 'completed') {
      // Slack returns boolean directly or in value.checkbox
      const checked = typeof field.value === 'boolean'
        ? field.value
        : field.value?.checkbox ?? false;
      if (checked === true) result._completed = true;
      if (checked === false) result._uncompleted = true;
    }

    // ── Spec Approved (checkbox — pull-only trigger, never stored in DB) ──
    if (fieldName === 'spec_approved') {
      const checked = typeof field.value === 'boolean'
        ? field.value
        : field.value?.checkbox ?? false;
      if (checked === true) result._spec_approved = true;
    }
  }

  // Checkbox overrides: completed=true forces Done, uncompleted=true forces un-Done
  if (result._completed && result.status !== 'Done') {
    result.status = 'Done';
  }
  delete result._completed;
  delete result._uncompleted;

  return result;
}

// ─── Match Slack items to DB tasks ────────────────────────────────

function indexSlackItems(items) {
  const map = new Map();
  for (const item of items) {
    if (item.id) map.set(item.id, item);
  }
  return map;
}

// ─── Core sync cycle ──────────────────────────────────────────────

/**
 * Run one full bidirectional sync cycle.
 * Returns { pulled: [], pushed: [], skipped: number, errors: [] }.
 */
export async function runSyncCycle() {
  const libs = await getWorkspaceLibs();
  const db = libs.trackerDb.getDb();
  const { getListItems } = libs.slackApi;

  libs.trackerDb.ensureSyncStateTable();

  const summary = { pulled: [], pushed: [], deleted: [], created: [], skipped: 0, errors: [] };
  const threadNotifications = []; // { taskId, message } — fired after sync loop

  // 1. Fetch all Slack items
  let slackItems;
  try {
    slackItems = await getListItems(SLACK.listId);
  } catch (err) {
    summary.errors.push(`Failed to fetch Slack items: ${err.message}`);
    return summary;
  }
  const slackMap = indexSlackItems(slackItems);

  // 2. Fetch all DB tasks
  const allTasks = libs.trackerDb.getAllTasks();

  // 3. For each task, compare timestamps and sync
  for (const task of allTasks) {
    const taskId = task['Task ID'];
    const rowId = getSlackRowId(db, taskId);
    if (!rowId) {
      summary.skipped++;
      continue;
    }

    const slackItem = slackMap.get(rowId);
    if (!slackItem) {
      // Row exists in mapping but gone from Slack → deleted on Slack side
      try {
        deleteLocalTask(db, libs, taskId);
        summary.deleted.push(taskId);
      } catch (err) {
        summary.errors.push(`${taskId} delete: ${err.message}`);
      }
      continue;
    }

    try {
      const syncResult = syncOneTask(db, libs, task, slackItem, threadNotifications);
      if (syncResult === 'pulled') {
        summary.pulled.push(taskId);
      } else if (syncResult === 'pushed') {
        summary.pushed.push(taskId);
      } else {
        summary.skipped++;
      }
    } catch (err) {
      summary.errors.push(`${taskId}: ${err.message}`);
    }
  }

  // 4. Pull new items from Slack that don't exist locally
  //    (e.g. Backlog items created directly in Slack)
  let knownRowIds;
  try {
    knownRowIds = new Set(
      db.prepare('SELECT row_id FROM slack_row_ids').all().map(r => r.row_id)
    );
  } catch {
    knownRowIds = new Set(); // Table might not exist yet on fresh DBs
  }
  for (const slackItem of slackItems) {
    if (!slackItem.id || knownRowIds.has(slackItem.id)) continue;
    // Skip child items (subtasks) — only pull top-level items
    if (slackItem.parent_item_id) continue;

    try {
      const created = createTaskFromSlack(db, libs, slackItem);
      if (created) {
        summary.created.push(created);
        threadNotifications.push({
          taskId: created,
          message: `*${created}* created from Slack list item`,
        });
      }
    } catch (err) {
      summary.errors.push(`New item ${slackItem.id}: ${err.message}`);
    }
  }

  // Fire thread notifications for sync-driven changes (best-effort)
  for (const { taskId, message } of threadNotifications) {
    postThreadUpdate(taskId, message, db).catch(() => {});
  }

  return summary;
}

/**
 * Sync a single task/item pair.
 * Returns 'pulled' | 'pushed' | 'skipped'.
 */
function syncOneTask(db, libs, task, slackItem, threadNotifications = []) {
  const taskId = task['Task ID'];
  const syncState = libs.trackerDb.getSyncState(taskId);

  const slackTs = slackItem.updated_timestamp || 0;
  const dbTs = task['updated_at'] || '';

  const lastSlackTs = syncState?.last_slack_ts || 0;
  const lastDbTs = syncState?.last_db_ts || '';

  const slackChanged = slackTs > lastSlackTs;
  const dbChanged = dbTs > lastDbTs;

  if (!slackChanged && !dbChanged) {
    // Safety: even if timestamps match, check for value drift
    // (e.g. config was updated with new option IDs after a previous sync)
    return checkValueDrift(db, libs, taskId, task, slackItem, slackTs);
  }

  if (slackChanged && !dbChanged) {
    return pullFromSlack(db, libs, taskId, task, slackItem, slackTs, threadNotifications);
  }

  if (!slackChanged && dbChanged) {
    // DB was edited → record sync state (push handled by mutation commands)
    libs.trackerDb.setSyncState(taskId, slackTs, dbTs);
    return 'skipped';
  }

  // Both changed → most recent wins
  const dbUnix = Math.floor(new Date(dbTs + 'Z').getTime() / 1000);
  if (slackTs >= dbUnix) {
    return pullFromSlack(db, libs, taskId, task, slackItem, slackTs, threadNotifications);
  } else {
    libs.trackerDb.setSyncState(taskId, slackTs, dbTs);
    return 'skipped';
  }
}

/**
 * Safety fallback: even when timestamps haven't changed, compare actual values.
 * Catches cases where config was updated (new option IDs) after a previous sync.
 */
function checkValueDrift(db, libs, taskId, task, slackItem, slackTs) {
  const parsed = parseSlackItem(slackItem);
  const updates = {};
  if (parsed.status && parsed.status !== task['Status']) updates.status = parsed.status;
  if (parsed.assigned_to && parsed.assigned_to !== task['Assigned To']) updates.assigned_to = parsed.assigned_to;
  if (parsed.type && parsed.type !== task['Type']) updates.type = parsed.type;
  if (parsed.task_name && parsed.task_name !== task['Task Name']) updates.task_name = parsed.task_name;

  if (Object.keys(updates).length === 0) return 'skipped';

  // Found drift — apply Slack values (Slack is authoritative for drift)
  libs.trackerDb.updateTaskDirect(taskId, updates);
  const changes = Object.entries(updates).map(([k, v]) => `${k}: ${v}`).join(', ');
  libs.trackerDb.addLogEntry(taskId, `[sync] Value drift corrected from Slack: ${changes}`);
  const updatedTask = libs.trackerDb.findTask(taskId);
  libs.trackerDb.setSyncState(taskId, slackTs, updatedTask?.['updated_at'] || '');
  return 'pulled';
}

/**
 * Pull changes from a Slack item into the DB task.
 */
function pullFromSlack(db, libs, taskId, task, slackItem, slackTs, threadNotifications = []) {
  const parsed = parseSlackItem(slackItem);
  if (Object.keys(parsed).length === 0) {
    const currentDbTs = task['updated_at'] || '';
    libs.trackerDb.setSyncState(taskId, slackTs, currentDbTs);
    return 'skipped';
  }

  // Spec approval via Slack checkbox: reassign from human to lead
  if (parsed._spec_approved && task['Status'] === 'To-Do' && task['Assigned To'] === CONFIG.human.name) {
    const leadName = getLeadAgent();
    if (leadName) {
      parsed.assigned_to = leadName;
    }
  }
  delete parsed._spec_approved;

  // Diff: only update fields that actually changed
  const updates = {};
  if (parsed.status && parsed.status !== task['Status']) {
    updates.status = parsed.status;
  }
  if (parsed.assigned_to && parsed.assigned_to !== task['Assigned To']) {
    updates.assigned_to = parsed.assigned_to;
  }
  if (parsed.type && parsed.type !== task['Type']) {
    updates.type = parsed.type;
  }
  if (parsed.task_name && parsed.task_name !== task['Task Name']) {
    updates.task_name = parsed.task_name;
  }

  if (Object.keys(updates).length === 0) {
    const currentDbTs = task['updated_at'] || '';
    libs.trackerDb.setSyncState(taskId, slackTs, currentDbTs);
    return 'skipped';
  }

  // Apply direct update (bypasses guards — human override)
  libs.trackerDb.updateTaskDirect(taskId, updates);

  // Log the change
  const changes = Object.entries(updates).map(([k, v]) => `${k}: ${v}`).join(', ');
  libs.trackerDb.addLogEntry(taskId, `[sync] Pulled from Slack: ${changes}`);

  // Queue thread notifications for significant changes
  const parts = [];
  if (updates.status) parts.push(`status → *${updates.status}*`);
  if (updates.assigned_to) parts.push(`assigned to *${updates.assigned_to}*`);
  if (parts.length > 0) {
    threadNotifications.push({
      taskId,
      message: `*${taskId}* updated via Slack: ${parts.join(', ')}`,
    });
  }

  // Update sync state with new timestamps
  const updatedTask = libs.trackerDb.findTask(taskId);
  const newDbTs = updatedTask?.['updated_at'] || '';
  libs.trackerDb.setSyncState(taskId, slackTs, newDbTs);

  return 'pulled';
}

// ─── Create local task from Slack item ────────────────────────────

/**
 * Create a new local task from a Slack List item that has no DB counterpart.
 * Returns the new task ID, or null if the item can't be parsed.
 */
function createTaskFromSlack(db, libs, slackItem) {
  const parsed = parseSlackItem(slackItem);
  const name = parsed.task_name;
  if (!name) return null; // Can't create without a name

  const taskId = libs.trackerDb.getNextTaskId();
  const status = parsed.status || 'Backlog';
  const assignedTo = parsed.assigned_to || null;
  const type = parsed.type || 'Task';

  libs.trackerDb.insertTask({
    task_id: taskId,
    task_name: name,
    status,
    assigned_to: assignedTo,
    type,
    spec: '',
  });

  setSlackRowId(db, taskId, slackItem.id);
  libs.trackerDb.addLogEntry(taskId, `[sync] ${taskId} "${name}" created from Slack (${status}).`);

  // Record sync state so we don't re-process this item
  const slackTs = slackItem.updated_timestamp || Math.floor(Date.now() / 1000);
  const task = libs.trackerDb.findTask(taskId);
  const dbTs = task?.['updated_at'] || '';
  libs.trackerDb.setSyncState(taskId, slackTs, dbTs);

  // Push the task_id back to Slack so the Slack item shows the ID
  const { updateListCells } = libs.slackApi;
  const COLS_LOCAL = SLACK.columns;
  if (COLS_LOCAL.task_id) {
    updateListCells(SLACK.listId, [{
      row_id: slackItem.id,
      column_id: COLS_LOCAL.task_id,
      rich_text: [{
        type: 'rich_text',
        elements: [{ type: 'rich_text_section', elements: [{ type: 'text', text: taskId }] }],
      }],
    }]).catch(() => {}); // Best-effort
  }

  return taskId;
}

// ─── Delete local task (Slack row was deleted) ────────────────────

/**
 * Delete a task from the local DB after it was removed on Slack.
 * Handles subtasks, log entries, session claims, and sync state.
 * Mirrors the logic in commands/delete.mjs but without Slack API calls.
 */
function deleteLocalTask(db, libs, taskId) {
  const task = libs.trackerDb.findTask(taskId);
  if (!task) return; // Already gone

  // Collect all IDs (parent + subtasks)
  const subtasks = libs.trackerDb.getSubtasks(taskId);
  const allIds = [taskId, ...subtasks.map(s => s['Task ID'])];

  // Drop protective triggers temporarily
  db.exec('DROP TRIGGER IF EXISTS validate_status_transition');
  db.exec('DROP TRIGGER IF EXISTS log_no_delete');
  db.exec('DROP TRIGGER IF EXISTS log_no_update');
  db.exec('DROP TRIGGER IF EXISTS enforce_in_progress_requirements');
  db.exec('DROP TRIGGER IF EXISTS enforce_ready_for_review_requirements');
  db.exec('DROP TRIGGER IF EXISTS update_timestamp');

  try {
    db.exec('BEGIN');
    for (const id of allIds) {
      db.prepare('DELETE FROM slack_row_ids WHERE task_id = ?').run(id);
      db.prepare('DELETE FROM sync_state WHERE task_id = ?').run(id);
      db.prepare('DELETE FROM active_sessions WHERE task_id = ?').run(id);
      db.prepare('DELETE FROM log WHERE task_id = ?').run(id);
    }
    // Delete subtasks first (FK constraint), then parent
    for (const sub of subtasks) {
      db.prepare('DELETE FROM tasks WHERE task_id = ?').run(sub['Task ID']);
    }
    db.prepare('DELETE FROM tasks WHERE task_id = ?').run(taskId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    // Restore all triggers from canonical source
    db.exec(TRIGGERS);
  }
}
