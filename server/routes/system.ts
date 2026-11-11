import { Router } from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import db from '../db/database';
import { HttpError } from '../httpError';
import { route, megabytes } from './helpers';
import { STORAGE_ROOT, VIDEOS_DIR, FRAMES_DIR, THUMBNAILS_DIR, LOGS_DIR } from '../paths';
import { listChannels, getChannelsRoot } from '../engine/channels';
import { getRunStatus, postedTodayCount } from '../engine/dailyRunner';
import { lastRun } from '../engine/runs';
import { channelPlistPath } from '../engine/dailySchedule';

/** Overview counters, the system check, and disk use / cleanup. */
export const systemRouter = Router();

systemRouter.get(
  '/overview',
  route((req, res) => {
    const channels = listChannels();
    const states = channels.map((c) => getRunStatus(c.id).state);
    const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
    res.json({
      counts: {
        channels: channels.length,
        running: states.filter((s) => s === 'running').length,
        waitingLogin: states.filter((s) => s === 'waiting_login').length,
        postedToday: postedTodayCount(),
        heldForReview: count(`SELECT COUNT(*) AS n FROM jobs WHERE state = 'held_for_review'`),
        failedToday: count(
          `SELECT COUNT(*) AS n FROM runs WHERE state = 'error' AND date(started_at, 'localtime') = date('now', 'localtime')`
        ),
      },
      lastRun: lastRun(),
    });
  })
);

// ───────────────────────── System check ─────────────────────────

interface Check {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  fix?: string;
}

function chromiumCheck(): Check {
  const base: Pick<Check, 'id' | 'label'> = { id: 'chromium', label: 'Browser (Playwright Chromium)' };
  try {
    // executablePath() only computes the path; it does not start a browser.
    const exe: string = require('playwright').chromium.executablePath();
    if (exe && fs.existsSync(exe)) return { ...base, ok: true, detail: 'Installed.' };
    return { ...base, ok: false, detail: 'The browser the app drives is not downloaded.', fix: 'Run: npx playwright install chromium' };
  } catch (err: any) {
    return { ...base, ok: false, detail: `Playwright could not be loaded: ${err.message}`, fix: 'Run: node scripts/setup.mjs' };
  }
}

systemRouter.get(
  '/system/check',
  route((req, res) => {
    const checks: Check[] = [];

    const nodeMajor = Number(process.versions.node.split('.')[0]);
    checks.push({
      id: 'node',
      label: 'Node.js',
      ok: nodeMajor >= 20,
      detail: `Version ${process.versions.node}.`,
      fix: nodeMajor >= 20 ? undefined : 'Install Node.js 20 or newer from nodejs.org.',
    });

    const mac = process.platform === 'darwin';
    checks.push({
      id: 'platform',
      label: 'macOS',
      ok: mac,
      detail: mac ? `macOS ${os.release()}.` : `This is ${process.platform}. The daily schedule and some browser steps are written for macOS.`,
    });

    checks.push(chromiumCheck());

    try {
      const n = (db.prepare('SELECT COUNT(*) AS n FROM channels').get() as { n: number }).n;
      db.pragma('quick_check');
      checks.push({ id: 'database', label: 'Database', ok: true, detail: `Healthy. ${n} channel${n === 1 ? '' : 's'}.` });
    } catch (err: any) {
      checks.push({ id: 'database', label: 'Database', ok: false, detail: err.message, fix: 'Restore storage/kindred_studio.db from a backup.' });
    }

    try {
      fs.accessSync(STORAGE_ROOT, fs.constants.W_OK);
      const stat = fs.statfsSync(STORAGE_ROOT);
      const freeGb = (stat.bavail * stat.bsize) / 1024 ** 3;
      checks.push({
        id: 'storage',
        label: 'Storage folder',
        ok: freeGb >= 1,
        detail: `${freeGb.toFixed(1)} GB free at ${STORAGE_ROOT}.`,
        fix: freeGb >= 1 ? undefined : 'Free up disk space: each video is a few MB and each browser profile several hundred.',
      });
    } catch (err: any) {
      checks.push({ id: 'storage', label: 'Storage folder', ok: false, detail: `Cannot write to ${STORAGE_ROOT}: ${err.message}` });
    }

    const scheduled = listChannels().filter((c) => c.schedule_enabled);
    const missing = mac ? scheduled.filter((c) => !fs.existsSync(channelPlistPath(c.id))) : [];
    checks.push({
      id: 'schedules',
      label: 'Daily schedules',
      ok: missing.length === 0,
      detail:
        scheduled.length === 0
          ? 'No channel has a daily schedule.'
          : missing.length === 0
            ? `${scheduled.length} channel${scheduled.length === 1 ? ' is' : 's are'} scheduled: ${scheduled.map((c) => c.name).join(', ')}.`
            : `Schedule is on but not installed for: ${missing.map((c) => c.name).join(', ')}.`,
      fix: missing.length ? 'Open the channel and switch its daily schedule off and on again.' : undefined,
    });

    res.json({ checks });
  })
);

// ───────────────────────── Storage ─────────────────────────

