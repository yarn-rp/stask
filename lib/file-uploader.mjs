/**
 * file-uploader.mjs — Scans workspace files, uploads new/changed ones to Slack,
 * and maintains FILE_REGISTRY.json for agent file references.
 */

import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { uploadFile, logger } from './slack-api.mjs';

const config = {
  maxFileSizeBytes: 102400,
  dryRun: process.argv.includes('--dry-run'),
};

const UPLOAD_GLOBS = [
  'shared/specs/*.md',
  'shared/artifacts/*.md',
  'shared/qa-reports/*.md',
  'shared/qa-reports/screenshots/*.png',
  'shared/pr-status/*.md',
];

/**
 * Simple glob matching (supports * and **).
 */
function matchGlob(filePath, pattern) {
  const regex = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*\//g, '(.+/)?')
    .replace(/\*/g, '[^/]+');
  return new RegExp(`^${regex}$`).test(filePath);
}

/**
 * Recursively walk a directory and return all file paths relative to base.
 */
function walkDir(dir, base = dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['.git', 'node_modules', 'sessions', 'skills', '.web42'].includes(entry.name)) continue;
      results.push(...walkDir(full, base));
    } else {
      results.push(path.relative(base, full));
    }
  }
  return results;
}

/**
 * Scan workspace for files matching UPLOAD_GLOBS.
 * Returns array of relative paths.
 */
export function scanWorkspace(basePath) {
  const allFiles = walkDir(basePath);
  const matched = [];
  for (const file of allFiles) {
    for (const glob of UPLOAD_GLOBS) {
      if (matchGlob(file, glob)) {
        matched.push(file);
        break;
      }
    }
  }
  return matched.sort();
}

/**
 * Load registry from disk. Returns { version, updatedAt, files: {} }.
 */
export function loadRegistry(registryPath) {
  try {
    return JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
  } catch {
    return { version: 1, updatedAt: null, files: {} };
  }
}

/**
 * Save registry to disk.
 */
export function saveRegistry(registryPath, registry) {
  registry.updatedAt = new Date().toISOString();
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2) + '\n');
}

/**
 * Hash file content (SHA-256, first 16 hex chars).
 */
function hashContent(content) {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/**
 * Sync workspace files to Slack.
 * Uploads new/changed files, skips unchanged ones (content-hash dedup).
 * Returns updated registry.
 */
export async function syncFiles(basePath, registry) {
  const files = scanWorkspace(basePath);
  logger.info(`Scanned workspace: ${files.length} files match upload globs`);

  let uploaded = 0;
  let skipped = 0;
  let errors = 0;

  for (const relPath of files) {
    const fullPath = path.join(basePath, relPath);
    let content;

    try {
      const stat = fs.statSync(fullPath);
      if (stat.size > config.maxFileSizeBytes) {
        logger.debug(`Skipping ${relPath} (${stat.size} bytes > ${config.maxFileSizeBytes} limit)`);
        skipped++;
        continue;
      }
      content = fs.readFileSync(fullPath, 'utf-8');
    } catch (err) {
      logger.warn(`Cannot read ${relPath}: ${err.message}`);
      errors++;
      continue;
    }

    const hash = hashContent(content);
    const existing = registry.files[relPath];

    if (existing && existing.hash === hash) {
      skipped++;
      continue;
    }

    if (config.dryRun) {
      logger.info(`DRY RUN: Would upload ${relPath} (${content.length} chars, hash ${hash})`);
      uploaded++;
      continue;
    }

    try {
      const filename = path.basename(relPath);
      const fileId = await uploadFile(filename, content);
      registry.files[relPath] = {
        fileId,
        hash,
        title: filename,
        uploadedAt: new Date().toISOString(),
        sizeBytes: Buffer.byteLength(content, 'utf-8'),
      };
      uploaded++;
      logger.debug(`Uploaded ${relPath} → ${fileId} (${content.length} chars)`);
    } catch (err) {
      logger.error(`Failed to upload ${relPath}: ${err.message}`);
      errors++;
    }
  }

  logger.info(`File sync: ${uploaded} uploaded, ${skipped} unchanged, ${errors} errors`);
  return registry;
}

/**
 * Look up a Slack file ID from the registry by relative path.
 * Handles paths with or without backticks, leading shared/, etc.
 */
export function resolveFileId(registry, specValue) {
  if (!specValue || specValue === 'N/A') return null;
  let p = specValue.trim().replace(/^`|`$/g, '');
  // Try exact match
  if (registry.files[p]) return registry.files[p].fileId;
  // Try with shared/ prefix
  if (registry.files['shared/' + p]) return registry.files['shared/' + p].fileId;
  // Try prepending specs/
  if (registry.files['shared/specs/' + path.basename(p)]) {
    return registry.files['shared/specs/' + path.basename(p)].fileId;
  }
  return null;
}
