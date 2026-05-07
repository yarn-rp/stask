import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

import { appendToExclude, removeStaskBlock, readStaskBlock } from '../lib/setup/git-exclude.mjs';

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stask-gx-'));
  execSync('git init -q', { cwd: dir });
  return dir;
}

test('appendToExclude writes a fenced block', () => {
  const repo = makeRepo();
  const wrote = appendToExclude(repo, ['.stask/', '.claude/agents/lead.md']);
  assert.equal(wrote, true);
  const contents = fs.readFileSync(path.join(repo, '.git/info/exclude'), 'utf-8');
  assert.match(contents, /# stask:begin\n\.stask\/\n\.claude\/agents\/lead\.md\n# stask:end/);
});

test('appendToExclude is idempotent for the same patterns', () => {
  const repo = makeRepo();
  appendToExclude(repo, ['.stask/']);
  const wrote2 = appendToExclude(repo, ['.stask/']);
  assert.equal(wrote2, false);
});

test('appendToExclude replaces an existing block when patterns change', () => {
  const repo = makeRepo();
  appendToExclude(repo, ['.stask/']);
  appendToExclude(repo, ['.stask/', '.claude/agents/lead.md']);
  const block = readStaskBlock(repo);
  assert.deepEqual(block, ['.stask/', '.claude/agents/lead.md']);
});

test('appendToExclude preserves existing exclude entries', () => {
  const repo = makeRepo();
  const excludePath = path.join(repo, '.git/info/exclude');
  fs.writeFileSync(excludePath, '# user entries\nmy-secret.txt\n');
  appendToExclude(repo, ['.stask/']);
  const contents = fs.readFileSync(excludePath, 'utf-8');
  assert.ok(contents.includes('my-secret.txt'));
  assert.ok(contents.includes('# stask:begin'));
});

test('removeStaskBlock strips only the stask block', () => {
  const repo = makeRepo();
  const excludePath = path.join(repo, '.git/info/exclude');
  fs.writeFileSync(excludePath, 'user-entry\n');
  appendToExclude(repo, ['.stask/']);
  const removed = removeStaskBlock(repo);
  assert.equal(removed, true);
  const contents = fs.readFileSync(excludePath, 'utf-8');
  assert.ok(contents.includes('user-entry'));
  assert.ok(!contents.includes('# stask:begin'));
});

test('readStaskBlock returns the patterns inside the block', () => {
  const repo = makeRepo();
  appendToExclude(repo, ['.stask/', '.claude/agents/x.md']);
  assert.deepEqual(readStaskBlock(repo), ['.stask/', '.claude/agents/x.md']);
});

test('git status does not show the excluded files', () => {
  const repo = makeRepo();
  fs.mkdirSync(path.join(repo, '.stask'));
  fs.writeFileSync(path.join(repo, '.stask/config.json'), '{}');
  appendToExclude(repo, ['.stask/']);
  const status = execSync('git status --porcelain', { cwd: repo, encoding: 'utf-8' });
  assert.equal(status.trim(), '');
});
