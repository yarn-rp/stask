/**
 * jira-cli.mjs — Thin wrapper around the `jira` CLI
 * (https://github.com/ankitpokhrel/jira-cli).
 *
 * Same shape as our `gh` shell-out for GitHub: we assume `jira` is on
 * PATH and `jira init` has already been run by the user. Stask never
 * authenticates, never prompts for tokens — it just calls the CLI.
 *
 * Errors are surfaced to the caller. `stask doctor` is responsible for
 * the upfront installed/authenticated check.
 */

import { execFileSync } from 'node:child_process';

const JIRA = 'jira';

function runJira(args, { allowFail = false } = {}) {
  try {
    return execFileSync(JIRA, args, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30000,
    });
  } catch (err) {
    if (allowFail) return null;
    const msg = err.stderr ? err.stderr.toString() : err.message;
    throw new Error(`jira ${args.join(' ')} failed: ${msg.trim()}`);
  }
}

/**
 * Returns true iff the `jira` CLI is on PATH and `jira me` succeeds.
 */
export function isReady() {
  try {
    const out = runJira(['me'], { allowFail: true });
    return Boolean(out && out.trim());
  } catch {
    return false;
  }
}

/**
 * Returns the authenticated user's email/account id.
 */
export function whoami() {
  const out = runJira(['me']);
  return out.trim();
}

/**
 * Validate that the user can see the given Jira project key. Used as a
 * config sanity check on init / doctor.
 */
export function projectExists(projectKey) {
  if (!projectKey) return false;
  const out = runJira(['project', 'list', '--plain', '--no-headers'], { allowFail: true });
  if (!out) return false;
  const keys = out
    .split('\n')
    .map((l) => l.trim().split(/\s+/)[0])
    .filter(Boolean);
  return keys.includes(projectKey);
}

/**
 * Fetch raw JSON for a single issue. Returns the parsed object or null
 * if the CLI fails.
 */
export function viewIssue(jiraKey) {
  if (!jiraKey) return null;
  const out = runJira(['issue', 'view', jiraKey, '--raw'], { allowFail: true });
  if (!out) return null;
  try {
    return JSON.parse(out);
  } catch {
    return null;
  }
}

/**
 * Best-effort: read the linked git branch name from a Jira ticket's
 * dev-tools panel via `jira issue view --raw`. Returns null if no
 * branch is linked or if the JSON shape is unfamiliar.
 *
 * The shape varies by Jira install — we look in a few common spots:
 *  - `fields.development` (legacy)
 *  - top-level `development.branches[].name`
 *  - `properties` with a `development-summary` blob
 * If none match we return null and the caller falls back to a slug.
 */
export function getLinkedBranch(jiraKey) {
  const issue = viewIssue(jiraKey);
  if (!issue) return null;

  const candidates = [
    issue.development?.branches,
    issue.fields?.development?.branches,
    issue.properties?.development?.branches,
  ].filter(Array.isArray);

  for (const branches of candidates) {
    for (const b of branches) {
      const name = b?.name || b?.branchName;
      if (typeof name === 'string' && name.trim()) return name.trim();
    }
  }
  return null;
}

/**
 * List recently updated issues in a project, optionally filtered to the
 * authenticated user. Returns parsed `--raw` JSON (typically
 * `{ issues: [...] }`) or null on failure.
 */
export function listIssues({ projectKey, assigneeMe = true, updatedAfter, limit = 50 } = {}) {
  if (!projectKey) return null;
  const args = ['issue', 'list', '--project', projectKey, '--paginate', `0:${limit}`, '--raw'];
  if (assigneeMe) args.push('--assignee', '$(jira me)'.replace(/[$()]/g, ''));  // jira-cli accepts username
  if (updatedAfter) args.push('--updated-after', updatedAfter);
  const out = runJira(args, { allowFail: true });
  if (!out) return null;
  try { return JSON.parse(out); } catch { return null; }
}
