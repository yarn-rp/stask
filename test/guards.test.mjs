/**
 * guards.test.mjs — Tests for the scope-aware guard system and
 * requireParentInProgress guard.
 *
 * Tests runGuards() directly with a mock libs object to isolate
 * guard logic from the real DB, worktree creation, and CLI side effects.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { runGuards } from '../lib/guards.mjs';

// ─── Mock libs ─────────────────────────────────────────────────────

/**
 * Create a mock libs object with a stubbed trackerDb.
 * tasks is a Map of task objects keyed by Task ID.
 */
function makeLibs(tasks = new Map()) {
  return {
    trackerDb: {
      findTask(id) {
        return tasks.get(id) || null;
      },
      getSubtasks(parentId) {
        const result = [];
        for (const [, t] of tasks) {
          if (t['Parent'] === parentId) result.push(t);
        }
        return result;
      },
    },
  };
}

/** Make a parent task (no parent_id). */
function makeParent(id, status, extra = {}) {
  return {
    'Task ID': id,
    'Task Name': `Task ${id}`,
    'Status': status,
    'Assigned To': 'Berlin',
    'Spec': 'specs/test.md (F0TEST)',
    'Type': 'Feature',
    'Parent': 'None',
    'Worktree': 'feature/test (~/wt/test)',
    'PR': 'None',
    ...extra,
  };
}

/** Make a subtask. */
function makeSubtask(id, status, parentId, extra = {}) {
  return {
    'Task ID': id,
    'Task Name': `Subtask ${id}`,
    'Status': status,
    'Assigned To': 'Berlin',
    'Spec': 'None',
    'Type': 'Task',
    'Parent': parentId,
    'Worktree': 'None',
    'PR': 'None',
    ...extra,
  };
}

// ─── requireParentInProgress guard ─────────────────────────────────

describe('requireParentInProgress guard', () => {
  it('parent task passes (no parent to check)', () => {
    const parent = makeParent('T-001', 'To-Do');
    const libs = makeLibs(new Map([['T-001', parent]]));
    const result = runGuards(parent, 'In-Progress', libs);
    // Parent has scope:parent guards (require_subtasks, require_approved, setup_worktree)
    // but we're only testing that requireParentInProgress passes for parents
    // The other guards will fail, but that's expected — we just check no requireParentInProgress failure
    const parentGuardFails = result.failures.filter(f => f.name === 'require_parent_in_progress');
    assert.equal(parentGuardFails.length, 0, 'requireParentInProgress should pass for parent tasks');
  });

  it('subtask passes when parent is In-Progress', () => {
    const parent = makeParent('T-001', 'In-Progress');
    const sub = makeSubtask('T-001.1', 'To-Do', 'T-001');
    const libs = makeLibs(new Map([['T-001', parent], ['T-001.1', sub]]));
    const result = runGuards(sub, 'In-Progress', libs);
    assert.equal(result.ok, true, 'Subtask should transition to In-Progress when parent is In-Progress');
    assert.equal(result.failures.length, 0, 'No guard failures expected');
  });

  it('subtask passes when parent is Testing', () => {
    const parent = makeParent('T-001', 'Testing');
    const sub = makeSubtask('T-001.1', 'To-Do', 'T-001');
    const libs = makeLibs(new Map([['T-001', parent], ['T-001.1', sub]]));
    const result = runGuards(sub, 'In-Progress', libs);
    assert.equal(result.ok, true, 'Subtask should transition to In-Progress when parent is Testing');
    assert.equal(result.failures.length, 0);
  });

  it('subtask passes when parent is Ready for Human Review', () => {
    const parent = makeParent('T-001', 'Ready for Human Review');
    const sub = makeSubtask('T-001.1', 'To-Do', 'T-001');
    const libs = makeLibs(new Map([['T-001', parent], ['T-001.1', sub]]));
    const result = runGuards(sub, 'In-Progress', libs);
    assert.equal(result.ok, true, 'Subtask should transition to In-Progress when parent is RHR');
    assert.equal(result.failures.length, 0);
  });

  it('subtask BLOCKED when parent is To-Do', () => {
    const parent = makeParent('T-001', 'To-Do');
    const sub = makeSubtask('T-001.1', 'To-Do', 'T-001');
    const libs = makeLibs(new Map([['T-001', parent], ['T-001.1', sub]]));
    const result = runGuards(sub, 'In-Progress', libs);
    assert.equal(result.ok, false, 'Subtask should be blocked when parent is To-Do');
    const fail = result.failures.find(f => f.name === 'require_parent_in_progress');
    assert.ok(fail, 'Should have a requireParentInProgress failure');
    assert.match(fail.reason, /Cannot transition subtask T-001\.1 to In-Progress.*parent task T-001 is not yet In-Progress.*current status: To-Do/);
  });

  it('subtask BLOCKED when parent is Backlog', () => {
    const parent = makeParent('T-001', 'Backlog');
    const sub = makeSubtask('T-001.1', 'To-Do', 'T-001');
    const libs = makeLibs(new Map([['T-001', parent], ['T-001.1', sub]]));
    const result = runGuards(sub, 'In-Progress', libs);
    assert.equal(result.ok, false);
    const fail = result.failures.find(f => f.name === 'require_parent_in_progress');
    assert.ok(fail);
    assert.match(fail.reason, /current status: Backlog/);
  });

  it('subtask BLOCKED when parent is Blocked', () => {
    const parent = makeParent('T-001', 'Blocked');
    const sub = makeSubtask('T-001.1', 'To-Do', 'T-001');
    const libs = makeLibs(new Map([['T-001', parent], ['T-001.1', sub]]));
    const result = runGuards(sub, 'In-Progress', libs);
    assert.equal(result.ok, false);
    const fail = result.failures.find(f => f.name === 'require_parent_in_progress');
    assert.ok(fail);
    assert.match(fail.reason, /current status: Blocked/);
  });

  it('subtask BLOCKED when parent not found in DB', () => {
    const sub = makeSubtask('T-001.1', 'To-Do', 'T-999');
    // Only subtask in the DB, parent T-999 doesn't exist
    const libs = makeLibs(new Map([['T-001.1', sub]]));
    const result = runGuards(sub, 'In-Progress', libs);
    assert.equal(result.ok, false);
    const fail = result.failures.find(f => f.name === 'require_parent_in_progress');
    assert.ok(fail);
    assert.match(fail.reason, /parent task T-999 not found/);
  });
});

