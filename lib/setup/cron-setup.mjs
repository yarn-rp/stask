/**
 * lib/setup/cron-setup.mjs — Manage lead-supervisor cron via `openclaw cron`.
 *
 * Migrated from writing ~/.openclaw/cron/jobs.json directly to driving the
 * `openclaw cron add|list|rm` CLI. OpenClaw's own scheduler is the source
 * of truth.
 *
 * New architecture: the lead is the only scheduled actor. Only manifests
 * that declare `cron.heartbeat` get a job. Orphaned `<agent>-heartbeat`
 * jobs left over from the old model (worker/QA heartbeats) are
 * garbage-collected on every run.
 *
 * Gateway dependency: `openclaw cron *` commands require a running gateway.
 * If the gateway is unreachable we surface a warning and return without
 * mutating anything — setup can be re-run via `stask setup --only cron`.
 */

import { listCronJobs, addCronJob, removeCronJob } from './openclaw-cli.mjs';

const HEARTBEAT_PROMPT =
  'Pipeline tick — you are the solo project agent.\n\n' +
  'Read your HEARTBEAT.md and follow it strictly. Drive every active task one phase forward per tick. All coding goes through acpx; QA runs in a fresh acpx session. No hand-edits, no OpenClaw subagents.';

/**
 * Sync heartbeat cron jobs for agents with `cron.heartbeat` in their manifest.
 *
 * @param {Array<[string, Object]>} agents — entries from ctx.agents; value.role is
 *   'lead' | 'worker' | 'qa'.
 * @param {Object<string, Object>} [agentManifests] — per-role manifest (keyed by
 *   manifest role), used to read `cron.heartbeat`.
 * @param {string} [projectSlug]
 * @returns {{ created: string[], updated: string[], skipped: string[], removed: string[], gatewayDown?: boolean }}
 */
export function setupCronJobs(agents, agentManifests, projectSlug) {
  const slug = projectSlug || 'stask';
  const desired = buildDesiredJobs(agents, agentManifests, slug);

  // 1. Pull current jobs from the gateway. If it's down, bail early with a
  //    soft failure so `stask setup` can finish and the user can re-run.
  let existingJobs;
  try {
    const listed = listCronJobs({ allowGatewayDown: true });
    if (listed.gatewayDown) {
      return {
        created: [], updated: [], skipped: [], removed: [],
        gatewayDown: true,
      };
    }
    existingJobs = listed.jobs || [];
  } catch (err) {
    if (err.gatewayDown) {
      return {
        created: [], updated: [], skipped: [], removed: [],
        gatewayDown: true,
      };
    }
    throw err;
  }

  const wantedNames = new Set(desired.map(j => j.name));
  const byName = new Map(existingJobs.map(j => [j.name, j]));

  const created = [];
  const updated = [];
  const skipped = [];
  const removed = [];

  // 2. Garbage-collect orphaned <agent>-heartbeat jobs (worker/QA heartbeats
  //    from the old pre-supervisor model).
  for (const job of existingJobs) {
    if (!isHeartbeatJob(job.name)) continue;
    if (wantedNames.has(job.name)) continue;
    removeCronJob(job.id);
    removed.push(job.name);
  }

  // 3. Upsert each desired job. OpenClaw's `cron add` isn't idempotent by
  //    name, so we replace-when-schedule-changed (rm then add) and leave
  //    the job alone when its schedule + agent already match.
  for (const spec of desired) {
    const current = byName.get(spec.name);
    if (current) {
      const scheduleMatches = extractCronExpr(current) === spec.cron;
      const agentMatches = (current.agentId || current.agent) === spec.agent;
      if (scheduleMatches && agentMatches) {
        skipped.push(spec.name);
        continue;
      }
      removeCronJob(current.id);
      addCronJob(spec);
      updated.push(spec.name);
    } else {
      addCronJob(spec);
      created.push(spec.name);
    }
  }

  return { created, updated, skipped, removed };
}

// ─── Internals ──────────────────────────────────────────────────────

function buildDesiredJobs(agents, agentManifests, slug) {
  return agents
    .map(([name, cfg]) => ({ name, cfg, manifest: findManifest(cfg.role, agentManifests) }))
    .filter(({ manifest }) => manifest?.cron?.heartbeat)
    .map(({ name, cfg, manifest }) => ({
      name: `${name}-heartbeat`,
      cron: manifest.cron.heartbeat,
      agent: name,
      description: describe(name, cfg.role),
      message: buildPayloadMessage(name, slug),
      session: 'isolated',
      wake: 'now',
      tz: 'America/New_York',
    }));
}

/**
 * Resolve the manifest for an agent entry.
 *
 * stask config uses coarse roles (`lead`/`worker`/`qa`); template manifests
 * key on finer roles (`lead`/`backend`/`frontend`/`qa`). For workers we return
 * any non-lead, non-qa manifest — their content is unified post-migration.
 */
function findManifest(coarseRole, agentManifests) {
  if (!agentManifests) return null;
  if (coarseRole === 'lead') return agentManifests.lead || null;
  return null;
}

function describe(id, role) {
  const pretty = capitalize(id);
  if (role === 'lead') {
    return `${pretty} owns the stask pipeline end to end: requirements analysis, planning, coding (via acpx), QA (via fresh acpx session), PR review, and merge.`;
  }
  return `${pretty} works stask tasks end to end.`;
}

function buildPayloadMessage(agentId, slug) {
  return (
    `${HEARTBEAT_PROMPT}\n\n` +
    `1. Run: stask --project ${slug} heartbeat ${agentId}\n` +
    `2. For each active task, follow the phase loop in HEARTBEAT.md: advance one phase per tick. Use acpx sessions \`<thread_id>:explore\` (spec), \`<thread_id>:code\` (implementation), \`<thread_id>:qa\` (verification). Check session health via \`stask session health --label <label>\`; resume with the same \`-s <label>\` name on hung/missing.\n` +
    `3. Reply with a summary: tasks advanced, sessions resumed, items awaiting human review.`
  );
}

function isHeartbeatJob(name) {
  return typeof name === 'string' && name.endsWith('-heartbeat');
}

/**
 * Best-effort extract of a cron expression from the varied shapes `openclaw
 * cron list --json` returns. Known fields on current versions: `schedule.expr`
 * or a flat `cron`/`scheduleExpr` depending on storage version.
 */
function extractCronExpr(job) {
  if (typeof job.cron === 'string') return job.cron;
  if (typeof job.scheduleExpr === 'string') return job.scheduleExpr;
  if (job.schedule) {
    if (typeof job.schedule.expr === 'string') return job.schedule.expr;
    if (typeof job.schedule === 'string') return job.schedule;
  }
  return null;
}

function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
