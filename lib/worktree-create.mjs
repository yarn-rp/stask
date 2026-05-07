#!/usr/bin/env node
/**
 * worktree-create.mjs — Create a git worktree for a parent task in
 * EVERY configured repo.
 *
 * Multi-repo projects: a single shared branch name is created in every
 * repo listed in `config.repos`, so backend and frontend (or however
 * many repos a project spans) can be tested end-to-end with the same
 * branch name on both sides. The `worktree` column is stored as a JSON
 * array of `{repo, branch, path}` entries — see formatWorktrees in
 * tracker-db.mjs.
 *
 * Branch name source order:
 *   1. If `task.jira_key` is set and Jira's dev-tools panel has a linked
 *      branch, reuse that name across all repos.
 *   2. Fall back to `<prefix>/<slug>` from validate.mjs, with a -<id>
 *      collision suffix if the branch already exists in the host repo.
 *
 * Failure handling: if any repo's `git worktree add` fails partway
 * through, roll back the worktrees already created in this run so we
 * never leave the task in a half-created state.
 *
 * Usage: node worktree-create.mjs <task-id>
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import {
  findTask, updateTask, addLogEntry, formatWorktrees, parseWorktrees,
} from './tracker-db.mjs';
import { slugifyTaskName, branchPrefixForType } from './validate.mjs';
import { CONFIG } from './env.mjs';
import { getLinkedBranch } from './jira-cli.mjs';

const REPOS = CONFIG.repos;
const WORKTREE_BASE = CONFIG.worktreeBaseDir;
const HOST_REPO = REPOS[0].path;  // host repo — used for branch-collision check

function resolveBaseBranch(repoPath) {
  const configured = CONFIG.baseBranch;
  if (configured) {
    try {
      execSync(`git rev-parse --verify ${configured}`, { cwd: repoPath, stdio: 'pipe' });
      return configured;
    } catch {
      // configured branch missing in this repo — fall through to defaults
    }
  }
  for (const candidate of ['main', 'dev']) {
    try {
      execSync(`git rev-parse --verify ${candidate}`, { cwd: repoPath, stdio: 'pipe' });
      return candidate;
    } catch {}
  }
  return null;
}

function branchExistsLocal(repoPath, branchName) {
  try {
    const out = execSync(`git branch --list "${branchName}"`, { cwd: repoPath, encoding: 'utf-8' });
    return Boolean(out.trim());
  } catch {
    return false;
  }
}

function existingWorktreeForBranch(repoPath, branchName) {
  try {
    const out = execSync('git worktree list --porcelain', { cwd: repoPath, encoding: 'utf-8' });
    const lines = out.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] === `branch refs/heads/${branchName}`) {
        const wtLine = lines.slice(0, i).reverse().find((l) => l.startsWith('worktree '));
        if (wtLine) return wtLine.replace('worktree ', '').trim();
      }
    }
  } catch {}
  return null;
}

function safeRemoveWorktree(repoPath, wtPath) {
  if (!fs.existsSync(wtPath)) return;
  try {
    execSync(`git worktree remove "${wtPath}" --force`, { cwd: repoPath, stdio: 'pipe' });
  } catch {
    try { fs.rmSync(wtPath, { recursive: true, force: true }); } catch {}
    try { execSync('git worktree prune', { cwd: repoPath, stdio: 'pipe' }); } catch {}
  }
}

function deriveBranchName(task) {
  const slug = slugifyTaskName(task['Task Name']);
  const prefix = branchPrefixForType(task['Type']);

  // 1. Jira dev-tools branch (best effort)
  if (task.jira_key) {
    try {
      const linked = getLinkedBranch(task.jira_key);
      if (linked) return linked;
    } catch {}
  }

  // 2. Slug-based default with collision suffix
  let branchName = `${prefix}/${slug}`;
  if (branchExistsLocal(HOST_REPO, branchName)) {
    branchName = `${prefix}/${slug}-${task['Task ID'].toLowerCase()}`;
    console.log(`Branch name collision in host repo. Using: ${branchName}`);
  }
  return branchName;
}

function createWorktreeInRepo(repo, branchName, slug) {
  const repoPath = repo.path;
  const repoKey = repo.key;
  const wtPath = path.join(WORKTREE_BASE, slug, repoKey);

  // Reuse existing worktree if the branch already has one — matches
  // single-repo behavior. Useful when a previous run partially succeeded.
  const existingWtPath = existingWorktreeForBranch(repoPath, branchName);
  if (existingWtPath) {
    console.log(`[${repoKey}] Reusing existing worktree: ${existingWtPath}`);
    return { repo: repoKey, branch: branchName, path: existingWtPath };
  }

  // Clean up any stale dir or branch reference at our target path.
  if (fs.existsSync(wtPath)) {
    safeRemoveWorktree(repoPath, wtPath);
  }

  const baseBranch = resolveBaseBranch(repoPath);
  if (!baseBranch) {
    throw new Error(`[${repoKey}] No base branch available (tried ${CONFIG.baseBranch || 'main/dev'})`);
  }

  try {
    execSync(`git fetch origin ${baseBranch}`, { cwd: repoPath, stdio: 'pipe' });
  } catch (err) {
    console.warn(`[${repoKey}] WARN: fetch origin/${baseBranch} failed (continuing): ${err.message}`);
  }

  const branchAlreadyExists = branchExistsLocal(repoPath, branchName);
  const cmd = branchAlreadyExists
    ? `git worktree add "${wtPath}" "${branchName}"`
    : `git worktree add "${wtPath}" -b "${branchName}" ${baseBranch}`;

  execSync(cmd, { cwd: repoPath, stdio: 'pipe' });
  console.log(`[${repoKey}] Worktree created: ${wtPath} (base: ${baseBranch})`);
  return { repo: repoKey, branch: branchName, path: wtPath };
}

function rollbackWorktrees(created) {
  for (const entry of created) {
    const repo = REPOS.find((r) => r.key === entry.repo);
    if (!repo) continue;
    try {
      safeRemoveWorktree(repo.path, entry.path);
      console.log(`[rollback] Removed ${entry.repo}: ${entry.path}`);
    } catch {}
  }
}

// ─── Main ──────────────────────────────────────────────────────────

const taskId = process.argv[2];

if (!taskId) {
  console.error('Usage: node worktree-create.mjs <task-id>');
  process.exit(1);
}

const task = findTask(taskId);

if (!task) {
  console.error(`ERROR: Task ${taskId} not found`);
  process.exit(1);
}

if (task['Parent'] !== 'None') {
  console.error(`ERROR: ${taskId} is a subtask. Worktrees are only created for parent tasks.`);
  process.exit(1);
}

const existing = parseWorktrees(task['Worktree']);
if (existing.length > 0) {
  console.log(`Worktree already set for ${taskId} (${existing.length} repo${existing.length > 1 ? 's' : ''}). Skipping.`);
  process.exit(0);
}

if (!fs.existsSync(WORKTREE_BASE)) {
  fs.mkdirSync(WORKTREE_BASE, { recursive: true });
}

const slug = slugifyTaskName(task['Task Name']);
const branchName = deriveBranchName(task);

const created = [];
try {
  for (const repo of REPOS) {
    const entry = createWorktreeInRepo(repo, branchName, slug);
    created.push(entry);
  }
} catch (err) {
  console.error(`ERROR: ${err.message}`);
  console.error('Rolling back worktrees created in this run...');
  rollbackWorktrees(created);
  process.exit(1);
}

const wtValue = formatWorktrees(created);
updateTask(taskId, { worktree: wtValue });

const summary = created.map((e) => `${e.repo}=${e.path}`).join(', ');
addLogEntry(taskId, `${taskId} "${task['Task Name']}": Worktrees created in ${created.length} repo${created.length > 1 ? 's' : ''}. Branch: ${branchName}. ${summary}`);

console.log(`${taskId}: ${created.length} worktree${created.length > 1 ? 's' : ''} created | Branch: ${branchName}`);
for (const e of created) console.log(`  ${e.repo}: ${e.path}`);
