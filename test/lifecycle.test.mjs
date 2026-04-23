/**
 * lifecycle.test.mjs — Full task lifecycle end-to-end.
 *
 * Simulates the complete flow: create → approve → delegate → build → QA → done.
 * Uses real DB with triggers, no Slack calls.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, insertTask, getTask, updateTask, createTaskAtStatus } from './helpers/test-db.mjs';
import { runGuards } from '../lib/guards.mjs';

let db;

describe('Full task lifecycle', () => {
  beforeEach(() => { db = createTestDb(); });

  it('Create → To-Do, assigned to human', () => {
    insertTask(db, {
      task_id: 'T-001',
      task_name: 'Build login page',
      status: 'To-Do',
      assigned_to: 'Yan',
      spec: 'specs/login.md (F0LOGIN123)',
      type: 'Feature',
    });

    const task = getTask(db, 'T-001');
    assert.equal(task.status, 'To-Do');
    assert.equal(task.assigned_to, 'Yan');
    assert.equal(task.spec, 'specs/login.md (F0LOGIN123)');
    assert.equal(task.type, 'Feature');
  });

  it('Approve → stays To-Do, assigned to lead', () => {
    insertTask(db, { task_id: 'T-001', assigned_to: 'Yan' });

    updateTask(db, 'T-001', { assigned_to: 'Richard' });
    const task = getTask(db, 'T-001');
    assert.equal(task.status, 'To-Do');
    assert.equal(task.assigned_to, 'Richard');
  });

  it('Subtask creation → child inherits spec', () => {
    insertTask(db, { task_id: 'T-001', spec: 'specs/login.md (F0LOGIN123)' });

    insertTask(db, {
      task_id: 'T-001.1',
      task_name: 'Build API endpoint',
      parent_id: 'T-001',
      assigned_to: 'Gilfoyle',
      spec: 'specs/login.md (F0LOGIN123)', // inherits from parent
    });

    const sub = getTask(db, 'T-001.1');
    assert.equal(sub.parent_id, 'T-001');
    assert.equal(sub.spec, 'specs/login.md (F0LOGIN123)');
    assert.equal(sub.assigned_to, 'Gilfoyle');
  });

  it('Parent To-Do → In-Progress requires worktree', () => {
    insertTask(db, { task_id: 'T-001' });

    assert.throws(
      () => updateTask(db, 'T-001', { status: 'In-Progress' }),
      /worktree/i
    );

    // With worktree
    updateTask(db, 'T-001', { status: 'In-Progress', worktree: 'feature/login (~/wt/login)' });
    assert.equal(getTask(db, 'T-001').status, 'In-Progress');
  });

  it('In-Progress → Testing', () => {
    createTaskAtStatus(db, 'T-001', 'In-Progress');
    updateTask(db, 'T-001', { status: 'Testing' });
    assert.equal(getTask(db, 'T-001').status, 'Testing');
  });

  it('QA PASS → Ready for Human Review (with all prerequisites)', () => {
    createTaskAtStatus(db, 'T-001', 'Testing');
    updateTask(db, 'T-001', {
      status: 'Ready for Human Review',
      qa_report_1: '(F0REPORT1)',
      worktree: 'feature/login (~/wt/login)',
      pr: 'https://github.com/test/repo/pull/42',
      assigned_to: 'Yan',
    });

    const task = getTask(db, 'T-001');
    assert.equal(task.status, 'Ready for Human Review');
    assert.equal(task.assigned_to, 'Yan');
    assert.equal(task.qa_report_1, '(F0REPORT1)');
    assert.equal(task.pr, 'https://github.com/test/repo/pull/42');
  });

  it('QA FAIL → back to In-Progress, fail count incremented', () => {
    createTaskAtStatus(db, 'T-001', 'Testing');

    updateTask(db, 'T-001', {
      status: 'In-Progress',
      qa_report_1: '(F0REPORT1)',
      qa_fail_count: 1,
      assigned_to: 'Richard',
    });

    const task = getTask(db, 'T-001');
    assert.equal(task.status, 'In-Progress');
    assert.equal(task.qa_fail_count, 1);
    assert.equal(task.assigned_to, 'Richard');
  });

  it('QA FAIL x3 → Blocked, escalated to human', () => {
    createTaskAtStatus(db, 'T-001', 'Testing', { qa_fail_count: 2, qa_report_1: '(F0R1)', qa_report_2: '(F0R2)' });

    updateTask(db, 'T-001', {
      status: 'Blocked',
      qa_report_3: '(F0R3)',
      qa_fail_count: 3,
      assigned_to: 'Yan',
    });

    const task = getTask(db, 'T-001');
    assert.equal(task.status, 'Blocked');
    assert.equal(task.qa_fail_count, 3);
    assert.equal(task.assigned_to, 'Yan');
  });

  it('Ready for Human Review → Done (PR merged)', () => {
    createTaskAtStatus(db, 'T-001', 'Ready for Human Review');
    updateTask(db, 'T-001', { status: 'Done' });
    assert.equal(getTask(db, 'T-001').status, 'Done');
  });

  it('Done is terminal — no further transitions', () => {
    createTaskAtStatus(db, 'T-001', 'Done');
    assert.throws(() => updateTask(db, 'T-001', { status: 'To-Do' }), /Cannot transition from Done/);
    assert.throws(() => updateTask(db, 'T-001', { status: 'In-Progress' }), /Cannot transition from Done/);
    assert.throws(() => updateTask(db, 'T-001', { status: 'Testing' }), /Cannot transition from Done/);
    assert.throws(() => updateTask(db, 'T-001', { status: 'Ready for Human Review' }), /Cannot transition from Done/);
    assert.throws(() => updateTask(db, 'T-001', { status: 'Blocked' }), /Cannot transition from Done/);
  });
});

describe('Full lifecycle walkthrough (single task)', () => {
  it('complete happy path: create → approve → build → QA PASS → merge → done', () => {
    db = createTestDb();

    // 1. Create
    insertTask(db, {
      task_id: 'T-100',
      task_name: 'Add user profiles',
      assigned_to: 'Yan',
      spec: 'specs/profiles.md (F0PROF123)',
    });
    assert.equal(getTask(db, 'T-100').status, 'To-Do');

    // 2. Approve
    updateTask(db, 'T-100', { assigned_to: 'Richard' });
    assert.equal(getTask(db, 'T-100').assigned_to, 'Richard');

    // 3. Create subtasks
    insertTask(db, { task_id: 'T-100.1', task_name: 'API', parent_id: 'T-100', assigned_to: 'Gilfoyle', spec: 'specs/profiles.md (F0PROF123)' });
    insertTask(db, { task_id: 'T-100.2', task_name: 'UI', parent_id: 'T-100', assigned_to: 'Dinesh', spec: 'specs/profiles.md (F0PROF123)' });

    // 4. Transition parent to In-Progress (with worktree)
    updateTask(db, 'T-100', { status: 'In-Progress', worktree: 'feature/profiles (~/wt/profiles)' });
    assert.equal(getTask(db, 'T-100').status, 'In-Progress');

    // 5. Cascade subtasks to In-Progress
    db.exec('DROP TRIGGER IF EXISTS validate_status_transition');
    db.prepare('UPDATE tasks SET status = ? WHERE task_id = ?').run('In-Progress', 'T-100.1');
    db.prepare('UPDATE tasks SET status = ? WHERE task_id = ?').run('In-Progress', 'T-100.2');

    // 6. Builder marks subtasks Done
    db.prepare('UPDATE tasks SET status = ? WHERE task_id = ?').run('Done', 'T-100.1');
    db.prepare('UPDATE tasks SET status = ? WHERE task_id = ?').run('Done', 'T-100.2');
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

    // All subtasks done → transition parent to Testing
    const subs = db.prepare('SELECT * FROM tasks WHERE parent_id = ?').all('T-100');
    assert.ok(subs.every(s => s.status === 'Done'));

    updateTask(db, 'T-100', { status: 'Testing', assigned_to: 'Jared' });
    assert.equal(getTask(db, 'T-100').status, 'Testing');

    // 7. QA PASS → RHR
    updateTask(db, 'T-100', {
      status: 'Ready for Human Review',
      qa_report_1: '(F0QAREPORT)',
      pr: 'https://github.com/test/repo/pull/99',
      assigned_to: 'Yan',
    });
    assert.equal(getTask(db, 'T-100').status, 'Ready for Human Review');

    // 8. Human merges PR → Done
    updateTask(db, 'T-100', { status: 'Done' });
    assert.equal(getTask(db, 'T-100').status, 'Done');
  });

  it('sad path: create → approve → build → QA FAIL → fix → QA FAIL → fix → QA FAIL → Blocked', () => {
    db = createTestDb();

    insertTask(db, { task_id: 'T-200', assigned_to: 'Yan', spec: 'specs/bugfix.md (F0BUG123)', type: 'Bug' });
    updateTask(db, 'T-200', { assigned_to: 'Richard' });

    // In-Progress with worktree
    updateTask(db, 'T-200', { status: 'In-Progress', worktree: 'fix/bug (~/wt/bug)' });

    // Testing
    updateTask(db, 'T-200', { status: 'Testing', assigned_to: 'Jared' });

    // QA FAIL #1
    updateTask(db, 'T-200', { status: 'In-Progress', qa_report_1: '(F0QA1)', qa_fail_count: 1, assigned_to: 'Richard' });

    // Fix and resubmit to Testing
    updateTask(db, 'T-200', { status: 'Testing', assigned_to: 'Jared' });

    // QA FAIL #2
    updateTask(db, 'T-200', { status: 'In-Progress', qa_report_2: '(F0QA2)', qa_fail_count: 2, assigned_to: 'Richard' });

    // Fix and resubmit to Testing
    updateTask(db, 'T-200', { status: 'Testing', assigned_to: 'Jared' });

    // QA FAIL #3 → Blocked
    updateTask(db, 'T-200', { status: 'Blocked', qa_report_3: '(F0QA3)', qa_fail_count: 3, assigned_to: 'Yan' });

    const task = getTask(db, 'T-200');
    assert.equal(task.status, 'Blocked');
    assert.equal(task.qa_fail_count, 3);
    assert.equal(task.assigned_to, 'Yan');
    assert.equal(task.qa_report_1, '(F0QA1)');
    assert.equal(task.qa_report_2, '(F0QA2)');
    assert.equal(task.qa_report_3, '(F0QA3)');
  });
});

// ─── Guard tests (application-layer enforcement) ──────────────────

/**
 * Helper: build a task object in the shape guards expect.
 * Guards read task['Task ID'], task['Status'], task['Assigned To'], task['Parent'], etc.
 */
