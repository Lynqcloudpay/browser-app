/**
 * Import this FIRST in every test file. It points the app at a fresh temp storage folder before any server module
 * (which reads these variables when it loads) is imported, so tests never touch the real database, channels,
 * browser profiles or videos.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

export const TEST_STORAGE = fs.mkdtempSync(path.join(os.tmpdir(), 'kindred-test-'));
process.env.KINDRED_STORAGE_DIR = TEST_STORAGE;
process.env.DATABASE_PATH = path.join(TEST_STORAGE, 'kindred_studio.db');
delete process.env.KINDRED_CHANNELS_DIR;
// Never write to ~/Library/LaunchAgents or call launchctl from a test.
process.env.KINDRED_NO_LAUNCHD = '1';
// Never show macOS notifications from a test.
process.env.KINDRED_NO_NOTIFY = '1';
// No calls to the Jev API from tests unless a test asks for it (KINDRED_TEST_LIVE_JEV=1).
if (process.env.KINDRED_TEST_LIVE_JEV !== '1') process.env.KINDRED_NO_JEV = '1';

// The shared launch-time plan lives in the git-tracked channel_seeds folder; tests must not read or write the real one.
process.env.KINDRED_SCHEDULE_PLAN_FILE = path.join(TEST_STORAGE, 'schedule_plan.json');

/** Removes the temp storage folder. Call once at the end of each test file. */
export function cleanup(): void {
  try {
    fs.rmSync(TEST_STORAGE, { recursive: true, force: true });
  } catch {
    // best effort
  }
}
