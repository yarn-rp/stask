#!/usr/bin/env node
/**
 * ⚠️ DEPRECATED — This module has been superseded by the Inbox Subscription Engine.
 *
 * PR status detection is now handled by:
 *   - lib/inbox/sources/github.mjs (fetches PR merge state and comments)
 *   - lib/inbox/actions.mjs (executes automated transitions)
 *   - lib/inbox/pollerd.mjs (daemon entry point, runs on cron)
 *
 * View PR-related inbox items:  stask inbox list --source github
 * View specific item:           stask inbox show <item-id>
 *
 * This file is preserved for reference only. Do not import from it.
 * Removal scheduled: v0.3.0
 */

console.error('⚠️ lib/pr-status.mjs is DEPRECATED. Use: stask inbox list --source github');
process.exit(1);