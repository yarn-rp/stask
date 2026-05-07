/**
 * git-exclude.mjs — Per-clone, never-committed git ignore management.
 *
 * Writes a fenced block bounded by `# stask:begin` / `# stask:end` to
 * each repo's `.git/info/exclude`, so stask's untracked artifacts
 * (`.stask/`, scaffolded `.claude/` files) don't show up in `git status`
 * without modifying the team's committed `.gitignore`.
 *
 * Idempotent: re-running with the same patterns is a no-op. Re-running
 * with different patterns replaces the block in place.
 */

import fs from 'node:fs';
import path from 'node:path';

const BEGIN = '# stask:begin';
const END = '# stask:end';

function excludePath(repoPath) {
  // Worktrees keep their per-clone exclude file inside the linked
  // worktree's git dir, which `git rev-parse --git-dir` would resolve.
  // For the common (non-worktree) case it's `<repo>/.git/info/exclude`.
  // We support both by checking if .git is a file (worktree pointer) or
  // a directory.
  const gitPath = path.join(repoPath, '.git');
  if (!fs.existsSync(gitPath)) return null;

  const stat = fs.statSync(gitPath);
  if (stat.isDirectory()) {
    return path.join(gitPath, 'info', 'exclude');
  }
  // Worktree: .git is a file with `gitdir: <path>` pointing at the real
  // git dir. The shared exclude lives in the main repo's git dir, which
  // for our purposes is fine — it covers the worktree too.
  const contents = fs.readFileSync(gitPath, 'utf-8').trim();
  const m = contents.match(/^gitdir:\s*(.+)$/m);
  if (!m) return null;
  let gitdir = m[1].trim();
  if (!path.isAbsolute(gitdir)) gitdir = path.resolve(repoPath, gitdir);
  // Worktree gitdir looks like `<main>/.git/worktrees/<name>`.
  // Walk up to the parent of `worktrees/` to find the main git dir.
  const wtIdx = gitdir.lastIndexOf(`${path.sep}worktrees${path.sep}`);
  const mainGitDir = wtIdx >= 0 ? gitdir.slice(0, wtIdx) : gitdir;
  return path.join(mainGitDir, 'info', 'exclude');
}

function readFileOrEmpty(p) {
  try {
    return fs.readFileSync(p, 'utf-8');
  } catch (err) {
    if (err.code === 'ENOENT') return '';
    throw err;
  }
}

function buildBlock(patterns) {
  const lines = [BEGIN, ...patterns, END];
  return lines.join('\n') + '\n';
}

function stripBlock(contents) {
  const beginIdx = contents.indexOf(BEGIN);
  if (beginIdx < 0) return { stripped: contents, found: false };
  const endIdx = contents.indexOf(END, beginIdx);
  if (endIdx < 0) return { stripped: contents, found: false };
  const endLineEnd = contents.indexOf('\n', endIdx);
  const sliceEnd = endLineEnd < 0 ? contents.length : endLineEnd + 1;
  // Also drop the newline immediately preceding BEGIN if present, so we
  // don't leave a stray blank line after removal.
  let sliceStart = beginIdx;
  if (sliceStart > 0 && contents[sliceStart - 1] === '\n') sliceStart -= 1;
  return {
    stripped: contents.slice(0, sliceStart) + contents.slice(sliceEnd),
    found: true,
  };
}

/**
 * Append a stask block to `<repoPath>/.git/info/exclude`. If a block
 * already exists, replace it. Returns true if the file was modified.
 *
 * @param {string} repoPath
 * @param {string[]} patterns - .gitignore-style patterns relative to repo root
 * @returns {boolean} true if the exclude file was written
 */
export function appendToExclude(repoPath, patterns) {
  if (!Array.isArray(patterns) || patterns.length === 0) return false;
  const target = excludePath(repoPath);
  if (!target) return false;

  const existing = readFileOrEmpty(target);
  const { stripped } = stripBlock(existing);
  const block = buildBlock(patterns);

  // Check if the existing block is already exactly what we want.
  if (existing.includes(block)) return false;

  const trimmed = stripped.replace(/\s*$/, '');
  const next = trimmed
    ? `${trimmed}\n\n${block}`
    : block;

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, next);
  return true;
}

/**
 * Remove the stask block from `<repoPath>/.git/info/exclude`. Returns
 * true if a block was found and removed.
 */
export function removeStaskBlock(repoPath) {
  const target = excludePath(repoPath);
  if (!target) return false;
  const existing = readFileOrEmpty(target);
  const { stripped, found } = stripBlock(existing);
  if (!found) return false;
  fs.writeFileSync(target, stripped);
  return true;
}

/**
 * Read the patterns currently in the stask block, if any. Useful for
 * `stask doctor` to verify the expected patterns are present.
 */
export function readStaskBlock(repoPath) {
  const target = excludePath(repoPath);
  if (!target) return null;
  const existing = readFileOrEmpty(target);
  const beginIdx = existing.indexOf(BEGIN);
  if (beginIdx < 0) return [];
  const endIdx = existing.indexOf(END, beginIdx);
  if (endIdx < 0) return [];
  const inner = existing.slice(beginIdx + BEGIN.length, endIdx);
  return inner
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}
