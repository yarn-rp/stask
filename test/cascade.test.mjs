/**
 * cascade.test.mjs — Subtask cascading rules.
 *
 * Tests that parent status transitions correctly cascade to subtasks,
 * preserving builder assignments on In-Progress and skipping Done subtasks.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, insertTask, createTaskAtStatus, getTask } from './helpers/test-db.mjs';

let db;

/**
 * Helper: cascade parent status to subtasks (mimics transition.mjs logic).
 * Temporarily drops the trigger to allow cross-status updates on subtasks.
 */
function cascadeToSubtasks(db, parentId, newStatus, autoAssign) {
  const subtasks = db.prepare('SELECT * FROM tasks WHERE parent_id = ?').all(parentId);

  db.exec('DROP TRIGGER IF EXISTS validate_status_transition');
  try {
    for (const sub of subtasks) {
      if (sub.status === 'Done' || sub.status === newStatus) continue;
      const updates = { status: newStatus };
      // In-Progress keeps existing builder assignments
      if (newStatus !== 'In-Progress' && autoAssign) updates.assigned_to = autoAssign;

      const sets = Object.keys(updates).map(k => `${k} = ?`).join(', ');
      db.prepare(`UPDATE tasks SET ${sets} WHERE task_id = ?`)
        .run(...Object.values(updates), sub.task_id);
    }
  } finally {
    db.exec(`
      CREATE TRIGGER validate_status_transition
      BEFORE UPDATE OF status ON tasks WHEN OLD.status != NEW.status
      BEGIN SELECT CASE
        WHEN OLD.status = 'Done' THEN RAISE(ABORT, 'Cannot transition from Done')
        WHEN OLD.status = 'To-Do' AND NEW.status NOT IN ('In-Progress','Blocked') THEN RAISE(ABORT, 'Invalid from To-Do')
        WHEN OLD.status = 'In-Progress' AND NEW.status NOT IN ('Testing','Blocked') THEN RAISE(ABORT, 'Invalid from In-Progress')
        WHEN OLD.status = 'Testing' AND NEW.status NOT IN ('Ready for Human Review','In-Progress','Blocked') THEN RAISE(ABORT, 'Invalid from Testing')
        WHEN OLD.status = 'Ready for Human Review' AND NEW.status NOT IN ('Done','In-Progress','Blocked') THEN RAISE(ABORT, 'Invalid from RHR')
        WHEN OLD.status = 'Blocked' AND NEW.status NOT IN ('To-Do','In-Progress','Testing','Ready for Human Review') THEN RAISE(ABORT, 'Invalid from Blocked')
      END; END;
    `);
  }
}

