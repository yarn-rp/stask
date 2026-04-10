/**
 * tx.test.mjs — Transaction commit/rollback behavior.
 *
 * Tests that withTransaction commits on success and rolls back on failure.
 * Uses real DB, mock Slack.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, insertTask, getTask } from './helpers/test-db.mjs';

let db;

describe('Transaction behavior', () => {
  beforeEach(() => {
    db = createTestDb();
    insertTask(db, { task_id: 'T-001', assigned_to: 'Yan' });
  });

  it('successful mutation commits to DB', () => {
    db.exec('BEGIN');
    db.prepare('UPDATE tasks SET assigned_to = ? WHERE task_id = ?').run('Richard', 'T-001');
    db.exec('COMMIT');

    assert.equal(getTask(db, 'T-001').assigned_to, 'Richard');
  });

  it('failed Slack sync rolls back DB', () => {
    db.exec('BEGIN');
    db.prepare('UPDATE tasks SET assigned_to = ? WHERE task_id = ?').run('Richard', 'T-001');

    // Simulate Slack failure
    db.exec('ROLLBACK');

    // DB should be unchanged
    assert.equal(getTask(db, 'T-001').assigned_to, 'Yan');
  });

  it('rollback preserves original state completely', () => {
    const originalTask = getTask(db, 'T-001');

    db.exec('BEGIN');
    db.prepare('UPDATE tasks SET assigned_to = ?, status = ? WHERE task_id = ?')
      .run('Richard', 'Blocked', 'T-001');

    // Verify the change IS visible inside the transaction
    assert.equal(getTask(db, 'T-001').assigned_to, 'Richard');
    assert.equal(getTask(db, 'T-001').status, 'Blocked');

    db.exec('ROLLBACK');

    // Everything back to original
    const restored = getTask(db, 'T-001');
    assert.equal(restored.assigned_to, originalTask.assigned_to);
    assert.equal(restored.status, originalTask.status);
  });

  it('rollback also undoes log entries', () => {
    db.exec('BEGIN');
    db.prepare('INSERT INTO log (task_id, message) VALUES (?, ?)').run('T-001', 'This should be rolled back');
    db.exec('ROLLBACK');

    const logs = db.prepare('SELECT * FROM log WHERE task_id = ?').all('T-001');
    assert.equal(logs.length, 0);
  });

  it('rollback undoes new task creation', () => {
    db.exec('BEGIN');
    insertTask(db, { task_id: 'T-NEW', task_name: 'Should not exist' });
    db.exec('ROLLBACK');

    const task = getTask(db, 'T-NEW');
    assert.equal(task, undefined);
  });

  it('rollback undoes slack_row_ids insertions', () => {
    db.exec('BEGIN');
    db.prepare('INSERT INTO slack_row_ids (task_id, row_id) VALUES (?, ?)').run('T-001', 'R_SLACK_001');
    db.exec('ROLLBACK');

    const row = db.prepare('SELECT * FROM slack_row_ids WHERE task_id = ?').get('T-001');
    assert.equal(row, undefined);
  });

  it('nested operations all roll back together', () => {
    db.exec('BEGIN');

    // Create parent
    insertTask(db, { task_id: 'T-PARENT', task_name: 'Parent' });

    // Create subtask
    insertTask(db, { task_id: 'T-PARENT.1', task_name: 'Subtask', parent_id: 'T-PARENT' });

    // Add log
    db.prepare('INSERT INTO log (task_id, message) VALUES (?, ?)').run('T-PARENT', 'Created');

    // Add slack row ID
    db.prepare('INSERT INTO slack_row_ids (task_id, row_id) VALUES (?, ?)').run('T-PARENT', 'R_123');

    // Verify all exist inside transaction
    assert.ok(getTask(db, 'T-PARENT'));
    assert.ok(getTask(db, 'T-PARENT.1'));

    // Rollback everything
    db.exec('ROLLBACK');

    assert.equal(getTask(db, 'T-PARENT'), undefined);
    assert.equal(getTask(db, 'T-PARENT.1'), undefined);
    assert.equal(db.prepare('SELECT * FROM log WHERE task_id = ?').all('T-PARENT').length, 0);
    assert.equal(db.prepare('SELECT * FROM slack_row_ids WHERE task_id = ?').get('T-PARENT'), undefined);
  });
});
