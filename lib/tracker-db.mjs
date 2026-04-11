/**
 * tracker-db.mjs — SQLite-backed task tracker.
 * Replaces tracker-io.mjs. The database enforces all lifecycle rules
 * via CHECK constraints and triggers — the DB can never be in an illegal state.
 *
 * Uses better-sqlite3 (synchronous API, WAL mode for concurrent access).
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Resolve paths via resolve-home.mjs (no circular dep with env.mjs)
import { resolveProjectRoot } from './resolve-home.mjs';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STASK_HOME = resolveProjectRoot();
const STASK_ROOT = path.resolve(__dirname, '..');  // Package install dir
const _configRaw = JSON.parse(fs.readFileSync(path.join(STASK_HOME, 'config.json'), 'utf-8'));
const WORKSPACE_DIR = _configRaw.specsDir;
const TASKS_DIR = STASK_HOME;  // Runtime data lives in .stask/
const DB_PATH = path.join(STASK_HOME, 'tracker.db');

// ─── Schema ─────────────────────────────────────────────────────────

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tasks (
  task_id       TEXT PRIMARY KEY,
  task_name     TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'To-Do'
                CHECK (status IN ('To-Do','In-Progress','Testing',
                       'Ready for Human Review','Blocked','Done')),
  assigned_to   TEXT,
  spec          TEXT NOT NULL,
  qa_report_1   TEXT,
  qa_report_2   TEXT,
  qa_report_3   TEXT,
  type          TEXT NOT NULL DEFAULT 'Task'
                CHECK (type IN ('Feature','Bug','Task','Improvement','Research')),
  parent_id     TEXT REFERENCES tasks(task_id),
  blocker       TEXT,
  worktree      TEXT,
  pr            TEXT,
  qa_fail_count INTEGER NOT NULL DEFAULT 0,
  pr_status     TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id    TEXT NOT NULL,
  message    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

const TRIGGERS = `
-- Prevent log tampering
CREATE TRIGGER IF NOT EXISTS log_no_update BEFORE UPDATE ON log
BEGIN SELECT RAISE(ABORT, 'Log entries are immutable'); END;

CREATE TRIGGER IF NOT EXISTS log_no_delete BEFORE DELETE ON log
BEGIN SELECT RAISE(ABORT, 'Log entries cannot be deleted'); END;

-- Status transition validation
CREATE TRIGGER IF NOT EXISTS validate_status_transition
BEFORE UPDATE OF status ON tasks
WHEN OLD.status != NEW.status
BEGIN
  SELECT CASE
    WHEN OLD.status = 'Done' THEN
      RAISE(ABORT, 'Cannot transition from Done (terminal state)')
    WHEN OLD.status = 'To-Do' AND NEW.status NOT IN ('In-Progress','Blocked') THEN
      RAISE(ABORT, 'To-Do can only transition to In-Progress or Blocked')
    WHEN OLD.status = 'In-Progress' AND NEW.status NOT IN ('Testing','Blocked') THEN
      RAISE(ABORT, 'In-Progress can only transition to Testing or Blocked')
    WHEN OLD.status = 'Testing' AND NEW.status NOT IN ('Ready for Human Review','In-Progress','Blocked') THEN
      RAISE(ABORT, 'Testing can only transition to Ready for Human Review, In-Progress, or Blocked')
    WHEN OLD.status = 'Ready for Human Review' AND NEW.status NOT IN ('Done','In-Progress','Blocked') THEN
      RAISE(ABORT, 'Ready for Human Review can only transition to Done, In-Progress, or Blocked')
    WHEN OLD.status = 'Blocked' AND NEW.status NOT IN ('To-Do','In-Progress','Testing','Ready for Human Review') THEN
      RAISE(ABORT, 'Blocked can transition to To-Do, In-Progress, Testing, or Ready for Human Review')
  END;
END;

-- Worktree required for parent tasks going to In-Progress from To-Do
CREATE TRIGGER IF NOT EXISTS enforce_in_progress_requirements
BEFORE UPDATE OF status ON tasks
WHEN NEW.status = 'In-Progress' AND OLD.status = 'To-Do'
     AND NEW.parent_id IS NULL
BEGIN
  SELECT CASE
    WHEN NEW.worktree IS NULL OR NEW.worktree = '' THEN
      RAISE(ABORT, 'Parent task requires a worktree before moving to In-Progress')
  END;
END;

-- QA report + worktree required for Ready for Human Review (parent tasks only)
CREATE TRIGGER IF NOT EXISTS enforce_ready_for_review_requirements
BEFORE UPDATE OF status ON tasks
WHEN NEW.status = 'Ready for Human Review' AND NEW.parent_id IS NULL
BEGIN
  SELECT CASE
    WHEN NEW.qa_fail_count = 0 AND (NEW.qa_report_1 IS NULL OR NEW.qa_report_1 = '') THEN
      RAISE(ABORT, 'QA Report (attempt 1) required before Ready for Human Review')
    WHEN NEW.qa_fail_count = 1 AND (NEW.qa_report_2 IS NULL OR NEW.qa_report_2 = '') THEN
      RAISE(ABORT, 'QA Report (attempt 2) required before Ready for Human Review')
    WHEN NEW.qa_fail_count = 2 AND (NEW.qa_report_3 IS NULL OR NEW.qa_report_3 = '') THEN
      RAISE(ABORT, 'QA Report (attempt 3) required before Ready for Human Review')
    WHEN NEW.worktree IS NULL OR NEW.worktree = '' THEN
      RAISE(ABORT, 'Worktree required before Ready for Human Review')
    WHEN NEW.pr IS NULL OR NEW.pr = '' THEN
      RAISE(ABORT, 'Draft PR required before Ready for Human Review')
  END;
END;

-- Auto-update timestamp
CREATE TRIGGER IF NOT EXISTS update_timestamp
AFTER UPDATE ON tasks
BEGIN
  UPDATE tasks SET updated_at = datetime('now') WHERE task_id = NEW.task_id;
END;
`;

// ─── Singleton DB ───────────────────────────────────────────────────

let _db = null;

export function getDb() {
  if (_db) return _db;
  const isNew = !fs.existsSync(DB_PATH);
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  if (isNew) {
    _db.exec(SCHEMA);
    _db.exec(TRIGGERS);
  } else {
    // Ensure triggers exist (idempotent)
    _db.exec(TRIGGERS);
    // Migrate: add pr_status column if missing (renamed from review_flag)
    const cols = _db.pragma('table_info(tasks)').map(c => c.name);
    if (!cols.includes('pr_status')) {
      if (cols.includes('review_flag')) {
        _db.exec('ALTER TABLE tasks RENAME COLUMN review_flag TO pr_status');
      } else {
        _db.exec('ALTER TABLE tasks ADD COLUMN pr_status TEXT');
      }
    }

    // Migrate: expand type CHECK constraint to include Improvement, Research
    // SQLite can't alter CHECK constraints, so we recreate the table
    const typeCheck = _db.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='tasks'"
    ).get();
    if (typeCheck?.sql && !typeCheck.sql.includes('Improvement')) {
      _db.exec('PRAGMA foreign_keys = OFF');
      _db.exec(`
        CREATE TABLE tasks_new (
          task_id       TEXT PRIMARY KEY,
          task_name     TEXT NOT NULL,
          status        TEXT NOT NULL DEFAULT 'To-Do'
                        CHECK (status IN ('To-Do','In-Progress','Testing',
                               'Ready for Human Review','Blocked','Done')),
          assigned_to   TEXT,
          spec          TEXT NOT NULL,
          qa_report_1   TEXT,
          qa_report_2   TEXT,
          qa_report_3   TEXT,
          type          TEXT NOT NULL DEFAULT 'Task'
                        CHECK (type IN ('Feature','Bug','Task','Improvement','Research')),
          parent_id     TEXT REFERENCES tasks(task_id),
          blocker       TEXT,
          worktree      TEXT,
          pr            TEXT,
          qa_fail_count INTEGER NOT NULL DEFAULT 0,
          pr_status     TEXT,
          created_at    TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO tasks_new SELECT
          task_id, task_name, status, assigned_to, spec,
          qa_report_1, qa_report_2, qa_report_3, type, parent_id,
          blocker, worktree, pr, qa_fail_count, pr_status,
          COALESCE(created_at, datetime('now')),
          COALESCE(updated_at, datetime('now'))
        FROM tasks;
        DROP TABLE tasks;
        ALTER TABLE tasks_new RENAME TO tasks;
      `);
      _db.exec('PRAGMA foreign_keys = ON');
      // Re-create triggers on the new table
      _db.exec(TRIGGERS);
    }
  }
  return _db;
}

export function closeDb() {
  if (_db) { _db.close(); _db = null; }
}

// ─── Sync state table ──────────────────────────────────────────────

const SYNC_STATE_SQL = `
CREATE TABLE IF NOT EXISTS sync_state (
  task_id       TEXT PRIMARY KEY REFERENCES tasks(task_id),
  last_slack_ts INTEGER NOT NULL DEFAULT 0,
  last_db_ts    TEXT NOT NULL DEFAULT '',
  last_synced   TEXT NOT NULL DEFAULT ''
);
`;

let _syncStateCreated = false;

export function ensureSyncStateTable() {
  if (_syncStateCreated) return;
  const db = getDb();
  db.exec(SYNC_STATE_SQL);
  _syncStateCreated = true;
}

export function getSyncState(taskId) {
  ensureSyncStateTable();
  const db = getDb();
  return db.prepare('SELECT * FROM sync_state WHERE task_id = ?').get(taskId) || null;
}

export function setSyncState(taskId, slackTs, dbTs) {
  ensureSyncStateTable();
  const db = getDb();
  db.prepare(`
    INSERT INTO sync_state (task_id, last_slack_ts, last_db_ts, last_synced)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(task_id) DO UPDATE SET
      last_slack_ts = excluded.last_slack_ts,
      last_db_ts = excluded.last_db_ts,
      last_synced = datetime('now')
  `).run(taskId, slackTs, dbTs);
}

/**
 * Direct field update — bypasses status transition triggers.
 * Used by Slack→DB sync where human authority supersedes the state machine.
 */
