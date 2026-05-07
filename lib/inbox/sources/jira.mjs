/**
 * jira.mjs — Jira source for the inbox subscription engine.
 *
 * Shells out to the `jira` CLI (https://github.com/ankitpokhrel/jira-cli)
 * — same pattern as the GitHub source, which uses `gh`. Stask never
 * authenticates against Jira directly: it expects `jira init` to have
 * been run already.
 *
 * The subscription's `target_id` is the Jira project key (e.g. "ACME").
 * Default filter is "issues assigned to me", overridable via the
 * subscription's `filters` JSON column.
 */

import { execFileSync } from 'node:child_process';
import { fingerprint } from '../fingerprint.mjs';

const JIRA = 'jira';

function jiraJson(args) {
  try {
    const out = execFileSync(JIRA, args, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30000,
    });
    if (!out || !out.trim()) return null;
    return JSON.parse(out);
  } catch (err) {
    const msg = err.stderr ? err.stderr.toString().trim() : err.message;
    throw new Error(`jira ${args.join(' ')} failed: ${msg}`);
  }
}

function whoami() {
  try {
    const out = execFileSync(JIRA, ['me'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30000,
    });
    return (out || '').trim() || null;
  } catch {
    return null;
  }
}

function isoSubtractMinutes(iso, minutes) {
  const t = new Date(iso).getTime() - minutes * 60_000;
  return new Date(t).toISOString();
}

/**
 * Fetch new Jira events for a subscription since `last_cursor`.
 *
 * @param {Object} sub - Subscription row from inbox_subs
 * @returns {{ events: Array, cursor: string }}
 */
export function fetchJiraEvents(sub) {
  const projectKey = sub.target_id;
  const filters = sub.filters ? safeJson(sub.filters) : null;
  const assignee = filters?.assignee || whoami() || 'me';

  const since = sub.last_cursor || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  // jira-cli's --updated-after expects YYYY-MM-DD; we trim to date.
  const sinceDate = since.slice(0, 10);

  const events = [];

  try {
    // Fetch issues updated since `sinceDate`, scoped to the project key
    // and to the configured assignee. `--raw` returns the full JSON the
    // Jira API gave us.
    const args = [
      'issue', 'list',
      '--project', projectKey,
      '--assignee', assignee,
      '--updated-after', sinceDate,
      '--paginate', '0:50',
      '--raw',
    ];
    const data = jiraJson(args);
    const issues = Array.isArray(data) ? data : (data?.issues || []);

    for (const issue of issues) {
      const key = issue.key || issue.id;
      const fields = issue.fields || {};
      const updatedAt = fields.updated || issue.updated || new Date().toISOString();
      if (updatedAt <= since) continue;

      const title = fields.summary || `Jira ${key}`;
      const author = fields.assignee?.displayName || fields.assignee?.emailAddress || 'unassigned';
      const url = issue.self ? guessBrowseUrl(issue.self, key) : null;
      const status = fields.status?.name || null;

      const baseEvent = {
        source_type: 'jira',
        source_id: key,
        author,
        url,
        body: (fields.description || '').slice(0, 10000),
        source_raw: JSON.stringify(issue).slice(0, 50000),
        // Carry through hints the inbox→task converter can use to pick
        // a primary repo (label/component matching).
        labels: Array.isArray(fields.labels) ? fields.labels : [],
        components: Array.isArray(fields.components) ? fields.components.map((c) => c.name).filter(Boolean) : [],
        jira_key: key,
      };

      // Emit one event per kind we can detect from the issue payload.
      // The CLI returns summary fields, not a full activity stream, so
      // we approximate: every fresh `updated_at` is treated as a
      // status_changed event when status moved within the window, plus
      // an assigned event if we just appeared as the assignee. Comments
      // ride on `comment_added` events surfaced via the comment list.
      events.push({
        ...baseEvent,
        event_type: 'updated',
        title: `${key}: ${title}` + (status ? ` [${status}]` : ''),
        occurred_at: updatedAt,
      });

      // Comments — only fetch detail when the issue was actually touched
      // recently, to keep the per-poll API budget bounded.
      const commentTotal = fields.comment?.total || fields.comment?.comments?.length || 0;
      if (commentTotal > 0) {
        const comments = fields.comment?.comments || [];
        for (const c of comments) {
          const created = c.created || c.updated;
          if (!created || created <= since) continue;
          events.push({
            ...baseEvent,
            event_type: 'comment_added',
            title: `Comment on ${key}: ${title}`,
            body: (c.body?.content ? renderAdf(c.body) : c.body || '').slice(0, 10000),
            author: c.author?.displayName || baseEvent.author,
            occurred_at: created,
          });
        }
      }
    }
  } catch (err) {
    console.error(`Jira fetch error: ${err.message}`);
  }

  // Cursor = current time minus a small overlap so we don't lose events
  // that landed during the poll itself.
  const cursor = isoSubtractMinutes(new Date().toISOString(), 1);

  return { events, cursor };
}

/**
 * Add fingerprints to a list of raw Jira events.
 */
export function addFingerprints(events) {
  return events.map((e) => ({
    ...e,
    fingerprint: fingerprint(e.source_type, e.source_id, e.event_type, e.occurred_at),
  }));
}

// ─── Helpers ───────────────────────────────────────────────────────

function safeJson(v) {
  try { return JSON.parse(v); } catch { return null; }
}

function guessBrowseUrl(selfUrl, key) {
  // self looks like https://acme.atlassian.net/rest/api/3/issue/12345
  // Convert to https://acme.atlassian.net/browse/<KEY>.
  try {
    const u = new URL(selfUrl);
    return `${u.origin}/browse/${key}`;
  } catch {
    return null;
  }
}

/**
 * Best-effort plain-text rendering of Atlassian Document Format (ADF).
 * Comments often come as ADF nodes; we walk them recursively and join
 * any `text` fields. Unknown shapes fall through.
 */
function renderAdf(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (typeof node.text === 'string') return node.text;
  const children = node.content || node.children || [];
  if (Array.isArray(children)) {
    return children.map(renderAdf).join('');
  }
  return '';
}
