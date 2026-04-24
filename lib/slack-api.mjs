/**
 * slack-api.mjs — Slack API helpers shared across sync scripts.
 */

import https from 'https';
import fs from 'fs';
import { logError } from './error-logger.mjs';

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
 * Classify an error as transient (worth retrying) or permanent (fail immediately).
 * Transient: rate limits, network errors, timeouts, HTTP 5xx
 * Permanent: auth failures, missing scopes, not found, invalid args
 */
export function isTransient(error) {
  const msg = typeof error === 'string' ? error : error?.message ?? String(error);

  // Permanent errors — retrying won't help
  const permanentPatterns = [
    'invalid_auth',
    'missing_scope',
    'channel_not_found',
    'invalid_arg',
    'not_authed',
    'account_inactive',
    'token_revoked',
    'no_permission',
    'user_not_found',
    'invalid_blocks',
    'invalid_form_data',
  ];
  for (const pattern of permanentPatterns) {
    if (msg.includes(pattern)) return false;
  }

  // Transient errors — worth retrying
  const transientPatterns = [
    'ratelimited',
    'ECONNRESET',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'ENOTFOUND',
    'EAI_AGAIN',
    'socket hang up',
    'request timeout',
    'network',
    'HTTP 5',  // catches 500, 502, 503, 504
    'overloaded',
    'fatal_error',       // Slack internal server error
    'service_unavailable',
  ];
  for (const pattern of transientPatterns) {
    if (msg.toLowerCase().includes(pattern.toLowerCase())) return true;
  }

  // HTTP 5xx status codes from uploadToUrl or form requests
  if (error?.statusCode >= 500 && error?.statusCode < 600) return true;

  // Unknown errors — assume transient (safer to retry once than to lose data)
  return true;
}

/**
 * JSON POST to Slack API with automatic retry on transient errors.
 * Retries up to 5 times with exponential backoff (1s, 2s, 4s, 8s, 16s).
 * Respects Retry-After header for rate limits.
 * Non-transient errors fail immediately without retry.
 */
