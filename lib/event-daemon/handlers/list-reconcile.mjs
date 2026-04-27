/**
 * list-reconcile.mjs — Reconcile Slack list changes into the DB on file_change events.
 *
 * Fires when the Slack list file is modified. Fetches the current item set via
 * getListItems() and calls reconcileSlackItem() per item.
 *
 * Idempotency is guaranteed by the last_slack_ts guard inside reconcileSlackItem —
 * items that haven't changed since the last sync are skipped.
 */

import { reconcileSlackItem } from '../../slack-reconcile.mjs';

export default {
  eventType: 'file_change',
  name: 'list-reconcile',

  /**
   * Only handle changes to the stask list file. Slack delivers
   * `file_change` for many things (thumbnails, exports, edits to other
   * files in the workspace) — we only care about edits to the configured
   * Stask list file. Slack also occasionally sends a payload where the
   * top-level `file_id` is empty/missing but `file.id` is populated, so
   * accept either.
   * @param {Object} event
   * @param {Object} ctx
   */
  match(event, ctx) {
    const expected = ctx.config?.slack?.listId;
    const got = event.file_id || event.file?.id || null;
    const ok = !!expected && got === expected;
    if (!ok) {
      ctx.logger?.info?.(
        `[list-reconcile] match=false ` +
        `event.file_id=${JSON.stringify(event.file_id ?? null)} ` +
        `event.file.id=${JSON.stringify(event.file?.id ?? null)} ` +
        `expected=${JSON.stringify(expected ?? null)}`,
      );
    }
    return ok;
  },

  /**
   * Fetch all list items and reconcile each one against the DB.
   * @param {Object} event
   * @param {Object} ctx
   */
  async handle(event, ctx) {
    const { slackApi, db, libs, logger, config } = ctx;
    const listId = config?.slack?.listId;
    if (!listId) {
      logger.warn('[list-reconcile] No listId in config — skipping');
      return;
    }

    let items;
    try {
      items = await slackApi.getListItems(listId);
    } catch (err) {
      logger.error(`[list-reconcile] Failed to fetch list items: ${err.message}`);
      return;
    }

    let pulled = 0;
    let skipped = 0;
    let errors = 0;

    for (const item of items) {
      // Skip child items (subtasks) — we only reconcile top-level rows
      if (item.parent_item_id) continue;

      try {
        const result = await reconcileSlackItem(item, { source: 'event', db, libs });
        if (result === 'pulled') pulled++;
        else skipped++;
      } catch (err) {
        errors++;
        logger.error(`[list-reconcile] Error reconciling item ${item.id}: ${err.message}`);
      }
    }

    logger.info(`[list-reconcile] file_change handled: pulled=${pulled} skipped=${skipped} errors=${errors}`);
  },
};
