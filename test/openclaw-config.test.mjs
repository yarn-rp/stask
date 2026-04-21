/**
 * openclaw-config.test.mjs — registerAgents drives the openclaw CLI
 * (agents add / agents bind / channels add) via a stub.
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
let staskConfigPath;
let prevBin;

function readLog() {
  if (!fs.existsSync(stubLogPath)) return [];
  return fs.readFileSync(stubLogPath, 'utf-8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}

function writeStubState(state) {
  fs.writeFileSync(stubStatePath, JSON.stringify(state));
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

if (cmd === 'agents' && sub === 'list') {
  const state = loadState();
  process.stdout.write(JSON.stringify(state.agents || []));
  process.exit(0);
}
if (cmd === 'agents' && sub === 'add') {
  const state = loadState();
  const name = rest[0];
  if ((state.agents || []).some(a => a.id === name)) {
    process.stderr.write(\`Agent "\${name}" already exists.\\n\`);
    process.exit(1);
  }
  const workspace = args[args.indexOf('--workspace') + 1];
  const agentDir = args.indexOf('--agent-dir') > -1 ? args[args.indexOf('--agent-dir') + 1] : null;
  const model = args.indexOf('--model') > -1 ? args[args.indexOf('--model') + 1] : null;
  state.agents = state.agents || [];
  state.agents.push({ id: name, workspace, agentDir, model });
  saveState(state);
  process.stdout.write(JSON.stringify({ agentId: name, workspace, agentDir, bindings: { added: [], skipped: [], conflicts: [] } }));
  process.exit(0);
}
if (cmd === 'agents' && sub === 'bind') {
  const agent = args[args.indexOf('--agent') + 1];
  const binds = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--bind') binds.push(args[i + 1]);
  }
  process.stdout.write(JSON.stringify({ agent, added: binds, skipped: [], conflicts: [] }));
  process.exit(0);
}
if (cmd === 'channels' && sub === 'add') {
  const account = args[args.indexOf('--account') + 1];
  process.stdout.write(\`Added Slack account "\${account}".\\n\`);
  process.exit(0);
}
if (cmd === 'config' && sub === 'set') {
  // Echo back the path we just set so the caller sees a clean JSON line.
  process.stdout.write(JSON.stringify({ ok: true, path: args[2] }) + '\\n');
  process.exit(0);
}
process.stderr.write('unhandled: ' + cmd + ' ' + sub + '\\n');
process.exit(2);
`;
  fs.writeFileSync(stubPath, script);
  fs.chmodSync(stubPath, 0o755);
}

async function freshRegister(opts) {
  const modUrl = new URL('../lib/setup/openclaw-config.mjs', import.meta.url).href + `?t=${Date.now()}`;
  const mod = await import(modUrl);
  return mod.registerAgents(opts);
}

describe('registerAgents (openclaw CLI)', () => {
  beforeEach(() => {
    sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'stask-oc-cfg-'));
    stubPath = path.join(sandbox, 'openclaw-stub.mjs');
    stubLogPath = path.join(sandbox, 'calls.jsonl');
    stubStatePath = path.join(sandbox, 'state.json');
    staskConfigPath = path.join(sandbox, 'stask-config.json');
    prevBin = process.env.STASK_OPENCLAW_BIN;
    process.env.STASK_OPENCLAW_BIN = stubPath;
    writeStubState({ agents: [] });
    buildStub();
  });

  afterEach(() => {
    if (prevBin !== undefined) process.env.STASK_OPENCLAW_BIN = prevBin;
    else delete process.env.STASK_OPENCLAW_BIN;
    fs.rmSync(sandbox, { recursive: true, force: true });
  });

  const TEAM = [
    { id: 'professor', name: 'Professor', workspace: '/tmp/ws/professor', agentDir: '/tmp/ad/professor', model: 'ollama/model-a' },
    { id: 'berlin', name: 'Berlin', workspace: '/tmp/ws/berlin', agentDir: '/tmp/ad/berlin', model: 'ollama/model-b' },
    { id: 'helsinki', name: 'Helsinki', workspace: '/tmp/ws/helsinki', agentDir: '/tmp/ad/helsinki', model: 'ollama/model-c' },
  ];

  const SLACK = {
    professor: { botToken: 'xoxb-p', appToken: 'xapp-p' },
    berlin: { botToken: 'xoxb-b', appToken: 'xapp-b' },
    helsinki: { botToken: 'xoxb-h', appToken: 'xapp-h' },
  };

  it('adds channels, agents, and bindings via the CLI', async () => {
    const res = await freshRegister({
      projectSlug: 'demo',
      agents: TEAM,
      leadId: 'professor',
      slackAccounts: SLACK,
    });
    assert.deepEqual(res.added.sort(), ['berlin', 'helsinki', 'professor']);
    assert.deepEqual(res.skipped, []);
    assert.deepEqual(res.slackAccounts.added.sort(), ['berlin', 'helsinki', 'professor']);

    const calls = readLog();
    const channelsAdd = calls.filter(c => c.cmd === 'channels' && c.sub === 'add');
    assert.equal(channelsAdd.length, 3);
    // Check one: --account + tokens + --name flow through.
    const prof = channelsAdd.find(c => c.args.includes('professor'));
    assert.ok(prof.args.includes('--bot-token'));
    assert.equal(prof.args[prof.args.indexOf('--bot-token') + 1], 'xoxb-p');
    assert.equal(prof.args[prof.args.indexOf('--app-token') + 1], 'xapp-p');
    assert.equal(prof.args[prof.args.indexOf('--name') + 1], 'Professor');

    const agentsAdd = calls.filter(c => c.cmd === 'agents' && c.sub === 'add');
    assert.equal(agentsAdd.length, 3);
    // agents add carries --bind slack:<id> at add-time.
    for (const a of agentsAdd) {
      const name = a.args[2];
      const bindIdx = a.args.indexOf('--bind');
      assert.ok(bindIdx > -1, `agents add for ${name} should include --bind`);
      assert.equal(a.args[bindIdx + 1], `slack:${name}`);
      assert.ok(a.args.includes('--non-interactive'));
      assert.ok(a.args.includes('--json'));
    }
  });

  it('applies Slack trust policy per account when humanSlackUserId is provided', async () => {
    const res = await freshRegister({
      projectSlug: 'demo',
      agents: TEAM,
      leadId: 'professor',
      slackAccounts: SLACK,
      humanSlackUserId: 'U0HUMAN1',
    });
    assert.deepEqual(res.slackAccounts.trustApplied.sort(), ['berlin', 'helsinki', 'professor']);

    const calls = readLog();
    const configSets = calls.filter(c => c.cmd === 'config' && c.sub === 'set');
    // 4 writes per account (allowFrom, dmPolicy, groupPolicy, execApprovals) * 3 accounts = 12.
    assert.equal(configSets.length, 12);

    // Verify professor's allowFrom carries the human user id.
    const profAllowFrom = configSets.find(c =>
      c.args[2] === 'channels.slack.accounts.professor.allowFrom',
    );
    assert.ok(profAllowFrom);
    assert.deepEqual(JSON.parse(profAllowFrom.args[3]), ['U0HUMAN1']);

    // Exec approvals should be disabled.
    const profExec = configSets.find(c =>
      c.args[2] === 'channels.slack.accounts.professor.execApprovals',
    );
    assert.ok(profExec);
    assert.deepEqual(JSON.parse(profExec.args[3]), { enabled: false });
  });

  it('skips trust policy when humanSlackUserId is not provided', async () => {
    await freshRegister({
      projectSlug: 'demo',
      agents: TEAM.slice(0, 1),
      leadId: 'professor',
      slackAccounts: SLACK,
    });
    const calls = readLog();
    assert.equal(calls.filter(c => c.cmd === 'config' && c.sub === 'set').length, 0);
  });

  it('skips agents that already exist; bindings still ensured via agents bind', async () => {
    writeStubState({
      agents: [
        { id: 'professor', workspace: '/tmp/ws/professor' },
      ],
    });
    buildStub();

    const res = await freshRegister({
      projectSlug: 'demo',
      agents: TEAM,
      leadId: 'professor',
      slackAccounts: SLACK,
    });
    assert.deepEqual(res.skipped, ['professor']);
    assert.deepEqual(res.added.sort(), ['berlin', 'helsinki']);

    const calls = readLog();
    const agentsAdd = calls.filter(c => c.cmd === 'agents' && c.sub === 'add');
    assert.equal(agentsAdd.length, 2);
    assert.deepEqual(agentsAdd.map(c => c.args[2]).sort(), ['berlin', 'helsinki']);

    const agentsBind = calls.filter(c => c.cmd === 'agents' && c.sub === 'bind');
    // Existing agent gets an explicit bind call.
    assert.equal(agentsBind.length, 1);
    assert.equal(agentsBind[0].args[agentsBind[0].args.indexOf('--agent') + 1], 'professor');
  });

  it('writes acp defaults into .stask/config.json, not openclaw.json', async () => {
    fs.writeFileSync(staskConfigPath, JSON.stringify({ existing: true }) + '\n');

    await freshRegister({
      projectSlug: 'demo',
      agents: TEAM.slice(0, 1),
      leadId: 'professor',
      slackAccounts: {},
      acpDefaults: { cli: 'acpx', agent: 'codex', hangTimeoutMinutes: 5 },
      staskConfigPath,
    });

    const cfg = JSON.parse(fs.readFileSync(staskConfigPath, 'utf-8'));
    assert.equal(cfg.existing, true, 'existing keys in stask config preserved');
    assert.ok(cfg.acp, 'acp block written to stask config');
    assert.equal(cfg.acp.cli, 'acpx');
    assert.equal(cfg.acp.agent, 'codex');
    assert.equal(cfg.acp.hangTimeoutMinutes, 5);
    // Defaults are filled in for unspecified fields.
    assert.equal(cfg.acp.enabled, true);
    assert.equal(cfg.acp.fallback, 'fail');
  });

  it('does nothing with acpDefaults if staskConfigPath is missing', async () => {
    await freshRegister({
      projectSlug: 'demo',
      agents: TEAM.slice(0, 1),
      leadId: 'professor',
      slackAccounts: {},
      acpDefaults: { cli: 'acpx' },
      // no staskConfigPath
    });
    // No crash; path wasn't created.
    assert.equal(fs.existsSync(staskConfigPath), false);
  });

  it('throws if openclaw agents add fails for a new agent', async () => {
    // Pre-seed with the same id to force a duplicate-name error from the stub.
    writeStubState({ agents: [{ id: 'professor', workspace: '/old' }] });
    buildStub();

    // But because we pre-seed, registerAgents will treat professor as skipped.
    // To actually force an add failure, add a non-preseeded agent after making
    // the stub reject it. Instead we test the error-path by giving the stub a
    // broken state file, which makes it fail.
    fs.unlinkSync(stubStatePath);

    await assert.rejects(
      () => freshRegister({
        projectSlug: 'demo',
        agents: TEAM,
        leadId: 'professor',
        slackAccounts: SLACK,
      }),
      /openclaw/,
    );
  });
});
