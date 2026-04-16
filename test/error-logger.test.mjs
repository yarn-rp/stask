/**
 * error-logger.test.mjs — Tests for lib/error-logger.mjs
 *
 * Covers: logError, logWarn, directory creation, rotation, fallback.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { logError, logWarn } from '../lib/error-logger.mjs';

// ─── Test helpers ─────────────────────────────────────────────────

let tmpDir;
let originalStaskHome;

function setup() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stask-error-logger-test-'));
  originalStaskHome = process.env.STASK_HOME;
  process.env.STASK_HOME = tmpDir;
}

function teardown() {
  process.env.STASK_HOME = originalStaskHome;
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

function getLogPath() {
  return path.join(tmpDir, 'logs', 'errors.jsonl');
}

function readLogLines() {
  const logPath = getLogPath();
  if (!fs.existsSync(logPath)) return [];
  const content = fs.readFileSync(logPath, 'utf-8').trim();
  if (!content) return [];
  return content.split('\n').map(line => JSON.parse(line));
}

// ─── Tests ───────────────────────────────────────────────────────

describe('error-logger', () => {
  beforeEach(() => setup());
  afterEach(() => teardown());

  it('logError writes a JSONL entry with all fields', () => {
    logError({
      source: 'sync-daemon',
      operation: 'syncTaskToSlack',
      taskId: 'T-024',
      error: 'rate limited',
      retries: 3,
      metadata: { listId: 'L123' },
    });

    const lines = readLogLines();
    assert.equal(lines.length, 1);

    const entry = lines[0];
    assert.equal(entry.level, 'error');
    assert.equal(entry.source, 'sync-daemon');
    assert.equal(entry.operation, 'syncTaskToSlack');
    assert.equal(entry.taskId, 'T-024');
    assert.equal(entry.error, 'rate limited');
    assert.equal(entry.retries, 3);
    assert.deepEqual(entry.metadata, { listId: 'L123' });
    assert.ok(entry.timestamp);
    // Verify timestamp is valid ISO
    assert.ok(!isNaN(Date.parse(entry.timestamp)));
  });

  it('logWarn writes a warn-level entry', () => {
    logWarn({
      source: 'thread-notify',
      operation: 'postThreadUpdate',
      error: 'timeout',
      taskId: 'T-001',
    });

    const lines = readLogLines();
    assert.equal(lines.length, 1);
    assert.equal(lines[0].level, 'warn');
    assert.equal(lines[0].source, 'thread-notify');
    assert.equal(lines[0].error, 'timeout');
    assert.equal(lines[0].retries, null);
  });

  it('creates logs directory on first write', () => {
    const logsDir = path.join(tmpDir, 'logs');
    assert.ok(!fs.existsSync(logsDir));

    logError({ source: 'test', operation: 'test', error: 'test' });

    assert.ok(fs.existsSync(logsDir));
    assert.ok(fs.existsSync(getLogPath()));
  });

  it('appends multiple entries to the same file', () => {
    logError({ source: 'test', operation: 'op1', error: 'err1' });
    logWarn({ source: 'test', operation: 'op2', error: 'err2' });
    logError({ source: 'test', operation: 'op3', error: 'err3', taskId: 'T-005' });

    const lines = readLogLines();
    assert.equal(lines.length, 3);
    assert.equal(lines[0].level, 'error');
    assert.equal(lines[1].level, 'warn');
    assert.equal(lines[2].taskId, 'T-005');
  });

  it('handles missing optional fields gracefully', () => {
    logError({ source: 'test', operation: 'test', error: 'err' });

    const lines = readLogLines();
    assert.equal(lines.length, 1);
    assert.equal(lines[0].taskId, null);
    assert.equal(lines[0].retries, null);
    assert.deepEqual(lines[0].metadata, {});
  });

  it('handles Error objects by extracting .message', () => {
    const err = new Error('something broke');
    logError({ source: 'test', operation: 'test', error: err });

    const lines = readLogLines();
    assert.equal(lines[0].error, 'something broke');
  });

  it('rotates log file when it exceeds 10MB', () => {
    const logPath = getLogPath();

    // Write enough data to exceed 10MB
    // Each entry is ~200 bytes, so we need ~50,000+ entries
    // Instead, let's write a small file and then manually inflate it
    logError({ source: 'test', operation: 'init', error: 'init' });

    // Now directly pad the file to be over 10MB
    const bigLine = JSON.stringify({ timestamp: new Date().toISOString(), level: 'error', source: 'pad', operation: 'pad', error: 'x'.repeat(200), taskId: null, retries: null, metadata: {} }) + '\n';
    const lineBytes = Buffer.byteLength(bigLine, 'utf-8');
    const targetSize = 10 * 1024 * 1024 + 1; // just over 10MB
    const linesNeeded = Math.ceil(targetSize / lineBytes);

    // Write in batches to avoid OOM
    const batch = bigLine.repeat(1000);
    const fd = fs.openSync(logPath, 'a');
    for (let i = 0; i < linesNeeded; i += 1000) {
      fs.writeFileSync(fd, batch);
    }
    fs.closeSync(fd);

    // Verify file is over 10MB
    assert.ok(fs.statSync(logPath).size >= 10 * 1024 * 1024);

    // Now trigger rotation by writing another entry
    logError({ source: 'test', operation: 'post-rotate', error: 'after-rotation' });

    // The original file should have been rotated to .1
    assert.ok(fs.existsSync(`${logPath}.1`), 'rotated file .1 should exist');

    // A new log file should exist with the latest entry
    const newLines = readLogLines();
    assert.ok(newLines.length >= 1);
    assert.equal(newLines[newLines.length - 1].operation, 'post-rotate');
  });

  it('keeps only 3 rotated files', () => {
    const logPath = getLogPath();
    const bigLine = JSON.stringify({ timestamp: new Date().toISOString(), level: 'error', source: 'pad', operation: 'pad', error: 'x'.repeat(200), taskId: null, retries: null, metadata: {} }) + '\n';
    const lineBytes = Buffer.byteLength(bigLine, 'utf-8');
    const targetSize = 10 * 1024 * 1024 + 1;
    const linesNeeded = Math.ceil(targetSize / lineBytes);
    const batch = bigLine.repeat(1000);

    // Rotate 4 times
    for (let rot = 0; rot < 4; rot++) {
      // Ensure the log file exists (logError creates it + logs dir)
      logError({ source: 'test', operation: `rotate-${rot}`, error: 'trigger' });

      // Pad the file to exceed 10MB
      const fd = fs.openSync(logPath, 'a');
      for (let i = 0; i < linesNeeded; i += 1000) {
        fs.writeFileSync(fd, batch);
      }
      fs.closeSync(fd);

      // Trigger rotation with another write
      logError({ source: 'test', operation: `post-rotate-${rot}`, error: 'trigger' });
    }

    // .1, .2, .3 should exist but NOT .4
    assert.ok(fs.existsSync(`${logPath}.1`), '.1 exists');
    assert.ok(fs.existsSync(`${logPath}.2`), '.2 exists');
    assert.ok(fs.existsSync(`${logPath}.3`), '.3 exists');
    assert.ok(!fs.existsSync(`${logPath}.4`), '.4 should not exist');
  });

  it('falls back to console.error when file write fails', () => {
    // Make the logs directory a file (not a directory) to force write failure
    const logsDir = path.join(tmpDir, 'logs');
    fs.writeFileSync(logsDir, 'blocker'); // exists as file, not dir

    // Capture console.error output
    const origError = console.error;
    let captured = [];
    console.error = (...args) => { captured.push(args.join(' ')); };

    try {
      // This should not throw — it falls back to console.error
      logError({ source: 'test', operation: 'fallback', error: 'file-write-failed' });
    } finally {
      console.error = origError;
    }

    // Should have logged to console about the failure
    assert.ok(captured.some(msg => msg.includes('error-logger')), 'should log fallback message');
  });
});