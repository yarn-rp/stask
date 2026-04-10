/**
 * transitions.test.mjs — Exhaustive status transition matrix.
 *
 * Tests every valid and invalid transition against the real SQLite triggers.
 * No mocking — uses the exact same schema + triggers as production.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, createTaskAtStatus, updateTask, getTask } from './helpers/test-db.mjs';

let db;

// ─── Valid Transitions ─────────────────────────────────────────────

describe('Valid status transitions', () => {
  beforeEach(() => { db = createTestDb(); });

  // From To-Do
  it('To-Do → In-Progress (subtask, no worktree needed)', () => {
    // Subtasks don't need worktree
    createTaskAtStatus(db, 'T-001', 'To-Do');
    createTaskAtStatus(db, 'T-001.1', 'To-Do', { parent_id: 'T-001' });
    updateTask(db, 'T-001.1', { status: 'In-Progress' });
    assert.equal(getTask(db, 'T-001.1').status, 'In-Progress');
  });

  it('To-Do → In-Progress (parent with worktree)', () => {
    createTaskAtStatus(db, 'T-002', 'To-Do');
    updateTask(db, 'T-002', { status: 'In-Progress', worktree: 'feature/test (~/wt/test)' });
    assert.equal(getTask(db, 'T-002').status, 'In-Progress');
  });

  it('To-Do → Blocked', () => {
    createTaskAtStatus(db, 'T-003', 'To-Do');
    updateTask(db, 'T-003', { status: 'Blocked' });
    assert.equal(getTask(db, 'T-003').status, 'Blocked');
  });

  // From In-Progress
  it('In-Progress → Testing', () => {
    createTaskAtStatus(db, 'T-004', 'In-Progress');
    updateTask(db, 'T-004', { status: 'Testing' });
    assert.equal(getTask(db, 'T-004').status, 'Testing');
  });

  it('In-Progress → Blocked', () => {
    createTaskAtStatus(db, 'T-005', 'In-Progress');
    updateTask(db, 'T-005', { status: 'Blocked' });
    assert.equal(getTask(db, 'T-005').status, 'Blocked');
  });

  // From Testing
  it('Testing → Ready for Human Review (with QA report + worktree + PR)', () => {
    createTaskAtStatus(db, 'T-006', 'Testing');
    updateTask(db, 'T-006', {
      status: 'Ready for Human Review',
      qa_report_1: '(F0QA1)',
      worktree: 'feature/t (~/wt/t)',
      pr: 'https://github.com/x/x/pull/1',
    });
    assert.equal(getTask(db, 'T-006').status, 'Ready for Human Review');
  });

  it('Testing → In-Progress (QA fail)', () => {
    createTaskAtStatus(db, 'T-007', 'Testing');
    updateTask(db, 'T-007', { status: 'In-Progress' });
    assert.equal(getTask(db, 'T-007').status, 'In-Progress');
  });

  it('Testing → Blocked', () => {
    createTaskAtStatus(db, 'T-008', 'Testing');
    updateTask(db, 'T-008', { status: 'Blocked' });
    assert.equal(getTask(db, 'T-008').status, 'Blocked');
  });

  // From Ready for Human Review
  it('Ready for Human Review → Done', () => {
    createTaskAtStatus(db, 'T-009', 'Ready for Human Review');
    updateTask(db, 'T-009', { status: 'Done' });
    assert.equal(getTask(db, 'T-009').status, 'Done');
  });

  it('Ready for Human Review → In-Progress', () => {
    createTaskAtStatus(db, 'T-010', 'Ready for Human Review');
    updateTask(db, 'T-010', { status: 'In-Progress' });
    assert.equal(getTask(db, 'T-010').status, 'In-Progress');
  });

  it('Ready for Human Review → Blocked', () => {
    createTaskAtStatus(db, 'T-011', 'Ready for Human Review');
    updateTask(db, 'T-011', { status: 'Blocked' });
    assert.equal(getTask(db, 'T-011').status, 'Blocked');
  });

  // From Blocked (can go to anything except Done)
  it('Blocked → To-Do', () => {
    createTaskAtStatus(db, 'T-012', 'Blocked');
    updateTask(db, 'T-012', { status: 'To-Do' });
    assert.equal(getTask(db, 'T-012').status, 'To-Do');
  });

  it('Blocked → In-Progress', () => {
    createTaskAtStatus(db, 'T-013', 'Blocked');
    updateTask(db, 'T-013', { status: 'In-Progress' });
    assert.equal(getTask(db, 'T-013').status, 'In-Progress');
  });

  it('Blocked → Testing', () => {
    createTaskAtStatus(db, 'T-014', 'Blocked');
    updateTask(db, 'T-014', { status: 'Testing' });
    assert.equal(getTask(db, 'T-014').status, 'Testing');
  });

  it('Blocked → Ready for Human Review', () => {
    createTaskAtStatus(db, 'T-015', 'Blocked');
    // Need QA report + worktree + PR for RHR trigger
    updateTask(db, 'T-015', {
      status: 'Ready for Human Review',
      qa_report_1: '(F0QA1)',
      worktree: 'feature/t (~/wt/t)',
      pr: 'https://github.com/x/x/pull/1',
    });
    assert.equal(getTask(db, 'T-015').status, 'Ready for Human Review');
  });
});

// ─── Invalid Transitions ───────────────────────────────────────────

describe('Invalid status transitions (must fail)', () => {
  beforeEach(() => { db = createTestDb(); });

  // From To-Do: can only go to In-Progress or Blocked
  // Use a subtask (needs real parent) to avoid worktree requirement
  it('To-Do → Testing (skip)', () => {
    createTaskAtStatus(db, 'T-019', 'To-Do');
    createTaskAtStatus(db, 'T-020', 'To-Do', { parent_id: 'T-019' });
    assert.throws(() => updateTask(db, 'T-020', { status: 'Testing' }), /To-Do can only transition/);
  });

  it('To-Do → Ready for Human Review (skip)', () => {
    createTaskAtStatus(db, 'T-019B', 'To-Do');
    createTaskAtStatus(db, 'T-021', 'To-Do', { parent_id: 'T-019B' });
    assert.throws(() => updateTask(db, 'T-021', { status: 'Ready for Human Review' }), /To-Do can only transition/);
  });

  it('To-Do → Done (skip)', () => {
    createTaskAtStatus(db, 'T-019C', 'To-Do');
    createTaskAtStatus(db, 'T-022', 'To-Do', { parent_id: 'T-019C' });
    assert.throws(() => updateTask(db, 'T-022', { status: 'Done' }), /To-Do can only transition/);
  });

  // From In-Progress: can only go to Testing or Blocked
  it('In-Progress → To-Do (backward)', () => {
    createTaskAtStatus(db, 'T-023', 'In-Progress');
    assert.throws(() => updateTask(db, 'T-023', { status: 'To-Do' }), /In-Progress can only transition/);
  });

  it('In-Progress → Ready for Human Review (skip)', () => {
    createTaskAtStatus(db, 'T-024', 'In-Progress');
    // Transition trigger OR RHR prerequisites trigger will fire — both reject this
    assert.throws(() => updateTask(db, 'T-024', { status: 'Ready for Human Review' }));
  });

  it('In-Progress → Done (skip)', () => {
    createTaskAtStatus(db, 'T-025', 'In-Progress');
    assert.throws(() => updateTask(db, 'T-025', { status: 'Done' }), /In-Progress can only transition/);
  });

  // From Testing: can go to RHR, In-Progress, or Blocked
  it('Testing → To-Do (backward)', () => {
    createTaskAtStatus(db, 'T-026', 'Testing');
    assert.throws(() => updateTask(db, 'T-026', { status: 'To-Do' }), /Testing can only transition/);
  });

  it('Testing → Done (skip)', () => {
    createTaskAtStatus(db, 'T-027', 'Testing');
    assert.throws(() => updateTask(db, 'T-027', { status: 'Done' }), /Testing can only transition/);
  });

  // From Ready for Human Review: can go to Done, In-Progress, or Blocked
  it('Ready for Human Review → To-Do (backward)', () => {
    createTaskAtStatus(db, 'T-028', 'Ready for Human Review');
    assert.throws(() => updateTask(db, 'T-028', { status: 'To-Do' }), /Ready for Human Review can only transition/);
  });

  it('Ready for Human Review → Testing (backward)', () => {
    createTaskAtStatus(db, 'T-029', 'Ready for Human Review');
    assert.throws(() => updateTask(db, 'T-029', { status: 'Testing' }), /Ready for Human Review can only transition/);
  });

  // From Done: terminal — nothing allowed
  it('Done → To-Do', () => {
    createTaskAtStatus(db, 'T-030', 'Done');
    assert.throws(() => updateTask(db, 'T-030', { status: 'To-Do' }), /Cannot transition from Done/);
  });

  it('Done → In-Progress', () => {
    createTaskAtStatus(db, 'T-031', 'Done');
    assert.throws(() => updateTask(db, 'T-031', { status: 'In-Progress' }), /Cannot transition from Done/);
  });

  it('Done → Testing', () => {
    createTaskAtStatus(db, 'T-032', 'Done');
    assert.throws(() => updateTask(db, 'T-032', { status: 'Testing' }), /Cannot transition from Done/);
  });

  it('Done → Ready for Human Review', () => {
    createTaskAtStatus(db, 'T-033', 'Done');
    assert.throws(() => updateTask(db, 'T-033', { status: 'Ready for Human Review' }), /Cannot transition from Done/);
  });

  it('Done → Blocked', () => {
    createTaskAtStatus(db, 'T-034', 'Done');
    assert.throws(() => updateTask(db, 'T-034', { status: 'Blocked' }), /Cannot transition from Done/);
  });

  // From Blocked: can go anywhere except Done
  it('Blocked → Done', () => {
    createTaskAtStatus(db, 'T-035', 'Blocked');
    assert.throws(() => updateTask(db, 'T-035', { status: 'Done' }), /Blocked can transition/);
  });
});

// ─── Prerequisite Enforcement ──────────────────────────────────────

describe('Prerequisite enforcement (triggers)', () => {
  beforeEach(() => { db = createTestDb(); });

  it('Parent task To-Do → In-Progress requires worktree', () => {
    createTaskAtStatus(db, 'T-040', 'To-Do');
    assert.throws(() => updateTask(db, 'T-040', { status: 'In-Progress' }), /worktree/i);
  });

  it('Parent task To-Do → In-Progress succeeds with worktree', () => {
    createTaskAtStatus(db, 'T-041', 'To-Do');
    updateTask(db, 'T-041', { status: 'In-Progress', worktree: 'feature/test (~/wt/test)' });
    assert.equal(getTask(db, 'T-041').status, 'In-Progress');
  });

  it('Subtask To-Do → In-Progress does NOT require worktree', () => {
    createTaskAtStatus(db, 'T-042', 'To-Do');
    createTaskAtStatus(db, 'T-042.1', 'To-Do', { parent_id: 'T-042' });
    updateTask(db, 'T-042.1', { status: 'In-Progress' });
    assert.equal(getTask(db, 'T-042.1').status, 'In-Progress');
  });

  it('Parent Testing → RHR requires QA report', () => {
    createTaskAtStatus(db, 'T-043', 'Testing');
    assert.throws(
      () => updateTask(db, 'T-043', {
        status: 'Ready for Human Review',
        worktree: 'feature/t (~/wt/t)',
        pr: 'https://github.com/x/x/pull/1',
      }),
      /QA Report/i
    );
  });

  it('Parent Testing → RHR requires PR', () => {
    createTaskAtStatus(db, 'T-044', 'Testing');
    assert.throws(
      () => updateTask(db, 'T-044', {
        status: 'Ready for Human Review',
        qa_report_1: '(F0QA1)',
        worktree: 'feature/t (~/wt/t)',
      }),
      /PR required/i
    );
  });

  it('Parent Testing → RHR requires worktree', () => {
    // Create at Testing WITHOUT a worktree (explicit null override)
    createTaskAtStatus(db, 'T-045', 'Testing', { worktree: null });
    // Clear the worktree that createTaskAtStatus may have set
    db.exec('DROP TRIGGER IF EXISTS validate_status_transition');
    db.exec('DROP TRIGGER IF EXISTS enforce_ready_for_review_requirements');
    db.prepare('UPDATE tasks SET worktree = NULL WHERE task_id = ?').run('T-045');
    // Restore triggers
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS validate_status_transition
      BEFORE UPDATE OF status ON tasks WHEN OLD.status != NEW.status
      BEGIN SELECT CASE
        WHEN OLD.status = 'Done' THEN RAISE(ABORT, 'Cannot transition from Done (terminal state)')
        WHEN OLD.status = 'To-Do' AND NEW.status NOT IN ('In-Progress','Blocked') THEN RAISE(ABORT, 'To-Do can only transition to In-Progress or Blocked')
        WHEN OLD.status = 'In-Progress' AND NEW.status NOT IN ('Testing','Blocked') THEN RAISE(ABORT, 'In-Progress can only transition to Testing or Blocked')
        WHEN OLD.status = 'Testing' AND NEW.status NOT IN ('Ready for Human Review','In-Progress','Blocked') THEN RAISE(ABORT, 'Testing can only transition to Ready for Human Review, In-Progress, or Blocked')
        WHEN OLD.status = 'Ready for Human Review' AND NEW.status NOT IN ('Done','In-Progress','Blocked') THEN RAISE(ABORT, 'Ready for Human Review can only transition to Done, In-Progress, or Blocked')
        WHEN OLD.status = 'Blocked' AND NEW.status NOT IN ('To-Do','In-Progress','Testing','Ready for Human Review') THEN RAISE(ABORT, 'Blocked can transition to To-Do, In-Progress, Testing, or Ready for Human Review')
      END; END;
    `);
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS enforce_ready_for_review_requirements
      BEFORE UPDATE OF status ON tasks
      WHEN NEW.status = 'Ready for Human Review' AND NEW.parent_id IS NULL
      BEGIN SELECT CASE
        WHEN NEW.qa_fail_count = 0 AND (NEW.qa_report_1 IS NULL OR NEW.qa_report_1 = '') THEN RAISE(ABORT, 'QA Report (attempt 1) required before Ready for Human Review')
        WHEN NEW.qa_fail_count = 1 AND (NEW.qa_report_2 IS NULL OR NEW.qa_report_2 = '') THEN RAISE(ABORT, 'QA Report (attempt 2) required before Ready for Human Review')
        WHEN NEW.qa_fail_count = 2 AND (NEW.qa_report_3 IS NULL OR NEW.qa_report_3 = '') THEN RAISE(ABORT, 'QA Report (attempt 3) required before Ready for Human Review')
        WHEN NEW.worktree IS NULL OR NEW.worktree = '' THEN RAISE(ABORT, 'Worktree required before Ready for Human Review')
        WHEN NEW.pr IS NULL OR NEW.pr = '' THEN RAISE(ABORT, 'Draft PR required before Ready for Human Review')
      END; END;
    `);
    assert.throws(
      () => updateTask(db, 'T-045', {
        status: 'Ready for Human Review',
        qa_report_1: '(F0QA1)',
        pr: 'https://github.com/x/x/pull/1',
      }),
      /Worktree required/i
    );
  });

  it('2nd QA attempt requires qa_report_2 (not qa_report_1)', () => {
    createTaskAtStatus(db, 'T-046', 'Testing', { qa_fail_count: 1, qa_report_1: '(F0QA1)' });
    assert.throws(
      () => updateTask(db, 'T-046', {
        status: 'Ready for Human Review',
        worktree: 'feature/t (~/wt/t)',
        pr: 'https://github.com/x/x/pull/1',
      }),
      /QA Report.*attempt 2/i
    );
  });

  it('2nd QA attempt succeeds with qa_report_2', () => {
    createTaskAtStatus(db, 'T-047', 'Testing', { qa_fail_count: 1, qa_report_1: '(F0QA1)' });
    updateTask(db, 'T-047', {
      status: 'Ready for Human Review',
      qa_report_2: '(F0QA2)',
      worktree: 'feature/t (~/wt/t)',
      pr: 'https://github.com/x/x/pull/1',
    });
    assert.equal(getTask(db, 'T-047').status, 'Ready for Human Review');
  });
});

// ─── Log Immutability ──────────────────────────────────────────────

describe('Log immutability', () => {
  beforeEach(() => { db = createTestDb(); });

  it('Cannot update log entries', () => {
    db.prepare('INSERT INTO log (task_id, message) VALUES (?, ?)').run('T-050', 'Test entry');
    assert.throws(
      () => db.prepare('UPDATE log SET message = ? WHERE task_id = ?').run('Changed', 'T-050'),
      /immutable/i
    );
  });

  it('Cannot delete log entries', () => {
    db.prepare('INSERT INTO log (task_id, message) VALUES (?, ?)').run('T-051', 'Test entry');
    assert.throws(
      () => db.prepare('DELETE FROM log WHERE task_id = ?').run('T-051'),
      /cannot be deleted/i
    );
  });
});

// ─── Invalid Status Values ─────────────────────────────────────────

describe('Invalid status values (CHECK constraint)', () => {
  beforeEach(() => { db = createTestDb(); });

  it('Cannot insert task with invalid status', () => {
    assert.throws(
      () => db.prepare('INSERT INTO tasks (task_id, task_name, status, spec) VALUES (?, ?, ?, ?)')
        .run('T-060', 'Bad', 'Invalid', 'specs/t.md (F0X)'),
      /CHECK constraint/i
    );
  });

  it('Cannot insert task with invalid type', () => {
    assert.throws(
      () => db.prepare('INSERT INTO tasks (task_id, task_name, type, spec) VALUES (?, ?, ?, ?)')
        .run('T-061', 'Bad', 'Epic', 'specs/t.md (F0X)'),
      /CHECK constraint/i
    );
  });
});