function makeTask(overrides = {}) {
  return {
    'Task ID': 'T-500',
    'Task Name': 'Test Task',
    'Status': 'To-Do',
    'Assigned To': 'Richard',
    'Spec': 'specs/test.md (F0TEST)',
    'Parent': 'None',
    'Worktree': 'None',
    'PR': 'None',
    ...overrides,
  };
}

/**
 * Helper: build a mock libs object with trackerDb.getSubtasks.
 */
function makeMockLibs(subtasks = []) {
  return {
    trackerDb: {
      getSubtasks: () => subtasks,
      findTask: (id) => null,
    },
  };
}

describe('Guard: require_subtasks', () => {
  it('fails when parent has zero subtasks', () => {
    const task = makeTask();
    const libs = makeMockLibs([]);
    const result = runGuards(task, 'In-Progress', libs);
    assert.equal(result.ok, false);
    assert.ok(result.failures.some(f => f.name === 'require_subtasks'));
    assert.ok(result.failures.some(f => f.reason.includes('subtask')));
  });

  it('fails when subtasks exist but some are unassigned', () => {
    const task = makeTask();
    const subtasks = [
      { 'Task ID': 'T-500.1', 'Status': 'To-Do', 'Assigned To': 'Gilfoyle' },
      { 'Task ID': 'T-500.2', 'Status': 'To-Do', 'Assigned To': null },
    ];
    const libs = makeMockLibs(subtasks);
    const result = runGuards(task, 'In-Progress', libs);
    assert.equal(result.ok, false);
    assert.ok(result.failures.some(f => f.name === 'require_subtasks'));
    assert.ok(result.failures.some(f => f.reason.includes('T-500.2')));
  });

  it('fails when subtask assigned_to is "None"', () => {
    const task = makeTask();
    const subtasks = [
      { 'Task ID': 'T-500.1', 'Status': 'To-Do', 'Assigned To': 'None' },
    ];
    const libs = makeMockLibs(subtasks);
    const result = runGuards(task, 'In-Progress', libs);
    assert.equal(result.ok, false);
    assert.ok(result.failures.some(f => f.name === 'require_subtasks'));
  });

  it('passes when all subtasks are assigned', () => {
    const task = makeTask();
    const subtasks = [
      { 'Task ID': 'T-500.1', 'Status': 'To-Do', 'Assigned To': 'Gilfoyle' },
      { 'Task ID': 'T-500.2', 'Status': 'To-Do', 'Assigned To': 'Dinesh' },
    ];
    const libs = makeMockLibs(subtasks);
    // Note: require_approved will also run — task is assigned to Richard (not human), so it passes
    const result = runGuards(task, 'In-Progress', libs);
    // Checks pass, but setup_worktree will fail (no real worktree). Check only check guards.
    // require_subtasks and require_approved should both pass
    const checkFailures = result.failures.filter(f => f.name === 'require_subtasks' || f.name === 'require_approved');
    assert.equal(checkFailures.length, 0);
  });

  it('parent-only guards skipped for subtasks, but scope:any guards still run', () => {
    // require_subtasks and require_approved are scope:parent — skipped for subtasks
    // requireParentInProgress is scope:any — runs for subtasks too
    // Parent T-400 is in In-Progress, so requireParentInProgress passes
    const parent = makeTask({ 'Task ID': 'T-400', 'Status': 'In-Progress', 'Parent': 'None' });
    const subtask = makeTask({ 'Task ID': 'T-400.1', 'Parent': 'T-400' });
    const libs = makeMockLibs([subtask]);
    // Add parent to findTask mock
    libs.trackerDb.findTask = (id) => id === 'T-400' ? parent : null;
    const result = runGuards(subtask, 'In-Progress', libs);
    // Subtask passes — parent-only guards skipped, requireParentInProgress passes
    assert.equal(result.ok, true);
  });
});

