/**
 * socket-client.mjs — Thin wrapper around @slack/socket-mode SocketModeClient.
 *
 * Opens an outbound WebSocket to Slack using the lead agent's xapp- token.
 * Forwards every event_callback payload to the dispatcher.
 * Reconnect is handled automatically by the library (autoReconnectEnabled: true).
 * Fatal errors emit 'error' — callers should listen and exit.
 */

import { SocketModeClient } from '@slack/socket-mode';
import { dispatch } from './dispatcher.mjs';

/**
 * Create and start the Socket Mode client.
 *
 * @param {Object} opts
 * @param {string} opts.appToken   - Lead agent's xapp- token (connections:write scope)
 * @param {Object} opts.ctx        - Shared handler context (passed through to dispatcher)
 * @returns {SocketModeClient} The connected client (caller may listen on it)
 */
export async function createSocketClient({ appToken, ctx }) {
  const { logger } = ctx;

  const client = new SocketModeClient({
    appToken,
    autoReconnectEnabled: true,
    // Suppress the library's own console noise; we log ourselves
    logLevel: 'warn',
  });

  // ─── Lifecycle events ──────────────────────────────────────────────
  client.on('connected', () => {
    logger.info('[socket-client] Socket Mode connected');
  });

  client.on('reconnecting', () => {
    logger.warn('[socket-client] Socket Mode reconnecting...');
  });

  client.on('disconnected', () => {
    logger.warn('[socket-client] Socket Mode disconnected');
  });

  client.on('authenticated', (data) => {
    logger.info(`[socket-client] Authenticated (url: ${data?.url || 'unknown'})`);
  });

  client.on('error', (err) => {
    logger.error(`[socket-client] Socket error: ${err?.message || err}`);
  });

  // ─── Event dispatch ────────────────────────────────────────────────
  // The library emits specific event type names for events_api payloads.
  // We use the generic 'slack_event' to catch all of them and route through
  // our dispatcher so handler registration is decoupled from this client.
  client.on('slack_event', async ({ ack, type, body }) => {
    // ack immediately — library will ack if we don't within the timeout,
    // but explicit ack is cleaner.
    try {
      if (typeof ack === 'function') await ack();
    } catch (_) {}

    // Only handle events_api payloads (the event_callback type)
    if (type !== 'events_api' || !body?.event) return;

    const event = body.event;
    const receiveTs = Date.now();

    // Raw payload dump — useful for diagnosing what Slack actually sends so
    // handlers can decide what's worth re-fetching vs deriving from the event.
    logger.info(`[socket-client] event_callback: ${JSON.stringify(event)}`);

    try {
      await dispatch(event, ctx);
    } catch (err) {
      logger.error(`[socket-client] Unhandled dispatch error for ${event.type}: ${err.message}`);
    }

    const elapsed = Date.now() - receiveTs;
    logger.info(`[socket-client] Processed ${event.type} in ${elapsed}ms`);
  });

  // ─── Connect ───────────────────────────────────────────────────────
  await client.start();

  return client;
}
