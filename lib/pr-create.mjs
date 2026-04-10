#!/usr/bin/env node
/**
 * pr-create.mjs — Create a draft PR for a task in Ready for Human Review.
 *
 * Usage: node pr-create.mjs <task-id>
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import {
  findTask, updateTask, addLogEntry, parseWorktreeValue, WORKSPACE_DIR,
} from './tracker-db.mjs';
import { parseSpecValue } from './validate.mjs';
import { CONFIG } from './env.mjs';

const GH = 'gh';

const taskId = process.argv[2];

if (!taskId) {
  console.error('Usage: node pr-create.mjs <task-id>');
  process.exit(1);
}

const task = findTask(taskId);

if (!task) {
  console.error(`ERROR: Task ${taskId} not found`);
  process.exit(1);
}

if (task['Status'] !== 'Ready for Human Review' && task['Status'] !== 'Testing') {
  console.error(`ERROR: Task ${taskId} is "${task['Status']}". Must be "Testing" or "Ready for Human Review" to create a PR.`);
  process.exit(1);
}

if (task['PR'] !== 'None') {
  console.log(`PR already exists for ${taskId}: ${task['PR']}. Skipping.`);
  process.exit(0);
}

const wt = parseWorktreeValue(task['Worktree']);
if (!wt) {
  console.error(`ERROR: Task ${taskId} has no worktree. Cannot create PR without a branch.`);
  process.exit(1);
}

const { branch, path: wtPath } = wt;

// Check for existing PR on this branch
try {
  const existingPr = execSync(
    `${GH} pr list --head "${branch}" --json url --jq ".[0].url"`,
    { cwd: wtPath, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
  ).trim();

  if (existingPr) {
    updateTask(taskId, { pr: existingPr });
    addLogEntry(taskId, `${taskId} "${task['Task Name']}": Linked existing PR ${existingPr}.`);
        console.log(`${taskId}: PR linked | ${existingPr}`);
    process.exit(0);
  }
} catch {}

// Build PR body
let specContent = '';
const specInfo = parseSpecValue(task['Spec']);
if (specInfo?.filename) {
  const specPath = path.join(WORKSPACE_DIR, 'shared', specInfo.filename);
  if (fs.existsSync(specPath)) {
    specContent = fs.readFileSync(specPath, 'utf-8');
  }
}

let acceptanceCriteria = '';
if (specContent) {
  const acMatch = specContent.match(/##\s*Acceptance Criteria[\s\S]*?(?=\n##|\n---|\Z)/i);
  if (acMatch) acceptanceCriteria = acMatch[0].trim();
}

const qaReport = task['QA Report 1'] || 'None';
const prTitle = `[${taskId}] ${task['Task Name']}`;
const prBody = `## Task: ${taskId} — ${task['Task Name']}

**Type:** ${task['Type']}
**QA Report:** ${qaReport !== 'None' ? 'Passed' : 'N/A'}

${acceptanceCriteria ? `## Acceptance Criteria\n\n${acceptanceCriteria}\n` : ''}
---

*Created by the task framework. Review comments will be routed to the team automatically.*`;

// Push branch
try {
  execSync(`git push -u origin "${branch}"`, { cwd: wtPath, stdio: 'pipe' });
  console.log(`Pushed branch: ${branch}`);
} catch (err) {
  const errMsg = err.stderr?.toString() || err.message;
  if (!errMsg.includes('Everything up-to-date')) {
    console.error(`WARNING: Push issue: ${errMsg}`);
  }
}

// Detect base branch
let baseBranch = 'dev';
try {
  execSync('git rev-parse --verify dev', { cwd: wtPath, stdio: 'pipe' });
} catch {
  baseBranch = 'main';
}

// Create draft PR
let prUrl;
try {
  prUrl = execSync(
    `${GH} pr create --draft --base ${baseBranch} --head "${branch}" --title "${prTitle.replace(/"/g, '\\"')}" --body "${prBody.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`,
    { cwd: wtPath, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
  ).trim();
} catch (err) {
  const urlMatch = (err.stdout?.toString() || '').match(/(https:\/\/github\.com\/[^\s]+)/);
  if (urlMatch) {
    prUrl = urlMatch[1];
  } else {
    console.error(`ERROR: Failed to create PR: ${err.stderr?.toString() || err.message}`);
    process.exit(1);
  }
}

updateTask(taskId, { pr: prUrl });
addLogEntry(taskId, `${taskId} "${task['Task Name']}": Draft PR created at ${prUrl}.`);

console.log(`${taskId}: Draft PR created | ${prUrl}`);