describe('Guard: block_cli_done', () => {
  it('blocks parent task from transitioning to Done via CLI', () => {
    const task = makeTask({ 'Status': 'Ready for Human Review' });
    const libs = makeMockLibs([]);
    const result = runGuards(task, 'Done', libs);
    assert.equal(result.ok, false);
    assert.ok(result.failures.some(f => f.name === 'block_cli_done'));
    assert.ok(result.failures.some(f => f.reason.includes('CLI')));
  });

  it('does not affect subtasks (non-parent tasks)', () => {
    const task = makeTask({ 'Parent': 'T-400', 'Status': 'Ready for Human Review' });
    const libs = makeMockLibs([]);
    const result = runGuards(task, 'Done', libs);
    assert.equal(result.ok, true);
  });
});

describe('Guard: all_subtasks_done (tightened)', () => {
  it('fails when parent has zero subtasks', () => {
    const task = makeTask({ 'Status': 'In-Progress' });
    const libs = makeMockLibs([]);
    const result = runGuards(task, 'Testing', libs);
    assert.equal(result.ok, false);
    assert.ok(result.failures.some(f => f.name === 'all_subtasks_done'));
    assert.ok(result.failures.some(f => f.reason.includes('no subtask')));
  });

  it('fails when some subtasks are not Done', () => {
    const task = makeTask({ 'Status': 'In-Progress', 'Worktree': 'feature/test (~/wt/test)' });
    const subtasks = [
      { 'Task ID': 'T-500.1', 'Status': 'Done', 'Assigned To': 'Gilfoyle' },
      { 'Task ID': 'T-500.2', 'Status': 'In-Progress', 'Assigned To': 'Dinesh' },
    ];
    const libs = makeMockLibs(subtasks);
    const result = runGuards(task, 'Testing', libs);
    assert.equal(result.ok, false);
    assert.ok(result.failures.some(f => f.name === 'all_subtasks_done'));
  });
});
