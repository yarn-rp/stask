/**
 * github.mjs — GitHub source for the inbox subscription engine.
 *
 * Shells out to `gh api` CLI — no raw HTTP requests.
 * Detects: PR merged, PR comments (issue, review, and review comments).
 *
 * Auth: handled by `gh` CLI (keychain / config file).
 * Pagination: `--paginate` flag.
 * Rate limits: `gh` handles automatically.
 */

import { execSync } from 'child_process';
import { fingerprint } from '../fingerprint.mjs';

const GH = 'gh';

/**
 * Execute gh api with exponential backoff retry for 5xx errors.
 */
function ghApi(endpoint) {
  const cmd = `${GH} api "${endpoint}" --paginate`;
  let lastError;
  const maxRetries = 3;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000 });
      return JSON.parse(result);
    } catch (err) {
      lastError = err;
      const status = err.status;
      // Only retry on 5xx server errors
      if (!status || status < 500 || status >= 600) {
        throw new Error(`gh api ${endpoint} failed: ${err.message}`);
      }
      if (attempt === maxRetries) {
        throw new Error(`gh api ${endpoint} failed after ${maxRetries} retries: ${err.message}`);
      }
      const delayMs = Math.pow(2, attempt) * 1000;  // 1s, 2s, 4s
      console.error(`5xx error on gh api ${endpoint}, attempt ${attempt + 1}, retrying in ${delayMs}ms...`);
      const start = Date.now();
      while (Date.now() - start < delayMs) {
        // Busy wait
      }
    }
  }
  throw lastError;
}

/**
 * Fetch new GitHub events for a subscription since last_cursor.
 *
 * @param {Object} sub - Subscription row from inbox_subs
 * @returns {{ events: Array, cursor: string }}
 */
export function fetchGitHubEvents(sub) {
  const [owner, repo] = sub.target_id.split('/');
  const since = sub.last_cursor || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const events = [];

  // 1. Fetch closed PRs — check for merges
  try {
    const closedPrs = ghApi(`repos/${owner}/${repo}/pulls?state=closed&sort=updated&direction=desc`);
    for (const pr of closedPrs) {
      if (!pr.merged_at) continue;  // closed but not merged
      if (pr.merged_at <= since) continue;  // already seen

      events.push({
        source_type: 'github',
        source_id: `${owner}/${repo}#${pr.number}`,
        event_type: 'pr_merged',
        title: pr.title || `PR #${pr.number}`,
        body: (pr.body || '').slice(0, 10000),
        url: pr.html_url,
        author: pr.user?.login || 'unknown',
        occurred_at: pr.merged_at,
        source_raw: JSON.stringify(pr).slice(0, 50000),
        // Extra context for PR-task linking
        pr_url: pr.html_url,
        pr_number: pr.number,
      });
    }
  } catch (err) {
    console.error(`GitHub fetch error (closed PRs): ${err.message}`);
  }

  // 2. Fetch PRs that are open or recently closed to check for comments
  //    We need to check each PR that was updated since last poll
  try {
    const updatedPrs = ghApi(`repos/${owner}/${repo}/pulls?state=all&sort=updated&direction=desc`);
    for (const pr of updatedPrs) {
      if (pr.updated_at <= since) continue;  // no changes since last poll
      if (pr.merged_at && pr.merged_at > since) continue;  // already captured as pr_merged

      // Fetch issue comments
      try {
        const issueComments = ghApi(`repos/${owner}/${repo}/issues/${pr.number}/comments`);
        for (const c of issueComments) {
          if (c.created_at <= since) continue;
          events.push({
            source_type: 'github',
            source_id: `${owner}/${repo}#${pr.number}`,
            event_type: 'comment_added',
            title: `Comment on PR #${pr.number}: ${pr.title || ''}`,
            body: (c.body || '').slice(0, 10000),
            url: c.html_url,
            author: c.user?.login || 'unknown',
            occurred_at: c.created_at,
            source_raw: JSON.stringify(c).slice(0, 50000),
            pr_url: pr.html_url,
            pr_number: pr.number,
          });
        }
      } catch {}

      // Fetch review comments
      try {
        const reviewComments = ghApi(`repos/${owner}/${repo}/pulls/${pr.number}/comments`);
        for (const c of reviewComments) {
          if (c.created_at <= since) continue;
          events.push({
            source_type: 'github',
            source_id: `${owner}/${repo}#${pr.number}`,
            event_type: 'comment_added',
            title: `Review comment on PR #${pr.number}: ${pr.title || ''}`,
            body: (c.body || '').slice(0, 10000),
            url: c.html_url,
            author: c.user?.login || 'unknown',
            occurred_at: c.created_at,
            source_raw: JSON.stringify(c).slice(0, 50000),
            pr_url: pr.html_url,
            pr_number: pr.number,
          });
        }
      } catch {}

      // Fetch reviews
      try {
        const reviews = ghApi(`repos/${owner}/${repo}/pulls/${pr.number}/reviews`);
        for (const r of reviews) {
          if (!r.body || !r.body.trim()) continue;
          if (r.submitted_at <= since) continue;
          events.push({
            source_type: 'github',
            source_id: `${owner}/${repo}#${pr.number}`,
            event_type: 'comment_added',
            title: `Review on PR #${pr.number}: ${pr.title || ''}`,
            body: (r.body || '').slice(0, 10000),
            url: r.html_url,
            author: r.user?.login || 'unknown',
            occurred_at: r.submitted_at,
            source_raw: JSON.stringify(r).slice(0, 50000),
            pr_url: pr.html_url,
            pr_number: pr.number,
          });
        }
      } catch {}
    }
  } catch (err) {
    console.error(`GitHub fetch error (updated PRs): ${err.message}`);
  }

  // Cursor = current time (next poll picks up from here)
  const cursor = new Date().toISOString();

  return { events, cursor };
}

/**
 * Shell out to `gh api` and parse JSON.
 * Handles pagination via --paginate flag.
 * (Removed - now integrated into ghApi function above)
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