function listFiles(dir: string): Array<{ file: string; size: number }> {
  if (!fs.existsSync(dir)) return [];
  const out: Array<{ file: string; size: number }> = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || entry.name.startsWith('.')) continue;
    const file = path.join(dir, entry.name);
    try {
      out.push({ file, size: fs.statSync(file).size });
    } catch {
      // file vanished between readdir and stat
    }
  }
  return out;
}

function treeSize(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    try {
      if (entry.isSymbolicLink()) continue;
      total += entry.isDirectory() ? treeSize(full) : fs.statSync(full).size;
    } catch {
      // unreadable entry: skip
    }
  }
  return total;
}

const sum = (files: Array<{ size: number }>) => files.reduce((acc, f) => acc + f.size, 0);

/** File names (not paths) the database points at, so a moved project folder still matches. */
function referencedNames(column: 'video_path' | 'thumbnail_path'): Set<string> {
  const rows = db.prepare(`SELECT ${column} AS p FROM jobs WHERE ${column} IS NOT NULL`).all() as Array<{ p: string }>;
  return new Set(rows.map((r) => path.basename(r.p)));
}

function orphanVideos(): Array<{ file: string; size: number }> {
  const keep = referencedNames('video_path');
  return listFiles(VIDEOS_DIR).filter((f) => !keep.has(path.basename(f.file)));
}

function removableFrames(): Array<{ file: string; size: number }> {
  const keep = referencedNames('thumbnail_path');
  return listFiles(FRAMES_DIR).filter((f) => /\.(png|jpe?g)$/i.test(f.file) && !keep.has(path.basename(f.file)));
}

let profileSizeCache: { at: number; count: number; bytes: number } | null = null;

/** Browser profiles are large trees; measuring them is cached for a minute. */
function profilesSize(): { count: number; bytes: number } {
  if (profileSizeCache && Date.now() - profileSizeCache.at < 60_000) return profileSizeCache;
  const root = getChannelsRoot();
  let count = 0;
  let bytes = 0;
  if (fs.existsSync(root)) {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const profile = path.join(root, entry.name, 'browser_profile');
      if (fs.existsSync(profile)) {
        count++;
        bytes += treeSize(profile);
      }
    }
  }
  profileSizeCache = { at: Date.now(), count, bytes };
  return profileSizeCache;
}

systemRouter.get(
  '/storage/status',
  route((req, res) => {
    const videos = listFiles(VIDEOS_DIR);
    const frames = listFiles(FRAMES_DIR);
    const thumbnails = listFiles(THUMBNAILS_DIR);
    const orphans = orphanVideos();
    const profiles = profilesSize();
    const group = (files: Array<{ size: number }>) => ({ count: files.length, sizeMb: megabytes(sum(files)) });
    res.json({
      root: STORAGE_ROOT,
      videos: group(videos),
      frames: group(frames),
      thumbnails: group(thumbnails),
      profiles: { count: profiles.count, sizeMb: megabytes(profiles.bytes) },
      orphanVideos: group(orphans),
      totalMb: megabytes(sum(videos) + sum(frames) + sum(thumbnails) + profiles.bytes),
    });
  })
);

systemRouter.post(
  '/storage/open-folder',
  route((req, res) => {
    const targets: Record<string, string> = { videos: VIDEOS_DIR, logs: LOGS_DIR, storage: STORAGE_ROOT };
    const dir = targets[String(req.body?.target)];
    if (!dir) throw new HttpError(400, 'Unknown folder.');
    if (process.platform !== 'darwin') throw new HttpError(400, `Opening folders works on macOS only. The folder is ${dir}`);
    fs.mkdirSync(dir, { recursive: true });
    return new Promise<void>((resolve, reject) => {
      execFile('open', [dir], (err) => {
        if (err) return reject(new HttpError(500, `Could not open the folder: ${err.message}`));
        res.json({ success: true, path: dir });
        resolve();
      });
    });
  })
);

systemRouter.post(
  '/storage/cleanup',
  route((req, res) => {
    // A run in progress writes files before the database knows about them: leave anything touched in the last hour.
    const cutoff = Date.now() - 60 * 60 * 1000;
    const old = (f: { file: string }) => {
      try {
        return fs.statSync(f.file).mtimeMs < cutoff;
      } catch {
        return false;
      }
    };
    const doomed: Array<{ file: string; size: number }> = [];
    if (req.body?.frames) doomed.push(...removableFrames().filter(old));
    if (req.body?.orphanVideos) doomed.push(...orphanVideos().filter(old));
    let deletedCount = 0;
    let freed = 0;
    for (const f of doomed) {
      try {
        fs.rmSync(f.file);
        deletedCount++;
        freed += f.size;
      } catch {
        // already gone or locked: skip
      }
    }
    const freedMb = megabytes(freed);
    res.json({
      success: true,
      deletedCount,
      freedMb,
      message: deletedCount ? `Removed ${deletedCount} file${deletedCount === 1 ? '' : 's'}, freeing ${freedMb} MB.` : 'Nothing to remove.',
    });
  })
);
