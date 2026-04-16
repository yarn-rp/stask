/**
 * fingerprint.mjs — Generate deterministic fingerprints for inbox event dedup.
 *
 * Format: source_type:source_id:event_type:occurred_at
 * SHA-256 of that string for compactness.
 */

import { createHash } from 'crypto';

/**
 * Generate a fingerprint for an inbox event.
 * @param {string} source_type - 'github' or 'linear'
 * @param {string} source_id - e.g., "owner/repo#42" or "PROJ-123"
 * @param {string} event_type - 'pr_merged', 'comment_added', 'ticket_assigned'
 * @param {string} occurred_at - ISO timestamp of the event
 * @returns {string} SHA-256 hex digest
 */
export function fingerprint(source_type, source_id, event_type, occurred_at) {
  const raw = `${source_type}:${source_id}:${event_type}:${occurred_at}`;
  return createHash('sha256').update(raw).digest('hex');
}