/**
 * session.test.mjs — Session claim/release/stale detection.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, insertTask } from './helpers/test-db.mjs';
import {
  claimTask, releaseTask, getSessionStatus, isTaskClaimable, cleanStaleSessions,
  pingAcpSession, acpSessionHealth, listAcpSessions, closeAcpSession, closeAcpSessionsForTask,
  saveSubtaskBundles, getSubtaskBundles, clearSubtaskBundles,
} from '../lib/session-tracker.mjs';

let db;

describe('Session tracking', () => {
  beforeEach(() => {
    db = createTestDb();
    insertTask(db, { task_id: 'T-001' });
    insertTask(db, { task_id: 'T-002' });
  });

  describe('claimTask', () => {
    it('claims unclaimed task', () => {
      const result = claimTask(db, 'T-001', 'richard', 'sess-1');
      assert.equal(result.ok, true);
    });

    it('same session reclaiming refreshes', () => {
      claimTask(db, 'T-001', 'richard', 'sess-1');
      const result = claimTask(db, 'T-001', 'richard', 'sess-1');
      assert.equal(result.ok, true);
      assert.match(result.message, /Refreshed/);
    });

    it('different session fails (within stale window)', () => {
      claimTask(db, 'T-001', 'richard', 'sess-1');
      const result = claimTask(db, 'T-001', 'gilfoyle', 'sess-2');
      assert.equal(result.ok, false);
      assert.equal(result.claimedBy, 'richard');
    });

    it('reclaims stale session', () => {
      claimTask(db, 'T-001', 'richard', 'sess-1');
      // Artificially age the claim
      db.prepare("UPDATE active_sessions SET claimed_at = datetime('now', '-60 minutes') WHERE task_id = ?")
        .run('T-001');
      const result = claimTask(db, 'T-001', 'gilfoyle', 'sess-2');
      assert.equal(result.ok, true);
      assert.match(result.message, /Reclaimed stale/);
    });
  });

  describe('releaseTask', () => {
    it('releases by owning session', () => {
      claimTask(db, 'T-001', 'richard', 'sess-1');
      const result = releaseTask(db, 'T-001', 'sess-1');
      assert.equal(result.ok, true);
    });

    it('fails for wrong session', () => {
      claimTask(db, 'T-001', 'richard', 'sess-1');
      const result = releaseTask(db, 'T-001', 'sess-wrong');
      assert.equal(result.ok, false);
    });

    it('force release works without session check', () => {
      claimTask(db, 'T-001', 'richard', 'sess-1');
      const result = releaseTask(db, 'T-001');
      assert.equal(result.ok, true);
    });

    it('returns false for unclaimed task', () => {
      const result = releaseTask(db, 'T-001', 'sess-1');
      assert.equal(result.ok, false);
    });
  });

  describe('getSessionStatus', () => {
    it('returns empty for no sessions', () => {
      const sessions = getSessionStatus(db);
      assert.equal(sessions.length, 0);
    });

    it('returns all active sessions', () => {
      claimTask(db, 'T-001', 'richard', 'sess-1');
      claimTask(db, 'T-002', 'gilfoyle', 'sess-2');
      const sessions = getSessionStatus(db);
      assert.equal(sessions.length, 2);
    });

    it('returns single task session', () => {
      claimTask(db, 'T-001', 'richard', 'sess-1');
      const sessions = getSessionStatus(db, 'T-001');
      assert.equal(sessions.length, 1);
      assert.equal(sessions[0].agent, 'richard');
    });

    it('marks stale sessions', () => {
      claimTask(db, 'T-001', 'richard', 'sess-1');
      db.prepare("UPDATE active_sessions SET claimed_at = datetime('now', '-60 minutes') WHERE task_id = ?")
        .run('T-001');
      const sessions = getSessionStatus(db, 'T-001');
      assert.equal(sessions[0].isStale, true);
    });

    it('marks fresh sessions as not stale', () => {
      claimTask(db, 'T-001', 'richard', 'sess-1');
      const sessions = getSessionStatus(db, 'T-001');
      assert.equal(sessions[0].isStale, false);
    });
  });

  describe('isTaskClaimable', () => {
    it('unclaimed task is claimable', () => {
      assert.equal(isTaskClaimable(db, 'T-001', 'richard'), true);
    });

    it('own claim is claimable', () => {
      claimTask(db, 'T-001', 'richard', 'sess-1');
      assert.equal(isTaskClaimable(db, 'T-001', 'richard'), true);
    });

    it('other agent fresh claim is not claimable', () => {
      claimTask(db, 'T-001', 'richard', 'sess-1');
      assert.equal(isTaskClaimable(db, 'T-001', 'gilfoyle'), false);
    });

    it('stale claim from other agent is claimable', () => {
      claimTask(db, 'T-001', 'richard', 'sess-1');
      db.prepare("UPDATE active_sessions SET claimed_at = datetime('now', '-60 minutes') WHERE task_id = ?")
        .run('T-001');
      assert.equal(isTaskClaimable(db, 'T-001', 'gilfoyle'), true);
    });
  });

  describe('cleanStaleSessions', () => {
    it('removes stale sessions', () => {
      claimTask(db, 'T-001', 'richard', 'sess-1');
      claimTask(db, 'T-002', 'gilfoyle', 'sess-2');
      db.prepare("UPDATE active_sessions SET claimed_at = datetime('now', '-60 minutes') WHERE task_id = ?")
        .run('T-001');
      const removed = cleanStaleSessions(db);
      assert.equal(removed, 1);
      // T-002 should still be there
      const remaining = getSessionStatus(db);
      assert.equal(remaining.length, 1);
      assert.equal(remaining[0].task_id, 'T-002');
    });

    it('does nothing when no stale sessions', () => {
      claimTask(db, 'T-001', 'richard', 'sess-1');
      const removed = cleanStaleSessions(db);
      assert.equal(removed, 0);
    });
  });
});

describe('ACP session liveness', () => {
  beforeEach(() => {
    db = createTestDb();
    insertTask(db, { task_id: 'T-001' });
    insertTask(db, { task_id: 'T-002' });
  });

  describe('pingAcpSession', () => {
    it('creates a row on first ping, derives agent from label', () => {
      const r = pingAcpSession(db, 'T-001:berlin:s1');
      assert.equal(r.ok, true);
      assert.equal(r.created, true);

      const rows = listAcpSessions(db);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].label, 'T-001:berlin:s1');
      assert.equal(rows[0].agent, 'berlin');
      assert.equal(rows[0].subtask_id, 's1');
    });

    it('explicit meta overrides label parsing', () => {
      const r = pingAcpSession(db, 'T-001:professor', {
        taskId: 'T-001', agent: 'professor',
      });
      assert.equal(r.created, true);
      const row = db.prepare('SELECT * FROM acp_sessions WHERE label = ?').get('T-001:professor');
      assert.equal(row.agent, 'professor');
      assert.equal(row.subtask_id, null);
      assert.equal(row.task_id, 'T-001');
    });

    it('refreshes last_ping_at on subsequent pings', () => {
      pingAcpSession(db, 'T-001:berlin:s1');
      // Artificially age it
      db.prepare("UPDATE acp_sessions SET last_ping_at = datetime('now', '-10 minutes') WHERE label = ?")
        .run('T-001:berlin:s1');
      const before = db.prepare('SELECT last_ping_at FROM acp_sessions WHERE label = ?').get('T-001:berlin:s1');

      const r = pingAcpSession(db, 'T-001:berlin:s1');
      assert.equal(r.created, false);

      const after = db.prepare('SELECT last_ping_at FROM acp_sessions WHERE label = ?').get('T-001:berlin:s1');
      assert.notEqual(before.last_ping_at, after.last_ping_at);
    });

    it('fails when agent cannot be derived and none supplied', () => {
      const r = pingAcpSession(db, 'loneLabel');
      assert.equal(r.ok, false);
      assert.match(r.error, /Cannot derive agent/);
    });
  });

  describe('acpSessionHealth', () => {
    it('returns missing for unknown label', () => {
      const r = acpSessionHealth(db, 'T-001:berlin:s1');
      assert.equal(r.status, 'missing');
    });

    it('returns alive for fresh ping', () => {
      pingAcpSession(db, 'T-001:berlin:s1');
      const r = acpSessionHealth(db, 'T-001:berlin:s1', 3);
      assert.equal(r.status, 'alive');
    });

    it('returns hung when last ping exceeds hang timeout', () => {
      pingAcpSession(db, 'T-001:berlin:s1');
      db.prepare("UPDATE acp_sessions SET last_ping_at = datetime('now', '-10 minutes') WHERE label = ?")
        .run('T-001:berlin:s1');
      const r = acpSessionHealth(db, 'T-001:berlin:s1', 3);
      assert.equal(r.status, 'hung');
    });
  });

  describe('listAcpSessions', () => {
    it('filters by task and by agent', () => {
      // taskId is explicit — label prefix is the Slack thread_ts, not the task_id.
      pingAcpSession(db, '1727883456.1:berlin:s1', { taskId: 'T-001' });
      pingAcpSession(db, '1727883456.1:berlin:s2', { taskId: 'T-001' });
      pingAcpSession(db, '1727883456.2:tokyo:s1',  { taskId: 'T-002' });

      assert.equal(listAcpSessions(db).length, 3);
      assert.equal(listAcpSessions(db, { taskId: 'T-001' }).length, 2);
      assert.equal(listAcpSessions(db, { agent: 'tokyo' }).length, 1);
      assert.equal(listAcpSessions(db, { taskId: 'T-001', agent: 'berlin' }).length, 2);
    });
  });

  describe('closeAcpSession / closeAcpSessionsForTask', () => {
    it('closes a single session by label', () => {
      pingAcpSession(db, 'thr:berlin:s1', { taskId: 'T-001' });
      const r = closeAcpSession(db, 'thr:berlin:s1');
      assert.equal(r.ok, true);
      assert.equal(listAcpSessions(db).length, 0);
    });

    it('returns ok=false for unknown label', () => {
      const r = closeAcpSession(db, 'nope');
      assert.equal(r.ok, false);
    });

    it('closes every session tied to a task', () => {
      pingAcpSession(db, 'thr:berlin:s1',   { taskId: 'T-001' });
      pingAcpSession(db, 'thr:berlin:s2',   { taskId: 'T-001' });
      pingAcpSession(db, 'thr:professor',   { taskId: 'T-001', agent: 'professor' });
      pingAcpSession(db, 'thr2:tokyo:s1',   { taskId: 'T-002' });

      const r = closeAcpSessionsForTask(db, 'T-001');
      assert.equal(r.removed, 3);
      const remaining = listAcpSessions(db);
      assert.equal(remaining.length, 1);
      assert.equal(remaining[0].task_id, 'T-002');
    });
  });
});

describe('Subtask bundles', () => {
  beforeEach(() => {
    db = createTestDb();
    insertTask(db, { task_id: 'T-001' });
    insertTask(db, { task_id: 'T-002' });
  });

  it('returns null when no bundling is saved', () => {
    assert.equal(getSubtaskBundles(db, 'T-001', 'berlin'), null);
  });

  it('round-trips bundles in submission order', () => {
    saveSubtaskBundles(db, 'T-001', 'berlin', [
      { primarySubtaskId: 'T-001.1', memberSubtaskIds: ['T-001.1', 'T-001.2'] },
      { primarySubtaskId: 'T-001.3', memberSubtaskIds: ['T-001.3'] },
    ]);
    const out = getSubtaskBundles(db, 'T-001', 'berlin');
    assert.deepEqual(out, [
      { primarySubtaskId: 'T-001.1', memberSubtaskIds: ['T-001.1', 'T-001.2'] },
      { primarySubtaskId: 'T-001.3', memberSubtaskIds: ['T-001.3'] },
    ]);
  });

  it('replace semantics on re-save (idempotent)', () => {
    saveSubtaskBundles(db, 'T-001', 'berlin', [
      { primarySubtaskId: 'T-001.1', memberSubtaskIds: ['T-001.1', 'T-001.2'] },
    ]);
    saveSubtaskBundles(db, 'T-001', 'berlin', [
      { primarySubtaskId: 'T-001.2', memberSubtaskIds: ['T-001.2'] },
    ]);
    assert.deepEqual(getSubtaskBundles(db, 'T-001', 'berlin'), [
      { primarySubtaskId: 'T-001.2', memberSubtaskIds: ['T-001.2'] },
    ]);
  });

  it('scopes by (task, agent)', () => {
    saveSubtaskBundles(db, 'T-001', 'berlin', [
      { primarySubtaskId: 'T-001.1', memberSubtaskIds: ['T-001.1'] },
    ]);
    saveSubtaskBundles(db, 'T-001', 'tokyo', [
      { primarySubtaskId: 'T-001.2', memberSubtaskIds: ['T-001.2'] },
    ]);
    saveSubtaskBundles(db, 'T-002', 'berlin', [
      { primarySubtaskId: 'T-002.1', memberSubtaskIds: ['T-002.1'] },
    ]);

    assert.equal(getSubtaskBundles(db, 'T-001', 'berlin').length, 1);
    assert.equal(getSubtaskBundles(db, 'T-001', 'tokyo').length, 1);
    assert.equal(getSubtaskBundles(db, 'T-001', 'tokyo')[0].memberSubtaskIds[0], 'T-001.2');
    assert.equal(getSubtaskBundles(db, 'T-002', 'berlin')[0].memberSubtaskIds[0], 'T-002.1');
  });

  it('clearSubtaskBundles drops every bundle row for a task (all agents)', () => {
    saveSubtaskBundles(db, 'T-001', 'berlin', [
      { primarySubtaskId: 'T-001.1', memberSubtaskIds: ['T-001.1'] },
    ]);
    saveSubtaskBundles(db, 'T-001', 'tokyo', [
      { primarySubtaskId: 'T-001.2', memberSubtaskIds: ['T-001.2'] },
    ]);
    saveSubtaskBundles(db, 'T-002', 'berlin', [
      { primarySubtaskId: 'T-002.1', memberSubtaskIds: ['T-002.1'] },
    ]);

    const r = clearSubtaskBundles(db, 'T-001');
    assert.equal(r.removed, 2);
    assert.equal(getSubtaskBundles(db, 'T-001', 'berlin'), null);
    assert.equal(getSubtaskBundles(db, 'T-001', 'tokyo'), null);
    // Other task untouched
    assert.equal(getSubtaskBundles(db, 'T-002', 'berlin').length, 1);
  });
});
