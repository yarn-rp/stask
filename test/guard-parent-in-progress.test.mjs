/**
 * guard-parent-in-progress.test.mjs — Tests for the requireParentInProgress guard
 * and the scope-aware guard system.
 *
 * Covers AC1–AC7 from the spec:
 *   AC1: Subtask → In-Progress blocked when parent is To-Do
 *   AC2: Subtask → In-Progress succeeds when parent is In-Progress
 *   AC3: Subtask → In-Progress succeeds when parent is Testing or RHR
 *   AC4: Cascade transitions bypass guards (by design — not tested at guard level)
 *   AC5: Slack sync bypasses guards (by design — not tested at guard level)
 *   AC6: Parent-task guards still work unchanged (regression)
 *   AC7: Tests exist (this file)
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, insertTask, getTask, createTaskAtStatus } from './helpers/test-db.mjs';

// ─── Mock libs for guard testing ────────────────────────────────────

/**
 * Build a mock libs object with findTask and getSubtasks backed by
 * an in-memory SQLite DB. This lets us test guard logic without
 * needing the full production tracker-db module.
 */
function buildLibs(db) {
  return {
    trackerDb: {
      findTask(taskId) {
        const row = db.prepare('SELECT * FROM tasks WHERE task_id = ?').get(taskId);
        if (!row) return null;
        return rowToTask(row);
      },
      getSubtasks(parentId) {
        return db.prepare('SELECT * FROM tasks WHERE parent_id = ?').all(parentId).map(rowToTask);
      },
    },
  };
}

