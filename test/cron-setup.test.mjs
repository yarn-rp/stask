/**
 * cron-setup.test.mjs — Verify the lead-only cron behavior.
 *
 * Workers and QA no longer carry `cron.heartbeat`. setupCronJobs must:
 *   - Emit a job only for agents whose manifest has `cron.heartbeat`.
 *   - Garbage-collect pre-existing `<agent>-heartbeat` jobs when the
 *     corresponding manifest no longer wants one (migration path).
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { setupCronJobs } from '../lib/setup/cron-setup.mjs';

let sandboxHome;
let originalHome;

function jobsFilePath() {
  return path.join(sandboxHome, '.openclaw', 'cron', 'jobs.json');
}

function readJobs() {
  return JSON.parse(fs.readFileSync(jobsFilePath(), 'utf-8'));
}

describe('setupCronJobs (lead-only)', () => {
  beforeEach(() => {
    sandboxHome = fs.mkdtempSync(path.join(os.tmpdir(), 'stask-cron-test-'));
    originalHome = process.env.HOME;
    process.env.HOME = sandboxHome;
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    fs.rmSync(sandboxHome, { recursive: true, force: true });
  });

  const BASE_MANIFESTS = {
    lead: { role: 'lead', cron: { heartbeat: '*/5 * * * *' } },
    backend: { role: 'backend' }, // no cron.heartbeat
    qa: { role: 'qa' },
  };

  // NOTE: setupCronJobs is import-cached; jobsFile path resolves at module-load
  // time from process.env.HOME. We import fresh so the sandbox HOME is honored.
  async function freshSetup(agents, manifests, slug = 'demo') {
    // delete cache entry to re-resolve OPENCLAW_HOME under the sandbox HOME
    const modPath = new URL('../lib/setup/cron-setup.mjs', import.meta.url).href + `?t=${Date.now()}`;
    const mod = await import(modPath);
    return mod.setupCronJobs(agents, manifests, slug);
  }

  it('emits a job only for agents with cron.heartbeat', async () => {
    const agents = [
      ['professor', { role: 'lead' }],
      ['berlin', { role: 'worker' }],
      ['helsinki', { role: 'qa' }],
    ];
    const res = await freshSetup(agents, BASE_MANIFESTS);
    assert.deepEqual(res.created.sort(), ['professor-heartbeat']);
    assert.deepEqual(res.removed, []);

    const jobs = readJobs();
    assert.equal(jobs.jobs.length, 1);
    assert.equal(jobs.jobs[0].name, 'professor-heartbeat');
    assert.equal(jobs.jobs[0].agentId, 'professor');
    assert.equal(jobs.jobs[0].schedule.expr, '*/5 * * * *');
    assert.match(jobs.jobs[0].payload.message, /supervisor tick/);
    assert.match(jobs.jobs[0].payload.message, /acpx/);
  });

  it('garbage-collects worker/qa heartbeat jobs left over from the old model', async () => {
    // Pre-seed jobs.json with old-style worker & QA heartbeats.
    const dir = path.dirname(jobsFilePath());
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(jobsFilePath(), JSON.stringify({
      version: 1,
      jobs: [
        { id: 'a', agentId: 'professor', name: 'professor-heartbeat', enabled: true, schedule: { kind: 'cron', expr: '0,20,40 * * * *' }, payload: { kind: 'agentTurn', message: 'old' }, delivery: { mode: 'none' } },
        { id: 'b', agentId: 'berlin', name: 'berlin-heartbeat', enabled: true, schedule: { kind: 'cron', expr: '5,25,45 * * * *' }, payload: { kind: 'agentTurn', message: 'old' }, delivery: { mode: 'none' } },
        { id: 'c', agentId: 'helsinki', name: 'helsinki-heartbeat', enabled: true, schedule: { kind: 'cron', expr: '15,35,55 * * * *' }, payload: { kind: 'agentTurn', message: 'old' }, delivery: { mode: 'none' } },
        // unrelated non-heartbeat job should survive
        { id: 'd', agentId: 'demo', name: 'inbox-pollerd', enabled: true, schedule: { kind: 'cron', expr: '*/5 * * * *' }, payload: { kind: 'agentTurn', message: 'poll' }, delivery: { mode: 'none' } },
      ],
    }) + '\n');

    const agents = [
      ['professor', { role: 'lead' }],
      ['berlin', { role: 'worker' }],
      ['helsinki', { role: 'qa' }],
    ];
    const res = await freshSetup(agents, BASE_MANIFESTS);
    assert.deepEqual(res.removed.sort(), ['berlin-heartbeat', 'helsinki-heartbeat']);

    const jobs = readJobs();
    const names = jobs.jobs.map(j => j.name).sort();
    assert.deepEqual(names, ['inbox-pollerd', 'professor-heartbeat']);
    // Lead's schedule updated to the new */5 cadence
    const lead = jobs.jobs.find(j => j.name === 'professor-heartbeat');
    assert.equal(lead.schedule.expr, '*/5 * * * *');
  });

  it('skips heartbeat job when lead manifest has no cron.heartbeat', async () => {
    const manifests = {
      lead: { role: 'lead' }, // no cron.heartbeat
      backend: { role: 'backend' },
      qa: { role: 'qa' },
    };
    const agents = [['professor', { role: 'lead' }]];
    const res = await freshSetup(agents, manifests);
    assert.deepEqual(res.created, []);

    const jobs = readJobs();
    assert.equal(jobs.jobs.length, 0);
  });
});
