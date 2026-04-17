/**
 * lib/setup/slack-teardown.mjs — Tear down the Slack resources setup created:
 * archive the channel, delete the List (stored as a file), delete the Canvas.
 *
 * Slack does not support true channel deletion via API — `conversations.archive`
 * is the closest thing and is reversible from the UI. Lists and canvases are
 * fully deletable.
 */

import https from 'node:https';

function slackPost(token, endpoint, data) {
  return new Promise((resolve) => {
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
        try { resolve(JSON.parse(raw)); }
        catch { resolve({ ok: false, error: `invalid_json: ${raw.slice(0, 120)}` }); }
      });
    });
    req.on('error', (err) => resolve({ ok: false, error: err.message }));
    req.write(body);
    req.end();
  });
}

/**
 * Archive a channel. Idempotent: treats `already_archived` as success.
 * Returns { ok: boolean, error?: string }.
 */
export async function archiveChannel({ botToken, channelId }) {
  if (!botToken || !channelId) return { ok: false, error: 'missing token/channelId' };
  const res = await slackPost(botToken, 'conversations.archive', { channel: channelId });
  if (res.ok) return { ok: true };
  if (res.error === 'already_archived') return { ok: true, note: 'already archived' };
  return { ok: false, error: res.error || 'unknown' };
}

/**
 * Delete a Slack List. Lists are backed by file objects, so files.delete with
 * the F-prefix list ID removes them.
 * Returns { ok: boolean, error?: string }.
 */
export async function deleteList({ botToken, listId }) {
  if (!botToken || !listId) return { ok: false, error: 'missing token/listId' };
  const res = await slackPost(botToken, 'files.delete', { file: listId });
  if (res.ok) return { ok: true };
  if (res.error === 'file_deleted' || res.error === 'file_not_found') {
    return { ok: true, note: res.error };
  }
  return { ok: false, error: res.error || 'unknown' };
}

/**
 * Delete a Canvas by its canvas_id.
 * Returns { ok: boolean, error?: string }.
 */
export async function deleteCanvas({ botToken, canvasId }) {
  if (!botToken || !canvasId) return { ok: false, error: 'missing token/canvasId' };
  const res = await slackPost(botToken, 'canvases.delete', { canvas_id: canvasId });
  if (res.ok) return { ok: true };
  if (res.error === 'canvas_not_found') return { ok: true, note: 'canvas_not_found' };
  return { ok: false, error: res.error || 'unknown' };
}
