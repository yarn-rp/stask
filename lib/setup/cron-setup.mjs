/**
 * lib/setup/cron-setup.mjs — Write/merge staggered heartbeat cron jobs.
 *
 * Writes to ~/.openclaw/cron/jobs.json with staggered schedules
 * to avoid all agents polling simultaneously.
 */

import fs from 'node:fs';
import path from 'node:path';

const OPENCLAW_HOME = path.join(process.env.HOME || '', '.openclaw');
const CRON_DIR = path.join(OPENCLAW_HOME, 'cron');
const JOBS_FILE = path.join(CRON_DIR, 'jobs.json');

/**
 * Create heartbeat cron jobs for all agents.
 * Schedules are read from agent manifests.
 *
 * @param {Array<[string, Object]>} agents — entries from ctx.agents
 * @param {Object} [agentManifests] — manifest.json per role (optional, falls back to defaults)
 * @returns {{ created: string[], skipped: string[] }}
 */
export function setupCronJobs(agents, agentManifests) {
  fs.mkdirSync(CRON_DIR, { recursive: true });

  let existing = { version: 1, jobs: {} };
  if (fs.existsSync(JOBS_FILE)) {
    try {
      existing = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf-8'));
    } catch {
      // Corrupted — start fresh but preserve version
    }
  }

  if (!existing.jobs) existing.jobs = {};

  const created = [];
  const skipped = [];

  // Fallback stagger pattern if no manifests provided
  const FALLBACK_CRONS = ['0,20,40 * * * *', '5,25,45 * * * *', '10,30,50 * * * *', '15,35,55 * * * *'];

  const heartbeats = agents.map(([name, cfg], i) => {
    // Try to find schedule from agent manifest
    const roleId = cfg.role === 'worker' ? guessRoleFromIndex(agents, name) : cfg.role;
    const manifest = agentManifests?.[roleId];
    const cron = manifest?.cron?.heartbeat || FALLBACK_CRONS[i % FALLBACK_CRONS.length];
    return { id: name, cron };
  });

  for (const { id, cron } of heartbeats) {
    const jobKey = `${id}-heartbeat`;
    if (existing.jobs[jobKey]) {
      skipped.push(jobKey);
      continue;
    }

    existing.jobs[jobKey] = {
      agentId: id,
      schedule: { cron },
      enabled: true,
      timeout: 600,
      prompt: 'Run your heartbeat. Check stask pipeline and spawn subsessions for pending work.',
    };
    created.push(jobKey);
  }

  fs.writeFileSync(JOBS_FILE, JSON.stringify(existing, null, 2) + '\n');
  return { created, skipped };
}

/**
 * Try to guess the original manifest role for a worker agent.
 * Workers in stask config have role "worker" but we need "backend" or "frontend"
 * to look up the right manifest. Best effort — falls back to the agent name.
 */
function guessRoleFromIndex(agents, name) {
  // If the agent name matches a known role, use it
  const workers = agents.filter(([, v]) => v.role === 'worker');
  const idx = workers.findIndex(([n]) => n === name);
  if (idx === 0) return 'backend';
  if (idx === 1) return 'frontend';
  return name; // fallback
}
