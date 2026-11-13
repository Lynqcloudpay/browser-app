/**
 * Shared launch-time registry for ALL channels, on every machine.
 *
 * Channels live on more than one computer, and each computer has its own database. The only thing the machines share
 * is the git-tracked channel_seeds folder. So every enabled channel's launch times for the day are written to
 * channel_seeds/schedule_plan.json, keyed by channel name. Planning (random series, fixed steps, plain times) reads
 * this file, so no channel can land within CHANNEL_GAP_MINUTES of another channel's video, wherever it runs.
 *
 * Writes are serialized with a lock in the storage folder, so two nightly planners never plan at the same time.
 */
import fs from 'fs';
import path from 'path';
import { CHANNEL_SEEDS_DIR, STORAGE_ROOT } from '../paths';
import { findClash, toMinutes } from './seriesPlan';

export interface SharedEntry {
  enabled: boolean;
  times: string[];
  updated: string;
}

export const SHARED_SCHEDULE_FILE =
  process.env.KINDRED_SCHEDULE_PLAN_FILE || path.join(CHANNEL_SEEDS_DIR, 'schedule_plan.json');
const LOCK_FILE = path.join(STORAGE_ROOT, 'schedule_plan.lock');
const LOCK_STALE_MS = 30_000;
const LOCK_WAIT_MS = 5_000;

export function readShared(): Record<string, SharedEntry> {
  try {
    const parsed = JSON.parse(fs.readFileSync(SHARED_SCHEDULE_FILE, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeShared(data: Record<string, SharedEntry>): void {
  fs.mkdirSync(path.dirname(SHARED_SCHEDULE_FILE), { recursive: true });
  const tmp = `${SHARED_SCHEDULE_FILE}.tmp_${process.pid}_${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, SHARED_SCHEDULE_FILE);
}

let lockHeld = false;

/** Run fn while holding the planning lock. Re-entrant within one process. */
export function withPlanLock<T>(fn: () => T): T {
  if (lockHeld) return fn();
  fs.mkdirSync(path.dirname(LOCK_FILE), { recursive: true });
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      fs.closeSync(fs.openSync(LOCK_FILE, 'wx'));
      break;
    } catch (err: any) {
      if (err.code !== 'EEXIST') throw err;
      try {
        if (Date.now() - fs.statSync(LOCK_FILE).mtimeMs > LOCK_STALE_MS) fs.unlinkSync(LOCK_FILE);
      } catch {}
      if (Date.now() > deadline) throw new Error('Another channel is planning its schedule right now. Try again in a moment.');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
  lockHeld = true;
  try {
    return fn();
  } finally {
    lockHeld = false;
    try {
      fs.unlinkSync(LOCK_FILE);
    } catch {}
  }
}

/**
 * Replace this machine's view of its channels. `channels` = every channel in the local database with its current
 * enabled flag and launch times. Entries written by other machines are kept.
 */
export function publishChannels(channels: Array<{ name: string; enabled: boolean; times: string[] }>): void {
  withPlanLock(() => {
    const all = readShared();
    const now = new Date().toISOString();
    for (const c of channels) {
      all[c.name] = { enabled: c.enabled, times: [...c.times], updated: now };
    }
    writeShared(all);
  });
}

export interface LocalPlan {
  name: string;
  enabled: boolean;
  times: string[];
}

/**
 * Every OTHER channel whose schedule is on: this machine's channels (passed in, read from the local database) plus
 * the channels other machines published. A local channel wins over a published entry with the same name.
 */
export function otherEnabledPlans(ownName: string, local: readonly LocalPlan[]): Array<{ name: string; times: string[] }> {
  const localNames = new Set(local.map((l) => l.name));
  const fromLocal = local.filter((l) => l.name !== ownName && l.enabled).map((l) => ({ name: l.name, times: l.times }));
  const fromShared = Object.entries(readShared())
    .filter(([name, e]) => name !== ownName && !localNames.has(name) && e && e.enabled)
    .map(([name, e]) => ({ name, times: Array.isArray(e.times) ? e.times : [] }));
  return [...fromLocal, ...fromShared];
}

/** Minutes of day that another channel already uses, so random planning steers around them. */
export function blockedMinutes(ownName: string, local: readonly LocalPlan[]): number[] {
  return otherEnabledPlans(ownName, local).flatMap((o) => o.times.map(toMinutes));
}

/** First clash of these times with another channel's launch times, or null. */
export function sharedClash(
  ownName: string,
  times: readonly string[],
  local: readonly LocalPlan[]
): { time: string; other: string; otherTime: string } | null {
  return findClash(times, otherEnabledPlans(ownName, local));
}
