/**
 * stask doctor — Read-only health checks for the stask / OpenClaw integration.
 *
 * Targets the specific failure modes we've seen in the wild:
 *
 *   1. `Subagent announce completion direct announce agent call transient
 *      failure, retrying … : gateway timeout after 120000ms` in gateway.log.
 *      → agents.defaults.subagents.announceTimeoutMs is unset or too low.
 *
 *   2. Webchat / dashboard WS drops (code 1001/1006) after an earlier agent
 *      flipped gateway.bind from "lan" to "loopback" without reason.
 *      → gateway.bind should be "lan" for local dev per OpenClaw docs.
 *
 *   3. openclaw.json.clobbered.* files accumulating in ~/.openclaw/.
 *      → indicates something raced the gateway on the config file.
 *
 *   4. Heartbeat cron jobs missing for registered agents (easy to happen
 *      when you edit config manually).
 *
 * Never writes. Prints remediation commands for anything it flags.
 */

import fs from 'node:fs';
import path from 'node:path';

import { configGet, cronList, OpenclawCliError } from '../lib/setup/openclaw-cli.mjs';

const OPENCLAW_HOME = path.join(process.env.HOME || '', '.openclaw');

// The defaults we expect stask setup to have written.
const EXPECTED = {
  announceTimeoutMs: 600_000,
  runTimeoutSeconds: 1800,
  subagentsMaxConcurrent: 8,
  leadMaxConcurrent: 8,
  gatewayBind: 'lan',
};

export async function run(args) {
  const jsonOut = args.includes('--json');
  const findings = [];
  function ok(msg)     { findings.push({ level: 'ok', msg }); }
  function warn(msg, fix) { findings.push({ level: 'warn', msg, fix }); }
  function err(msg, fix)  { findings.push({ level: 'err',  msg, fix }); }

  // ── 1. openclaw CLI reachable ─────────────────────────────────
  let cliReachable = true;
  try {
    configGet('agents.defaults'); // any read; throws OpenclawCliError if not
  } catch (e) {
    cliReachable = false;
    err(
      'openclaw CLI not reachable — is the gateway running?',
      'openclaw gateway start   # or: openclaw doctor --fix',
    );
  }

  if (cliReachable) {
    // ── 2. Subagent timeouts ────────────────────────────────────
    const sub = configGet('agents.defaults.subagents') || {};
    if (sub.announceTimeoutMs === undefined) {
      err(
        `agents.defaults.subagents.announceTimeoutMs is unset (default 120000ms is too short for cloud models)`,
        `openclaw config set agents.defaults.subagents.announceTimeoutMs ${EXPECTED.announceTimeoutMs}`,
      );
    } else if (sub.announceTimeoutMs < EXPECTED.announceTimeoutMs) {
      warn(
        `announceTimeoutMs = ${sub.announceTimeoutMs}ms (recommended ≥ ${EXPECTED.announceTimeoutMs}ms)`,
        `openclaw config set agents.defaults.subagents.announceTimeoutMs ${EXPECTED.announceTimeoutMs}`,
      );
    } else {
      ok(`announceTimeoutMs = ${sub.announceTimeoutMs}ms`);
    }

    if (sub.runTimeoutSeconds === undefined || sub.runTimeoutSeconds < EXPECTED.runTimeoutSeconds) {
      warn(
        `runTimeoutSeconds = ${sub.runTimeoutSeconds ?? 'unset'} (recommended ${EXPECTED.runTimeoutSeconds})`,
        `openclaw config set agents.defaults.subagents.runTimeoutSeconds ${EXPECTED.runTimeoutSeconds}`,
      );
    } else {
      ok(`runTimeoutSeconds = ${sub.runTimeoutSeconds}`);
    }

    // ── 3. Gateway bind ─────────────────────────────────────────
    const bind = configGet('gateway.bind');
    if (bind === undefined) {
      warn('gateway.bind is unset (defaults to "auto"; prefer "lan" for local dev)',
        'openclaw config set gateway.bind lan');
    } else if (bind !== EXPECTED.gatewayBind) {
      warn(
        `gateway.bind = "${bind}" (recommended "lan" for local dev — required for host browser/dashboard access)`,
        `openclaw config set gateway.bind lan && openclaw gateway restart`,
      );
    } else {
      ok(`gateway.bind = "${bind}"`);
    }

    // ── 4. Lead concurrency override ────────────────────────────
    const list = configGet('agents.list') || [];
    const leads = list.filter((a) => Array.isArray(a.subagents?.allowAgents) && a.subagents.allowAgents.length > 1);
    for (const lead of leads) {
      if ((lead.maxConcurrent ?? 0) < EXPECTED.leadMaxConcurrent) {
        warn(
          `Lead agent "${lead.id}" has maxConcurrent = ${lead.maxConcurrent ?? 'default (4)'}; bump to ${EXPECTED.leadMaxConcurrent} to absorb simultaneous worker announces`,
          `openclaw config set 'agents.list[?(@.id=="${lead.id}")].maxConcurrent' ${EXPECTED.leadMaxConcurrent}`,
        );
      } else {
        ok(`Lead "${lead.id}" maxConcurrent = ${lead.maxConcurrent}`);
      }
    }

    // ── 5. Cron jobs per agent ──────────────────────────────────
    const jobs = cronList();
    const jobNames = new Set(jobs.map((j) => j.name));
    const projectAgents = list.filter((a) => typeof a.workspace === 'string' && a.workspace.includes('/workspace-'));
    for (const a of projectAgents) {
      const expected = `${a.id}-heartbeat`;
      if (!jobNames.has(expected)) {
        warn(
          `Missing cron "${expected}" for agent "${a.id}"`,
          `stask setup --only cron   # re-run cron registration`,
        );
      }
    }

    // ── 6. Clobbered config snapshots ───────────────────────────
    try {
      const clobbered = fs.readdirSync(OPENCLAW_HOME)
        .filter((n) => n.startsWith('openclaw.json.clobbered.'));
      if (clobbered.length > 0) {
        warn(
          `${clobbered.length} openclaw.json.clobbered.* snapshot(s) present — something raced the gateway on the config file in the past`,
          `ls -1 ${OPENCLAW_HOME}/openclaw.json.clobbered.*   # review, then rm when satisfied`,
        );
      } else {
        ok('No clobbered config snapshots');
      }
    } catch { /* dir missing = nothing to check */ }
  }

  // ── Output ───────────────────────────────────────────────────
  if (jsonOut) {
    console.log(JSON.stringify({ findings }, null, 2));
  } else {
    console.log('');
    console.log('stask doctor');
    console.log('─'.repeat(40));
    for (const f of findings) {
      const glyph = f.level === 'ok' ? '✓' : f.level === 'warn' ? '⚠' : '✗';
      console.log(`  ${glyph} ${f.msg}`);
      if (f.fix) console.log(`      fix: ${f.fix}`);
    }
    console.log('');
    const bad = findings.filter((f) => f.level !== 'ok').length;
    console.log(bad === 0 ? 'All checks passed.' : `${bad} issue(s) — see "fix:" lines above.`);
  }

  process.exit(findings.some((f) => f.level === 'err') ? 1 : 0);
}
