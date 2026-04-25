/**
 * dispatcher.mjs — Route Slack events to registered handlers.
 *
 * Receives an event envelope, looks up handlers registered for event.type,
 * and runs them via Promise.allSettled for per-handler error isolation.
 * A thrown handler is logged with its name and does not block siblings.
 */

import { HANDLERS } from './registry.mjs';

/**
 * Dispatch a Slack event envelope to all matching handlers.
 *
 * @param {Object} event  - Slack event payload (already unwrapped from envelope)
 * @param {Object} ctx    - Shared handler context (db, slackApi, logger, ...)
 */
export async function dispatch(event, ctx) {
  if (!event?.type) return;

  const { logger } = ctx;
  const eventType = event.type;
  const matching = HANDLERS.filter(h => {
    if (h.eventType !== eventType) return false;
    if (typeof h.match === 'function') {
      try {
        return h.match(event, ctx);
      } catch (err) {
        logger.error(`[dispatcher] handler "${h.name}" match() threw: ${err.message}`);
        return false;
      }
    }
    return true;
  });

  if (matching.length === 0) return;

  const start = Date.now();
  const results = await Promise.allSettled(
    matching.map(h => h.handle(event, ctx))
  );

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const h = matching[i];
    if (r.status === 'rejected') {
      logger.error(`[dispatcher] handler "${h.name}" failed: ${r.reason?.message || r.reason}`);
    }
  }

  const elapsed = Date.now() - start;
  logger.info(`[dispatcher] ${eventType} dispatched to ${matching.length} handler(s) in ${elapsed}ms`);
}