export function updateTaskDirect(taskId, fields) {
  const db = getDb();
  // Temporarily disable the status transition trigger for human overrides
  // We do this by updating fields one-by-one, with status handled specially
  if (fields.status) {
    // Drop and recreate the transition trigger temporarily
    db.exec('DROP TRIGGER IF EXISTS validate_status_transition');
    db.exec('DROP TRIGGER IF EXISTS enforce_in_progress_requirements');
    db.exec('DROP TRIGGER IF EXISTS enforce_ready_for_review_requirements');
  }
  try {
    const sets = Object.keys(fields).map(k => `${k} = ?`).join(', ');
    const sql = `UPDATE tasks SET ${sets} WHERE task_id = ?`;
    const result = db.prepare(sql).run(...Object.values(fields), taskId);
    if (result.changes === 0) throw new Error(`Task ${taskId} not found`);
  } finally {
    if (fields.status) {
      // Re-enable triggers (TRIGGERS constant contains CREATE IF NOT EXISTS)
      db.exec(TRIGGERS);
    }
  }
}

// ─── Task CRUD ──────────────────────────────────────────────────────

/**
 * Get all tasks as an array of objects.
 * Keys use the original TRACKER.md column names for backward compatibility
 * with tracker-sync.mjs and other consumers.
 */
