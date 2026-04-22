/**
 * roles.test.mjs — Role-based auto-assignment from config.
 *
 * Solo-agent projects: auto-assign resolves to human or lead only.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { getAutoAssign, getLeadAgent, getAgentByRole, getHuman, getSlackUserId, isHumanReviewStatus } from '../lib/roles.mjs';
import { CONFIG } from '../lib/env.mjs';

describe('getAutoAssign', () => {
  it('Backlog assigns to human', () => {
    assert.equal(getAutoAssign('Backlog'), getHuman());
  });

  it('To-Do assigns to human', () => {
    assert.equal(getAutoAssign('To-Do'), getHuman());
  });

  it('In-Progress assigns to lead agent', () => {
    assert.equal(getAutoAssign('In-Progress'), getLeadAgent());
  });

  it('Testing assigns to lead agent', () => {
    assert.equal(getAutoAssign('Testing'), getLeadAgent());
  });

  it('Ready for Human Review assigns to human', () => {
    assert.equal(getAutoAssign('Ready for Human Review'), getHuman());
  });

  it('Blocked assigns to human', () => {
    assert.equal(getAutoAssign('Blocked'), getHuman());
  });

  it('Done keeps current (null)', () => {
    assert.equal(getAutoAssign('Done'), null);
  });
});

describe('getHuman', () => {
  it('returns the human display name from config', () => {
    assert.equal(getHuman(), CONFIG.human.name);
  });
});

describe('getLeadAgent', () => {
  it('returns the agent with role "lead"', () => {
    const lead = getLeadAgent();
    assert.ok(lead, 'Lead agent should exist');
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
