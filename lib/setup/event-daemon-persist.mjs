/**
 * event-daemon-persist.mjs — Install/uninstall OS-level persistence for the
 * stask event daemon.
 *
 * macOS:  launchd user plist at ~/Library/LaunchAgents/com.stask.<slug>.event-daemon.plist
 * Linux:  systemd user unit at ~/.config/systemd/user/stask-<slug>-event-daemon.service
 *
 * The daemon is started automatically after install.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const HOME = process.env.HOME || '';
const PLATFORM = process.platform;

/**
 * Install OS-level autostart for the event daemon.
 *
 * @param {Object} opts
 * @param {string} opts.nodeExecPath  - Absolute path to node binary
 * @param {string} opts.daemonScript  - Absolute path to stask-event-daemon.mjs
 * @param {string} opts.staskHome     - .stask/ directory for the project
 * @param {string} opts.slug          - Project slug (for plist/unit naming)
 * @returns {{ ok: boolean, label: string, path: string, message: string }}
 */
export function installPersistence({ nodeExecPath, daemonScript, staskHome, slug }) {
  if (PLATFORM === 'darwin') {
    return installLaunchd({ nodeExecPath, daemonScript, staskHome, slug });
  }
  if (PLATFORM === 'linux') {
    return installSystemd({ nodeExecPath, daemonScript, staskHome, slug });
  }
  return {
    ok: false,
    label: '',
    path: '',
    message: `Unsupported platform: ${PLATFORM}. Start the daemon manually: stask event-daemon start`,
  };
}

/**
 * Uninstall OS-level autostart for the event daemon.
 */
export function uninstallPersistence({ slug }) {
  if (PLATFORM === 'darwin') return uninstallLaunchd({ slug });
  if (PLATFORM === 'linux') return uninstallSystemd({ slug });
  return { ok: false, message: `Unsupported platform: ${PLATFORM}` };
}

// ─── macOS (launchd) ─────────────────────────────────────────────────

function launchdLabel(slug) { return `com.stask.${slug}.event-daemon`; }
function launchdPlistPath(slug) {
  return path.join(HOME, 'Library', 'LaunchAgents', `${launchdLabel(slug)}.plist`);
}

function installLaunchd({ nodeExecPath, daemonScript, staskHome, slug }) {
  const label = launchdLabel(slug);
  const plistPath = launchdPlistPath(slug);
  const logDir = path.join(staskHome, 'logs');

  if (!fs.existsSync(path.dirname(plistPath))) {
    try { fs.mkdirSync(path.dirname(plistPath), { recursive: true }); } catch (_) {}
  }

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>

  <key>ProgramArguments</key>
  <array>
    <string>${nodeExecPath}</string>
    <string>${daemonScript}</string>
  </array>

  <key>EnvironmentVariables</key>
  <dict>
    <key>STASK_HOME</key>
    <string>${staskHome}</string>
    <key>HOME</key>
    <string>${HOME}</string>
  </dict>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <true/>

  <key>StandardOutPath</key>
  <string>${path.join(logDir, 'event-daemon.log')}</string>

  <key>StandardErrorPath</key>
  <string>${path.join(logDir, 'event-daemon.log')}</string>

  <key>ThrottleInterval</key>
  <integer>5</integer>
</dict>
</plist>
`;

  fs.writeFileSync(plistPath, plist, 'utf-8');

  try {
    // Unload first in case it was already loaded (avoids "already loaded" error)
    try { execFileSync('launchctl', ['unload', plistPath], { encoding: 'utf-8' }); } catch (_) {}
    execFileSync('launchctl', ['load', plistPath], { encoding: 'utf-8' });
    return { ok: true, label, path: plistPath, message: `Installed launchd plist: ${plistPath}` };
  } catch (err) {
    return { ok: false, label, path: plistPath, message: `Written plist but launchctl load failed: ${err.message}` };
  }
}

function uninstallLaunchd({ slug }) {
  const plistPath = launchdPlistPath(slug);
  try {
    execFileSync('launchctl', ['unload', plistPath], { encoding: 'utf-8' });
  } catch (_) {}
  try {
    fs.unlinkSync(plistPath);
    return { ok: true, message: `Removed launchd plist: ${plistPath}` };
  } catch (err) {
    return { ok: false, message: `Failed to remove plist: ${err.message}` };
  }
}

// ─── Linux (systemd user) ────────────────────────────────────────────

function systemdUnitName(slug) { return `stask-${slug}-event-daemon`; }
function systemdUnitPath(slug) {
  return path.join(HOME, '.config', 'systemd', 'user', `${systemdUnitName(slug)}.service`);
}

function installSystemd({ nodeExecPath, daemonScript, staskHome, slug }) {
  const unitName = systemdUnitName(slug);
  const unitPath = systemdUnitPath(slug);
  const logDir = path.join(staskHome, 'logs');

  if (!fs.existsSync(path.dirname(unitPath))) {
    try { fs.mkdirSync(path.dirname(unitPath), { recursive: true }); } catch (_) {}
  }

  const unit = `[Unit]
Description=stask event daemon (${slug})
After=network.target

[Service]
Type=simple
ExecStart=${nodeExecPath} ${daemonScript}
Restart=on-failure
RestartSec=5
Environment=STASK_HOME=${staskHome}
Environment=HOME=${HOME}
StandardOutput=append:${path.join(logDir, 'event-daemon.log')}
StandardError=append:${path.join(logDir, 'event-daemon.log')}

[Install]
WantedBy=default.target
`;

  fs.writeFileSync(unitPath, unit, 'utf-8');

  try {
    execFileSync('systemctl', ['--user', 'daemon-reload'], { encoding: 'utf-8' });
    execFileSync('systemctl', ['--user', 'enable', '--now', unitName], { encoding: 'utf-8' });
    return { ok: true, label: unitName, path: unitPath, message: `Installed systemd user unit: ${unitPath}` };
  } catch (err) {
    return { ok: false, label: unitName, path: unitPath, message: `Written unit but systemctl enable failed: ${err.message}` };
  }
}

function uninstallSystemd({ slug }) {
  const unitName = systemdUnitName(slug);
  const unitPath = systemdUnitPath(slug);
  try {
    execFileSync('systemctl', ['--user', 'disable', '--now', unitName], { encoding: 'utf-8' });
  } catch (_) {}
  try {
    fs.unlinkSync(unitPath);
    execFileSync('systemctl', ['--user', 'daemon-reload'], { encoding: 'utf-8' });
    return { ok: true, message: `Removed systemd unit: ${unitPath}` };
  } catch (err) {
    return { ok: false, message: `Failed to remove unit: ${err.message}` };
  }
}