export function getAllTasks() {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM tasks ORDER BY task_id').all();
  return rows.map(rowToTask);
}

/**
 * Find a single task by ID. Returns null if not found.
 */
export function findTask(taskId) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM tasks WHERE task_id = ?').get(taskId);
  return row ? rowToTask(row) : null;
}

/**
 * Get all subtasks for a parent task ID.
 */
export function getSubtasks(parentId) {
  const db = getDb();
  return db.prepare('SELECT * FROM tasks WHERE parent_id = ?').all(parentId).map(rowToTask);
}

/**
 * Get the next available top-level task ID (T-NNN).
 */
export function getNextTaskId() {
  const db = getDb();
  const row = db.prepare(`
    SELECT task_id FROM tasks
    WHERE task_id GLOB 'T-[0-9][0-9][0-9]'
    ORDER BY task_id DESC LIMIT 1
  `).get();
  if (!row) return 'T-001';
  const num = parseInt(row.task_id.slice(2), 10);
  return `T-${String(num + 1).padStart(3, '0')}`;
}

/**
 * Get the next subtask ID for a parent (T-NNN.M).
 */
export function getNextSubtaskId(parentId) {
  const db = getDb();
  const row = db.prepare(`
    SELECT task_id FROM tasks
    WHERE parent_id = ?
    ORDER BY task_id DESC LIMIT 1
  `).get(parentId);
  if (!row) return `${parentId}.1`;
  const suffix = row.task_id.split('.').pop();
  return `${parentId}.${parseInt(suffix, 10) + 1}`;
}

/**
 * Insert a new task. Throws on constraint violation.
 */
