import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseWorktrees,
  parseWorktreeValue,
  formatWorktrees,
  formatWorktreeValue,
} from '../lib/tracker-db.mjs';

test('parseWorktrees: null/empty returns empty array', () => {
  assert.deepEqual(parseWorktrees(null), []);
  assert.deepEqual(parseWorktrees(''), []);
  assert.deepEqual(parseWorktrees(undefined), []);
});

test('parseWorktrees: legacy "branch (path)" string returns 1-element array', () => {
  const result = parseWorktrees('feature/foo (~/wt/foo)');
  assert.deepEqual(result, [{ repo: 'foo', branch: 'feature/foo', path: '~/wt/foo' }]);
});

test('parseWorktrees: JSON array round-trips', () => {
  const input = JSON.stringify([
    { repo: 'api', branch: 'feat/x', path: '/wt/x/api' },
    { repo: 'web', branch: 'feat/x', path: '/wt/x/web' },
  ]);
  assert.equal(parseWorktrees(input).length, 2);
  assert.equal(parseWorktrees(input)[1].repo, 'web');
});

test('parseWorktrees: malformed JSON returns empty array', () => {
  assert.deepEqual(parseWorktrees('[not json'), []);
});

test('parseWorktreeValue: returns first entry as {branch, path}', () => {
  const json = JSON.stringify([
    { repo: 'api', branch: 'feat/x', path: '/wt/x/api' },
    { repo: 'web', branch: 'feat/x', path: '/wt/x/web' },
  ]);
  assert.deepEqual(parseWorktreeValue(json), { branch: 'feat/x', path: '/wt/x/api' });
});

test('parseWorktreeValue: legacy string still works', () => {
  assert.deepEqual(
    parseWorktreeValue('feature/foo (~/wt/foo)'),
    { branch: 'feature/foo', path: '~/wt/foo' }
  );
});

test('formatWorktrees: produces JSON', () => {
  const json = formatWorktrees([
    { repo: 'api', branch: 'feat/x', path: '/wt/api' },
    { repo: 'web', branch: 'feat/x', path: '/wt/web' },
  ]);
  assert.deepEqual(JSON.parse(json), [
    { repo: 'api', branch: 'feat/x', path: '/wt/api' },
    { repo: 'web', branch: 'feat/x', path: '/wt/web' },
  ]);
});

test('formatWorktrees: empty input returns null', () => {
  assert.equal(formatWorktrees([]), null);
});

test('formatWorktrees: missing repo derives from path basename', () => {
  const json = formatWorktrees([{ branch: 'b', path: '/wt/api' }]);
  assert.equal(JSON.parse(json)[0].repo, 'api');
});

test('formatWorktreeValue: back-compat single repo, returns JSON shape', () => {
  const v = formatWorktreeValue('feat/x', '/wt/api', 'api');
  assert.deepEqual(JSON.parse(v), [{ repo: 'api', branch: 'feat/x', path: '/wt/api' }]);
});

test('round-trip: format then parse preserves structure', () => {
  const entries = [
    { repo: 'api', branch: 'feat/y', path: '/wt/y/api' },
    { repo: 'web', branch: 'feat/y', path: '/wt/y/web' },
  ];
  const parsed = parseWorktrees(formatWorktrees(entries));
  assert.deepEqual(parsed, entries);
});
