import fs from 'fs';
import path from 'path';
import db from '../db/database';
import { normalizeTimes, removeChannelLaunchAgent } from './dailySchedule';
import { STORAGE_ROOT, LOGS_DIR, CHANNEL_SEEDS_DIR, REPO_ROOT } from '../paths';

export interface Channel {
  id: number;
  name: string;
  chatgpt_chat_url: string;
  chatgpt_chat_name: string;
  grok_resolution: '480p' | '720p';
  grok_duration: 6 | 10 | 15;
  post_tiktok: boolean;
  post_youtube: boolean;
  youtube_made_for_kids: boolean;
  hashtag_hint: string;
  schedule_enabled: boolean;
  schedule_times: string[];
  /** Keep this channel's browser window open between videos (faster); its posting tabs are still released. */
  keep_browser_open: boolean;
  /** Hold a video for a person when the safety check flags words in it. Off: post anyway and record the flags. */
  hold_flagged_videos: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Pre-channels files (browser_profile, browser_cookies.json, account_status.json, mr_apple_reference.jpg and the old
 * grok/publish/schedule json) live directly in the storage root. They are only read or moved when the channels folder
 * sits inside the real storage root and the database is the real one. Tests and relocated storage never touch them.
 */
function legacyPathsAllowed(): boolean {
  const rel = path.relative(STORAGE_ROOT, path.resolve(getChannelsRoot()));
  const insideStorage = rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  if (!insideStorage) return false;
  const dbEnv = process.env.DATABASE_PATH;
  return !dbEnv || path.resolve(REPO_ROOT, dbEnv) === path.join(STORAGE_ROOT, 'kindred_studio.db');
}

export function getChannelsRoot(): string {
  return process.env.KINDRED_CHANNELS_DIR || path.join(STORAGE_ROOT, 'channels');
}

export function channelDir(id: number): string {
  const dir = path.join(getChannelsRoot(), String(id));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function profileDir(id: number): string {
  const cDir = path.join(getChannelsRoot(), String(id), 'browser_profile');
  if (id === 1 && legacyPathsAllowed()) {
    if (fs.existsSync(cDir)) return cDir;
    const legacy = path.join(STORAGE_ROOT, 'browser_profile');
    if (fs.existsSync(legacy)) return legacy;
  }
  return cDir;
}

export function cookiesFile(id: number): string {
  const cFile = path.join(getChannelsRoot(), String(id), 'browser_cookies.json');
  if (id === 1 && legacyPathsAllowed()) {
    if (fs.existsSync(cFile)) return cFile;
    const legacy = path.join(STORAGE_ROOT, 'browser_cookies.json');
    if (fs.existsSync(legacy)) return legacy;
  }
  return cFile;
}

export function referenceImagePath(id: number): string | null {
  const dir = channelDir(id);
  const exts = ['.jpg', '.jpeg', '.png', '.webp'];
  for (const ext of exts) {
    const p = path.join(dir, `reference${ext}`);
    if (fs.existsSync(p)) return p;
  }
  if (id === 1 && legacyPathsAllowed()) {
    const legacy = path.join(STORAGE_ROOT, 'mr_apple_reference.jpg');
    if (fs.existsSync(legacy)) return legacy;
  }
  return null;
}

export function accountStatusFile(id: number): string {
  const file = path.join(channelDir(id), 'account_status.json');
  if (id === 1 && !fs.existsSync(file) && legacyPathsAllowed()) {
    const legacy = path.join(STORAGE_ROOT, 'account_status.json');
    if (fs.existsSync(legacy)) return legacy;
  }
  return file;
}

export function scheduleStateFile(id: number): string {
  return path.join(channelDir(id), 'schedule_state.json');
}

export function channelLogFile(id: number): string {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
  return path.join(LOGS_DIR, `channel_${id}.log`);
}

function rowToChannel(row: any): Channel {
  let times: string[] = [];
  try {
    times = JSON.parse(row.schedule_times || '[]');
  } catch {
    times = [];
  }
  return {
    id: row.id,
    name: row.name,
    chatgpt_chat_url: row.chatgpt_chat_url || '',
    chatgpt_chat_name: row.chatgpt_chat_name || '',
    grok_resolution: row.grok_resolution === '480p' ? '480p' : '720p',
    grok_duration: [6, 10, 15].includes(Number(row.grok_duration)) ? (Number(row.grok_duration) as 6 | 10 | 15) : 15,
    post_tiktok: Boolean(row.post_tiktok),
    post_youtube: Boolean(row.post_youtube),
    youtube_made_for_kids: Boolean(row.youtube_made_for_kids),
    hashtag_hint: row.hashtag_hint || '',
    schedule_enabled: Boolean(row.schedule_enabled),
    schedule_times: Array.isArray(times) ? times : [],
    keep_browser_open: row.keep_browser_open === undefined || row.keep_browser_open === null ? true : Boolean(row.keep_browser_open),
    hold_flagged_videos: Boolean(row.hold_flagged_videos),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

let lastSeedsMtime = 0;

export function isTestEnvironment(): boolean {
  return Boolean(
    process.env.KINDRED_STORAGE_DIR ||
    process.env.NODE_ENV === 'test' ||
    process.env.KINDRED_TEST_MODE ||
    process.env.KINDRED_CHANNELS_DIR
  );
}

export function syncSeedsIfChanged(): void {
  if (isTestEnvironment()) return;
  const seedsFile = path.join(CHANNEL_SEEDS_DIR, 'channels.json');
  if (!fs.existsSync(seedsFile)) return;
  try {
    const mtime = fs.statSync(seedsFile).mtimeMs;
    if (mtime > lastSeedsMtime) {
      importChannelsFromSeeds();
      lastSeedsMtime = mtime;
    }
  } catch {}
}

export function exportChannelsToSeeds(): void {
  if (isTestEnvironment()) return;

  try {
    fs.mkdirSync(CHANNEL_SEEDS_DIR, { recursive: true });
    const rows = db.prepare('SELECT * FROM channels ORDER BY id ASC').all();
    const channels = rows.map(rowToChannel);

    const seeds = channels.map((c) => ({
      id: c.id,
      name: c.name,
      chatgpt_chat_url: c.chatgpt_chat_url,
      chatgpt_chat_name: c.chatgpt_chat_name,
      grok_resolution: c.grok_resolution,
      grok_duration: c.grok_duration,
      post_tiktok: c.post_tiktok,
      post_youtube: c.post_youtube,
      youtube_made_for_kids: c.youtube_made_for_kids,
      hashtag_hint: c.hashtag_hint,
      schedule_enabled: c.schedule_enabled,
      schedule_times: c.schedule_times,
      keep_browser_open: c.keep_browser_open,
      hold_flagged_videos: c.hold_flagged_videos,
      created_at: c.created_at,
      updated_at: c.updated_at,
    }));

    const targetJson = path.join(CHANNEL_SEEDS_DIR, 'channels.json');
    const tmpJson = targetJson + '.tmp_' + Date.now();
    fs.writeFileSync(tmpJson, JSON.stringify(seeds, null, 2) + '\n');
    fs.renameSync(tmpJson, targetJson);

    try {
      lastSeedsMtime = fs.statSync(targetJson).mtimeMs;
    } catch {}

    // Sync reference images
    const existingSeedFiles = fs.readdirSync(CHANNEL_SEEDS_DIR);
    const activeIds = new Set(channels.map((c) => c.id));

    // Remove reference files for deleted channels
    for (const f of existingSeedFiles) {
      const match = f.match(/^reference_(\d+)\.(jpg|jpeg|png|webp)$/i);
      if (match) {
        const fileChannelId = Number(match[1]);
        if (!activeIds.has(fileChannelId)) {
          try { fs.unlinkSync(path.join(CHANNEL_SEEDS_DIR, f)); } catch {}
        }
      }
    }

    // Copy reference image for each active channel into channel_seeds
    for (const c of channels) {
      const refImg = referenceImagePath(c.id);
      if (refImg && fs.existsSync(refImg)) {
        const ext = path.extname(refImg).toLowerCase();
        const dest = path.join(CHANNEL_SEEDS_DIR, `reference_${c.id}${ext}`);
        // Remove different extensions for this channel if any
        for (const otherExt of ['.jpg', '.jpeg', '.png', '.webp']) {
          if (otherExt !== ext) {
            const stale = path.join(CHANNEL_SEEDS_DIR, `reference_${c.id}${otherExt}`);
            if (fs.existsSync(stale)) {
              try { fs.unlinkSync(stale); } catch {}
            }
          }
        }
        try {
          fs.copyFileSync(refImg, dest);
        } catch (e: any) {
          console.warn(`[channels] Failed to copy reference image for channel ${c.id}:`, e.message);
        }
      }
    }
  } catch (err: any) {
    console.warn('[channels] Failed to export channel seeds:', err.message);
  }
}

export function importChannelsFromSeeds(): void {
  if (isTestEnvironment()) return;

  const seedsFile = path.join(CHANNEL_SEEDS_DIR, 'channels.json');
  if (!fs.existsSync(seedsFile)) return;

  try {
    const raw = fs.readFileSync(seedsFile, 'utf8');
    const seeds = JSON.parse(raw);
    if (!Array.isArray(seeds)) return;

    for (const seed of seeds) {
      if (!seed || typeof seed.id !== 'number' || !seed.name) continue;

      const existing = db.prepare('SELECT * FROM channels WHERE id = ?').get(seed.id) as any;
      if (!existing) {
        console.log(`[Channels] Restoring channel ${seed.id} (${seed.name}) from seeds...`);
        db.prepare(`
          INSERT INTO channels (
            id, name, chatgpt_chat_url, chatgpt_chat_name, grok_resolution, grok_duration,
            post_tiktok, post_youtube, youtube_made_for_kids, hashtag_hint,
            schedule_enabled, schedule_times, keep_browser_open, hold_flagged_videos,
            created_at, updated_at
          ) VALUES (
            ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?
          )
        `).run(
          seed.id,
          seed.name,
          seed.chatgpt_chat_url || '',
          seed.chatgpt_chat_name || '',
          seed.grok_resolution || '720p',
          seed.grok_duration || 15,
          seed.post_tiktok ? 1 : 0,
          seed.post_youtube ? 1 : 0,
          seed.youtube_made_for_kids ? 1 : 0,
          seed.hashtag_hint || '',
          0, // schedule_enabled starts off on new machine to prevent double posting
          JSON.stringify(Array.isArray(seed.schedule_times) ? seed.schedule_times : ['10:00']),
          seed.keep_browser_open === undefined ? 1 : (seed.keep_browser_open ? 1 : 0),
          seed.hold_flagged_videos ? 1 : 0,
          seed.created_at || new Date().toISOString(),
          seed.updated_at || new Date().toISOString()
        );
      } else {
        // Channel already exists locally: update channel metadata
        db.prepare(`
          UPDATE channels SET
            name = ?, chatgpt_chat_url = ?, chatgpt_chat_name = ?,
            grok_resolution = ?, grok_duration = ?, post_tiktok = ?,
            post_youtube = ?, youtube_made_for_kids = ?, hashtag_hint = ?,
            keep_browser_open = ?, hold_flagged_videos = ?
          WHERE id = ?
        `).run(
          seed.name,
          seed.chatgpt_chat_url || '',
          seed.chatgpt_chat_name || '',
          seed.grok_resolution || '720p',
          seed.grok_duration || 15,
          seed.post_tiktok ? 1 : 0,
          seed.post_youtube ? 1 : 0,
          seed.youtube_made_for_kids ? 1 : 0,
          seed.hashtag_hint || '',
          seed.keep_browser_open === undefined ? 1 : (seed.keep_browser_open ? 1 : 0),
          seed.hold_flagged_videos ? 1 : 0,
          seed.id
        );
      }

      // Restore reference image if missing locally
      const cDir = channelDir(seed.id);
      const exts = ['.jpg', '.jpeg', '.png', '.webp'];
      const hasLocalRef = exts.some((ext) => fs.existsSync(path.join(cDir, `reference${ext}`)));
      if (!hasLocalRef) {
        for (const ext of exts) {
          const seedRef = path.join(CHANNEL_SEEDS_DIR, `reference_${seed.id}${ext}`);
          if (fs.existsSync(seedRef)) {
            const dest = path.join(cDir, `reference${ext}`);
            try {
              fs.copyFileSync(seedRef, dest);
              console.log(`[Channels] Restored reference image for channel ${seed.id}`);
            } catch (err: any) {
              console.warn(`[Channels] Could not copy reference image for channel ${seed.id}:`, err.message);
            }
            break;
          }
        }
      }
    }
  } catch (err: any) {
    console.warn('[Channels] Could not import channels from seeds:', err.message);
  }
}

export function listChannels(): Channel[] {
  syncSeedsIfChanged();
  const rows = db.prepare('SELECT * FROM channels ORDER BY id ASC').all();
  return rows.map(rowToChannel);
}

export function getChannel(id: number): Channel | null {
  const row = db.prepare('SELECT * FROM channels WHERE id = ?').get(id);
  return row ? rowToChannel(row) : null;
}

export function createChannel(name: string): Channel {
  const cleanName = (name || '').trim().slice(0, 60);
  if (!cleanName) throw new Error('Channel name is required and cannot be empty.');

  const res = db.prepare(`
    INSERT INTO channels (
      name, chatgpt_chat_url, chatgpt_chat_name, grok_resolution, grok_duration,
      post_tiktok, post_youtube, youtube_made_for_kids, hashtag_hint,
      schedule_enabled, schedule_times, created_at, updated_at
    ) VALUES (
      ?, '', '', '720p', 15,
      1, 1, 1, '',
      0, '[]', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `).run(cleanName);

  const newId = Number(res.lastInsertRowid);
  channelDir(newId);
  exportChannelsToSeeds();
  return getChannel(newId)!;
}

/**
 * Store a day's launch times that were already checked (series plans can be 15 minutes apart, which the plain
 * "times" rule forbids). Does not touch seeds: series times are per machine and re-made every day.
 */
export function saveScheduleTimes(id: number, times: string[]): void {
  db.prepare('UPDATE channels SET schedule_times = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(JSON.stringify(times), id);
}

export function updateChannel(id: number, patch: Partial<Channel>): Channel {
  const existing = getChannel(id);
  if (!existing) throw new Error(`Channel ${id} not found.`);

  const updates: string[] = [];
  const params: any[] = [];

  if (patch.name !== undefined) {
    const cleanName = patch.name.trim().slice(0, 60);
    if (!cleanName) throw new Error('Channel name cannot be empty.');
    updates.push('name = ?');
    params.push(cleanName);
  }
  if (patch.chatgpt_chat_url !== undefined) {
    updates.push('chatgpt_chat_url = ?');
    params.push(patch.chatgpt_chat_url.trim());
  }
  if (patch.chatgpt_chat_name !== undefined) {
    updates.push('chatgpt_chat_name = ?');
    params.push(patch.chatgpt_chat_name.trim());
  }
  if (patch.grok_resolution !== undefined) {
    const res = patch.grok_resolution === '480p' ? '480p' : '720p';
    updates.push('grok_resolution = ?');
    params.push(res);
  }
  if (patch.grok_duration !== undefined) {
    const dur = [6, 10, 15].includes(Number(patch.grok_duration)) ? Number(patch.grok_duration) : 15;
    updates.push('grok_duration = ?');
    params.push(dur);
  }
  if (patch.post_tiktok !== undefined) {
    updates.push('post_tiktok = ?');
    params.push(patch.post_tiktok ? 1 : 0);
  }
  if (patch.post_youtube !== undefined) {
    updates.push('post_youtube = ?');
    params.push(patch.post_youtube ? 1 : 0);
  }
  if (patch.youtube_made_for_kids !== undefined) {
    updates.push('youtube_made_for_kids = ?');
    params.push(patch.youtube_made_for_kids ? 1 : 0);
  }
  if (patch.hashtag_hint !== undefined) {
    updates.push('hashtag_hint = ?');
    params.push(patch.hashtag_hint.trim());
  }
  if (patch.schedule_enabled !== undefined) {
    updates.push('schedule_enabled = ?');
    params.push(patch.schedule_enabled ? 1 : 0);
  }
  if (patch.hold_flagged_videos !== undefined) {
    updates.push('hold_flagged_videos = ?');
    params.push(patch.hold_flagged_videos ? 1 : 0);
  }
  if (patch.keep_browser_open !== undefined) {
    updates.push('keep_browser_open = ?');
    params.push(patch.keep_browser_open ? 1 : 0);
  }
  if (patch.schedule_times !== undefined) {
    const cleanTimes = normalizeTimes(Array.isArray(patch.schedule_times) ? patch.schedule_times : []);
    updates.push('schedule_times = ?');
    params.push(JSON.stringify(cleanTimes));
  }

  if (updates.length > 0) {
    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(id);
    db.prepare(`UPDATE channels SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    exportChannelsToSeeds();
  }

  return getChannel(id)!;
}

// Registry hook to check if channel is busy before deletion
type BusyChecker = (channelId: number) => { busy: boolean; reason?: string };
let channelBusyChecker: BusyChecker | null = null;

export function registerChannelBusyChecker(fn: BusyChecker): void {
  channelBusyChecker = fn;
}

type ChannelDeleteHook = (channelId: number) => Promise<void> | void;
const channelDeleteHooks: ChannelDeleteHook[] = [];

export function registerChannelDeleteHook(fn: ChannelDeleteHook): void {
  channelDeleteHooks.push(fn);
}

export function deleteChannel(id: number): void {
  const channel = getChannel(id);
  if (!channel) throw new Error(`Channel ${id} not found.`);

  if (channelBusyChecker) {
    const check = channelBusyChecker(id);
    if (check.busy) {
      throw new Error(`Cannot delete channel "${channel.name}": ${check.reason || 'Channel is active.'}`);
    }
  }

  // Remove any registered LaunchAgent schedule
  try {
    Promise.resolve(removeChannelLaunchAgent(id)).catch((e: any) =>
      console.warn(`[channels] Error removing LaunchAgent for channel ${id}:`, e?.message)
    );
  } catch (e: any) {
    console.warn(`[channels] Error removing LaunchAgent for channel ${id}:`, e.message);
  }

  // Run delete hooks (they may be async; a failing hook must not block the delete)
  for (const hook of channelDeleteHooks) {
    try {
      Promise.resolve(hook(id)).catch((e: any) => console.warn(`[channels] Delete hook error for channel ${id}:`, e?.message));
    } catch (e: any) {
      console.warn(`[channels] Delete hook error for channel ${id}:`, e.message);
    }
  }

  // Delete DB row. Jobs are kept as history; they keep their channel_id.
  db.prepare('DELETE FROM channels WHERE id = ?').run(id);
  exportChannelsToSeeds();

  // Move the channel's folder (browser profile, cookies, reference image) aside instead of destroying it.
  const src = path.join(getChannelsRoot(), String(id));
  if (fs.existsSync(src)) {
    const deletedDir = path.join(getChannelsRoot(), '_deleted');
    fs.mkdirSync(deletedDir, { recursive: true });
    const dest = path.join(deletedDir, `${id}_${Date.now()}`);
    try {
      fs.renameSync(src, dest);
    } catch {
      // Rename can fail across devices: copy, then remove the original.
      fs.cpSync(src, dest, { recursive: true });
      fs.rmSync(src, { recursive: true, force: true });
    }
  }
}

export function seedDefaultChannelIfNeeded(): void {
  importChannelsFromSeeds();

  const countRow = db.prepare('SELECT COUNT(*) as n FROM channels').get() as any;
  if (countRow?.n > 0) return;

  console.log('[Channels] Initializing default channel 1 (Mr. Apple)...');

  // One-time migration of the pre-channels layout. Only ever touches the real storage folder: a test or a
  // relocated channels folder must never move or copy the real browser profile, cookies or account files.
  const allowLegacy = legacyPathsAllowed();

  let settingsUrl = '';
  try {
    const settings = db.prepare('SELECT chatgpt_chat_url FROM settings WHERE id = 1').get() as any;
    settingsUrl = settings?.chatgpt_chat_url || '';
  } catch {
    // fresh databases have no legacy settings table
  }

  let grokRes: '480p' | '720p' = '720p';
  let grokDur: 6 | 10 | 15 = 15;
  let postTiktok = true;
  let postYoutube = true;
  let ytKids = true;
  let schedEnabled = false;
  let schedTimes: string[] = ['10:00'];

  if (allowLegacy) {
    try {
      const grokRaw = JSON.parse(fs.readFileSync(path.join(STORAGE_ROOT, 'grok_settings.json'), 'utf8'));
      if (grokRaw.resolution === '480p') grokRes = '480p';
      if ([6, 10, 15].includes(Number(grokRaw.duration))) grokDur = Number(grokRaw.duration) as 6 | 10 | 15;
    } catch {}

    try {
      const targets = JSON.parse(fs.readFileSync(path.join(STORAGE_ROOT, 'publish_targets.json'), 'utf8'));
      if (typeof targets.tiktok === 'boolean') postTiktok = targets.tiktok;
      if (typeof targets.youtube === 'boolean') postYoutube = targets.youtube;
      if (typeof targets.youtubeMadeForKids === 'boolean') ytKids = targets.youtubeMadeForKids;
    } catch {}

    try {
      const sched = JSON.parse(fs.readFileSync(path.join(STORAGE_ROOT, 'schedule.json'), 'utf8'));
      if (typeof sched.enabled === 'boolean') schedEnabled = sched.enabled;
      if (Array.isArray(sched.times) && sched.times.length) schedTimes = sched.times;
    } catch {}
  }

  db.prepare(`
    INSERT INTO channels (
      id, name, chatgpt_chat_url, chatgpt_chat_name, grok_resolution, grok_duration,
      post_tiktok, post_youtube, youtube_made_for_kids, hashtag_hint,
      schedule_enabled, schedule_times, created_at, updated_at
    ) VALUES (
      1, 'Mr. Apple', ?, 'Create Mr Apple Videos', ?, ?,
      ?, ?, ?, '#MrApple',
      ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `).run(
    settingsUrl || process.env.CHATGPT_MR_APPLE_URL || '',
    grokRes,
    grokDur,
    postTiktok ? 1 : 0,
    postYoutube ? 1 : 0,
    ytKids ? 1 : 0,
    schedEnabled ? 1 : 0,
    JSON.stringify(schedTimes)
  );

  if (!allowLegacy) {
    // Test or relocated storage: skip the file migration entirely.
    return;
  }

  const ch1Dir = channelDir(1);

  // Copy reference image to channel 1
  const legacyRef = path.join(STORAGE_ROOT, 'mr_apple_reference.jpg');
  const ch1Ref = path.join(ch1Dir, 'reference.jpg');
  if (fs.existsSync(legacyRef) && !fs.existsSync(ch1Ref)) {
    try {
      fs.copyFileSync(legacyRef, ch1Ref);
    } catch {}
  }

  // Copy account status if present
  const legacyAcc = path.join(STORAGE_ROOT, 'account_status.json');
  const ch1Acc = path.join(ch1Dir, 'account_status.json');
  if (fs.existsSync(legacyAcc) && !fs.existsSync(ch1Acc)) {
    try {
      fs.copyFileSync(legacyAcc, ch1Acc);
    } catch {}
  }

  // Attempt migration of profile and cookies if unlocked
  const legacyProfile = path.join(STORAGE_ROOT, 'browser_profile');
  const ch1Profile = path.join(ch1Dir, 'browser_profile');
  const lockFile = path.join(legacyProfile, 'SingletonLock');
  if (fs.existsSync(legacyProfile) && !fs.existsSync(ch1Profile)) {
    if (!fs.existsSync(lockFile)) {
      try {
        fs.renameSync(legacyProfile, ch1Profile);
        console.log('[Channels] Migrated browser_profile to channel 1.');
      } catch (e: any) {
        console.warn('[Channels] Could not migrate browser_profile directly:', e.message);
      }
    } else {
      console.log('[Channels] browser_profile is currently in use (SingletonLock exists). Will migrate when closed.');
    }
  }

  const legacyCookies = path.join(STORAGE_ROOT, 'browser_cookies.json');
  const ch1Cookies = path.join(ch1Dir, 'browser_cookies.json');
  if (fs.existsSync(legacyCookies) && !fs.existsSync(ch1Cookies)) {
    try {
      fs.copyFileSync(legacyCookies, ch1Cookies);
      console.log('[Channels] Migrated browser_cookies.json to channel 1.');
    } catch {}
  }

  // Tag unassigned jobs to channel 1
  try {
    db.prepare('UPDATE jobs SET channel_id = 1 WHERE channel_id IS NULL').run();
  } catch {}

  exportChannelsToSeeds();
}
