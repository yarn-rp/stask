/**
 * canvas-sync.mjs — Two-way sync daemon between local .md files and Slack Canvases.
 *
 * Architecture:
 *   - Auto-discovery: scan directories for .md files with `slack_synced: true` frontmatter
 *   - Auto-create: if `slack_canvas_id` missing, create Canvas via API
 *   - Polling: every 2-5 minutes (configurable via syncIntervalSeconds)
 *   - Push: local → Canvas via canvases.edit (if local hash changed)
 *   - Pull: Canvas → local (if Canvas edit_timestamp newer than last_synced)
 *   - Conflict resolution: most recent timestamp wins
 *   - Frontmatter updated after each sync
 *
 * Dependencies:
 *   - lib/yaml-frontmatter.mjs — parse/inject frontmatter
 *   - lib/canvas-format.mjs — Markdown ↔ Canvas HTML conversion
 *   - lib/slack-api.mjs — Canvas API wrappers
 */

import fs from 'fs';
import path from 'path';
import { extractFrontmatter, injectFrontmatter, isTrackable, updateFrontmatter, getFrontmatterField } from './yaml-frontmatter.mjs';
import { markdownToCanvas, canvasToMarkdown } from './canvas-format.mjs';
import { createCanvas, editCanvas, getCanvasFileInfo, downloadCanvasContent, computeHash, logger } from './slack-api.mjs';

// ─── File discovery ────────────────────────────────────────────────

/**
 * Recursively walk a directory and return all .md file paths.
 * Skips .git, node_modules, and other non-project dirs.
 */
function walkDir(dir, base = dir) {
  const results = [];
  const skipDirs = new Set(['.git', 'node_modules', '.stask', 'sessions', '.web42']);

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (skipDirs.has(entry.name)) continue;
      results.push(...walkDir(full, base));
    } else if (entry.name.endsWith('.md')) {
      results.push(path.relative(base, full));
    }
  }
  return results;
}

/**
 * Scan directories for trackable .md files.
 * @param {string[]} directories - Array of directory paths to scan
 * @param {string} basePath - Base path for relative resolution
 * @returns {Array<{ relPath: string, fullPath: string, content: string }>}
 */
export function scanForTrackableFiles(directories, basePath) {
  const trackable = [];

  for (const dir of directories) {
    const absDir = path.resolve(basePath, dir);
    if (!fs.existsSync(absDir)) {
      logger.debug(`Sync scan: directory not found: ${absDir}`);
      continue;
    }

    const files = walkDir(absDir);
    for (const relPath of files) {
      const fullPath = path.join(absDir, relPath);
      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        if (isTrackable(content)) {
          trackable.push({ relPath: path.join(dir, relPath), fullPath, content });
        }
      } catch (err) {
        logger.warn(`Sync scan: cannot read ${fullPath}: ${err.message}`);
      }
    }
  }

  return trackable;
}

// ─── Sync operations ───────────────────────────────────────────────

/**
 * Auto-create a Canvas for a trackable file that doesn't have one yet.
 * @returns {{ content: string, canvasId: string, canvasUrl: string }}
 */
export async function autoCreateCanvas(filePath, content) {
  const { frontmatter, body } = extractFrontmatter(content);
  const canvasName = frontmatter.slack_canvas_name || path.basename(filePath, '.md');

  logger.info(`Auto-creating Canvas "${canvasName}" for ${filePath}`);

  const docContent = markdownToCanvas(body);
  const result = await createCanvas({
    title: canvasName,
    document_content: docContent,
  });

  const canvasId = result.canvas_id;
  // Construct the Canvas URL from the ID
  const canvasUrl = `https://app.slack.com/canvas/${canvasId}`;

  // Update the local file with Canvas metadata
  const updatedContent = updateFrontmatter(content, {
    slack_canvas_id: canvasId,
    slack_canvas_url: canvasUrl,
    last_synced: new Date().toISOString(),
    last_hash: computeHash(content),
  });

  fs.writeFileSync(filePath, updatedContent, 'utf-8');

  logger.info(`Canvas created: ${canvasId} → ${filePath}`);
  return { content: updatedContent, canvasId, canvasUrl };
}

/**
 * Push local changes to Canvas (local → Canvas).
 * Called when local file hash has changed since last sync.
 */
export async function pushToCanvas(filePath, canvasId, content) {
  const { body } = extractFrontmatter(content);
  const docContent = markdownToCanvas(body);

  logger.info(`Pushing to Canvas ${canvasId}: ${filePath}`);

  await editCanvas(canvasId, [{
    operation: 'replace_all',
    document_content: docContent,
  }]);

  // Update frontmatter with new sync timestamp and hash
  const updatedContent = updateFrontmatter(content, {
    last_synced: new Date().toISOString(),
    last_hash: computeHash(content),
  });

  fs.writeFileSync(filePath, updatedContent, 'utf-8');
  logger.debug(`Push complete: ${filePath}`);
  return updatedContent;
}

/**
 * Pull Canvas changes to local file (Canvas → local).
 * Called when Canvas edit_timestamp is newer than last_synced.
 */
