/**
 * cron-setup.test.mjs — Lead-only cron via `openclaw cron`.
 *
 * We stub the `openclaw` CLI with a tiny Node script that records its args
 * to a JSONL file and replies with canned JSON. The real CLI is never
 * invoked, and the tests don't need a running OpenClaw gateway.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

let sandbox;
let stubPath;
let stubLogPath;
let stubStatePath;
let prevBin;

function readLog() {
  if (!fs.existsSync(stubLogPath)) return [];
  return fs.readFileSync(stubLogPath, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

function writeStubState(state) {
  fs.writeFileSync(stubStatePath, JSON.stringify(state));
}

async function freshSetup(agents, manifests, slug = 'demo') {
  const modUrl = new URL('../lib/setup/cron-setup.mjs', import.meta.url).href + `?t=${Date.now()}`;
  const mod = await import(modUrl);
  return mod.setupCronJobs(agents, manifests, slug);
}

function buildStub() {
  const script = `#!/usr/bin/env node
import fs from 'node:fs';
const args = process.argv.slice(2);
const logPath = ${JSON.stringify(stubLogPath)};
const statePath = ${JSON.stringify(stubStatePath)};
function log(entry) { fs.appendFileSync(logPath, JSON.stringify(entry) + '\\n'); }
function loadState() { return JSON.parse(fs.readFileSync(statePath, 'utf-8')); }
function saveState(s) { fs.writeFileSync(statePath, JSON.stringify(s)); }
const [cmd, sub, ...rest] = args;
log({ cmd, sub, args });

if (cmd === 'cron' && sub === 'list') {
  const state = loadState();
  if (state.gatewayDown) {
    process.stderr.write('Error: gateway closed\\n');
    process.exit(1);
  }
  process.stdout.write(JSON.stringify(state.jobs));
  process.exit(0);
}
if (cmd === 'cron' && sub === 'add') {
  const state = loadState();
  if (state.gatewayDown) {
    process.stderr.write('Error: gateway closed\\n');
    process.exit(1);
  }
  const name = args[args.indexOf('--name') + 1];
  const cronExpr = args[args.indexOf('--cron') + 1];
  const agentId = args[args.indexOf('--agent') + 1];
  const id = 'job-' + Math.random().toString(36).slice(2, 10);
  state.jobs.push({ id, name, schedule: { expr: cronExpr }, agentId });
  saveState(state);
  process.stdout.write(JSON.stringify({ id, name }));
  process.exit(0);
}
if (cmd === 'cron' && sub === 'rm') {
  const state = loadState();
  const id = args[2];
  state.jobs = state.jobs.filter(j => j.id !== id);
  saveState(state);
  process.stdout.write(JSON.stringify({ removed: id }));
  process.exit(0);
}
process.stderr.write('unhandled: ' + cmd + ' ' + sub + '\\n');
process.exit(2);
`;
  fs.writeFileSync(stubPath, script);
  fs.chmodSync(stubPath, 0o755);
}

describe('setupCronJobs (openclaw CLI)', () => {
  beforeEach(() => {
    sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'stask-cron-cli-'));
    stubPath = path.join(sandbox, 'openclaw-stub.mjs');
    stubLogPath = path.join(sandbox, 'calls.jsonl');
    stubStatePath = path.join(sandbox, 'state.json');
    prevBin = process.env.STASK_OPENCLAW_BIN;
    process.env.STASK_OPENCLAW_BIN = stubPath;
    writeStubState({ jobs: [] });
  });

  afterEach(() => {
    if (prevBin !== undefined) process.env.STASK_OPENCLAW_BIN = prevBin;
    else delete process.env.STASK_OPENCLAW_BIN;
    fs.rmSync(sandbox, { recursive: true, force: true });
  });

  const BASE_MANIFESTS = {
    lead: { role: 'lead', cron: { heartbeat: '*/5 * * * *' } },
    backend: { role: 'backend' },
    qa: { role: 'qa' },
  };

  it('emits a cron job only for agents with cron.heartbeat', async () => {
    buildStub();
    const agents = [
      ['professor', { role: 'lead' }],
      ['berlin', { role: 'worker' }],
      ['helsinki', { role: 'qa' }],
    ];
    const res = await freshSetup(agents, BASE_MANIFESTS);
    assert.deepEqual(res.created.sort(), ['professor-heartbeat']);
    assert.deepEqual(res.removed, []);

    const calls = readLog();
    const adds = calls.filter(c => c.cmd === 'cron' && c.sub === 'add');
    assert.equal(adds.length, 1);
    const a = adds[0].args;
    assert.equal(a[a.indexOf('--name') + 1], 'professor-heartbeat');
    assert.equal(a[a.indexOf('--cron') + 1], '*/5 * * * *');
    assert.equal(a[a.indexOf('--agent') + 1], 'professor');
    assert.equal(a[a.indexOf('--session') + 1], 'isolated');
    assert.equal(a[a.indexOf('--wake') + 1], 'now');
    const message = a[a.indexOf('--message') + 1];
    assert.match(message, /supervisor tick/);
    assert.match(message, /acpx/);
  });

  it('garbage-collects worker/qa heartbeat jobs left over from the old model', async () => {
    writeStubState({
      jobs: [
        { id: 'a', name: 'professor-heartbeat', schedule: { expr: '0,20,40 * * * *' }, agentId: 'professor' },
        { id: 'b', name: 'berlin-heartbeat', schedule: { expr: '5,25,45 * * * *' }, agentId: 'berlin' },
        { id: 'c', name: 'helsinki-heartbeat', schedule: { expr: '15,35,55 * * * *' }, agentId: 'helsinki' },
        { id: 'd', name: 'inbox-pollerd', schedule: { expr: '*/5 * * * *' }, agentId: 'demo' },
      ],
    });
    buildStub();

    const agents = [
      ['professor', { role: 'lead' }],
      ['berlin', { role: 'worker' }],
      ['helsinki', { role: 'qa' }],
    ];
    const res = await freshSetup(agents, BASE_MANIFESTS);

    assert.deepEqual(res.removed.sort(), ['berlin-heartbeat', 'helsinki-heartbeat']);
    assert.deepEqual(res.updated, ['professor-heartbeat']);

    const state = JSON.parse(fs.readFileSync(stubStatePath, 'utf-8'));
    const names = state.jobs.map(j => j.name).sort();
    assert.deepEqual(names, ['inbox-pollerd', 'professor-heartbeat']);
    const lead = state.jobs.find(j => j.name === 'professor-heartbeat');
    assert.equal(lead.schedule.expr, '*/5 * * * *');
  });

  it('skips unchanged jobs without re-creating', async () => {
    writeStubState({
      jobs: [
        { id: 'a', name: 'professor-heartbeat', schedule: { expr: '*/5 * * * *' }, agentId: 'professor' },
      ],
    });
    buildStub();

    const agents = [['professor', { role: 'lead' }]];
    const res = await freshSetup(agents, BASE_MANIFESTS);
    assert.deepEqual(res.skipped, ['professor-heartbeat']);
    assert.deepEqual(res.created, []);
    assert.deepEqual(res.updated, []);

    const calls = readLog();
    assert.equal(calls.filter(c => c.sub === 'add').length, 0);
    assert.equal(calls.filter(c => c.sub === 'rm').length, 0);
  });

  it('soft-fails with gatewayDown=true when the gateway is unreachable', async () => {
    writeStubState({ gatewayDown: true, jobs: [] });
    buildStub();

    const agents = [['professor', { role: 'lead' }]];
    const res = await freshSetup(agents, BASE_MANIFESTS);
    assert.equal(res.gatewayDown, true);
    assert.deepEqual(res.created, []);

    const calls = readLog();
    assert.ok(calls.every(c => c.sub === 'list'));
  });

  it('skips heartbeat job when lead manifest has no cron.heartbeat', async () => {
    buildStub();
    const manifests = { lead: { role: 'lead' }, backend: { role: 'backend' }, qa: { role: 'qa' } };
    const agents = [['professor', { role: 'lead' }]];
    const res = await freshSetup(agents, manifests);
    assert.deepEqual(res.created, []);

    const calls = readLog();
    assert.equal(calls.filter(c => c.sub === 'add').length, 0);
  });
});
