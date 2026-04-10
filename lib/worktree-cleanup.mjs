#!/usr/bin/env node
/**
 * worktree-cleanup.mjs — Remove a git worktree after task completion.
 *
 * Usage: node worktree-cleanup.mjs <task-id> [--force]
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { findTask, updateTask, addLogEntry, parseWorktreeValue } from './tracker-db.mjs';
import { CONFIG } from './env.mjs';

const REPO_PATH = CONFIG.projectRepoPath;

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

const wt = parseWorktreeValue(task['Worktree']);
if (!wt) {
  console.log(`No worktree set for ${taskId}. Nothing to clean up.`);
  process.exit(0);
}

const { branch, path: wtPath } = wt;

// Check for uncommitted changes
if (fs.existsSync(wtPath)) {
  try {
    const status = execSync('git status --porcelain', { cwd: wtPath, encoding: 'utf-8' }).trim();
    if (status && !forceFlag) {
      console.error(`ERROR: Worktree at ${wtPath} has uncommitted changes:`);
      console.error(status);
      console.error('Use --force to remove anyway.');
      process.exit(1);
    }
  } catch {}
}

// Remove worktree
if (fs.existsSync(wtPath)) {
  try {
    execSync(`git worktree remove "${wtPath}" ${forceFlag ? '--force' : ''}`, { cwd: REPO_PATH, stdio: 'pipe' });
    console.log(`Removed worktree: ${wtPath}`);
  } catch (err) {
    try {
      fs.rmSync(wtPath, { recursive: true, force: true });
      console.log(`Removed worktree directory manually: ${wtPath}`);
      execSync('git worktree prune', { cwd: REPO_PATH, stdio: 'pipe' });
    } catch (rmErr) {
      console.error(`ERROR: Could not remove worktree directory: ${rmErr.message}`);
    }
  }
} else {
  try { execSync('git worktree prune', { cwd: REPO_PATH, stdio: 'pipe' }); } catch {}
}

// Delete local branch
try {
  execSync(`git branch -d "${branch}"`, { cwd: REPO_PATH, stdio: 'pipe' });
  console.log(`Deleted local branch: ${branch}`);
} catch {
  if (forceFlag) {
    try {
      execSync(`git branch -D "${branch}"`, { cwd: REPO_PATH, stdio: 'pipe' });
      console.log(`Force-deleted local branch: ${branch}`);
    } catch (err) {
      console.error(`WARNING: Could not delete branch ${branch}: ${err.message}`);
    }
  } else {
    console.log(`Branch ${branch} not deleted (has unmerged changes). Use --force to delete.`);
  }
}

// Update DB
updateTask(taskId, { worktree: null });
addLogEntry(taskId, `${taskId} "${task['Task Name']}": Worktree cleaned up. Branch: ${branch}.`);

console.log(`${taskId}: Worktree cleaned up | Branch: ${branch}`);
