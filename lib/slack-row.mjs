/**
 * slack-row.mjs — Targeted per-row Slack List sync.
 *
 * All Slack column IDs, select option IDs, and user IDs come from config.json.
 * Row ID mappings are cached in the slack_row_ids table in tracker.db.
 */

import { CONFIG, getWorkspaceLibs } from './env.mjs';
import { getSlackUserId } from './roles.mjs';
import * as trackerDb from './tracker-db.mjs';

const SLACK = CONFIG.slack;
const COLS = SLACK.columns;

// ─── Ensure slack_row_ids table ────────────────────────────────────

const ROW_IDS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS slack_row_ids (
  task_id  TEXT PRIMARY KEY REFERENCES tasks(task_id),
  row_id   TEXT NOT NULL
);
`;

let _rowTableCreated = false;

function ensureRowIdsTable(db) {
  if (_rowTableCreated) return;
  db.exec(ROW_IDS_TABLE_SQL);
  // Migrate: add thread tracking columns (no-op if already present)
  try { db.exec('ALTER TABLE slack_row_ids ADD COLUMN channel_id TEXT'); } catch {}
  try { db.exec('ALTER TABLE slack_row_ids ADD COLUMN thread_ts TEXT'); } catch {}
  _rowTableCreated = true;
}

// ─── Local row ID cache ────────────────────────────────────────────

export function getSlackRowId(db, taskId) {
  ensureRowIdsTable(db);
  const row = db.prepare('SELECT row_id FROM slack_row_ids WHERE task_id = ?').get(taskId);
  return row?.row_id || null;
}

export function setSlackRowId(db, taskId, rowId) {
  ensureRowIdsTable(db);
  db.prepare(`
    INSERT INTO slack_row_ids (task_id, row_id) VALUES (?, ?)
    ON CONFLICT(task_id) DO UPDATE SET row_id = excluded.row_id
  `).run(taskId, rowId);
}

export function getThreadRef(db, taskId) {
  ensureRowIdsTable(db);
  const row = db.prepare('SELECT channel_id, thread_ts FROM slack_row_ids WHERE task_id = ?').get(taskId);
  if (!row?.channel_id || !row?.thread_ts) return null;
  return { channelId: row.channel_id, threadTs: row.thread_ts };
}

export function setThreadRef(db, taskId, channelId, threadTs) {
  ensureRowIdsTable(db);
  db.prepare('UPDATE slack_row_ids SET channel_id = ?, thread_ts = ? WHERE task_id = ?')
    .run(channelId, threadTs, taskId);
}

// ─── Cell formatting (config-driven) ───────────────────────────────

function formatCell(fieldName, value, columnId, taskRow) {
  if (!value || value === 'N/A' || value === 'None' || String(value).trim() === '') return null;
  const v = String(value).trim();

  // Status → select
  if (fieldName === 'Status') {
    const optId = SLACK.statusOptions[v];
    if (optId) return { column_id: columnId, select: [optId] };
    return null;
  }

  // Type → select
  if (fieldName === 'Type') {
    const optId = SLACK.typeOptions?.[v];
    if (optId) return { column_id: columnId, select: [optId] };
    return null;
  }

  // Assigned To → user (respects DB value, no status override)
  if (fieldName === 'Assigned To') {
    const userId = getSlackUserId(v);
    if (userId) return { column_id: columnId, user: [userId] };
    return null;
  }

  // Spec → attachment
  if (fieldName === 'Spec') {
    if (v === 'TBD') return null;
    const m = v.match(/^(.+?)\s*\((\w+)\)$/);
    const fileId = m ? m[2] : null;
    if (!fileId) return null;
    return { column_id: columnId, attachment: [fileId] };
  }

  // QA Reports → attachment(s)
  if (fieldName.startsWith('QA Report')) {
    const ids = [...v.matchAll(/\((\w+)\)/g)].map(m => m[1]);
    if (ids.length === 0) return null;
    return { column_id: columnId, attachment: ids };
  }

  // PR → link
  if (fieldName === 'PR') {
    return { column_id: columnId, link: [{ original_url: v }] };
  }

  // PR Status → attachment (pr-status/{taskId}.md with file ID)
  if (fieldName === 'PR Status') {
    const m = v.match(/^(.+?)\s*\((\w+)\)$/);
    const fileId = m ? m[2] : null;
    if (!fileId) return null;
    return { column_id: columnId, attachment: [fileId] };
  }

  // Default → rich_text
  return {
    column_id: columnId,
    rich_text: [{
      type: 'rich_text',
      elements: [{ type: 'rich_text_section', elements: [{ type: 'text', text: v }] }],
    }],
  };
}

/**
 * Build cell array for a task row.
 * Returns { coreCells, attachmentCells, allCells }.
 */
function buildCells(taskRow) {
  const FIELD_MAP = {
    'Task ID':     COLS.task_id,
    'Task Name':   COLS.name,
    'Status':      COLS.status,
    'Assigned To': COLS.assignee,
    'Spec':        COLS.spec,
    'QA Report 1': COLS.qa_report_1,
    'QA Report 2': COLS.qa_report_2,
    'QA Report 3': COLS.qa_report_3,
    'Type':        COLS.type,
    'Worktree':    COLS.worktree,
    'PR':          COLS.pr,
    'PR Status':   COLS.pr_status,
  };

  const allCells = [];
  for (const [field, colId] of Object.entries(FIELD_MAP)) {
    if (!colId) continue;
    const cell = formatCell(field, taskRow[field], colId, taskRow);
    if (cell) allCells.push(cell);
  }

  // Checkbox for Done status
  allCells.push({ column_id: COLS.completed, checkbox: taskRow['Status'] === 'Done' });

  return {
    allCells,
    coreCells: allCells.filter(c => !c.attachment),
    attachmentCells: allCells.filter(c => c.attachment),
  };
}

// ─── Thread discovery (shared by all creation paths) ───────────────

/**
 * Find the list-item's comment thread ts in the list's internal channel.
 * Slack's conversations.history can lag tens of seconds behind item
 * creation, so we poll for ~30s before giving up. Returns null on timeout.
 */
async function discoverListItemThread(slackApi, listChannelId, itemDateCreated) {
  const epoch = String(itemDateCreated);
  const oldest = String(itemDateCreated - 2);
  const latest = String(itemDateCreated + 10);

  for (let attempt = 0; attempt < 15; attempt++) {
    const result = await slackApi.getChannelHistory(listChannelId, { oldest, latest, limit: 10 });
    const messages = result.messages || [];
    const match = messages.find(m => m.ts && m.ts.startsWith(epoch + '.'));
    if (match) return match.ts;
    await new Promise(r => setTimeout(r, 2000));
  }
  return null;
}

/**
 * Post the seed comment into a newly-created task's thread and persist
 * the ref in slack_row_ids. Throws on any failure — thread linkage is
 * a hard requirement for usable tasks.
 */
async function linkTaskThread(db, taskRow, rowId, { overview = null } = {}) {
  const libs = await getWorkspaceLibs();
  const taskId = taskRow['Task ID'];
  const name = taskRow['Task Name'] || taskId;
  const listId = SLACK.listId;
  const listChannelId = listId.replace(/^F/, 'C');

  const itemInfo = await libs.slackApi.slackApiRequest('POST', '/slackLists.items.info', {
    list_id: listId, id: rowId,
  });
  const dateCreated = itemInfo.record?.date_created;
  if (!dateCreated) {
    throw new Error(`${taskId}: slackLists.items.info returned no date_created`);
  }

  const threadTs = await discoverListItemThread(libs.slackApi, listChannelId, dateCreated);
  if (!threadTs) {
    throw new Error(`${taskId}: list-item thread not visible in ${listChannelId} history after ~30s`);
  }

  const msg = overview
    ? `*${taskId}: ${name}*\n\n${overview}`
    : `*${taskId}: ${name}* — Created in ${taskRow['Status'] || 'Backlog'}. Requirements discussion starts here.`;
  await libs.slackApi.postMessage(listChannelId, msg, { threadTs });
  setThreadRef(db, taskId, listChannelId, threadTs);

  return { channelId: listChannelId, threadTs };
}

// ─── Public sync operations ────────────────────────────────────────

/**
 * Sync a task row to Slack: create if new, update if existing.
 * Uses slack_row_ids table for fast lookup (no full list scan).
 *
 * On the *create* path, also discovers and persists the list-item's
 * comment thread (seeding it with a starter message). This is NOT
 * best-effort — if thread linkage fails, the function throws so every
 * creation path (CLI create, subtask-create, inbox actions) fails hard
 * and consistently.
 *
 * @param {Object} db - SQLite database handle
 * @param {Object} taskRow - Task object (from tracker-db rowToTask)
 * @param {string|null} parentSlackRowId - Parent Slack row ID (for subtasks)
 * @param {Object} [opts]
 * @param {string|null} [opts.overview] - Custom seed message body for the thread.
 * @returns {{ action, rowId, slackOps[], thread? }}
 */
export async function syncTaskToSlack(db, taskRow, parentSlackRowId = null, { overview = null } = {}) {
  const libs = await getWorkspaceLibs();
  const { createListRow, updateListCells } = libs.slackApi;
  const listId = SLACK.listId;
  const { coreCells, attachmentCells } = buildCells(taskRow);
  const slackOps = [];

  const existingRowId = getSlackRowId(db, taskRow['Task ID']);

  if (existingRowId) {
    // Update existing row
    const coreWithRow = coreCells.map(c => ({ row_id: existingRowId, ...c }));
    const attachWithRow = attachmentCells.map(c => ({ row_id: existingRowId, ...c }));

    if (coreWithRow.length > 0) {
      await updateListCells(listId, coreWithRow);
      slackOps.push({ type: 'update', rowId: existingRowId, cells: coreWithRow });
    }
    for (const cell of attachWithRow) {
      await updateListCells(listId, [cell]);
      slackOps.push({ type: 'update', rowId: existingRowId, cells: [cell] });
    }
    // Record sync state: mark current time as Slack ts to prevent pull-back
    recordSyncState(taskRow);
    return { action: 'updated', rowId: existingRowId, slackOps };
  }

  // Create new row
  const result = await createListRow(listId, coreCells, parentSlackRowId);
  const rowId = result.item?.id;
  if (!rowId) throw new Error(`Slack createListRow returned no item ID for ${taskRow['Task ID']}`);

  slackOps.push({ type: 'create', rowId });
  setSlackRowId(db, taskRow['Task ID'], rowId);

  // Attachments require separate update after create
  if (attachmentCells.length > 0) {
    for (const cell of attachmentCells) {
      await updateListCells(listId, [{ row_id: rowId, ...cell }]);
      slackOps.push({ type: 'update', rowId, cells: [{ row_id: rowId, ...cell }] });
    }
  }

  // Thread linkage — hard requirement, not best-effort. On failure the
  // task row exists in the DB + Slack list (idempotently re-syncable),
  // but the create operation reports failure so callers see it.
  //
  // Only top-level tasks get their own thread. Subtask discussions live
  // in the parent task's thread — that's Slack Lists' native model — so
  // don't try to discover or seed a thread for subtasks. postThreadUpdate
  // callers (transition, subtask-create) already route subtask events to
  // the parent's thread via getThreadRef(parentId).
  let thread = null;
  if (!parentSlackRowId) {
    thread = await linkTaskThread(db, taskRow, rowId, { overview });
  }

  // Record sync state for new rows too
  recordSyncState(taskRow);
  return { action: 'created', rowId, slackOps, thread };
}

/**
 * Sync a subtask row to Slack. Resolves parent row ID from slack_row_ids.
 */
export async function syncSubtaskToSlack(db, subtaskRow) {
  const parentId = subtaskRow['Parent'];
  if (!parentId || parentId === 'None') {
    throw new Error(`Subtask ${subtaskRow['Task ID']} has no parent`);
  }

  let parentRowId = getSlackRowId(db, parentId);
  if (!parentRowId) {
    // Try syncing the parent first before giving up
    const parentTask = trackerDb.findTask(parentId);
    if (parentTask) {
      console.error(`Parent ${parentId} has no Slack row ID. Syncing parent first...`);
      await syncTaskToSlack(db, parentTask);
      parentRowId = getSlackRowId(db, parentId);
    }
    if (!parentRowId) {
      throw new Error(`Parent ${parentId} has no Slack row ID even after sync attempt. Cannot create subtask ${subtaskRow['Task ID']}.`);
    }
  }

  return syncTaskToSlack(db, subtaskRow, parentRowId);
}

/**
 * Record sync state after pushing to Slack.
 * Uses current Unix time as Slack timestamp (approximation — the actual
 * Slack updated_timestamp will be >= this value, so the daemon won't
 * see it as a Slack-side change).
 */
function recordSyncState(taskRow) {
  try {
    const nowUnix = Math.floor(Date.now() / 1000);
    const dbTs = taskRow['updated_at'] || new Date().toISOString().replace('T', ' ').slice(0, 19);
    trackerDb.setSyncState(taskRow['Task ID'], nowUnix, dbTs);
  } catch (_err) {
    // Non-fatal — sync daemon will handle on next cycle
  }
}

/**
 * Delete a Slack row by task ID.
 */
export async function deleteSlackRow(db, taskId) {
  const libs = await getWorkspaceLibs();
  const { deleteListRow } = libs.slackApi;
  const listId = SLACK.listId;

  const rowId = getSlackRowId(db, taskId);
  if (!rowId) return { action: 'noop', slackOps: [] };

  await deleteListRow(listId, rowId);
  db.prepare('DELETE FROM slack_row_ids WHERE task_id = ?').run(taskId);
  return { action: 'deleted', rowId, slackOps: [{ type: 'delete', rowId }] };
}