export async function slackApiRequest(method, endpoint, data, _retryCount = 0) {
  const MAX_RETRIES = 5;
  const BACKOFF_BASE = 1000; // 1s

  try {
    return await new Promise((resolve, reject) => {
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
              const apiError = new Error(`Slack API error: ${json.error} (${json.detail || json.response_metadata?.messages?.join('; ') || 'no detail'})`);
              apiError.slackError = json.error;
              apiError.statusCode = res.statusCode;

              // Check if error is transient and we have retries left
              if (isTransient(apiError) && _retryCount < MAX_RETRIES) {
                const retryAfterMs = json.error === 'ratelimited'
                  ? Math.max(parseInt(res.headers['retry-after'] || '5', 10), 1) * 1000
                  : BACKOFF_BASE * (2 ** _retryCount);
                logger.warn(`Transient error on ${endpoint}: ${json.error}, retrying in ${retryAfterMs / 1000}s (attempt ${_retryCount + 1}/${MAX_RETRIES})`);
                setTimeout(() => {
                  slackApiRequest(method, endpoint, data, _retryCount + 1)
                    .then(resolve).catch(reject);
                }, retryAfterMs);
                return;
              }

              // Non-transient or retries exhausted
              if (_retryCount >= MAX_RETRIES && isTransient(apiError)) {
                logError({
                  source: 'slack-api',
                  operation: `slackApiRequest:${endpoint}`,
                  error: apiError.message,
                  retries: MAX_RETRIES,
                  metadata: { method, endpoint, slackError: json.error },
                });
              }
              reject(apiError);
            } else {
              resolve(json);
            }
          } catch (e) {
            // Parse failures are likely transient (truncated response, etc.)
            const parseError = new Error(`Failed to parse Slack response: ${e.message}`);
            parseError.slackError = 'parse_error';
            if (_retryCount < MAX_RETRIES) {
              const delay = BACKOFF_BASE * (2 ** _retryCount);
              logger.warn(`Parse error on ${endpoint}, retrying in ${delay / 1000}s (attempt ${_retryCount + 1}/${MAX_RETRIES})`);
              setTimeout(() => {
                slackApiRequest(method, endpoint, data, _retryCount + 1)
                  .then(resolve).catch(reject);
              }, delay);
              return;
            }
            logError({
              source: 'slack-api',
              operation: `slackApiRequest:${endpoint}`,
              error: parseError.message,
              retries: MAX_RETRIES,
              metadata: { method, endpoint },
            });
            reject(parseError);
          }
        });
      });
      req.on('error', (err) => {
        // Network errors — always transient
        if (_retryCount < MAX_RETRIES) {
          const delay = BACKOFF_BASE * (2 ** _retryCount);
          logger.warn(`Network error on ${endpoint}: ${err.message}, retrying in ${delay / 1000}s (attempt ${_retryCount + 1}/${MAX_RETRIES})`);
          setTimeout(() => {
            slackApiRequest(method, endpoint, data, _retryCount + 1)
              .then(resolve).catch(reject);
          }, delay);
          return;
        }
        logError({
          source: 'slack-api',
          operation: `slackApiRequest:${endpoint}`,
          error: err.message,
          retries: MAX_RETRIES,
          metadata: { method, endpoint, code: err.code },
        });
        reject(err);
      });
      req.on('timeout', () => {
        req.destroy();
        const timeoutError = new Error('Slack API request timeout');
        if (_retryCount < MAX_RETRIES) {
          const delay = BACKOFF_BASE * (2 ** _retryCount);
          logger.warn(`Timeout on ${endpoint}, retrying in ${delay / 1000}s (attempt ${_retryCount + 1}/${MAX_RETRIES})`);
          setTimeout(() => {
            slackApiRequest(method, endpoint, data, _retryCount + 1)
              .then(resolve).catch(reject);
          }, delay);
          return;
        }
        logError({
          source: 'slack-api',
          operation: `slackApiRequest:${endpoint}`,
          error: timeoutError.message,
          retries: MAX_RETRIES,
          metadata: { method, endpoint },
        });
        reject(timeoutError);
      });
      req.setTimeout(15000);
      req.write(reqData);
      req.end();
    });
  } catch (err) {
    // Catch synchronous throws (shouldn't happen but defensive)
    if (isTransient(err) && _retryCount < MAX_RETRIES) {
      const delay = BACKOFF_BASE * (2 ** _retryCount);
      await new Promise(r => setTimeout(r, delay));
      return slackApiRequest(method, endpoint, data, _retryCount + 1);
    }
    throw err;
  }
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
 * If step 2 or 3 fails, logs the partial failure so we know the URL was
 * obtained but the file wasn't fully uploaded.
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

  // Step 1: Get upload URL
  let urlResp;
  try {
    urlResp = await slackFormRequest('/files.getUploadURLExternal', {
      filename,
      length: buf.length,
    });
  } catch (err) {
    logError({
      source: 'slack-api',
      operation: 'uploadFile:getUploadURL',
      error: err.message,
      metadata: { filename },
    });
    throw err;
  }

  // Step 2: Upload content to the URL
  try {
    await uploadToUrl(urlResp.upload_url, buf, contentType);
  } catch (uploadErr) {
    // Partial state: we have a file_id and upload URL but content wasn't uploaded.
    // Log the partial failure with enough info to retry manually if needed.
    logError({
      source: 'slack-api',
      operation: 'uploadFile:uploadToUrl',
      error: uploadErr.message,
      metadata: {
        filename,
        fileId: urlResp.file_id,
        uploadUrl: urlResp.upload_url,
        phase: 'step2-upload-failed',
      },
    });
    throw uploadErr;
  }

  // Step 3: Complete the upload
  try {
    await slackApiRequest('POST', '/files.completeUploadExternal', {
      files: [{ id: urlResp.file_id, title: filename }],
    });
  } catch (completeErr) {
    // Partial state: content was uploaded but completion failed.
    // The file exists in Slack's upload system but isn't finalized.
    logError({
      source: 'slack-api',
      operation: 'uploadFile:completeUpload',
      error: completeErr.message,
      metadata: {
        filename,
        fileId: urlResp.file_id,
        phase: 'step3-complete-failed',
      },
    });
    throw completeErr;
  }

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
  const result = await slackApiRequest('POST', '/slackLists.items.create', payload);

  // Verify parent linkage: if we requested a parent, ensure the created item is actually a child
  // Note: Slack returns the parent as 'parent_record_id', not 'parent_item_id'
  if (parentItemId && result.item) {
    const createdParent = result.item.parent_record_id || result.item.parent_item_id;
    if (!createdParent || createdParent !== parentItemId) {
      // Slack created a top-level row instead of a child — clean up and throw
      const rowId = result.item.id;
      console.error(`WARNING: Slack created row ${rowId} at top level instead of under parent ${parentItemId}. Got parent_record_id=${result.item.parent_record_id}, parent_item_id=${result.item.parent_item_id}. Cleaning up.`);
      try {
        await slackApiRequest('POST', '/slackLists.items.delete', { list_id: listId, item_id: rowId });
      } catch {}
      throw new Error(`Slack failed to link subtask to parent ${parentItemId}. Row created at top level and was deleted.`);
    }
  }

  return result;
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
 *
 * Uses GET with query params because Slack's JSON-body POST variant
 * returns `channel_not_found` on Slack-Lists comment channels
 * (is_thread_only / is_file). GET with form-encoded params works for
 * both regular channels and list channels, so we use it uniformly.
 */
export async function getChannelHistory(channelId, { limit = 20, oldest, latest } = {}) {
  const qs = new URLSearchParams({ channel: channelId, limit: String(limit) });
  if (oldest) qs.set('oldest', String(oldest));
  if (latest) qs.set('latest', String(latest));

  return new Promise((resolve, reject) => {
    const req = https.request(new URL(`https://slack.com/api/conversations.history?${qs}`), {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${config.slackToken}` },
    }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (!json.ok) {
            const err = new Error(`Slack API error: ${json.error} (${json.detail || 'no detail'})`);
            err.slackError = json.error;
            reject(err);
          } else {
            resolve(json);
          }
        } catch (e) {
          reject(new Error(`Slack API returned non-JSON (${res.statusCode}): ${body.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
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
