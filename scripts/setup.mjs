#!/usr/bin/env node
/**
 * One-command setup + verification for humans and AI agents.
 *
 *   node scripts/setup.mjs           install everything and verify it (safe to re-run)
 *   node scripts/setup.mjs --check   only report problems; changes nothing
 *
 * The LAST line of output is always either "SETUP OK" or "SETUP FAILED: <step>".
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const require = createRequire(path.join(root, 'package.json'));

const CHECK_ONLY = process.argv.includes('--check');
const isWin = process.platform === 'win32';
const NPM = isWin ? 'npm.cmd' : 'npm';
const NPX = isWin ? 'npx.cmd' : 'npx';
const warnings = [];

function say(msg) {
  console.log(msg);
}

function fail(step, fix) {
  say(`\n❌ ${step}`);
  if (fix) say(`   How to fix: ${fix}`);
  say(`\nSETUP FAILED: ${step}`);
  process.exit(1);
}

function run(step, cmd, args, fix) {
  say(`\n▶ ${step}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: root, env: process.env });
  if (r.status !== 0) fail(step, fix);
  say(`✔ ${step}`);
}

function depsInstalled() {
  try {
    for (const pkg of ['playwright', 'better-sqlite3', 'express', 'tsx', 'vite', 'react']) require.resolve(`${pkg}/package.json`);
    // better-sqlite3 is a native module: make sure it actually loads, not just exists.
    const Database = require('better-sqlite3');
    new Database(':memory:').close();
    return true;
  } catch {
    return false;
  }
}

function chromiumPath() {
  try {
    const p = require('playwright').chromium.executablePath();
    return p && fs.existsSync(p) ? p : null;
  } catch {
    return null;
  }
}

function portInUse(port) {
  const tryHost = (host) =>
    new Promise((resolve) => {
      const s = net.connect({ port, host });
      s.once('connect', () => (s.destroy(), resolve(true)));
      s.once('error', () => resolve(false));
      s.setTimeout(800, () => (s.destroy(), resolve(false)));
    });
  // Vite may listen on IPv6 only, so check both.
  return Promise.all([tryHost('127.0.0.1'), tryHost('::1')]).then((r) => r.some(Boolean));
}

say(`KindredStudio setup ${CHECK_ONLY ? '(check only — nothing will be changed)' : ''}`);
say(`Folder: ${root}`);

// 1. Node version
const nodeMajor = Number(process.versions.node.split('.')[0]);
say(`\n▶ Node.js ${process.versions.node}`);
if (nodeMajor < 20) fail(`Node.js ${process.versions.node} is too old (need 20 or newer)`, 'Install Node 20+ from https://nodejs.org (or `brew install node`), then rerun.');
say('✔ Node.js is new enough');

// 2. Platform
if (process.platform !== 'darwin') {
  warnings.push(`This is ${process.platform}, not macOS. The browser automation shortcuts, the daily scheduler and a few helpers are written for macOS; expect to adapt them.`);
}

// 3. Dependencies
say('\n▶ npm dependencies');
if (depsInstalled()) {
  say('✔ already installed');
} else if (CHECK_ONLY) {
  fail('npm dependencies are missing or broken', 'Run: node scripts/setup.mjs');
} else {
  const hasLock = fs.existsSync(path.join(root, 'package-lock.json'));
  run('Installing npm dependencies', NPM, hasLock ? ['ci', '--no-audit', '--no-fund'] : ['install', '--no-audit', '--no-fund'],
    'If a native module (better-sqlite3) fails to build on macOS, run `xcode-select --install`, then rerun.');
  if (!depsInstalled()) fail('Dependencies installed but could not be loaded', 'Delete node_modules and rerun: rm -rf node_modules && node scripts/setup.mjs');
}

// 4. Playwright's Chromium (npm install does NOT download it)
say('\n▶ Playwright Chromium browser');
if (chromiumPath()) {
  say('✔ already installed');
} else if (CHECK_ONLY) {
  fail('Playwright Chromium is not installed', 'Run: npx playwright install chromium');
} else {
  run('Downloading Chromium (one time, ~150 MB)', NPX, ['playwright', 'install', 'chromium'], 'Check your internet connection, then rerun.');
  if (!chromiumPath()) fail('Chromium was downloaded but cannot be found', 'Run: npx playwright install chromium --force');
}

// 5. .env
say('\n▶ .env file');
const envPath = path.join(root, '.env');
if (fs.existsSync(envPath)) {
  say('✔ exists');
} else if (CHECK_ONLY) {
  warnings.push('.env is missing — run `node scripts/setup.mjs` to create it from .env.example.');
} else {
  fs.copyFileSync(path.join(root, '.env.example'), envPath);
  say('✔ created .env from .env.example (the browser workflow needs no API keys)');
}

// 6. Storage folders
for (const sub of ['videos', 'frames', 'thumbnails', 'logs', 'channels']) {
  const dir = path.join(root, 'storage', sub);
  if (!fs.existsSync(dir) && !CHECK_ONLY) fs.mkdirSync(dir, { recursive: true });
}

// 6b. Studio channels check (read-only)
try {
  const dbPath = path.join(root, 'storage', 'kindred_studio.db');
  if (fs.existsSync(dbPath)) {
    const Database = require('better-sqlite3');
    const sdb = new Database(dbPath, { readonly: true });
    const tables = sdb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='channels'").all();
    if (tables.length > 0) {
      const rows = sdb.prepare('SELECT id, name FROM channels').all();
      say(`\n▶ Studio Channels (${rows.length})`);
      for (const ch of rows) {
        const chDir = path.join(root, 'storage', 'channels', String(ch.id));
        const hasImg = ['reference.jpg', 'reference.png', 'reference.webp'].some((f) => fs.existsSync(path.join(chDir, f)));
        if (!hasImg) {
          warnings.push(`Channel "${ch.name}" (ID ${ch.id}) has no reference image yet. Upload one via the Studio tab.`);
        }
      }
      say(`✔ ${rows.length} channel(s) in studio catalog`);
    }
    sdb.close();
  }
} catch {}

// 7. Verification (skipped in --check mode)
if (!CHECK_ONLY) {
  run('Type-check', NPX, ['tsc', '--noEmit', '-p', '.'], 'A TypeScript error means the code is broken — fix it before continuing.');
  run('Tests (use their own throw-away database)', NPM, ['test'], 'Read the failing test above. Tests never touch the real database.');
  run('Build the web page', NPM, ['run', 'build'], 'Read the build error above.');
}

// 8. Ports (informational)
for (const [port, what] of [[3000, 'backend API'], [5173, 'web page']]) {
  if (await portInUse(port)) warnings.push(`Port ${port} (${what}) is already in use — probably the app is already running. Fine if intended; otherwise stop the other process first.`);
}

// 9. Summary
if (warnings.length) {
  say('\n⚠ Notes');
  for (const w of warnings) say(`  - ${w}`);
}

say(`
────────────────────────────────────────────────────────────
Next steps (only the HUMAN can do these — never enter their passwords):
  1. Start the app:            npm run dev        → open http://localhost:5173
  2. Settings → "Make & Post a Video Now": a browser window opens; the human signs into
     ChatGPT, Grok and TikTok (it waits, then continues by itself).
  3. Settings → ChatGPT Master Prompt Chat → "Auto-Detect from Sidebar" (or paste the URL
     of the pinned "Create Mr Apple Videos" chat).
  NOTE: a run posts a REAL video to TikTok. Don't start one unless the human asked.
────────────────────────────────────────────────────────────
`);
say('SETUP OK');
