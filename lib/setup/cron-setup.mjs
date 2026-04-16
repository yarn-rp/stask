/**
 * lib/setup/cron-setup.mjs — Write/merge staggered heartbeat cron jobs.
 *
 * Writes to ~/.openclaw/cron/jobs.json with staggered schedules
 * to avoid all agents polling simultaneously.
 *
 * OpenClaw expects jobs.json to have `jobs` as an **array** of job objects
 * with a specific schema (id, name, description, schedule, sessionTarget,
 * wakeMode, payload, delivery, state).
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const OPENCLAW_HOME = path.join(process.env.HOME || '', '.openclaw');
const CRON_DIR = path.join(OPENCLAW_HOME, 'cron');
const JOBS_FILE = path.join(CRON_DIR, 'jobs.json');

const HEARTBEAT_PROMPT = 'Pipeline heartbeat. Be fast — spawn subsessions for heavy work, don\'t do it inline.\n\nRead your HEARTBEAT.md and follow it strictly.';

/**
 * Create heartbeat cron jobs for all agents.
 * Schedules are read from agent manifests.
 *
 * @param {Array<[string, Object]>} agents — entries from ctx.agents
 * @param {Object} [agentManifests] — manifest.json per role (optional, falls back to defaults)
 * @param {string} [projectSlug] — project slug for heartbeat prompt
 * @returns {{ created: string[], updated: string[], skipped: string[] }}
 */
export function setupCronJobs(agents, agentManifests, projectSlug) {
  fs.mkdirSync(CRON_DIR, { recursive: true });

  let existing = { version: 1, jobs: [] };
  if (fs.existsSync(JOBS_FILE)) {
    try {
      const raw = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf-8'));
      // Normalize: handle both array and legacy object formats
      if (Array.isArray(raw.jobs)) {
        existing = raw;
      } else if (raw.jobs && typeof raw.jobs === 'object') {
        // Legacy format: convert object to array
        existing = { version: raw.version || 1, jobs: Object.values(raw.jobs) };
      }
    } catch {
      // Corrupted — start fresh
    }
  }

  if (!Array.isArray(existing.jobs)) existing.jobs = [];

  const created = [];
  const updated = [];
  const skipped = [];

  // Fallback stagger pattern if no manifests provided
  // Lead: 0,20,40 · Workers: 5,25,45 · QA: 15,35,55
  const FALLBACK_CRONS = ['0,20,40 * * * *', '5,25,45 * * * *', '5,25,45 * * * *', '15,35,55 * * * *'];

  const now = Date.now();
  const slug = projectSlug || 'stask';

  const heartbeats = agents.map(([name, cfg], i) => {
    // Try to find schedule from agent manifest
    const roleId = cfg.role === 'worker' ? guessRoleFromIndex(agents, name) : cfg.role;
    const manifest = agentManifests?.[roleId];
    const cron = manifest?.cron?.heartbeat || FALLBACK_CRONS[i % FALLBACK_CRONS.length];
    const roleName = cfg.role === 'lead' ? 'lead' : cfg.role === 'qa' ? 'QA' : 'worker';
    return { id: name, cron, role: roleName };
  });

  for (const { id, cron, role } of heartbeats) {
    const jobName = `${id}-heartbeat`;
    const existingIdx = existing.jobs.findIndex(j => j.name === jobName);

    const job = buildJob({
      agentId: id,
      name: jobName,
      description: `${capitalize(id)} checks stask pipeline for ${role === 'qa' ? 'Testing tasks' : role === 'lead' ? 'pending delegation, QA review, or stale tasks' : 'In-Progress subtasks'}`,
      cronExpr: cron,
      createdAtMs: existingIdx >= 0 ? existing.jobs[existingIdx].createdAtMs || now : now,
      projectSlug: slug,
    });

    if (existingIdx >= 0) {
      // Preserve existing state, update schedule and config
      const oldJob = existing.jobs[existingIdx];
      job.state = oldJob.state || {};
      existing.jobs[existingIdx] = job;

      if (oldJob.schedule?.expr !== cron || oldJob.agentId !== id) {
        updated.push(jobName);
      } else {
        skipped.push(jobName);
      }
    } else {
      existing.jobs.push(job);
      created.push(jobName);
    }
  }

  fs.writeFileSync(JOBS_FILE, JSON.stringify(existing, null, 2) + '\n');
  return { created, updated, skipped };
}

/**
 * Build a complete OpenClaw cron job object.
 */
function buildJob({ agentId, name, description, cronExpr, createdAtMs, projectSlug }) {
  return {
    id: crypto.randomUUID(),
    agentId,
    name,
    description,
    enabled: true,
    createdAtMs,
    updatedAtMs: Date.now(),
    schedule: {
      kind: 'cron',
      expr: cronExpr,
      tz: 'America/New_York',
    },
    sessionTarget: 'isolated',
    wakeMode: 'now',
    payload: {
      kind: 'agentTurn',
      message: `${HEARTBEAT_PROMPT}\n\n1. Run: stask --project ${projectSlug} heartbeat ${agentId}\n2. For each pendingTask: check sessions_list(activeMinutes=10) for label pipeline:<taskId>. If no active session, sessions_spawn() with the task prompt. If stale, spawn fresh.\n3. Reply with summary of spawned sessions (or HEARTBEAT_OK if nothing to do). Do NOT do implementation work in this session.`,
      timeoutSeconds: 600,
    },
    delivery: {
      mode: 'none',
    },
  };
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