export async function pullFromCanvas(filePath, canvasId, content) {
  const { frontmatter } = extractFrontmatter(content);

  logger.info(`Pulling from Canvas ${canvasId}: ${filePath}`);

  // Get Canvas metadata for url_private
  const info = await getCanvasFileInfo(canvasId);

  // Download HTML content
  const html = await downloadCanvasContent(info.urlPrivate);

  // Convert back to markdown via format conversion layer
  const md = canvasToMarkdown(html);

  // Re-inject frontmatter (preserving all metadata)
  const updatedContent = updateFrontmatter(content, {
    last_synced: new Date().toISOString(),
    last_hash: computeHash(injectFrontmatter(md, { ...frontmatter, last_synced: new Date().toISOString(), last_hash: '' })),
  });

  // Write the pulled content: frontmatter + converted body
  const { frontmatter: newFm } = extractFrontmatter(updatedContent);
  const finalContent = injectFrontmatter(md, newFm);

  fs.writeFileSync(filePath, finalContent, 'utf-8');
  logger.debug(`Pull complete: ${filePath}`);
  return finalContent;
}

// ─── Sync cycle (one tick) ─────────────────────────────────────────

/**
 * Run one full sync cycle across all trackable files.
 * Returns { synced: number, created: number, errors: number, skipped: number, details: [] }
 *
 * @param {string[]} directories - Directories to scan for trackable files
 * @param {string} basePath - Base path for directory resolution
 */
export async function runCanvasSyncCycle(directories, basePath) {
  const summary = { synced: 0, created: 0, errors: 0, skipped: 0, details: [] };

  let trackableFiles;
  try {
    trackableFiles = scanForTrackableFiles(directories, basePath);
    logger.info(`Canvas sync: found ${trackableFiles.length} trackable files`);
  } catch (err) {
    summary.errors++;
    summary.details.push({ error: `Scan failed: ${err.message}` });
    return summary;
  }

  for (const file of trackableFiles) {
    try {
      const content = fs.readFileSync(file.fullPath, 'utf-8');
      const { frontmatter } = extractFrontmatter(content);

      // Auto-create Canvas if missing
      if (!frontmatter.slack_canvas_id) {
        await autoCreateCanvas(file.fullPath, content);
        summary.created++;
        summary.details.push({ path: file.relPath, action: 'created' });
        continue;
      }

      const canvasId = frontmatter.slack_canvas_id;
      const lastHash = frontmatter.last_hash || '';
      const currentHash = computeHash(content);
      const lastSyncedStr = frontmatter.last_synced;

      // Check if local changed (hash comparison)
      if (currentHash !== lastHash) {
        await pushToCanvas(file.fullPath, canvasId, content);
        summary.synced++;
        summary.details.push({ path: file.relPath, action: 'pushed' });
        continue;
      }

      // Check if Canvas changed (timestamp comparison)
      if (lastSyncedStr && canvasId) {
        try {
          const info = await getCanvasFileInfo(canvasId);
          const lastSyncedTs = Math.floor(new Date(lastSyncedStr + 'Z').getTime() / 1000);

          if (info.editTimestamp > lastSyncedTs) {
            await pullFromCanvas(file.fullPath, canvasId, content);
            summary.synced++;
            summary.details.push({ path: file.relPath, action: 'pulled' });
            continue;
          }
        } catch (err) {
          // 404 = Canvas was deleted on Slack side
          if (err.message.includes('file_not_found') || err.message.includes('404')) {
            logger.warn(`Canvas ${canvasId} deleted on Slack side: ${file.relPath}`);
            // Clear the canvas ID so it gets re-created on next tick
            const updatedContent = updateFrontmatter(content, {
              slack_canvas_id: null,
              slack_canvas_url: null,
            });
            fs.writeFileSync(file.fullPath, updatedContent, 'utf-8');
            summary.details.push({ path: file.relPath, action: 'canvas_deleted' });
            continue;
          }
          throw err; // Re-throw non-404 errors
        }
      }

      // No changes detected
      summary.skipped++;
      summary.details.push({ path: file.relPath, action: 'skipped' });

    } catch (err) {
      summary.errors++;
      summary.details.push({ path: file.relPath, error: err.message });
      logger.error(`Canvas sync error for ${file.relPath}: ${err.message}`);
    }
  }

  logger.info(`Canvas sync cycle: synced=${summary.synced} created=${summary.created} skipped=${summary.skipped} errors=${summary.errors}`);
  return summary;
}

// ─── Standalone daemon mode ────────────────────────────────────────

/**
 * Start the Canvas sync daemon as a long-running process.
 * Polls at the configured interval.
 */
export async function startCanvasSyncDaemon(directories, basePath, intervalSeconds = 180) {
  const INTERVAL_MS = intervalSeconds * 1000;

  logger.info(`Canvas sync daemon starting (interval: ${intervalSeconds}s, dirs: ${directories.join(', ')})`);

  async function tick() {
    try {
      await runCanvasSyncCycle(directories, basePath);
    } catch (err) {
      logger.error(`Canvas sync cycle failed: ${err.message}`);
    }
  }

  // Run first cycle immediately
  await tick();

  // Schedule subsequent cycles
  setInterval(tick, INTERVAL_MS);
}