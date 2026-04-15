/**
 * lib/setup/slack-channel.mjs — Create Slack channel and invite members.
 *
 * Uses the lead agent's bot token to create a project channel
 * and invite all agent bots + the human user.
 */

import https from 'node:https';

/**
 * Make a Slack API POST request with a specific bot token.
 */
function slackPost(token, endpoint, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const req = https.request({
      hostname: 'slack.com',
      path: `/api/${endpoint}`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(raw));
        } catch {
          reject(new Error(`Invalid JSON from Slack: ${raw.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Create a project channel and invite all team members.
 *
 * @param {Object} opts
 * @param {string} opts.botToken      — Lead agent's bot token (needs channels:manage)
 * @param {string} opts.channelName   — e.g. "my-project-project"
 * @param {string[]} opts.userIds     — All user IDs to invite (agents + human)
 * @returns {Promise<{ ok: boolean, channelId?: string, error?: string }>}
 */
export async function createProjectChannel({ botToken, channelName, userIds }) {
  // Create channel
  const createRes = await slackPost(botToken, 'conversations.create', {
    name: channelName,
    is_private: false,
  });

  if (!createRes.ok) {
    // Channel might already exist
    if (createRes.error === 'name_taken') {
      // Try to find the existing channel
      const listRes = await slackPost(botToken, 'conversations.list', {
        types: 'public_channel',
        limit: 200,
      });
      if (listRes.ok) {
        const existing = listRes.channels?.find((c) => c.name === channelName);
        if (existing) {
          return { ok: true, channelId: existing.id, existing: true };
        }
      }
    }
    return { ok: false, error: createRes.error };
  }

  const channelId = createRes.channel.id;

  // Invite all users (agents + human) — skip errors for already-in-channel
  const inviteErrors = [];
  for (const userId of userIds) {
    const invRes = await slackPost(botToken, 'conversations.invite', {
      channel: channelId,
      users: userId,
    });
    if (!invRes.ok && invRes.error !== 'already_in_channel' && invRes.error !== 'cant_invite_self') {
      inviteErrors.push({ userId, error: invRes.error });
    }
  }

  return {
    ok: true,
    channelId,
    existing: false,
    inviteErrors: inviteErrors.length ? inviteErrors : undefined,
  };
}
