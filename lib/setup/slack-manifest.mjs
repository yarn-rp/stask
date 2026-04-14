/**
 * lib/setup/slack-manifest.mjs — Slack token verification.
 *
 * Slack app manifest generation is now handled by manifest.mjs
 * using the per-agent manifest.json files.
 */

import https from 'node:https';

/**
 * Verify a Slack bot token via auth.test and return the bot user ID.
 *
 * @param {string} botToken - xoxb-... token
 * @returns {Promise<{ ok: boolean, userId?: string, botName?: string, error?: string }>}
 */
export function verifyToken(botToken) {
  return new Promise((resolve) => {
    const postData = '';
    const options = {
      hostname: 'slack.com',
      path: '/api/auth.test',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${botToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (data.ok) {
            resolve({ ok: true, userId: data.user_id, botName: data.user });
          } else {
            resolve({ ok: false, error: data.error });
          }
        } catch (e) {
          resolve({ ok: false, error: 'Invalid JSON response' });
        }
      });
    });

    req.on('error', (e) => {
      resolve({ ok: false, error: e.message });
    });

    req.write(postData);
    req.end();
  });
}
