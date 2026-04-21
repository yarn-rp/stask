/**
 * lib/setup/cron-setup.mjs — Write/merge heartbeat cron jobs for agents that
 * declare `cron.heartbeat` in their manifest.
 *
 * New architecture: the lead is the only scheduled actor. Worker and QA
 * manifests no longer carry `cron.heartbeat`; they run only when the lead
 * summons them (via sessions_spawn) or when a worker resumes its own acpx
 * Codex session. Setup skips agents without `cron.heartbeat`.
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

const HEARTBEAT_PROMPT = 'Pipeline supervisor tick — you are the only scheduled actor.\n\nRead your HEARTBEAT.md and follow it strictly. Spawn acpx Codex sessions or OpenClaw subagents as needed; do not do spec/coding/QA inline.';

/**
 * Create heartbeat cron jobs for agents that declare `cron.heartbeat`.
 *
 * @param {Array<[string, Object]>} agents — entries from ctx.agents; each value
 *   is `{ role: 'lead' | 'worker' | 'qa', ... }` at the stask-config level.
 * @param {Object<string, Object>} [agentManifests] — per-role manifest (keyed
 *   by manifest.role). Used to read `cron.heartbeat`.
 * @param {string} [projectSlug]
 * @returns {{ created: string[], updated: string[], skipped: string[] }}
 */
export function setupCronJobs(agents, agentManifests, projectSlug) {
  fs.mkdirSync(CRON_DIR, { recursive: true });

  let existing = { version: 1, jobs: [] };
  if (fs.existsSync(JOBS_FILE)) {
    try {
      const raw = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf-8'));
      if (Array.isArray(raw.jobs)) {
        existing = raw;
      } else if (raw.jobs && typeof raw.jobs === 'object') {
        // Legacy: convert map to array
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

  const now = Date.now();
  const slug = projectSlug || 'stask';

  // Build heartbeat descriptors only for agents whose manifest carries
  // `cron.heartbeat`. Workers and QA are lead-driven in the new model.
  const heartbeats = agents
    .map(([name, cfg]) => ({ name, cfg, manifest: findManifest(cfg.role, name, agentManifests) }))
    .filter(({ manifest }) => manifest?.cron?.heartbeat)
    .map(({ name, cfg, manifest }) => ({
      id: name,
      cron: manifest.cron.heartbeat,
      role: cfg.role === 'lead' ? 'lead' : cfg.role === 'qa' ? 'QA' : 'worker',
    }));

  // Garbage-collect orphaned heartbeat jobs for agents that used to have a
  // cron.heartbeat but no longer do (e.g. workers/QA after the migration).
  const wantedNames = new Set(heartbeats.map(h => `${h.id}-heartbeat`));
  const removed = [];
  existing.jobs = existing.jobs.filter(j => {
    const isHeartbeat = j.name && j.name.endsWith('-heartbeat');
    if (!isHeartbeat) return true;
    if (wantedNames.has(j.name)) return true;
    // An existing heartbeat job that no agent manifest wants anymore.
    removed.push(j.name);
    return false;
  });

  for (const { id, cron, role } of heartbeats) {
    const jobName = `${id}-heartbeat`;
    const existingIdx = existing.jobs.findIndex(j => j.name === jobName);

    const job = buildJob({
      agentId: id,
      name: jobName,
      description: describe(id, role),
      cronExpr: cron,
      createdAtMs: existingIdx >= 0 ? existing.jobs[existingIdx].createdAtMs || now : now,
      projectSlug: slug,
    });

    if (existingIdx >= 0) {
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
  return { created, updated, skipped, removed };
}

/**
 * Resolve the manifest for an agent entry.
 *
 * Agent entries in stask config are keyed by instance name (Berlin, Tokyo,
 * Helsinki, ...) with a coarse `role` of 'lead' | 'worker' | 'qa'. Template
 * manifests are keyed by the finer-grained role (lead / backend / frontend /
 * qa). For 'worker' instances we try the first manifest whose role is neither
 * 'lead' nor 'qa'. All worker manifests carry identical behavior now (no
 * cron.heartbeat), so picking any one is safe.
 */
function findManifest(coarseRole, _name, agentManifests) {
  if (!agentManifests) return null;
  if (coarseRole === 'lead') return agentManifests.lead || null;
  if (coarseRole === 'qa') return agentManifests.qa || null;
  // worker — find any non-lead, non-qa manifest
  for (const [key, m] of Object.entries(agentManifests)) {
    if (key === 'lead' || key === 'qa') continue;
    return m;
  }
  return null;
}

function describe(id, role) {
  if (role === 'lead') {
    return `${capitalize(id)} supervises the stask pipeline: drives requirements analysis, delegates via acpx+sessions_spawn, and closes tasks after QA.`;
  }
  // Not expected in the new architecture, but kept for backward compat.
  if (role === 'QA') return `${capitalize(id)} runs QA on Testing tasks.`;
  return `${capitalize(id)} works In-Progress subtasks.`;
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
      message: `${HEARTBEAT_PROMPT}\n\n1. Run: stask --project ${projectSlug} heartbeat ${agentId}\n2. For each active task, follow the supervisor loop in HEARTBEAT.md: check acpx session health per (task, agent) group via \`stask session health --label <thread_id>:<agent>[:<subtask>]\`; resume with acpx (\`acpx codex -s <label> --ttl 0 ...\`) on hung/missing; spawn OpenClaw subagent via sessions_spawn when a worker or QA persona is needed for a task.\n3. Reply with a summary: tasks supervised, sessions resumed/spawned, items awaiting human review.`,
      timeoutSeconds: 600,
    },
    delivery: {
      mode: 'none',
    },
  };
}

function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }
