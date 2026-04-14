/**
 * lib/setup/template.mjs — Template copy + placeholder replacement engine.
 *
 * Copies the templates/team/ directory to a target workspace,
 * renames agent directories, and replaces all {{PLACEHOLDER}} variables.
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * Copy a template directory to a target, renaming dirs and replacing placeholders.
 *
 * @param {Object} opts
 * @param {string} opts.templateDir - Path to templates/team/
 * @param {string} opts.targetDir   - Path to ~/.openclaw/workspace-<project>/
 * @param {Object} opts.placeholders - Map of {{KEY}} → value
 * @param {Object} opts.dirRenames   - Map of template dir name → target dir name
 *                                     e.g. { lead: 'richard', backend: 'gilfoyle' }
 * @returns {{ filesCreated: number, dirsCreated: number }}
 */
export function scaffoldWorkspace({ templateDir, targetDir, placeholders, dirRenames }) {
  let filesCreated = 0;
  let dirsCreated = 0;

  // Meta files that belong to the template package, not the workspace
  const SKIP_FILES = new Set([
    'agent-configs.json', 'cron-jobs.json', 'models.json', 'slack-manifest.json',
    'manifest.json',
    'README.md', 'MODELS.md', 'RECOMMENDED-SKILLS.md',
  ]);

  // Walk the template directory recursively
  walkDir(templateDir, (srcPath, isDir) => {
    // Compute relative path from template root
    let relPath = path.relative(templateDir, srcPath);

    // Skip template meta files (they're not workspace files)
    // Check both full relative path and just the filename
    if (SKIP_FILES.has(relPath) || SKIP_FILES.has(path.basename(relPath))) return;

    // Rename top-level agent directories
    for (const [from, to] of Object.entries(dirRenames)) {
      if (relPath === from || relPath.startsWith(from + path.sep)) {
        relPath = to + relPath.slice(from.length);
      }
    }

    const destPath = path.join(targetDir, relPath);

    if (isDir) {
      fs.mkdirSync(destPath, { recursive: true });
      dirsCreated++;
      return;
    }

    // Read file
    const content = fs.readFileSync(srcPath);

    // Check if binary (null byte in first 512 bytes)
    if (isBinary(content)) {
      // Copy without replacement
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.writeFileSync(destPath, content);
    } else {
      // Text file — replace placeholders
      let text = content.toString('utf-8');
      for (const [key, value] of Object.entries(placeholders)) {
        text = text.replaceAll(key, value);
      }
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.writeFileSync(destPath, text);
    }

    filesCreated++;
  });

  return { filesCreated, dirsCreated };
}

/**
 * Create .openclaw/workspace-state.json in each agent directory.
 */
export function seedWorkspaceState(agentDir) {
  const ocDir = path.join(agentDir, '.openclaw');
  fs.mkdirSync(ocDir, { recursive: true });
  fs.writeFileSync(
    path.join(ocDir, 'workspace-state.json'),
    JSON.stringify({
      version: 1,
      bootstrapSeededAt: new Date().toISOString(),
    }, null, 2) + '\n'
  );
}

// ─── Helpers ────────────────────────────────────────────────────────

function walkDir(dir, callback) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      callback(fullPath, true);
      walkDir(fullPath, callback);
    } else {
      callback(fullPath, false);
    }
  }
}

function isBinary(buffer) {
  const check = buffer.subarray(0, Math.min(512, buffer.length));
  for (let i = 0; i < check.length; i++) {
    if (check[i] === 0) return true;
  }
  return false;
}
