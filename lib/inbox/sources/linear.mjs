/**
 * linear.mjs — Linear source for the inbox subscription engine.
 *
 * Shells out to `linear` CLI (schpet/linear-cli) — no raw GraphQL requests.
 * Detects: ticket assignment to the authenticated user.
 *
 * Auth: handled by `linear` CLI (API key from `linear auth login`).
 * Output: `--json` flag for structured data.
 */

import { execSync } from 'child_process';
import { fingerprint } from '../fingerprint.mjs';

const LINEAR = 'linear';

/**
 * Execute linear CLI with exponential backoff retry for 5xx errors.
 */
function linearMine() {
  const cmd = `${LINEAR} issue mine --json`;
  let lastError;
  const maxRetries = 3;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000 });
      const parsed = JSON.parse(result);

      // `linear issue mine --json` may return an array or { issues: [...] }
      if (Array.isArray(parsed)) return parsed;
      if (parsed.issues) return parsed.issues;
      if (parsed.data) return Array.isArray(parsed.data) ? parsed.data : [parsed.data];
      return [];
    } catch (err) {
      lastError = err;
      const status = err.status;
      // Only retry on 5xx server errors
      if (!status || status < 500 || status >= 600) {
        throw new Error(`linear issue mine failed: ${err.message}`);
      }
      if (attempt === maxRetries) {
        throw new Error(`linear issue mine failed after ${maxRetries} retries: ${err.message}`);
      }
      const delayMs = Math.pow(2, attempt) * 1000;  // 1s, 2s, 4s
      console.error(`5xx error on linear issue mine, attempt ${attempt + 1}, retrying in ${delayMs}ms...`);
      const start = Date.now();
      while (Date.now() - start < delayMs) {
        // Busy wait
      }
    }
  }
  throw lastError;
}

/**
 * Fetch new Linear events for a subscription since last_cursor.
 *
 * Uses `linear issue mine --json` to get issues assigned to the
 * authenticated user. Compares against last_cursor (stored issue IDs)
 * to detect new assignments.
 *
 * @param {Object} sub - Subscription row from inbox_subs
 * @returns {{ events: Array, cursor: string }}
 */
export function fetchLinearEvents(sub) {
  const events = [];
  const knownIds = sub.last_cursor ? new Set(sub.last_cursor.split(',')) : new Set();

  try {
    const issues = linearMine();

    for (const issue of issues) {
      const issueId = issue.identifier || issue.id;
      if (knownIds.has(issueId)) continue;  // already seen

      events.push({
        source_type: 'linear',
        source_id: issueId,
        event_type: 'ticket_assigned',
        title: issue.title || `Ticket ${issueId}`,
        body: (issue.description || '').slice(0, 10000),
        url: issue.url || `https://linear.app/issue/${issueId}`,
        author: issue.assignee?.name || issue.assignee?.displayName || 'unknown',
        occurred_at: issue.createdAt || issue.created_at || new Date().toISOString(),
        source_raw: JSON.stringify(issue).slice(0, 50000),
      });
    }

    // Update cursor: all known issue IDs (existing + new)
    const allIds = [...knownIds, ...events.map(e => e.source_id)];
    const cursor = allIds.join(',');

    return { events, cursor };
  } catch (err) {
    console.error(`Linear fetch error: ${err.message}`);
    // Return empty events but keep existing cursor on error
    return { events: [], cursor: sub.last_cursor || '' };
  }
}

/**
 * Shell out to `linear issue mine --json` and parse the result.
 * (Removed - now integrated into linearMine function above with retry)
 */

/**
 * Add fingerprints to a list of raw events.
 * Called by the pollerd after fetch.
 */
export function addFingerprints(events) {
  return events.map(e => ({
    ...e,
    fingerprint: fingerprint(e.source_type, e.source_id, e.event_type, e.occurred_at),
  }));
}