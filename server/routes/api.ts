import { Router, raw, Request } from 'express';
import path from 'path';
import fs from 'fs';
import { HttpError } from '../httpError';
import { route } from './helpers';
import { libraryRouter } from './library';
import { systemRouter } from './system';
import { listRuns, lastRun } from '../engine/runs';
import { startRun, getRunStatus, cancelRun, postedTodayCount, isRunBusy } from '../engine/dailyRunner';
import db from '../db/database';
import {
  assertNoClash,
  getChannelSchedule,
  normalizeTimes,
  readSeries,
  setChannelSchedule,
  setChannelSeries,
  syncChannelLaunchAgent,
} from '../engine/dailySchedule';
import { getAccountsOverview, startCheck, startSwitch, cancelAccountOp, isAccountOpBusy } from '../engine/accounts';
import { AccountKey } from '../engine/accountStatus';
import {
  listChannels,
  getChannel,
  createChannel,
  updateChannel,
  deleteChannel,
  referenceImagePath,
  channelDir,
  Channel,
  exportChannelsToSeeds,
} from '../engine/channels';
import { getAgent } from '../engine/agentRegistry';
import { REPO_ROOT } from '../paths';

export const apiRouter = Router();

const startedAt = new Date().toISOString();
const packageVersion: string = (() => {
  try {
    return require(path.join(REPO_ROOT, 'package.json')).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

/** Parses the `:id` route parameter as a positive integer. Anything else is a 400. */
export function channelIdParam(req: Request): number {
  const text = String(req.params.id ?? '');
  if (!/^\d+$/.test(text)) throw new HttpError(400, 'Invalid channel id');
  const id = Number(text);
  if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(400, 'Invalid channel id');
  return id;
}

/** Parses `:id` and makes sure the channel exists. Unknown channel is a 404. */
function existingChannel(req: Request): { id: number; channel: Channel } {
  const id = channelIdParam(req);
  const channel = getChannel(id);
  if (!channel) throw new HttpError(404, 'Channel not found');
  return { id, channel };
}

/** Next scheduled slot as an ISO time (today if one is still ahead, else the first one tomorrow). */
export function nextRunAt(channel: Channel, now = new Date()): string | null {
  if (!channel.schedule_enabled || !channel.schedule_times.length) return null;
  const candidates = channel.schedule_times
    .map((t) => /^(\d{1,2}):(\d{2})$/.exec(t))
    .filter((m): m is RegExpExecArray => !!m)
    .flatMap((m) => [0, 1].map((dayOffset) => {
      const d = new Date(now);
      d.setDate(d.getDate() + dayOffset);
      d.setHours(Number(m[1]), Number(m[2]), 0, 0);
      return d;
    }))
    .filter((d) => d.getTime() > now.getTime())
    .sort((a, b) => a.getTime() - b.getTime());
  return candidates.length ? candidates[0].toISOString() : null;
}

function channelView(c: Channel) {
  const count = (where: string) =>
    (db.prepare(`SELECT COUNT(*) AS n FROM jobs WHERE channel_id = ? ${where}`).get(c.id) as { n: number }).n;
  return {
    ...c,
    hasReferenceImage: Boolean(referenceImagePath(c.id)),
    runStatus: getRunStatus(c.id),
    accounts: getAccountsOverview(c.id),
    stats: {
      postedToday: postedTodayCount(c.id),
      totalVideos: count(''),
      heldForReview: count("AND state = 'held_for_review'"),
    },
    lastRun: lastRun(c.id),
    nextRunAt: nextRunAt(c),
    schedule_series: readSeries(c.id),
    browserOpen: getAgent(c.id).isBrowserOpen(),
  };
}

apiRouter.use(systemRouter);
apiRouter.use(libraryRouter);

apiRouter.get('/health', (req, res) => {
  res.json({
    ok: true,
    name: 'kindred-studio',
    version: packageVersion,
    startedAt,
    uptimeSec: Math.round(process.uptime()),
    pid: process.pid,
  });
});

// ───────────────────────── Channels ─────────────────────────

apiRouter.get('/channels', (req, res) => {
  res.json({ channels: listChannels().map(channelView) });
});

apiRouter.post('/channels', (req, res) => {
  try {
    const c = createChannel(req.body?.name);
    res.status(201).json(c);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.get('/channels/:id', (req, res) => {
  res.json(channelView(existingChannel(req).channel));
});

apiRouter.patch(
  '/channels/:id',
  route(async (req, res) => {
    const { id, channel } = existingChannel(req);
    const body = req.body || {};
    // Turning a schedule on, or changing its times, must keep 10 minutes from every other channel's videos.
    if (body.schedule_enabled !== undefined || body.schedule_times !== undefined) {
      const willBeOn = body.schedule_enabled !== undefined ? Boolean(body.schedule_enabled) : channel.schedule_enabled;
      if (willBeOn) {
        try {
          const times = body.schedule_times !== undefined
            ? normalizeTimes(Array.isArray(body.schedule_times) ? body.schedule_times : [])
            : channel.schedule_times;
          assertNoClash(id, times);
        } catch (err: any) {
          throw new HttpError(400, err.message);
        }
      }
    }
    let updated: Channel;
    try {
      updated = updateChannel(id, body);
    } catch (err: any) {
      throw new HttpError(400, err.message);
    }
    if (req.body?.schedule_enabled !== undefined || req.body?.schedule_times !== undefined) {
      try {
        await syncChannelLaunchAgent(id, updated.schedule_enabled, updated.schedule_times);
      } catch (e: any) {
        // The channel is saved. Tell the client the schedule did not get installed.
        console.warn(`[api] Could not sync LaunchAgent for channel ${id}:`, e.message);
        return res.json({ ...updated, scheduleWarning: `Saved, but the daily schedule could not be installed: ${e.message}` });
      }
    }
    res.json(updated);
  })
);

apiRouter.get(
  '/channels/:id/schedule',
  route((req, res) => {
    const { id } = existingChannel(req);
    res.json(getChannelSchedule(id));
  })
);

apiRouter.post(
  '/channels/:id/schedule',
  route(async (req, res) => {
    const { id } = existingChannel(req);
    try {
      const enabled = !!req.body?.enabled;
      const times: string[] = Array.isArray(req.body?.times)
        ? req.body.times.map(String)
        : [String(req.body?.time || '10:00')];
      res.json(await setChannelSchedule(id, enabled, times));
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  })
);

/** Series mode: body { enabled, series: { mode: 'every' | 'random', everyMinutes?, start, end } }. */
apiRouter.post(
  '/channels/:id/series',
  route(async (req, res) => {
    const { id } = existingChannel(req);
    try {
      res.json(await setChannelSeries(id, !!req.body?.enabled, req.body?.series));
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  })
);

apiRouter.delete(
  '/channels/:id',
  route((req, res) => {
    const { id } = existingChannel(req);
    try {
      deleteChannel(id);
    } catch (err: any) {
      return res.status(400).json({ error: err.message });
    }
    res.json({ success: true });
  })
);

// ───────────────────────── Reference image ─────────────────────────

/** Detects JPEG, PNG or WebP from the file's first bytes. The content-type header is not trusted. */
export function detectImageExtension(buf: Buffer): '.jpg' | '.png' | '.webp' | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return '.jpg';
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length >= 8 && buf.subarray(0, 8).equals(pngSignature)) return '.png';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') {
    return '.webp';
  }
  return null;
}

apiRouter.get(
  '/channels/:id/reference-image',
  route((req, res) => {
    const { id } = existingChannel(req);
    const img = referenceImagePath(id);
    if (!img || !fs.existsSync(img)) return res.status(404).json({ error: 'No reference image found' });
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.resolve(img));
  })
);

apiRouter.post(
  '/channels/:id/reference-image',
  raw({ type: ['image/*', 'application/octet-stream'], limit: '15mb' }),
  route((req, res) => {
    const { id } = existingChannel(req);

    const buf = req.body;
    if (!buf || !Buffer.isBuffer(buf) || buf.length < 100) {
      return res.status(400).json({ error: 'Invalid image data' });
    }
    const ext = detectImageExtension(buf);
    if (!ext) {
      return res.status(400).json({ error: 'Unsupported image type. Use JPEG, PNG or WebP.' });
    }

    const dir = channelDir(id);
    // Remove existing reference files
    ['.jpg', '.jpeg', '.png', '.webp'].forEach((e) => {
      const old = path.join(dir, `reference${e}`);
      if (fs.existsSync(old)) {
        try { fs.unlinkSync(old); } catch {}
      }
    });

    const target = path.join(dir, `reference${ext}`);
    const tmp = target + '.tmp_' + Date.now();
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, target);
    exportChannelsToSeeds();

    res.json({ success: true, path: target });
  })
);

// ───────────────────────── Run ─────────────────────────

apiRouter.post(
  '/channels/:id/run',
  route((req, res) => {
    const { id } = existingChannel(req);
    const trigger = req.body?.trigger === 'schedule' ? 'schedule' : 'button';
    const targetDurationSec = req.body?.targetDurationSec !== undefined ? Number(req.body.targetDurationSec) : undefined;
    const targetResolution = req.body?.targetResolution === '480p' || req.body?.targetResolution === '720p' ? req.body.targetResolution : undefined;
    const result = startRun(trigger, id, targetDurationSec, targetResolution);
    if (!result.started) return res.status(409).json({ error: result.reason, ...getRunStatus(id) });
    res.status(202).json({ started: true, ...getRunStatus(id) });
  })
);

apiRouter.post(
  '/channels/:id/cancel-run',
  route(async (req, res) => {
    const { id } = existingChannel(req);
    res.json(await cancelRun(id));
  })
);

apiRouter.get(
  '/runs',
  route((req, res) => {
    const channelId = req.query.channel_id ? Number(req.query.channel_id) : undefined;
    if (channelId !== undefined && (!Number.isInteger(channelId) || channelId <= 0)) throw new HttpError(400, 'Invalid channel id');
    res.json({ runs: listRuns({ channelId, limit: Number(req.query.limit) || 50 }) });
  })
);

apiRouter.get(
  '/channels/:id/run-status',
  route((req, res) => {
    const { id } = existingChannel(req);
    res.json(getRunStatus(id));
  })
);

apiRouter.post(
  '/channels/:id/skip-login',
  route((req, res) => {
    const { id } = existingChannel(req);
    getAgent(id).skipLoginWait();
    res.json({ success: true });
  })
);

// ───────────────────────── Accounts ─────────────────────────

apiRouter.get(
  '/channels/:id/accounts',
  route((req, res) => {
    const { id } = existingChannel(req);
    res.json(getAccountsOverview(id));
  })
);

apiRouter.post(
  '/channels/:id/accounts/check',
  route((req, res) => {
    const { id } = existingChannel(req);
    const r = startCheck(id);
    if (!r.started) return res.status(409).json({ error: r.reason, ...getAccountsOverview(id) });
    res.status(202).json(getAccountsOverview(id));
  })
);

apiRouter.post(
  '/channels/:id/accounts/cancel',
  route((req, res) => {
    const { id } = existingChannel(req);
    cancelAccountOp(id);
    res.json({ success: true });
  })
);

apiRouter.post(
  '/channels/:id/accounts/:site/switch',
  route((req, res) => {
    const { id } = existingChannel(req);
    const r = startSwitch(req.params.site as AccountKey, id);
    if (!r.started) return res.status(409).json({ error: r.reason, ...getAccountsOverview(id) });
    res.status(202).json(getAccountsOverview(id));
  })
);

// ───────────────────────── Browser helpers ─────────────────────────

apiRouter.post(
  '/channels/:id/open-browser',
  route(async (req, res) => {
    const { id } = existingChannel(req);
    res.json(await getAgent(id).openInteractiveSession());
  })
);

// Closes the channel's browser window to free its memory. Logins stay saved; the next video reopens it.
apiRouter.post(
  '/channels/:id/close-browser',
  route(async (req, res) => {
    const { id } = existingChannel(req);
    if (isRunBusy(id)) throw new HttpError(409, 'This channel is making or posting a video. Stop it first, or wait for it to finish.');
    if (isAccountOpBusy(id)) throw new HttpError(409, 'A login check or account switch is using the browser. Wait for it to finish.');
    const agent = getAgent(id);
    const wasOpen = agent.isBrowserOpen();
    await agent.shutdown();
    res.json({ success: true, message: wasOpen ? 'Browser window closed. Logins are saved.' : 'The browser window was already closed.' });
  })
);

apiRouter.post(
  '/channels/:id/detect-chatgpt-url',
  route(async (req, res) => {
    const { id } = existingChannel(req);
    res.json(await getAgent(id).detectAndSetChatGptUrl());
  })
);