// ─── Scope filtering ───────────────────────────────────────────────

describe('Scope filtering in runGuards', () => {
  it('subtask skips parent-only guards for In-Progress (no scope:parent guards run)', () => {
    // When a subtask transitions to In-Progress, only scope:'any' guards run.
    // require_subtasks (scope:parent), require_approved (scope:parent), setup_worktree (scope:parent)
    // should all be skipped. Only requireParentInProgress (scope:any) runs.
    const parent = makeParent('T-001', 'In-Progress');
    const sub = makeSubtask('T-001.1', 'To-Do', 'T-001');
    const libs = makeLibs(new Map([['T-001', parent], ['T-001.1', sub]]));
    const result = runGuards(sub, 'In-Progress', libs);
    assert.equal(result.ok, true, 'Subtask should pass — only scope:any guards run');
    assert.equal(result.failures.length, 0, 'No parent-scope guards should have run');
  });

  it('parent task still runs all parent-scope guards', () => {
    // Parent task moving to In-Progress should still hit require_subtasks, etc.
    // (require_subtasks will fail since we have no subtasks in this test)
    const parent = makeParent('T-001', 'To-Do');
    const libs = makeLibs(new Map([['T-001', parent]]));
    const result = runGuards(parent, 'In-Progress', libs);
    assert.equal(result.ok, false, 'Parent should fail — no subtasks');
    const names = result.failures.map(f => f.name);
    assert.ok(names.includes('require_subtasks'), 'require_subtasks should run for parent');
  });

  it('parent task with subtask but missing assignee still fails require_subtasks', () => {
    const parent = makeParent('T-001', 'To-Do');
    const sub = makeSubtask('T-001.1', 'To-Do', 'T-001', { 'Assigned To': 'None' });
    const libs = makeLibs(new Map([['T-001', parent], ['T-001.1', sub]]));
    const result = runGuards(parent, 'In-Progress', libs);
    assert.equal(result.ok, false);
    const fail = result.failures.find(f => f.name === 'require_subtasks');
    assert.ok(fail, 'Should fail on unassigned subtasks');
  });

  it('subtask transitioning to Testing skips parent-only guards', () => {
    // Testing guards: all_subtasks_done, worktree_clean, worktree_pushed — all scope:parent
    // A subtask moving to Testing should skip all of them
    const parent = makeParent('T-001', 'Testing');
    const sub = makeSubtask('T-001.1', 'In-Progress', 'T-001');
    const libs = makeLibs(new Map([['T-001', parent], ['T-001.1', sub]]));
    const result = runGuards(sub, 'Testing', libs);
    assert.equal(result.ok, true, 'Subtask should pass — no scope:any guards for Testing');
    assert.equal(result.failures.length, 0);
  });

  it('subtask transitioning to Done skips parent-only block_cli_done', () => {
    // Done guard: block_cli_done — scope:parent
    // A subtask moving to Done should skip it
    const parent = makeParent('T-001', 'Done');
    const sub = makeSubtask('T-001.1', 'Ready for Human Review', 'T-001');
    const libs = makeLibs(new Map([['T-001', parent], ['T-001.1', sub]]));
    const result = runGuards(sub, 'Done', libs);
    assert.equal(result.ok, true, 'Subtask should be allowed to move to Done');
    assert.equal(result.failures.length, 0);
  });
});

// ─── Backward compatibility ────────────────────────────────────────

describe('Backward compatibility — parent guards unchanged', () => {
  it('parent moving to In-Progress still requires subtasks', () => {
    const parent = makeParent('T-001', 'To-Do');
    const libs = makeLibs(new Map([['T-001', parent]]));
    const result = runGuards(parent, 'In-Progress', libs);
    assert.equal(result.ok, false);
    assert.ok(result.failures.some(f => f.name === 'require_subtasks'));
  });

  it('parent moving to In-Progress with assigned subtasks passes require_subtasks', () => {
    const parent = makeParent('T-001', 'To-Do');
    const sub = makeSubtask('T-001.1', 'To-Do', 'T-001', { 'Assigned To': 'Berlin' });
    const libs = makeLibs(new Map([['T-001', parent], ['T-001.1', sub]]));
    const result = runGuards(parent, 'In-Progress', libs);
    // require_subtasks should pass, require_approved depends on assignment,
    // setup_worktree will try to create one (but our mock won't handle that).
    // Just verify require_subtrees passes.
    const subtaskFail = result.failures.find(f => f.name === 'require_subtasks');
    assert.equal(subtaskFail, undefined, 'require_subtasks should pass');
  });
});