/**
 * registry.mjs — Static handler registry.
 *
 * Add a new event handler by:
 *   1. Dropping a handler file in lib/event-daemon/handlers/<name>.mjs
 *   2. Importing it here and adding it to HANDLERS
 *   3. Adding the event type to the lead manifest bot_events array
 *
 * Multiple handlers may subscribe to the same eventType; all matching
 * handlers are run per envelope (with per-handler error isolation).
 */

import listReconcile from './handlers/list-reconcile.mjs';

/**
 * All registered handlers, in dispatch order.
 * @type {Array<import('./handler.mjs').HandlerInterface>}
 */
export const HANDLERS = [
  listReconcile,
];
