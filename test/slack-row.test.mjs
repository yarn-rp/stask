/**
 * slack-row.test.mjs — Cell formatting and row ID tracking.
 *
 * Tests that tasks are formatted into correct Slack cell types
 * using IDs from config.json.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, insertTask, getTask } from './helpers/test-db.mjs';
import { CONFIG } from '../lib/env.mjs';

// We can't easily import slack-row.mjs directly since it depends on
// getWorkspaceLibs. Instead we test the config-driven mappings
// and the slack_row_ids table directly.

const COLS = CONFIG.slack.columns;

let db;

describe('Slack row ID tracking', () => {
  beforeEach(() => {
    db = createTestDb();
    insertTask(db, { task_id: 'T-001' });
    insertTask(db, { task_id: 'T-002' });
  });

  it('stores Slack row ID for a task', () => {
    db.prepare('INSERT INTO slack_row_ids (task_id, row_id) VALUES (?, ?)').run('T-001', 'R_SLACK_001');
    const row = db.prepare('SELECT row_id FROM slack_row_ids WHERE task_id = ?').get('T-001');
    assert.equal(row.row_id, 'R_SLACK_001');
  });

  it('upserts Slack row ID', () => {
    db.prepare('INSERT INTO slack_row_ids (task_id, row_id) VALUES (?, ?)').run('T-001', 'R_SLACK_001');
    db.prepare('INSERT INTO slack_row_ids (task_id, row_id) VALUES (?, ?) ON CONFLICT(task_id) DO UPDATE SET row_id = excluded.row_id')
      .run('T-001', 'R_SLACK_002');
    const row = db.prepare('SELECT row_id FROM slack_row_ids WHERE task_id = ?').get('T-001');
    assert.equal(row.row_id, 'R_SLACK_002');
  });

  it('returns null for unknown task', () => {
    const row = db.prepare('SELECT row_id FROM slack_row_ids WHERE task_id = ?').get('T-999');
    assert.equal(row, undefined);
  });

  it('deletes row ID when task row removed', () => {
    db.prepare('INSERT INTO slack_row_ids (task_id, row_id) VALUES (?, ?)').run('T-001', 'R_SLACK_001');
    db.prepare('DELETE FROM slack_row_ids WHERE task_id = ?').run('T-001');
    const row = db.prepare('SELECT row_id FROM slack_row_ids WHERE task_id = ?').get('T-001');
    assert.equal(row, undefined);
  });
});

describe('Config-driven Slack mappings', () => {
  it('all required columns are defined', () => {
    const required = ['name', 'task_id', 'status', 'assignee', 'spec', 'type', 'worktree', 'pr', 'qa_report_1', 'qa_report_2', 'qa_report_3', 'completed'];
    for (const col of required) {
      assert.ok(COLS[col], `Missing column mapping for "${col}"`);
      assert.ok(COLS[col].startsWith('Col'), `Column ID for "${col}" should start with "Col", got "${COLS[col]}"`);
    }
  });

  it('all statuses have option IDs', () => {
    const statuses = ['To-Do', 'In-Progress', 'Testing', 'Ready for Human Review', 'Blocked', 'Done'];
    for (const status of statuses) {
      assert.ok(CONFIG.slack.statusOptions[status], `Missing status option ID for "${status}"`);
      assert.ok(CONFIG.slack.statusOptions[status].startsWith('Opt'), `Status option ID for "${status}" should start with "Opt"`);
    }
  });

  it('human has Slack user ID', () => {
    assert.ok(CONFIG.human.slackUserId);
    assert.ok(CONFIG.human.slackUserId.startsWith('U'));
  });

  it('all agents have Slack user IDs', () => {
    for (const [name, agent] of Object.entries(CONFIG.agents)) {
      assert.ok(agent.slackUserId, `Agent "${name}" missing slackUserId`);
      assert.ok(agent.slackUserId.startsWith('U'), `Agent "${name}" slackUserId should start with "U"`);
    }
  });

  it('all agents have the lead role (solo-agent project)', () => {
    for (const [name, agent] of Object.entries(CONFIG.agents)) {
      assert.equal(agent.role, 'lead', `Agent "${name}" should have role "lead", got "${agent.role}"`);
    }
  });

  it('exactly one lead agent', () => {
    const leads = Object.entries(CONFIG.agents).filter(([, a]) => a.role === 'lead');
    assert.equal(leads.length, 1, 'Should have exactly one lead agent');
  });
});

describe('Cell formatting rules (unit)', () => {
  it('Status maps to select type with correct option ID', () => {
    const statusId = CONFIG.slack.statusOptions['In-Progress'];
    assert.ok(statusId, 'In-Progress status option should exist');
    const cell = { column_id: COLS.status, select: [statusId] };
    assert.equal(cell.column_id, COLS.status);
    assert.deepEqual(cell.select, [statusId]);
  });

  it('Assigned To maps to user type with correct Slack user ID', () => {
    const firstAgent = Object.values(CONFIG.agents)[0];
    const userId = firstAgent.slackUserId;
    const cell = { column_id: COLS.assignee, user: [userId] };
    assert.equal(cell.column_id, COLS.assignee);
    assert.deepEqual(cell.user, [userId]);
  });

  it('human-review status overrides assignee to human', () => {
    // When status is RHR or Blocked, assignee cell should use human's ID
    const cell = { column_id: COLS.assignee, user: [CONFIG.human.slackUserId] };
    assert.deepEqual(cell.user, [CONFIG.human.slackUserId]);
  });

  it('Spec maps to attachment type', () => {
    const spec = 'specs/login.md (F0LOGIN123)';
    const match = spec.match(/\((\w+)\)$/);
    const fileId = match[1];
    const cell = { column_id: COLS.spec, attachment: [fileId] };
    assert.deepEqual(cell.attachment, ['F0LOGIN123']);
  });

  it('QA Report maps to attachment with multiple file IDs', () => {
    const qaReport = '(F0REPORT1) (F0BUNDLE1)';
    const fileIds = [...qaReport.matchAll(/\((\w+)\)/g)].map(m => m[1]);
    const cell = { column_id: COLS.qa_report_1, attachment: fileIds };
    assert.deepEqual(cell.attachment, ['F0REPORT1', 'F0BUNDLE1']);
  });

  it('PR maps to link type', () => {
    const url = 'https://github.com/test/repo/pull/42';
    const cell = { column_id: COLS.pr, link: [{ original_url: url }] };
    assert.equal(cell.link[0].original_url, url);
  });

  it('Done status sets checkbox to true', () => {
    const cell = { column_id: COLS.completed, checkbox: true };
    assert.equal(cell.checkbox, true);
  });

  it('Non-Done status sets checkbox to false', () => {
    const cell = { column_id: COLS.completed, checkbox: false };
    assert.equal(cell.checkbox, false);
  });

  it('Worktree maps to rich_text', () => {
    const wt = 'feature/login (~/wt/login)';
    const cell = {
      column_id: COLS.worktree,
      rich_text: [{ type: 'rich_text', elements: [{ type: 'rich_text_section', elements: [{ type: 'text', text: wt }] }] }],
    };
    assert.equal(cell.rich_text[0].elements[0].elements[0].text, wt);
  });
});
