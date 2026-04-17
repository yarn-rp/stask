/**
 * stask update — Upgrade stask to the latest version on npm.
 *
 * Usage:
 *   stask update [--check] [--version <semver>] [--dry-run]
 *
 * Compares the installed version against @web42/stask on the npm registry
 * and (unless --check) runs `npm install -g @web42/stask@<version>` to
 * upgrade in place.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const PKG_NAME = '@web42/stask';

function parseArgs(argv) {
  const args = { check: false, dryRun: false, version: 'latest' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--check') args.check = true;
    else if (argv[i] === '--dry-run') args.dryRun = true;
    else if ((argv[i] === '--version' || argv[i] === '-v') && argv[i + 1]) args.version = argv[++i];
    else {
      console.error(`Unknown flag: ${argv[i]}`);
      console.error(`Run "stask update --help" for usage.`);
      process.exit(1);
    }
  }
  return args;
}

function getInstalledVersion() {
  const pkgPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  return pkg.version;
}

async function getRegistryVersion(spec) {
  const url = `https://registry.npmjs.org/${encodeURIComponent(PKG_NAME)}/${encodeURIComponent(spec)}`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`npm registry returned ${res.status} for ${PKG_NAME}@${spec}`);
  }
  const body = await res.json();
  if (!body.version) {
    throw new Error(`No version field in registry response for ${PKG_NAME}@${spec}`);
  }
  return body.version;
}

// Compare two semver-ish strings. Returns -1, 0, 1.
function cmpSemver(a, b) {
  const pa = a.split('-')[0].split('.').map(n => parseInt(n, 10) || 0);
  const pb = b.split('-')[0].split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

export async function run(argv) {
  const args = parseArgs(argv);

  const current = getInstalledVersion();
  console.log(`Installed: ${PKG_NAME}@${current}`);

  let target;
  try {
    target = await getRegistryVersion(args.version);
  } catch (err) {
    console.error(`Failed to query npm registry: ${err.message}`);
    process.exit(1);
  }
  console.log(`Available: ${PKG_NAME}@${target}${args.version === 'latest' ? ' (latest)' : ''}`);

  const cmp = cmpSemver(target, current);

  if (args.check) {
    if (cmp > 0) {
      console.log(`\nUpdate available: ${current} → ${target}`);
      console.log(`Run "stask update" to install.`);
      process.exit(0);
    }
    if (cmp === 0) {
      console.log(`\nYou're on the latest version.`);
      process.exit(0);
    }
    console.log(`\nInstalled version is newer than the requested version.`);
    process.exit(0);
  }

  if (cmp === 0) {
    console.log(`\nAlready on ${target}. Nothing to do.`);
    process.exit(0);
  }

  const npmCmd = ['install', '-g', `${PKG_NAME}@${target}`];
  console.log(`\n→ npm ${npmCmd.join(' ')}`);

  if (args.dryRun) {
    console.log(`(dry-run) skipped.`);
    process.exit(0);
  }

  const res = spawnSync('npm', npmCmd, { stdio: 'inherit' });
  if (res.error) {
    console.error(`Failed to launch npm: ${res.error.message}`);
    process.exit(1);
  }
  if (res.status !== 0) {
    process.exit(res.status || 1);
  }
  console.log(`\n✓ Updated ${PKG_NAME} ${current} → ${target}`);
}
