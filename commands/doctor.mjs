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
import { readStaskBlock } from '../lib/setup/git-exclude.mjs';
import { isReady as jiraReady, projectExists as jiraProjectExists } from '../lib/jira-cli.mjs';

const OPENCLAW_HOME = path.join(process.env.HOME || '', '.openclaw');

// The defaults we expect stask setup to have written.
const EXPECTED = {
  announceTimeoutMs: 600_000,
  runTimeoutSeconds: 1800,
  subagentsMaxConcurrent: 8,
  maxConcurrent: 8,
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

    // ── 4. Default agent concurrency ────────────────────────────
    // This is the lever that absorbs worker-announce fan-in on the lead.
    // Per-agent maxConcurrent isn't in the OpenClaw schema.
    const defaults = configGet('agents.defaults') || {};
    const list = configGet('agents.list') || [];
    if ((defaults.maxConcurrent ?? 0) < EXPECTED.maxConcurrent) {
      warn(
        `agents.defaults.maxConcurrent = ${defaults.maxConcurrent ?? 'unset (default 3)'}; recommend ${EXPECTED.maxConcurrent} so leads absorb simultaneous worker announces`,
        `openclaw config set agents.defaults.maxConcurrent ${EXPECTED.maxConcurrent}`,
      );
    } else {
      ok(`agents.defaults.maxConcurrent = ${defaults.maxConcurrent}`);
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

  // ── 7. stask project config — repos list + .git/info/exclude ──
  // Loaded lazily so `stask doctor` still works in a directory with no
  // resolved project (e.g. checking the OpenClaw side from anywhere).
  let projectConfig = null;
  try {
    const { CONFIG } = await import('../lib/env.mjs');
    projectConfig = CONFIG;
  } catch {}

  if (projectConfig) {
    if (!Array.isArray(projectConfig.repos) || projectConfig.repos.length === 0) {
      err(
        'config.json has no `repos` list',
        'edit .stask/config.json and add `"repos": [{ "path": "." }]`',
      );
    } else {
      ok(`config has ${projectConfig.repos.length} repo${projectConfig.repos.length > 1 ? 's' : ''} configured`);
      for (const r of projectConfig.repos) {
        if (!fs.existsSync(r.path)) {
          err(`repo path missing: ${r.path}`, `clone the repo at ${r.path} or fix .stask/config.json`);
          continue;
        }
        const block = readStaskBlock(r.path);
        if (block === null) {
          warn(`could not check .git/info/exclude for ${r.path}`);
        } else if (!block.includes('.stask/')) {
          warn(
            `.git/info/exclude in ${r.path} missing stask block — stask artifacts may show in git status`,
            `re-run \`stask setup --only claude\` to repair the exclude block`,
          );
        } else {
          ok(`.git/info/exclude OK in ${r.key || path.basename(r.path)}`);
        }
      }
    }

    // ── 8. Jira CLI + project handshake ──────────────────────────
    const jiraKey = projectConfig.jira?.projectKey;
    if (jiraKey) {
      if (!jiraReady()) {
        err(
          '`jira` CLI is not available or not authenticated',
          'install ankitpokhrel/jira-cli and run `jira init`',
        );
      } else if (!jiraProjectExists(jiraKey)) {
        err(
          `authenticated user cannot see Jira project "${jiraKey}"`,
          'verify the project key in .stask/config.json or your Jira permissions',
        );
      } else {
        ok(`jira project "${jiraKey}" reachable`);
      }
    }
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
