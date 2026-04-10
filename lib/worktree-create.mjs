#!/usr/bin/env node
/**
 * worktree-create.mjs — Create a git worktree for a parent task.
 *
 * Usage: node worktree-create.mjs <task-id>
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import {
  findTask, updateTask, addLogEntry, formatWorktreeValue,
} from './tracker-db.mjs';
import { slugifyTaskName, branchPrefixForType } from './validate.mjs';
import { CONFIG } from './env.mjs';

const REPO_PATH = CONFIG.projectRepoPath;
const WORKTREE_BASE = CONFIG.worktreeBaseDir;

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

if (task['Worktree'] !== 'None') {
  console.log(`Worktree already exists for ${taskId}: ${task['Worktree']}. Skipping.`);
  process.exit(0);
}

// ─── Derive branch name and path ────────────────────────────────────

const slug = slugifyTaskName(task['Task Name']);
const prefix = branchPrefixForType(task['Type']);
let branchName = `${prefix}/${slug}`;

if (!fs.existsSync(WORKTREE_BASE)) {
  fs.mkdirSync(WORKTREE_BASE, { recursive: true });
}

const worktreePath = path.join(WORKTREE_BASE, slug);

// Check for branch name collision
try {
  const existing = execSync(`git branch --list "${branchName}"`, { cwd: REPO_PATH, encoding: 'utf-8' }).trim();
  if (existing) {
    try {
      const worktrees = execSync('git worktree list --porcelain', { cwd: REPO_PATH, encoding: 'utf-8' });
      if (worktrees.includes(branchName)) {
        console.log(`Branch ${branchName} already has a worktree. Reusing.`);
        const lines = worktrees.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes(`branch refs/heads/${branchName}`)) {
            const wtPath = lines[i - 2]?.replace('worktree ', '') || worktreePath;
            const wtValue = formatWorktreeValue(branchName, wtPath);
            updateTask(taskId, { worktree: wtValue });
            addLogEntry(taskId, `${taskId}: Reusing existing worktree for branch ${branchName}.`);
                        console.log(`${taskId}: Worktree reused | Branch: ${branchName} | Path: ${wtPath}`);
            process.exit(0);
          }
        }
      }
    } catch {}
    branchName = `${prefix}/${slug}-${taskId.toLowerCase()}`;
    console.log(`Branch name collision. Using: ${branchName}`);
  }
} catch {}

// ─── Create worktree ────────────────────────────────────────────────

if (fs.existsSync(worktreePath)) {
  try {
    execSync(`git worktree remove "${worktreePath}" --force`, { cwd: REPO_PATH, stdio: 'pipe' });
  } catch {
    fs.rmSync(worktreePath, { recursive: true, force: true });
  }
}

try {
  let baseBranch = 'dev';
  try {
    execSync('git rev-parse --verify dev', { cwd: REPO_PATH, stdio: 'pipe' });
  } catch {
    try {
      execSync('git rev-parse --verify main', { cwd: REPO_PATH, stdio: 'pipe' });
      baseBranch = 'main';
    } catch {
      console.error('ERROR: Neither dev nor main branch found.');
      process.exit(1);
    }
  }

  try {
    execSync(`git fetch origin ${baseBranch}`, { cwd: REPO_PATH, stdio: 'pipe' });
  } catch {
    console.error(`WARNING: Could not fetch origin/${baseBranch}.`);
  }

  execSync(`git worktree add "${worktreePath}" -b "${branchName}" ${baseBranch}`, {
    cwd: REPO_PATH, stdio: 'pipe',
  });
  console.log(`Based on: ${baseBranch}`);
} catch (err) {
  console.error(`ERROR: Failed to create worktree: ${err.message}`);
  process.exit(1);
}

// ─── Update DB ──────────────────────────────────────────────────────

const wtValue = formatWorktreeValue(branchName, worktreePath);
updateTask(taskId, { worktree: wtValue });
addLogEntry(taskId, `${taskId} "${task['Task Name']}": Worktree created. Branch: ${branchName}, Path: ${worktreePath}.`);

console.log(`${taskId}: Worktree created | Branch: ${branchName} | Path: ${worktreePath}`);