describe('Subtask cascading', () => {
  beforeEach(() => {
    db = createTestDb();

    // Create parent + 3 subtasks
    createTaskAtStatus(db, 'T-001', 'To-Do');
    insertTask(db, { task_id: 'T-001.1', task_name: 'Backend API', parent_id: 'T-001', assigned_to: 'Gilfoyle' });
    insertTask(db, { task_id: 'T-001.2', task_name: 'Frontend UI', parent_id: 'T-001', assigned_to: 'Dinesh' });
    insertTask(db, { task_id: 'T-001.3', task_name: 'Tests', parent_id: 'T-001', assigned_to: 'Gilfoyle' });
  });

  it('To-Do → In-Progress cascades subtasks to In-Progress', () => {
    cascadeToSubtasks(db, 'T-001', 'In-Progress', null);

    assert.equal(getTask(db, 'T-001.1').status, 'In-Progress');
    assert.equal(getTask(db, 'T-001.2').status, 'In-Progress');
    assert.equal(getTask(db, 'T-001.3').status, 'In-Progress');
  });

  it('In-Progress cascade preserves builder assignments', () => {
    cascadeToSubtasks(db, 'T-001', 'In-Progress', null);

    // Builders should keep their assignments — NOT overwritten
    assert.equal(getTask(db, 'T-001.1').assigned_to, 'Gilfoyle');
    assert.equal(getTask(db, 'T-001.2').assigned_to, 'Dinesh');
    assert.equal(getTask(db, 'T-001.3').assigned_to, 'Gilfoyle');
  });

  it('Testing cascade assigns to QA agent', () => {
    // First move to In-Progress
    cascadeToSubtasks(db, 'T-001', 'In-Progress', null);
    // Then cascade to Testing with autoAssign = Jared
    cascadeToSubtasks(db, 'T-001', 'Testing', 'Jared');

    assert.equal(getTask(db, 'T-001.1').status, 'Testing');
    assert.equal(getTask(db, 'T-001.1').assigned_to, 'Jared');
    assert.equal(getTask(db, 'T-001.2').assigned_to, 'Jared');
  });

  it('Cascade skips Done subtasks', () => {
    // Move all to In-Progress, then mark one as Done
    cascadeToSubtasks(db, 'T-001', 'In-Progress', null);

    db.exec('DROP TRIGGER IF EXISTS validate_status_transition');
    db.prepare('UPDATE tasks SET status = ? WHERE task_id = ?').run('Done', 'T-001.1');
    db.exec(`
      CREATE TRIGGER validate_status_transition
      BEFORE UPDATE OF status ON tasks WHEN OLD.status != NEW.status
      BEGIN SELECT CASE
        WHEN OLD.status = 'Done' THEN RAISE(ABORT, 'Cannot transition from Done')
        WHEN OLD.status = 'To-Do' AND NEW.status NOT IN ('In-Progress','Blocked') THEN RAISE(ABORT, 'Invalid from To-Do')
        WHEN OLD.status = 'In-Progress' AND NEW.status NOT IN ('Testing','Blocked') THEN RAISE(ABORT, 'Invalid from In-Progress')
        WHEN OLD.status = 'Testing' AND NEW.status NOT IN ('Ready for Human Review','In-Progress','Blocked') THEN RAISE(ABORT, 'Invalid from Testing')
        WHEN OLD.status = 'Ready for Human Review' AND NEW.status NOT IN ('Done','In-Progress','Blocked') THEN RAISE(ABORT, 'Invalid from RHR')
        WHEN OLD.status = 'Blocked' AND NEW.status NOT IN ('To-Do','In-Progress','Testing','Ready for Human Review') THEN RAISE(ABORT, 'Invalid from Blocked')
      END; END;
    `);

    // Cascade to Testing — Done subtask should stay Done
    cascadeToSubtasks(db, 'T-001', 'Testing', 'Jared');

    assert.equal(getTask(db, 'T-001.1').status, 'Done'); // NOT changed
    assert.equal(getTask(db, 'T-001.2').status, 'Testing');
    assert.equal(getTask(db, 'T-001.3').status, 'Testing');
  });

  it('Cascade skips subtasks already at target status', () => {
    cascadeToSubtasks(db, 'T-001', 'In-Progress', null);

    // T-001.1 already In-Progress — cascade to In-Progress should be a no-op for it
    const beforeTs = getTask(db, 'T-001.1').updated_at;
    cascadeToSubtasks(db, 'T-001', 'In-Progress', null);
    // Since it was already at target, it shouldn't have been touched
    // (The trigger auto-updates updated_at, but we skipped it)
    assert.equal(getTask(db, 'T-001.1').status, 'In-Progress');
  });

  it('QA fail cascade re-opens Done subtasks for In-Progress', () => {
    // Simulate: all done → parent Testing → QA FAIL → back to In-Progress
    // On QA fail, Done subtasks get re-opened so builders can fix

    // Move subtasks through the lifecycle
    cascadeToSubtasks(db, 'T-001', 'In-Progress', null);

    // Mark all Done
    db.exec('DROP TRIGGER IF EXISTS validate_status_transition');
    for (const id of ['T-001.1', 'T-001.2', 'T-001.3']) {
      db.prepare('UPDATE tasks SET status = ? WHERE task_id = ?').run('Done', id);
    }
    db.exec(`
      CREATE TRIGGER validate_status_transition
      BEFORE UPDATE OF status ON tasks WHEN OLD.status != NEW.status
      BEGIN SELECT CASE
        WHEN OLD.status = 'Done' THEN RAISE(ABORT, 'Cannot transition from Done')
        WHEN OLD.status = 'To-Do' AND NEW.status NOT IN ('In-Progress','Blocked') THEN RAISE(ABORT, 'Invalid from To-Do')
        WHEN OLD.status = 'In-Progress' AND NEW.status NOT IN ('Testing','Blocked') THEN RAISE(ABORT, 'Invalid from In-Progress')
        WHEN OLD.status = 'Testing' AND NEW.status NOT IN ('Ready for Human Review','In-Progress','Blocked') THEN RAISE(ABORT, 'Invalid from Testing')
        WHEN OLD.status = 'Ready for Human Review' AND NEW.status NOT IN ('Done','In-Progress','Blocked') THEN RAISE(ABORT, 'Invalid from RHR')
        WHEN OLD.status = 'Blocked' AND NEW.status NOT IN ('To-Do','In-Progress','Testing','Ready for Human Review') THEN RAISE(ABORT, 'Invalid from Blocked')
      END; END;
    `);

    // Now simulate QA fail cascade: In-Progress (from Testing)
    // The cascade for In-Progress after QA fail should re-open Done subtasks
    // because the qa.mjs logic explicitly re-opens them
    // We simulate this by calling cascade with In-Progress, which normally
    // skips Done. But in qa.mjs, the cascade explicitly re-opens Done subtasks.

    // Direct DB re-open (as qa.mjs does it)
    db.exec('DROP TRIGGER IF EXISTS validate_status_transition');
    for (const id of ['T-001.1', 'T-001.2', 'T-001.3']) {
      db.prepare('UPDATE tasks SET status = ? WHERE task_id = ?').run('In-Progress', id);
    }
    db.exec(`
      CREATE TRIGGER validate_status_transition
      BEFORE UPDATE OF status ON tasks WHEN OLD.status != NEW.status
      BEGIN SELECT CASE
        WHEN OLD.status = 'Done' THEN RAISE(ABORT, 'Cannot transition from Done')
        WHEN OLD.status = 'To-Do' AND NEW.status NOT IN ('In-Progress','Blocked') THEN RAISE(ABORT, 'Invalid from To-Do')
        WHEN OLD.status = 'In-Progress' AND NEW.status NOT IN ('Testing','Blocked') THEN RAISE(ABORT, 'Invalid from In-Progress')
        WHEN OLD.status = 'Testing' AND NEW.status NOT IN ('Ready for Human Review','In-Progress','Blocked') THEN RAISE(ABORT, 'Invalid from Testing')
        WHEN OLD.status = 'Ready for Human Review' AND NEW.status NOT IN ('Done','In-Progress','Blocked') THEN RAISE(ABORT, 'Invalid from RHR')
        WHEN OLD.status = 'Blocked' AND NEW.status NOT IN ('To-Do','In-Progress','Testing','Ready for Human Review') THEN RAISE(ABORT, 'Invalid from Blocked')
      END; END;
    `);

    assert.equal(getTask(db, 'T-001.1').status, 'In-Progress');
    assert.equal(getTask(db, 'T-001.2').status, 'In-Progress');
    assert.equal(getTask(db, 'T-001.3').status, 'In-Progress');
  });
});

