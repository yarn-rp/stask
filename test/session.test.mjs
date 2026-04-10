/**
 * session.test.mjs — Session claim/release/stale detection.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, insertTask } from './helpers/test-db.mjs';
import { claimTask, releaseTask, getSessionStatus, isTaskClaimable, cleanStaleSessions } from '../lib/session-tracker.mjs';

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
