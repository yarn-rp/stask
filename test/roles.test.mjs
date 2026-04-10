/**
 * roles.test.mjs — Role-based auto-assignment from config.
 *
 * Tests that auto-assign rules map statuses to the correct agents
 * based on their roles in config.json.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// We import roles directly — it reads from config.json
import { getAutoAssign, getLeadAgent, getAgentByRole, getSlackUserId, isHumanReviewStatus } from '../lib/roles.mjs';
import { CONFIG } from '../lib/env.mjs';

describe('getAutoAssign', () => {
  it('To-Do assigns to human', () => {
    assert.equal(getAutoAssign('To-Do'), CONFIG.human.name);
  });

  it('In-Progress keeps current (null)', () => {
    assert.equal(getAutoAssign('In-Progress'), null);
  });

  it('Testing assigns to QA agent', () => {
    const qaAgent = getAgentByRole('qa');
    assert.equal(getAutoAssign('Testing'), qaAgent);
    assert.ok(qaAgent, 'QA agent should exist in config');
  });

  it('Ready for Human Review assigns to human', () => {
    assert.equal(getAutoAssign('Ready for Human Review'), CONFIG.human.name);
  });

  it('Blocked assigns to human', () => {
    assert.equal(getAutoAssign('Blocked'), CONFIG.human.name);
  });

  it('Done keeps current (null)', () => {
    assert.equal(getAutoAssign('Done'), null);
  });
});

describe('getLeadAgent', () => {
  it('returns the agent with role "lead"', () => {
    const lead = getLeadAgent();
    assert.ok(lead, 'Lead agent should exist');
    // Verify it matches a real agent in config
    const lowerLead = lead.toLowerCase();
    assert.ok(CONFIG.agents[lowerLead], `${lead} should be in config.agents`);
    assert.equal(CONFIG.agents[lowerLead].role, 'lead');
  });
});

describe('getAgentByRole', () => {
  it('finds lead agent', () => {
    const lead = getAgentByRole('lead');
    assert.ok(lead);
  });

  it('finds worker agent', () => {
    const worker = getAgentByRole('worker');
    assert.ok(worker);
  });

  it('finds qa agent', () => {
    const qa = getAgentByRole('qa');
    assert.ok(qa);
  });

  it('returns null for unknown role', () => {
    assert.equal(getAgentByRole('ceo'), null);
  });

  it('returns capitalized name', () => {
    const lead = getAgentByRole('lead');
    assert.equal(lead[0], lead[0].toUpperCase());
  });
});

describe('getSlackUserId', () => {
  it('resolves human name to Slack user ID', () => {
    const id = getSlackUserId(CONFIG.human.name);
    assert.equal(id, CONFIG.human.slackUserId);
  });

  it('resolves each configured agent to Slack user ID', () => {
    for (const [name, agent] of Object.entries(CONFIG.agents)) {
      const displayName = name.charAt(0).toUpperCase() + name.slice(1);
      const id = getSlackUserId(displayName);
      assert.equal(id, agent.slackUserId, `${displayName} should resolve to ${agent.slackUserId}`);
    }
  });

  it('returns null for unknown name', () => {
    assert.equal(getSlackUserId('BigHead'), null);
  });

  it('returns null for null/undefined', () => {
    assert.equal(getSlackUserId(null), null);
    assert.equal(getSlackUserId(undefined), null);
  });
});

describe('isHumanReviewStatus', () => {
  it('Ready for Human Review is true', () => {
    assert.equal(isHumanReviewStatus('Ready for Human Review'), true);
  });

  it('Blocked is true', () => {
    assert.equal(isHumanReviewStatus('Blocked'), true);
  });

  it('In-Progress is false', () => {
    assert.equal(isHumanReviewStatus('In-Progress'), false);
  });

  it('To-Do is false', () => {
    assert.equal(isHumanReviewStatus('To-Do'), false);
  });
});
