#!/usr/bin/env node
/**
 * worktree-cleanup.mjs — Remove every git worktree associated with a
 * task (one per configured repo) after task completion.
 *
 * Usage: node worktree-cleanup.mjs <task-id> [--force]
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { findTask, updateTask, addLogEntry, parseWorktrees } from './tracker-db.mjs';
import { CONFIG } from './env.mjs';

const REPOS = CONFIG.repos;

const taskId = process.argv[2];
const forceFlag = process.argv.includes('--force');

if (!taskId) {
  console.error('Usage: node worktree-cleanup.mjs <task-id> [--force]');
  process.exit(1);
}

const task = findTask(taskId);

if (!task) {
  console.error(`ERROR: Task ${taskId} not found`);
  process.exit(1);
}

const entries = parseWorktrees(task['Worktree']);
if (entries.length === 0) {
  console.log(`No worktree set for ${taskId}. Nothing to clean up.`);
  process.exit(0);
}

function repoPathForKey(key) {
  const r = REPOS.find((r) => r.key === key);
  // Fall back to the first repo if a stale key isn't in current config —
  // worst case `git worktree remove` errors out and we report it.
  return r ? r.path : REPOS[0].path;
}

let hadDirty = false;
const cleanedBranches = new Set();

for (const entry of entries) {
  const { branch, path: wtPath, repo } = entry;
  const repoPath = repoPathForKey(repo);

  if (fs.existsSync(wtPath)) {
    try {
      const status = execSync('git status --porcelain', { cwd: wtPath, encoding: 'utf-8' }).trim();
      if (status && !forceFlag) {
        console.error(`ERROR: Worktree at ${wtPath} (${repo}) has uncommitted changes:`);
        console.error(status);
        hadDirty = true;
        continue;
      }
    } catch {}

    try {
      execSync(`git worktree remove "${wtPath}" ${forceFlag ? '--force' : ''}`, { cwd: repoPath, stdio: 'pipe' });
      console.log(`[${repo}] Removed worktree: ${wtPath}`);
    } catch (err) {
      try {
        fs.rmSync(wtPath, { recursive: true, force: true });
        console.log(`[${repo}] Removed worktree directory manually: ${wtPath}`);
        execSync('git worktree prune', { cwd: repoPath, stdio: 'pipe' });
      } catch (rmErr) {
        console.error(`[${repo}] ERROR: Could not remove worktree directory: ${rmErr.message}`);
      }
    }
  } else {
    try { execSync('git worktree prune', { cwd: repoPath, stdio: 'pipe' }); } catch {}
  }

  // Delete the local branch in this repo. Many repos may share the same
  // branch name; we still try `git branch -d` per repo since each repo
  // has its own ref.
  try {
    execSync(`git branch -d "${branch}"`, { cwd: repoPath, stdio: 'pipe' });
    console.log(`[${repo}] Deleted local branch: ${branch}`);
    cleanedBranches.add(`${repo}:${branch}`);
  } catch {
    if (forceFlag) {
      try {
        execSync(`git branch -D "${branch}"`, { cwd: repoPath, stdio: 'pipe' });
        console.log(`[${repo}] Force-deleted local branch: ${branch}`);
        cleanedBranches.add(`${repo}:${branch}`);
      } catch (err) {
        console.error(`[${repo}] WARNING: Could not delete branch ${branch}: ${err.message}`);
      }
    } else {
      console.log(`[${repo}] Branch ${branch} not deleted (has unmerged changes). Use --force to delete.`);
    }
  }
}

if (hadDirty) {
  console.error('One or more worktrees had uncommitted changes. Use --force to remove anyway.');
  process.exit(1);
}

updateTask(taskId, { worktree: null });
addLogEntry(taskId, `${taskId} "${task['Task Name']}": Worktrees cleaned up across ${entries.length} repo${entries.length > 1 ? 's' : ''}.`);

console.log(`${taskId}: Cleaned up ${entries.length} worktree${entries.length > 1 ? 's' : ''}`);
