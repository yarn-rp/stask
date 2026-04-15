/**
 * lib/setup/prompt.mjs — Re-exports @clack/prompts with convenience wrappers.
 *
 * Centralizes all UI rendering for the setup wizard.
 */

import {
  intro,
  outro,
  text,
  confirm,
  select,
  spinner,
  note,
  cancel,
  isCancel,
  log,
  group,
} from '@clack/prompts';

export { intro, outro, text, confirm, select, spinner, note, cancel, isCancel, log, group };

import pc from 'picocolors';

export { pc };

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * Copy text to the system clipboard.
 * Returns true if successful, false otherwise.
 */
export function copyToClipboard(text) {
  try {
    // macOS
    if (process.platform === 'darwin') {
      execSync('pbcopy', { input: text, timeout: 3000 });
      return true;
    }
    // Linux (xclip or xsel)
    if (process.platform === 'linux') {
      try {
        execSync('xclip -selection clipboard', { input: text, timeout: 3000 });
        return true;
      } catch {
        execSync('xsel --clipboard --input', { input: text, timeout: 3000 });
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Write text to a temp file and return the path.
 */
export function writeToTempFile(text, filename) {
  const tmpDir = path.join(os.tmpdir(), 'stask-setup');
  fs.mkdirSync(tmpDir, { recursive: true });
  const filePath = path.join(tmpDir, filename);
  fs.writeFileSync(filePath, text);
  return filePath;
}

/**
 * Copy content to clipboard and save a temp file backup.
 * If clipboard works, just confirms. If not, shows the file path.
 * Returns the temp file path.
 */
export async function showCopyable(content, title, tempFilename) {
  const tempPath = writeToTempFile(content, tempFilename);
  const copied = copyToClipboard(content);

  if (copied) {
    log.success(`${title} — ${pc.green('copied to clipboard!')}`);
    log.info(pc.dim(`  Backup: ${tempPath}`));
  } else {
    log.warn(`Could not copy to clipboard automatically.`);
    log.info(`  File saved to: ${pc.cyan(tempPath)}`);
    log.info(pc.dim(`  Copy it with: ${pc.cyan(`cat ${tempPath} | pbcopy`)}`));
  }

  return tempPath;
}

/**
 * Clear the terminal and move cursor to top.
 */
export function clearScreen() {
  process.stdout.write('\x1b[2J\x1b[H');
}

/**
 * Show a compact progress header after clearing the screen.
 * Completed steps get a checkmark, current step is highlighted.
 */
export function showProgress(steps, currentIndex, title) {
  clearScreen();
  const bar = steps.map((name, i) => {
    if (i < currentIndex) return pc.green(`${pc.bold('\u2713')} ${name}`);
    if (i === currentIndex) return pc.cyan(pc.bold(`\u25B6 ${name}`));
    return pc.dim(`  ${name}`);
  }).join(pc.dim('  '));

  console.log(pc.dim('\u2500'.repeat(60)));
  console.log(bar);
  console.log(pc.dim('\u2500'.repeat(60)));
  console.log('');
}

/**
 * Format a clickable hyperlink for terminals that support OSC 8.
 * Falls back to showing the URL in parentheses.
 */
export function link(label, url) {
  return `\x1b]8;;${url}\x07${pc.underline(pc.cyan(label))}\x1b]8;;\x07`;
}

/**
 * Format a dim path.
 */
export function dimPath(p) {
  return pc.dim(p);
}

/**
 * Format a model name with provider prefix highlighted.
 */
export function fmtModel(model) {
  const [provider, name] = model.split('/');
  return `${pc.dim(provider + '/')}${pc.bold(name)}`;
}
