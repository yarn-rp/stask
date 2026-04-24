/**
 * handler.mjs — Handler interface contract (documentation module).
 *
 * Every event handler must export a default object with this shape:
 *
 * @example
 * export default {
 *   // Slack event type this handler subscribes to (e.g. 'file_change')
 *   eventType: 'file_change',
 *
 *   // Unique name for logs and error isolation
 *   name: 'list-reconcile',
 *
 *   // Optional filter — return false to skip this event (default: always match)
 *   match(event, ctx) { return true; },
 *
 *   // Handler implementation — must be idempotent
 *   async handle(event, ctx) { ... },
 * };
 *
 * Context object (ctx) provided to match() and handle():
 * @typedef {Object} HandlerCtx
 * @property {import('node:sqlite').Database} db     - better-sqlite3 db instance
 * @property {Object}  slackApi                      - lib/slack-api.mjs exports
 * @property {Object}  logger                        - { info, error, warn, debug }
 * @property {Object}  openclaw                      - thin invoker shim (stub in v1)
 * @property {Object}  config                        - loaded .stask/config.json
 * @property {string}  leadName                      - lead agent name from config
 */

// This module exists only as documentation. Import the interface typedef via JSDoc.
// Nothing to export at runtime — handlers are loaded directly by registry.mjs.
