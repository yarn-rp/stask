/**
 * stask sync-status — Show sync state for all trackable files.
 *
 * Usage:
 *   stask sync-status
 */

import { CONFIG, getWorkspaceLibs } from '../lib/env.mjs';
import { scanForTrackableFiles } from '../lib/canvas-sync.mjs';
import { extractFrontmatter } from '../lib/yaml-frontmatter.mjs';

export async function run(argv) {
  const directories = CONFIG.canvasSyncDirectories || ['../shared/'];
  const basePath = CONFIG.staskRoot || process.cwd();

  const files = scanForTrackableFiles(directories, basePath);

  if (files.length === 0) {
    console.log('No trackable files found (no .md files with `slack_synced: true` frontmatter).');
    return;
  }

  console.log(`\n  File/Canvas Sync Status (${files.length} trackable files)\n`);
  console.log('  PATH                                    CANVAS ID       LAST SYNCED           STATUS');
  console.log('  '.padEnd(90, '-'));

  for (const file of files) {
    const { frontmatter } = extractFrontmatter(file.content);
    const canvasId = frontmatter.slack_canvas_id || '(not created)';
    const lastSynced = frontmatter.last_synced || 'never';
    const hasCanvasId = !!frontmatter.slack_canvas_id;

    let status;
    if (!hasCanvasId) {
      status = '⚠ NEW';
    } else if (!frontmatter.last_hash) {
      status = '● SYNCED';
    } else {
      status = '✓ OK';
    }

    const relPath = file.relPath.padEnd(40);
    const idStr = canvasId.padEnd(16);
    const syncStr = (lastSynced === 'never' ? 'never' : lastSynced.replace('T', ' ').slice(0, 19)).padEnd(21);

    console.log(`  ${relPath} ${idStr} ${syncStr} ${status}`);
  }

  console.log('');
}