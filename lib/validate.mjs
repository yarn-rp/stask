/**
 * validate.mjs — Shared validation helpers for the task framework.
 * Most lifecycle rules are now enforced by SQLite triggers in tracker-db.mjs.
 * This module keeps only app-layer helpers that can't live in the DB.
 */

import fs from 'fs';
import path from 'path';
import { WORKSPACE_DIR } from './tracker-db.mjs';

// ─── Status definitions (reference only — DB enforces via CHECK) ────

export const STATUSES = [
  'Backlog',
  'To-Do',
  'In-Progress',
  'Testing',
  'Ready for Human Review',
  'Blocked',
  'Done',
];

/**
 * Auto-assignment rules: when transitioning TO a status, assign to this person.
 * null means keep current assignee.
 */
export const AUTO_ASSIGN = {
  'To-Do': 'Yan',
  'In-Progress': null,
  'Testing': 'Jared',
  'Ready for Human Review': 'Yan',
  'Blocked': 'Yan',
  'Done': null,
};

// ─── Spec helpers ───────────────────────────────────────────────────

/**
 * Check that a spec file exists on disk.
 */
export function validateSpecExists(specPath) {
  const fullPath = path.resolve(WORKSPACE_DIR, specPath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Spec file not found: ${specPath} (resolved: ${fullPath})`);
  }
  return true;
}

/**
 * Parse a Spec column value into { filename, fileId, canvasId, type }.
 * Format:
 *   Canvas: "specs/name.md (canvas:F0XXXXXXXXX)"
 *   File:   "specs/name.md (file:F0XXXXXXXXX)"
 *   Legacy: "specs/name.md (F0XXXXXXXXX)" → treated as File
 */
export function parseSpecValue(specValue) {
  if (!specValue || specValue === 'None' || specValue === 'N/A') return null;

  // Canvas prefix: canvas:F0XXXX
  const canvasMatch = specValue.match(/^(.+?)\s*\(canvas:([A-Z0-9]+)\)$/);
  if (canvasMatch) {
    return { filename: canvasMatch[1].trim(), canvasId: canvasMatch[2], type: 'canvas' };
  }

  // File prefix: file:F0XXXX
  const fileMatch = specValue.match(/^(.+?)\s*\(file:([A-Z0-9]+)\)$/);
  if (fileMatch) {
    return { filename: fileMatch[1].trim(), fileId: fileMatch[2], type: 'file' };
  }

  // Legacy format: (F0XXXX) without prefix → treat as file
  const legacyMatch = specValue.match(/^(.+?)\s*\(([A-Z0-9]+)\)$/);
  if (legacyMatch) {
    return { filename: legacyMatch[1].trim(), fileId: legacyMatch[2], type: 'file' };
  }

  // No ID at all
  return { filename: specValue.trim(), fileId: null, type: 'file' };
}

/**
 * Format a Spec column value.
 * @param {string} filename
 * @param {string} id - File ID or Canvas ID
 * @param {'file'|'canvas'} [type='file']
 */
export function formatSpecValue(filename, id, type = 'file') {
  const prefix = type === 'canvas' ? 'canvas' : 'file';
  return `${filename} (${prefix}:${id})`;
}

// ─── Git branch helpers ─────────────────────────────────────────────

/**
 * Convert a task name to a branch-safe slug (kebab-case).
 */
export function slugifyTaskName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * Map a task Type to the git branch prefix per GIT.md conventions.
 */
export function branchPrefixForType(type) {
  switch ((type || '').toLowerCase()) {
    case 'feature': return 'feature';
    case 'bug': return 'fix';
    default: return 'chore';
  }
}
