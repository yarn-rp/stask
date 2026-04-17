#!/usr/bin/env node
/**
 * render-answers.mjs — merge credentials + static template into the answers
 * file `stask setup` will consume via STASK_SETUP_ANSWERS.
 *
 * Usage: node render-answers.mjs <credentials.json> <template.json> <repo-path> <gh-login> <gh-name>
 * Writes merged JSON to stdout.
 */

import fs from 'node:fs';

const [, , credsPath, templatePath, repoPath, ghLogin, ghName] = process.argv;
if (!credsPath || !templatePath || !repoPath || !ghLogin) {
  console.error('usage: render-answers.mjs <credentials> <template> <repo-path> <gh-login> [gh-name]');
  process.exit(2);
}

const creds = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
const answers = JSON.parse(fs.readFileSync(templatePath, 'utf-8'));

// Drop the _comment field — clack would never see it but keep the JSON clean.
delete answers._comment;

// Dynamic values. Key order below mirrors the order agents are enumerated in
// stask setup — Bot/App Token arrays are consumed FIFO, so this has to match
// the ROLES order (lead/backend/frontend/qa → professor/berlin/tokyo/helsinki).
const apps = creds.slack.apps;
answers['Repo path'] = repoPath;
answers['Your name'] = ghName || ghLogin;
answers['GitHub username'] = ghLogin;
answers['Your Slack user ID (Profile → ⋮ → Copy member ID)'] = creds.slack.humanUserId;
answers['Bot Token'] = [
  apps.professor.botToken,
  apps.berlin.botToken,
  apps.tokyo.botToken,
  apps.helsinki.botToken,
];
answers['App Token'] = [
  apps.professor.appToken,
  apps.berlin.appToken,
  apps.tokyo.appToken,
  apps.helsinki.appToken,
];

process.stdout.write(JSON.stringify(answers, null, 2) + '\n');
