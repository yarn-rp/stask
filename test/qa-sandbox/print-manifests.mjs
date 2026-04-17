#!/usr/bin/env node
/**
 * print-manifests.mjs — emit the 4 Slack app manifests the sandbox needs,
 * using the SAME generator and templates that `stask setup` consumes.
 *
 * No forked/duplicated manifests — this script just calls
 * `generateSlackManifest(agentManifest, displayName)` against the live
 * templates/team/<role>/manifest.json. Change the templates, change what
 * prints here. That's the whole point.
 *
 * Usage:
 *   node test/qa-sandbox/print-manifests.mjs                         # dump all 4 to stdout
 *   node test/qa-sandbox/print-manifests.mjs --write <dir>           # write 4 files into <dir>
 *   node test/qa-sandbox/print-manifests.mjs --role lead             # dump only the lead manifest
 *   node test/qa-sandbox/print-manifests.mjs --role qa --copy        # pbcopy just the qa one (macOS)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const { generateSlackManifest } = await import('../../lib/setup/manifest.mjs');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.resolve(__dirname, '..', '..', 'templates', 'team');

// Sandbox display names — the "(QA Test)" suffix makes them visually distinct
// from production apps in the Slack admin UI, and keeps identity on the stask
// side (professor/berlin/tokyo/helsinki) unchanged.
const ROLES = [
  { id: 'lead',     display: 'Professor (QA Test)' },
  { id: 'backend',  display: 'Berlin (QA Test)'    },
  { id: 'frontend', display: 'Tokyo (QA Test)'     },
  { id: 'qa',       display: 'Helsinki (QA Test)'  },
];

const args = process.argv.slice(2);
const roleArg = args.includes('--role') ? args[args.indexOf('--role') + 1] : null;
const writeDir = args.includes('--write') ? args[args.indexOf('--write') + 1] : null;
const copy = args.includes('--copy');

const targets = roleArg ? ROLES.filter(r => r.id === roleArg) : ROLES;
if (roleArg && targets.length === 0) {
  console.error(`No role '${roleArg}'. Valid: ${ROLES.map(r => r.id).join(', ')}`);
  process.exit(2);
}

const rendered = targets.map(({ id, display }) => {
  const manifestPath = path.join(TEMPLATES_DIR, id, 'manifest.json');
  const agentManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  return { id, display, json: generateSlackManifest(agentManifest, display) };
});

if (writeDir) {
  fs.mkdirSync(writeDir, { recursive: true });
  for (const r of rendered) {
    const out = path.join(writeDir, `${r.id}.json`);
    fs.writeFileSync(out, r.json + '\n');
    console.log(`→ ${out}`);
  }
} else if (copy && rendered.length === 1) {
  const r = rendered[0];
  const res = spawnSync('pbcopy', [], { input: r.json });
  if (res.status !== 0) {
    console.error('pbcopy not available (non-macOS?) — falling back to stdout');
    process.stdout.write(r.json + '\n');
  } else {
    console.log(`${r.display} manifest copied to clipboard.`);
  }
} else {
  for (const r of rendered) {
    console.log(`\n=== ${r.id} — ${r.display} ===`);
    console.log(r.json);
  }
}