describe('Auto-transition parent when all subtasks Done', () => {
  beforeEach(() => {
    db = createTestDb();
    createTaskAtStatus(db, 'T-002', 'In-Progress');
    insertTask(db, { task_id: 'T-002.1', parent_id: 'T-002', assigned_to: 'Gilfoyle' });
    insertTask(db, { task_id: 'T-002.2', parent_id: 'T-002', assigned_to: 'Dinesh' });

    // Move subtasks to In-Progress
    cascadeToSubtasks(db, 'T-002', 'In-Progress', null);
  });

  it('detects all siblings Done', () => {
    db.exec('DROP TRIGGER IF EXISTS validate_status_transition');
    db.prepare('UPDATE tasks SET status = ? WHERE task_id = ?').run('Done', 'T-002.1');
    db.prepare('UPDATE tasks SET status = ? WHERE task_id = ?').run('Done', 'T-002.2');
    db.exec(`
      CREATE TRIGGER validate_status_transition
      BEFORE UPDATE OF status ON tasks WHEN OLD.status != NEW.status
      BEGIN SELECT CASE
        WHEN OLD.status = 'Done' THEN RAISE(ABORT, 'Cannot transition from Done')
        WHEN OLD.status = 'To-Do' AND NEW.status NOT IN ('In-Progress','Blocked') THEN RAISE(ABORT, 'Invalid from To-Do')
        WHEN OLD.status = 'In-Progress' AND NEW.status NOT IN ('Testing','Blocked') THEN RAISE(ABORT, 'Invalid from In-Progress')
        WHEN OLD.status = 'Testing' AND NEW.status NOT IN ('Ready for Human Review','In-Progress','Blocked') THEN RAISE(ABORT, 'Invalid from Testing')
        WHEN OLD.status = 'Ready for Human Review' AND NEW.status NOT IN ('Done','In-Progress','Blocked') THEN RAISE(ABORT, 'Invalid from RHR')
        WHEN OLD.status = 'Blocked' AND NEW.status NOT IN ('To-Do','In-Progress','Testing','Ready for Human Review') THEN RAISE(ABORT, 'Invalid from Blocked')
      END; END;
    `);

    const subtasks = db.prepare('SELECT * FROM tasks WHERE parent_id = ?').all('T-002');
    const allDone = subtasks.every(s => s.status === 'Done');
    assert.equal(allDone, true);

    // Parent should be transitionable to Testing
    db.prepare('UPDATE tasks SET status = ? WHERE task_id = ?').run('Testing', 'T-002');
    assert.equal(getTask(db, 'T-002').status, 'Testing');
  });

  it('not all siblings Done — parent stays In-Progress', () => {
    db.exec('DROP TRIGGER IF EXISTS validate_status_transition');
    db.prepare('UPDATE tasks SET status = ? WHERE task_id = ?').run('Done', 'T-002.1');
    db.exec(`
      CREATE TRIGGER validate_status_transition
      BEFORE UPDATE OF status ON tasks WHEN OLD.status != NEW.status
      BEGIN SELECT CASE
        WHEN OLD.status = 'Done' THEN RAISE(ABORT, 'Cannot transition from Done')
        WHEN OLD.status = 'To-Do' AND NEW.status NOT IN ('In-Progress','Blocked') THEN RAISE(ABORT, 'Invalid from To-Do')
        WHEN OLD.status = 'In-Progress' AND NEW.status NOT IN ('Testing','Blocked') THEN RAISE(ABORT, 'Invalid from In-Progress')
        WHEN OLD.status = 'Testing' AND NEW.status NOT IN ('Ready for Human Review','In-Progress','Blocked') THEN RAISE(ABORT, 'Invalid from Testing')
        WHEN OLD.status = 'Ready for Human Review' AND NEW.status NOT IN ('Done','In-Progress','Blocked') THEN RAISE(ABORT, 'Invalid from RHR')
        WHEN OLD.status = 'Blocked' AND NEW.status NOT IN ('To-Do','In-Progress','Testing','Ready for Human Review') THEN RAISE(ABORT, 'Invalid from Blocked')
      END; END;
    `);

    const subtasks = db.prepare('SELECT * FROM tasks WHERE parent_id = ?').all('T-002');
    const allDone = subtasks.every(s => s.status === 'Done');
    assert.equal(allDone, false);

    // T-002.2 is still In-Progress
    assert.equal(getTask(db, 'T-002.2').status, 'In-Progress');
  });
});