function rowToTask(row) {
  return {
    'Task ID': row.task_id,
    'Task Name': row.task_name,
    'Status': row.status,
    'Assigned To': row.assigned_to || 'None',
    'Spec': row.spec || 'None',
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

// ─── Import the guard module ────────────────────────────────────────

// We import runGuards to test scope filtering, and call guard functions
// directly via the module's public API.
import { runGuards } from '../lib/guards.mjs';

// ─── requireParentInProgress guard tests ───────────────────────────

describe('requireParentInProgress guard', () => {
  let db, libs;

  beforeEach(() => {
    db = createTestDb();
    libs = buildLibs(db);
  });

  it('AC1: subtask → In-Progress blocked when parent is To-Do', () => {
    // Create parent at To-Do
    insertTask(db, { task_id: 'T-100', task_name: 'Parent task', status: 'To-Do', parent_id: null });
    // Create subtask at To-Do
    insertTask(db, { task_id: 'T-100.1', task_name: 'Subtask', status: 'To-Do', parent_id: 'T-100' });

    const subtask = libs.trackerDb.findTask('T-100.1');
    const result = runGuards(subtask, 'In-Progress', libs);

    assert.equal(result.ok, false);
    assert.ok(result.failures.some(f => f.name === 'require_parent_in_progress'));
    const failure = result.failures.find(f => f.name === 'require_parent_in_progress');
    assert.match(failure.reason, /not yet In-Progress/);
    assert.match(failure.reason, /current status: To-Do/);
  });

  it('AC1: subtask → In-Progress blocked when parent is Backlog', () => {
    insertTask(db, { task_id: 'T-101', task_name: 'Parent task', status: 'Backlog', parent_id: null, spec: null });
    insertTask(db, { task_id: 'T-101.1', task_name: 'Subtask', status: 'To-Do', parent_id: 'T-101' });

    const subtask = libs.trackerDb.findTask('T-101.1');
    const result = runGuards(subtask, 'In-Progress', libs);

    assert.equal(result.ok, false);
    assert.ok(result.failures.some(f => f.name === 'require_parent_in_progress'));
  });

  it('AC1: subtask → In-Progress blocked when parent is Blocked', () => {
    insertTask(db, { task_id: 'T-102', task_name: 'Parent task', status: 'Blocked', parent_id: null, spec: null });
    insertTask(db, { task_id: 'T-102.1', task_name: 'Subtask', status: 'To-Do', parent_id: 'T-102' });

    const subtask = libs.trackerDb.findTask('T-102.1');
    const result = runGuards(subtask, 'In-Progress', libs);

    assert.equal(result.ok, false);
    assert.ok(result.failures.some(f => f.name === 'require_parent_in_progress'));
  });

  it('AC2: subtask → In-Progress succeeds when parent is In-Progress', () => {
    // Parent at In-Progress (needs worktree for DB trigger)
    insertTask(db, { task_id: 'T-200', task_name: 'Parent task', status: 'To-Do', parent_id: null });
    db.prepare('UPDATE tasks SET status = ?, worktree = ? WHERE task_id = ?')
      .run('In-Progress', 'feature/test (~/wt/test)', 'T-200');

    insertTask(db, { task_id: 'T-200.1', task_name: 'Subtask', status: 'To-Do', parent_id: 'T-200' });

    const subtask = libs.trackerDb.findTask('T-200.1');
    const result = runGuards(subtask, 'In-Progress', libs);

    // The only guard with scope:'any' for In-Progress is require_parent_in_progress
    // It should pass because parent is In-Progress
    assert.ok(result.ok, `Expected guard to pass but got failures: ${JSON.stringify(result.failures)}`);
  });

  it('AC3: subtask → In-Progress succeeds when parent is Testing', () => {
    // Use createTaskAtStatus to bypass transition triggers for setup
    createTaskAtStatus(db, 'T-300', 'Testing');
    insertTask(db, { task_id: 'T-300.1', task_name: 'Subtask', status: 'To-Do', parent_id: 'T-300' });

    const subtask = libs.trackerDb.findTask('T-300.1');
    const result = runGuards(subtask, 'In-Progress', libs);

    assert.ok(result.ok, `Expected guard to pass but got failures: ${JSON.stringify(result.failures)}`);
  });

  it('AC3: subtask → In-Progress succeeds when parent is Ready for Human Review', () => {
    // Use createTaskAtStatus to bypass transition triggers for setup
    createTaskAtStatus(db, 'T-301', 'Ready for Human Review');
    insertTask(db, { task_id: 'T-301.1', task_name: 'Subtask', status: 'To-Do', parent_id: 'T-301' });

    const subtask = libs.trackerDb.findTask('T-301.1');
    const result = runGuards(subtask, 'In-Progress', libs);

    assert.ok(result.ok, `Expected guard to pass but got failures: ${JSON.stringify(result.failures)}`);
  });

  it('edge case: parent task not found → guard fails', () => {
    // Insert parent, then subtask, then delete parent to simulate orphan
    // (Can't insert subtask with non-existent parent due to FK constraint)
    insertTask(db, { task_id: 'T-400', task_name: 'Parent task', status: 'To-Do', parent_id: null });
    insertTask(db, { task_id: 'T-400.1', task_name: 'Subtask', status: 'To-Do', parent_id: 'T-400' });
    // Delete parent, breaking FK reference (disable FK checks temporarily)
    db.exec('PRAGMA foreign_keys = OFF');
    db.prepare('DELETE FROM tasks WHERE task_id = ?').run('T-400');
    db.exec('PRAGMA foreign_keys = ON');

    const subtask = libs.trackerDb.findTask('T-400.1');
    const result = runGuards(subtask, 'In-Progress', libs);

    assert.equal(result.ok, false);
    assert.ok(result.failures.some(f => f.name === 'require_parent_in_progress'));
    const failure = result.failures.find(f => f.name === 'require_parent_in_progress');
    assert.match(failure.reason, /not found/);
  });

  it('parent task → In-Progress: require_parent_in_progress passes (no parent to check)', () => {
    // Parent task has Parent === 'None', so requireParentInProgress returns early
    insertTask(db, { task_id: 'T-500', task_name: 'Parent task', status: 'To-Do', parent_id: null });

    const parent = libs.trackerDb.findTask('T-500');
    // When a parent transitions to In-Progress, all scope:'parent' guards also run
    // requireParentInProgress with scope:'any' should pass for parent tasks
    const result = runGuards(parent, 'In-Progress', libs);

    // Parent task will fail other guards (require_subtasks, require_approved, setup_worktree)
    // but require_parent_in_progress should NOT be in the failures
    const parentGuardFailure = result.failures.find(f => f.name === 'require_parent_in_progress');
    assert.equal(parentGuardFailure, undefined, 'require_parent_in_progress should not block parent tasks');
  });
});

// ─── Scope-aware guard filtering tests ───────────────────────────────

describe('Guard scope filtering (AC6: no regression)', () => {
  let db, libs;

  beforeEach(() => {
    db = createTestDb();
    libs = buildLibs(db);
  });

  it('parent task → In-Progress: all parent-scoped guards run', () => {
    // Parent task at To-Do — will fail require_subtasks (no subtasks)
    insertTask(db, { task_id: 'T-600', task_name: 'Parent task', status: 'To-Do', parent_id: null });

    const parent = libs.trackerDb.findTask('T-600');
    const result = runGuards(parent, 'In-Progress', libs);

    assert.equal(result.ok, false);
    // Should have require_subtasks failure (parent-only guard)
    assert.ok(result.failures.some(f => f.name === 'require_subtasks'));
    // Should also have require_approved failure (parent-only guard)
    assert.ok(result.failures.some(f => f.name === 'require_approved'));
  });

  it('subtask → In-Progress: parent-only guards are skipped, only scope:any guards run', () => {
    // Create parent at In-Progress (so requireParentInProgress passes)
    insertTask(db, { task_id: 'T-700', task_name: 'Parent task', status: 'To-Do', parent_id: null });
    db.prepare('UPDATE tasks SET status = ?, worktree = ? WHERE task_id = ?')
      .run('In-Progress', 'feature/test (~/wt/test)', 'T-700');

    // Create subtask at To-Do
    insertTask(db, { task_id: 'T-700.1', task_name: 'Subtask', status: 'To-Do', parent_id: 'T-700' });

    const subtask = libs.trackerDb.findTask('T-700.1');
    const result = runGuards(subtask, 'In-Progress', libs);

    // Subtask should pass — parent is In-Progress, and parent-only guards are skipped
    assert.ok(result.ok, `Expected subtask to pass In-Progress guards but got: ${JSON.stringify(result.failures)}`);
    // No parent-only guard failures (require_subtasks, require_approved, setup_worktree)
    assert.ok(!result.failures.some(f => f.name === 'require_subtasks'));
    assert.ok(!result.failures.some(f => f.name === 'require_approved'));
    assert.ok(!result.failures.some(f => f.name === 'setup_worktree'));
  });

  it('subtask → Testing: no applicable guards (all are scope:parent) → passes', () => {
    // No scope:'any' guards on Testing — subtask should pass trivially
    insertTask(db, { task_id: 'T-800', task_name: 'Parent task', status: 'To-Do', parent_id: null });
    insertTask(db, { task_id: 'T-800.1', task_name: 'Subtask', status: 'In-Progress', parent_id: 'T-800' });

    const subtask = libs.trackerDb.findTask('T-800.1');
    const result = runGuards(subtask, 'Testing', libs);

    assert.ok(result.ok, 'No applicable guards for subtask → Testing');
    assert.equal(result.failures.length, 0);
  });

  it('subtask → To-Do: no scope:any guards → passes', () => {
    insertTask(db, { task_id: 'T-900', task_name: 'Parent', status: 'Backlog', parent_id: null, spec: null });
    insertTask(db, { task_id: 'T-900.1', task_name: 'Subtask', status: 'Blocked', parent_id: 'T-900' });

    const subtask = libs.trackerDb.findTask('T-900.1');
    const result = runGuards(subtask, 'To-Do', libs);

    assert.ok(result.ok, 'No scope:any guards on To-Do — subtask should pass');
    assert.equal(result.failures.length, 0);
  });
});