export function insertTask(fields) {
  const db = getDb();
  const cols = Object.keys(fields);
  const placeholders = cols.map(() => '?').join(', ');
  const sql = `INSERT INTO tasks (${cols.join(', ')}) VALUES (${placeholders})`;
  db.prepare(sql).run(...Object.values(fields));
}

/**
 * Update specific fields on a task. DB triggers enforce rules.
 * Throws if the update violates any constraint.
 */
export function updateTask(taskId, fields) {
  const db = getDb();
  const sets = Object.keys(fields).map(k => `${k} = ?`).join(', ');
  const sql = `UPDATE tasks SET ${sets} WHERE task_id = ?`;
  const result = db.prepare(sql).run(...Object.values(fields), taskId);
  if (result.changes === 0) {
    throw new Error(`Task ${taskId} not found`);
  }
}

/**
 * Get tasks by status.
 */
export function getTasksByStatus(status) {
  const db = getDb();
  return db.prepare('SELECT * FROM tasks WHERE status = ?').all(status).map(rowToTask);
}

/**
 * Get tasks by assignee.
 */
export function getTasksByAssignee(name) {
  const db = getDb();
  return db.prepare('SELECT * FROM tasks WHERE assigned_to = ?').all(name).map(rowToTask);
}

// ─── Log ────────────────────────────────────────────────────────────

/**
 * Add a log entry. Log entries are immutable (triggers prevent update/delete).
 */
export function addLogEntry(taskId, message) {
  const db = getDb();
  db.prepare('INSERT INTO log (task_id, message) VALUES (?, ?)').run(taskId, message);
}

/**
 * Get log entries, newest first.
 */
export function getLog(limit = 100) {
  const db = getDb();
  return db.prepare('SELECT * FROM log ORDER BY id DESC LIMIT ?').all(limit);
}

/**
 * Get log entries for a specific task.
 */
export function getLogForTask(taskId) {
  const db = getDb();
  return db.prepare('SELECT * FROM log WHERE task_id = ? ORDER BY id DESC').all(taskId);
}

/**
 * Count QA failures in the log for a task (for escalation logic).
 */
export function getQaFailCount(taskId) {
  const db = getDb();
  const task = db.prepare('SELECT qa_fail_count FROM tasks WHERE task_id = ?').get(taskId);
  return task ? task.qa_fail_count : 0;
}

// ─── Worktree/PR helpers ────────────────────────────────────────────

/**
 * Get the worktree for a task (or its parent if it's a subtask).
 */
export function getParentWorktree(taskId) {
  const task = findTask(taskId);
  if (!task) return null;

  const wt = parseWorktreeValue(task['Worktree']);
  if (wt) return wt;

  if (task['Parent'] && task['Parent'] !== 'None') {
    const parent = findTask(task['Parent']);
    if (parent) return parseWorktreeValue(parent['Worktree']);
  }
  return null;
}

/**
 * Parse "branch (path)" → { branch, path } or null.
 */
export function parseWorktreeValue(value) {
  if (!value) return null;
  const match = value.match(/^(.+?)\s+\((.+)\)$/);
  if (match) return { branch: match[1].trim(), path: match[2].trim() };
  return null;
}

/**
 * Format branch + path into worktree column value.
 */
export function formatWorktreeValue(branch, worktreePath) {
  return `${branch} (${worktreePath})`;
}

// ─── Internal helpers ───────────────────────────────────────────────

/**
 * Map a SQLite row to a task object with TRACKER.md-compatible keys.
 * This ensures backward compat with tracker-sync.mjs and agent-heartbeat.mjs.
 */
function rowToTask(row) {
  return {
    'Task ID': row.task_id,
    'Task Name': row.task_name,
    'Status': row.status,
    'Assigned To': row.assigned_to || 'None',
    'Spec': row.spec,
    'QA Report 1': row.qa_report_1 || 'None',
    'QA Report 2': row.qa_report_2 || 'None',
    'QA Report 3': row.qa_report_3 || 'None',
    'Type': row.type,
    'Parent': row.parent_id || 'None',
    'Blocker': row.blocker || 'None',
    'Worktree': row.worktree || 'None',
    'PR': row.pr || 'None',
    'PR Status': row.pr_status || '',
    'qa_fail_count': row.qa_fail_count,
    'created_at': row.created_at,
    'updated_at': row.updated_at,
  };
}

export { WORKSPACE_DIR, TASKS_DIR, DB_PATH };
