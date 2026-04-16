/**
 * tx.mjs — DB + Slack transactional wrapper with rollback.
 *
 * Every stask mutation command uses this to ensure DB and Slack stay in sync.
 * If the Slack sync fails, the DB rolls back and inverse Slack ops execute.
 */

import { getWorkspaceLibs, CONFIG } from './env.mjs';
import { logError } from './error-logger.mjs';

/**
 * Execute a mutation as an atomic DB + Slack transaction.
 *
 * @param {Function} mutationFn - (db, libs) => result
 *   Mutate DB (tasks, log, slack_row_ids). Called inside BEGIN/COMMIT.
 *
 * @param {Function} slackSyncFn - (result, db) => slackOps[]
 *   Sync changes to Slack. Returns slackOps for rollback.
 *   If this throws, DB rolls back + inverse Slack ops fire.
 *
 * @returns {Object} The mutationFn result.
 */
export async function withTransaction(mutationFn, slackSyncFn) {
  const libs = await getWorkspaceLibs();
  const db = libs.trackerDb.getDb();

  let mutationResult;
  let slackOps = [];

  db.exec('BEGIN IMMEDIATE');
  try {
    // Step 1: Mutate DB
    mutationResult = mutationFn(db, libs);

    // Step 2: Sync to Slack (while transaction is open)
    if (slackSyncFn) {
      slackOps = await slackSyncFn(mutationResult, db);
    }

    // Step 3: Commit
    db.exec('COMMIT');
  } catch (err) {
    // Rollback DB
    try { db.exec('ROLLBACK'); } catch {}

    // Best-effort rollback Slack changes
    if (slackOps.length > 0) {
      await rollbackSlack(slackOps, libs);
    }

    throw err;
  }

  return mutationResult;
}

/**
 * Best-effort rollback of Slack operations.
 * Created rows → deleted. Updates → warning (would need snapshot for full undo).
 */
async function rollbackSlack(slackOps, libs) {
  const { deleteListRow } = libs.slackApi;
  const listId = CONFIG.slack.listId;

  for (const op of slackOps.reverse()) {
    try {
      if (op.type === 'create' && op.rowId) {
        await deleteListRow(listId, op.rowId);
        console.error(`ROLLBACK: Deleted Slack row ${op.rowId}`);
      } else if (op.type === 'update') {
        console.error(`ROLLBACK: Cannot undo cell update on row ${op.rowId}. Manual fix may be needed.`);
      }
    } catch (rollbackErr) {
      logError({
        source: 'tx',
        operation: 'rollbackSlack',
        error: rollbackErr,
        metadata: { slackOps: [op] }
      });
      console.error(`ROLLBACK FAILED for ${op.type} on ${op.rowId}: ${rollbackErr.message}`);
    }
  }
}

/**
 * Run a read-only query. No transaction, no Slack sync.
 */
export async function withDb(queryFn) {
  const libs = await getWorkspaceLibs();
  return queryFn(libs.trackerDb.getDb(), libs);
}
