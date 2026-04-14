/**
 * test-db.mjs — Creates a fresh in-memory SQLite DB with the full
 * tracker.db schema + triggers. No mocking — real schema, real constraints.
 */

import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tasks (
  task_id       TEXT PRIMARY KEY,
  task_name     TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'Backlog'
                CHECK (status IN ('Backlog','To-Do','In-Progress','Testing',
                       'Ready for Human Review','Blocked','Done')),
  assigned_to   TEXT,
  spec          TEXT,
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

CREATE TABLE IF NOT EXISTS active_sessions (
  task_id     TEXT PRIMARY KEY REFERENCES tasks(task_id),
  agent       TEXT NOT NULL,
  session_id  TEXT NOT NULL,
  claimed_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS slack_row_ids (
  task_id  TEXT PRIMARY KEY REFERENCES tasks(task_id),
  row_id   TEXT NOT NULL
);
`;

const TRIGGERS = `
-- Log immutability
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
    WHEN OLD.status = 'Backlog' AND NEW.status NOT IN ('To-Do','Blocked') THEN
      RAISE(ABORT, 'Backlog can only transition to To-Do or Blocked')
    WHEN OLD.status = 'To-Do' AND NEW.status NOT IN ('In-Progress','Blocked') THEN
      RAISE(ABORT, 'To-Do can only transition to In-Progress or Blocked')
    WHEN OLD.status = 'In-Progress' AND NEW.status NOT IN ('Testing','Blocked') THEN
      RAISE(ABORT, 'In-Progress can only transition to Testing or Blocked')
    WHEN OLD.status = 'Testing' AND NEW.status NOT IN ('Ready for Human Review','In-Progress','Blocked') THEN
      RAISE(ABORT, 'Testing can only transition to Ready for Human Review, In-Progress, or Blocked')
    WHEN OLD.status = 'Ready for Human Review' AND NEW.status NOT IN ('Done','In-Progress','Blocked') THEN
      RAISE(ABORT, 'Ready for Human Review can only transition to Done, In-Progress, or Blocked')
    WHEN OLD.status = 'Blocked' AND NEW.status NOT IN ('Backlog','To-Do','In-Progress','Testing','Ready for Human Review') THEN
      RAISE(ABORT, 'Blocked can transition to Backlog, To-Do, In-Progress, Testing, or Ready for Human Review')
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

-- QA report + worktree + PR required for Ready for Human Review (parent tasks only)
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

/**
 * Create a fresh in-memory database with full schema + triggers.
 */
export function createTestDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  db.exec(TRIGGERS);
  return db;
}

/**
 * Insert a task directly (bypasses app-layer validation).
 */
export function insertTask(db, fields) {
  const defaults = {
    task_name: 'Test Task',
    status: 'To-Do',
    assigned_to: 'Yan',
    spec: 'specs/test.md (F0TEST12345)',
    type: 'Feature',
  };
  const merged = { ...defaults, ...fields };
  const cols = Object.keys(merged);
  const placeholders = cols.map(() => '?').join(', ');
  db.prepare(`INSERT INTO tasks (${cols.join(', ')}) VALUES (${placeholders})`)
    .run(...Object.values(merged));
}

/**
 * Get a task by ID.
 */
export function getTask(db, taskId) {
  return db.prepare('SELECT * FROM tasks WHERE task_id = ?').get(taskId);
}

/**
 * Update a task directly.
 */
export function updateTask(db, taskId, fields) {
  const sets = Object.keys(fields).map(k => `${k} = ?`).join(', ');
  db.prepare(`UPDATE tasks SET ${sets} WHERE task_id = ?`)
    .run(...Object.values(fields), taskId);
}

/**
 * Create a parent task at a given status with all required fields.
 * Useful for testing transitions FROM various states.
 */
export function createTaskAtStatus(db, taskId, status, extra = {}) {
  // For Backlog, insert directly with no spec required
  if (status === 'Backlog') {
    const defaults = {
      task_name: 'Test Task',
      status: 'Backlog',
      assigned_to: null,
      type: 'Feature',
    };
    const merged = { task_id: taskId, ...defaults, ...extra };
    const cols = Object.keys(merged);
    const placeholders = cols.map(() => '?').join(', ');
    db.prepare(`INSERT INTO tasks (${cols.join(', ')}) VALUES (${placeholders})`)
      .run(...Object.values(merged));
    return;
  }

  // Start with To-Do, then direct-update to target (bypassing triggers for setup)
  insertTask(db, { task_id: taskId, ...extra });

  if (status === 'To-Do') return;

  // For setup, temporarily drop trigger
  db.exec('DROP TRIGGER IF EXISTS validate_status_transition');
  db.exec('DROP TRIGGER IF EXISTS enforce_in_progress_requirements');
  db.exec('DROP TRIGGER IF EXISTS enforce_ready_for_review_requirements');

  const setupFields = { status };
  if (status === 'In-Progress' || status === 'Testing' || status === 'Ready for Human Review' || status === 'Done') {
    if (!extra.worktree) setupFields.worktree = 'feature/test (~/worktrees/test)';
  }
  if (status === 'Ready for Human Review' || status === 'Done') {
    if (!extra.pr) setupFields.pr = 'https://github.com/test/test/pull/1';
    if (!extra.qa_report_1) setupFields.qa_report_1 = '(F0QAREPORT1)';
  }

  const sets = Object.keys(setupFields).map(k => `${k} = ?`).join(', ');
  db.prepare(`UPDATE tasks SET ${sets} WHERE task_id = ?`)
    .run(...Object.values(setupFields), taskId);

  // Restore triggers
  db.exec(TRIGGERS);
}
