/**
 * slack-api.mjs — Slack API helpers shared across sync scripts.
 */

import https from 'https';
import fs from 'fs';

// Slack token loaded from env by stask's env.mjs (loadEnv populates process.env)
const config = {
  get slackToken() { return process.env.SLACK_TOKEN; },
  logFile: null,
};

/**
 * Logger with optional file output.
 */
export const logger = {
  info: (msg) => log('INFO', msg),
  error: (msg) => log('ERROR', msg),
  warn: (msg) => log('WARN', msg),
  debug: (msg) => log('DEBUG', msg),
};

function log(level, msg) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${level}] ${msg}`;
  console.error(line);
  if (config.logFile) {
    fs.appendFileSync(config.logFile, line + '\n');
  }
}

/**
 * JSON POST to Slack API with automatic retry on rate limits.
 * Respects Retry-After header, retries up to 3 times with exponential backoff.
 */
export async function slackApiRequest(method, endpoint, data, _retryCount = 0) {
  const MAX_RETRIES = 3;
  return new Promise((resolve, reject) => {
    const reqData = JSON.stringify(data);
    const req = https.request(new URL(`https://slack.com/api${endpoint}`), {
      method,
      headers: {
        'Authorization': `Bearer ${config.slackToken}`,
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(reqData),
      },
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (!json.ok) {
            // Rate limited — retry with backoff
            if (json.error === 'ratelimited' && _retryCount < MAX_RETRIES) {
              const retryAfter = parseInt(res.headers['retry-after'] || '5', 10);
              const delay = Math.max(retryAfter, 2 ** _retryCount) * 1000;
              logger.warn(`Rate limited on ${endpoint}, retrying in ${delay / 1000}s (attempt ${_retryCount + 1}/${MAX_RETRIES})`);
              setTimeout(() => {
                slackApiRequest(method, endpoint, data, _retryCount + 1)
                  .then(resolve).catch(reject);
              }, delay);
              return;
            }
            reject(new Error(`Slack API error: ${json.error} (${json.detail || json.response_metadata?.messages?.join('; ') || 'no detail'})`));
          } else {
            resolve(json);
          }
        } catch (e) {
          reject(new Error(`Failed to parse Slack response: ${e.message}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Slack API request timeout')); });
    req.setTimeout(15000);
    req.write(reqData);
    req.end();
  });
}

/**
 * Form-urlencoded POST to Slack API (required by files.* endpoints).
 */
export async function slackFormRequest(endpoint, params) {
  return new Promise((resolve, reject) => {
    const formData = Object.entries(params)
      .map(([k, v]) => k + '=' + encodeURIComponent(v))
      .join('&');
    const req = https.request(new URL(`https://slack.com/api${endpoint}`), {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.slackToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(formData),
      },
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (!json.ok) reject(new Error(`Slack API error: ${json.error}`));
          else resolve(json);
        } catch (e) { reject(new Error(`Failed to parse response: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000);
    req.write(formData);
    req.end();
  });
}

/**
 * POST raw content to a Slack upload URL.
 */
export async function uploadToUrl(uploadUrl, content, contentType = 'text/markdown') {
  return new Promise((resolve, reject) => {
    const url = new URL(uploadUrl);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: { 'Content-Type': contentType, 'Content-Length': Buffer.byteLength(content) },
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(body);
        else reject(new Error(`Upload failed: HTTP ${res.statusCode}`));
      });
    });
    req.on('error', reject);
    req.setTimeout(30000);
    req.write(content);
    req.end();
  });
}

/**
 * 3-step file upload: getUploadURL → upload content → complete.
 * Returns the Slack file ID.
 * @param {string} filename
 * @param {Buffer|string} content
 * @param {string} [contentType] - MIME type (default: text/markdown, auto-detects for common extensions)
 */
export async function uploadFile(filename, content, contentType) {
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8');
  if (!contentType) {
    const ext = filename.split('.').pop()?.toLowerCase();
    contentType = { zip: 'application/zip', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif' }[ext] || 'text/markdown';
  }
  const urlResp = await slackFormRequest('/files.getUploadURLExternal', {
    filename,
    length: buf.length,
  });
  await uploadToUrl(urlResp.upload_url, buf, contentType);
  await slackApiRequest('POST', '/files.completeUploadExternal', {
    files: [{ id: urlResp.file_id, title: filename }],
  });
  return urlResp.file_id;
}

/**
 * Get all rows from a Slack List (with pagination).
 */
export async function getListItems(listId, limit = 100) {
  const allItems = [];
  let cursor = null;
  while (true) {
    const payload = { list_id: listId, limit };
    if (cursor) payload.cursor = cursor;
    const result = await slackApiRequest('POST', '/slackLists.items.list', payload);
    allItems.push(...(result.items || []));
    cursor = result.response_metadata?.next_cursor;
    if (!cursor) break;
  }
  return allItems;
}

/**
 * Create a new row in a Slack List.
 * @param {string} parentItemId - Optional parent row ID for native subtasks
 */
export async function createListRow(listId, initialFields, parentItemId = null) {
  const payload = { list_id: listId, initial_fields: initialFields };
  if (parentItemId) payload.parent_item_id = parentItemId;
  return slackApiRequest('POST', '/slackLists.items.create', payload);
}

/**
 * Update cells in existing Slack List rows (batch).
 */
export async function updateListCells(listId, cells) {
  return slackApiRequest('POST', '/slackLists.items.update', {
    list_id: listId,
    cells,
  });
}

/**
 * Fetch recent messages from a channel (conversations.history).
 */
export async function getChannelHistory(channelId, { limit = 20, oldest, latest } = {}) {
  const payload = { channel: channelId, limit };
  if (oldest) payload.oldest = oldest;
  if (latest) payload.latest = latest;
  return slackApiRequest('POST', '/conversations.history', payload);
}

/**
 * Post a message to a channel (optionally as a thread reply).
 * Returns the full Slack response including ts (message timestamp).
 */
export async function postMessage(channelId, text, { threadTs, unfurlLinks } = {}) {
  const payload = { channel: channelId, text, unfurl_links: unfurlLinks ?? false };
  if (threadTs) payload.thread_ts = threadTs;
  return slackApiRequest('POST', '/chat.postMessage', payload);
}

/**
 * Delete a row from a Slack List.
 */
export async function deleteListRow(listId, itemId) {
  return slackApiRequest('POST', '/slackLists.items.delete', {
    list_id: listId,
    id: itemId,
  });
}
