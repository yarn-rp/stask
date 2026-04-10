#!/usr/bin/env node
/**
 * pr-status.mjs — Stateless PR query: fetch comments and merge status from GitHub.
 *
 * Usage: node pr-status.mjs <task-id>
 *
 * No local state files. GitHub is the single source of truth.
 * Returns yanComments + otherComments for the heartbeat to act on.
 */

import { execSync } from 'child_process';
import { findTask } from './tracker-db.mjs';
import { CONFIG } from './env.mjs';

const GH = 'gh';
const YAN_GITHUB = CONFIG.human.githubUsername;

const taskId = process.argv[2];

if (!taskId) {
  console.error('Usage: node pr-status.mjs <task-id>');
  process.exit(1);
}

const task = findTask(taskId);
if (!task) {
  console.error(`ERROR: Task ${taskId} not found`);
  process.exit(1);
}

const prUrl = task['PR'];
if (!prUrl || prUrl === 'None') {
  console.error(`ERROR: Task ${taskId} has no PR URL`);
  process.exit(1);
}

const prMatch = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
if (!prMatch) {
  console.error(`ERROR: Could not parse PR URL: ${prUrl}`);
  process.exit(1);
}

const [, owner, repo, prNumber] = prMatch;

// ─── Fetch PR info ────────────────────────────────────────────────

let prInfo;
try {
  prInfo = JSON.parse(execSync(
    `${GH} api repos/${owner}/${repo}/pulls/${prNumber}`,
    { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
  ));
} catch (err) {
  console.error(`ERROR: Could not fetch PR info: ${err.message}`);
  process.exit(1);
}

const isDraft = prInfo.draft === true;
const isMerged = prInfo.merged === true;
const prState = prInfo.state;

// ─── Fetch all comments ───────────────────────────────────────────

let issueComments = [];
try {
  issueComments = JSON.parse(execSync(
    `${GH} api repos/${owner}/${repo}/issues/${prNumber}/comments --paginate`,
    { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
  ));
} catch {}

let reviewComments = [];
try {
  reviewComments = JSON.parse(execSync(
    `${GH} api repos/${owner}/${repo}/pulls/${prNumber}/comments --paginate`,
    { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
  ));
} catch {}

let reviews = [];
try {
  reviews = JSON.parse(execSync(
    `${GH} api repos/${owner}/${repo}/pulls/${prNumber}/reviews --paginate`,
    { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
  ));
} catch {}

// ─── Normalize and split by author ────────────────────────────────

const allComments = [
  ...issueComments.map(c => ({
    id: c.id, type: 'issue', author: c.user?.login || 'unknown',
    body: c.body, path: null, line: null, createdAt: c.created_at,
    updatedAt: c.updated_at, htmlUrl: c.html_url,
  })),
  ...reviewComments.map(c => ({
    id: c.id, type: 'review', author: c.user?.login || 'unknown',
    body: c.body, path: c.path, line: c.line || c.original_line,
    createdAt: c.created_at, updatedAt: c.updated_at, htmlUrl: c.html_url,
  })),
  ...reviews.filter(r => r.body && r.body.trim()).map(r => ({
    id: r.id, type: 'pr-review', author: r.user?.login || 'unknown',
    body: r.body, path: null, line: null, createdAt: r.submitted_at,
    updatedAt: r.submitted_at, htmlUrl: r.html_url,
    reviewState: r.state,
  })),
];

const yanComments = allComments.filter(c => c.author === YAN_GITHUB);
const otherComments = allComments.filter(c => c.author !== YAN_GITHUB);

const output = {
  taskId, prUrl, isDraft, isMerged, state: prState,
  totalComments: allComments.length,
  yanComments,
  otherComments,
};

console.log(JSON.stringify(output, null, 2));
