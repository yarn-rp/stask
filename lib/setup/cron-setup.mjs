/**
 * lib/setup/cron-setup.mjs — Register staggered heartbeat cron jobs via the
 * `openclaw cron` CLI.
 *
 * Previously this file rewrote ~/.openclaw/cron/jobs.json directly, which:
 *   • Didn't notify the running gateway (new jobs didn't schedule until restart)
 *   • Could clobber the gateway's own writes
 *   • Bypassed the legacy-format migration `openclaw doctor --fix` performs
 *
 * The CLI handles all of that. We keep the same staggered schedule logic and
 * heartbeat prompt so behavior is unchanged at runtime.
 */

import { cronUpsertHeartbeat } from './openclaw-cli.mjs';

const HEARTBEAT_PROMPT = 'Pipeline heartbeat. Be fast — spawn subsessions for heavy work, don\'t do it inline.\n\nFollow the "Pipeline heartbeat" section of your AGENTS.md strictly.';

// Fallback stagger pattern if no manifests provided.
// Lead: 0,20,40 · Workers: 5,25,45 · QA: 15,35,55
const FALLBACK_CRONS = ['0,20,40 * * * *', '5,25,45 * * * *', '5,25,45 * * * *', '15,35,55 * * * *'];

/**
 * Create (or update) heartbeat cron jobs for all agents.
 *
 * @param {Array<[string, Object]>} agents — entries from ctx.agents
 * @param {Object} [agentManifests] — manifest.json per role (optional)
 * @param {string} [projectSlug]
 * @returns {{ created: string[], updated: string[], skipped: string[] }}
 */
export function setupCronJobs(agents, agentManifests, projectSlug) {
  const created = [];
  const updated = [];
  const skipped = [];
  const slug = projectSlug || 'stask';

  const plans = agents.map(([name, cfg], i) => {
    const roleId = cfg.role === 'worker' ? guessRoleFromIndex(agents, name) : cfg.role;
    const manifest = agentManifests?.[roleId];
    const cronExpr = manifest?.cron?.heartbeat || FALLBACK_CRONS[i % FALLBACK_CRONS.length];
    const roleName = cfg.role === 'lead' ? 'lead' : cfg.role === 'qa' ? 'QA' : 'worker';
    return { agentId: name, cronExpr, roleName };
  });

  for (const { agentId, cronExpr, roleName } of plans) {
    const jobName = `${agentId}-heartbeat`;
    const description = `${capitalize(agentId)} checks stask pipeline for ${
      roleName === 'QA' ? 'Testing tasks'
      : roleName === 'lead' ? 'pending delegation, QA review, or stale tasks'
      : 'In-Progress subtasks'
    }`;
    const message = [
      HEARTBEAT_PROMPT,
      '',
      `1. Run: stask --project ${slug} heartbeat ${agentId}`,
      `2. For each pendingTask: check sessions_list(activeMinutes=10) for label pipeline:<taskId>. If no active session, sessions_spawn() with the task prompt. If stale, spawn fresh.`,
      `3. Reply with summary of spawned sessions (or HEARTBEAT_OK if nothing to do). Do NOT do implementation work in this session.`,
    ].join('\n');

    const res = cronUpsertHeartbeat({
      agentId,
      name: jobName,
      cronExpr,
      description,
      message,
    });

    if (res.action === 'created') created.push(jobName);
    else if (res.action === 'updated') updated.push(jobName);
    else skipped.push(jobName);
  }

  return { created, updated, skipped };
}

/**
 * Try to guess the original manifest role for a worker agent.
 * Workers in stask config have role "worker" but we need "backend" or "frontend"
 * to look up the right manifest. Best effort — falls back to the agent name.
 */
function guessRoleFromIndex(agents, name) {
  const workers = agents.filter(([, v]) => v.role === 'worker');
  const idx = workers.findIndex(([n]) => n === name);
  if (idx === 0) return 'backend';
  if (idx === 1) return 'frontend';
  return name;
}

function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }
