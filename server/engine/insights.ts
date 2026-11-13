/**
 * Smart features ("Insights"), all optional per channel and off by default:
 *   - collect: read each video's views/likes from TikTok Studio and YouTube Studio, TikTok Studio's trending topics, and a
 *     short "what is trending" research answer from ChatGPT; Jev marks which trends are kid-safe and fit the channel.
 *   - smartPrompts: the message to the channel's ChatGPT chat says "next" plus a few fitting trends and recent winners.
 *   - hookCheck: Jev rates the new title; a weak one asks ChatGPT for another idea once (no Grok credits spent yet).
 *   - bestTimes: random series days lean toward the hours whose videos got the most views.
 *   - soundRotation: TikTok library sounds rotate through a list, never the same one twice in a row.
 *   - firstComment: after a TikTok post, the channel comments on its own video (a question to start replies).
 *
 * Jev makes judgments (is this trend safe for kids, does it fit, is the title appealing); the code here decides.
 * Everything that reads a web page is a pure parser over the page's text, so the tests cover it without a browser.
 */
import fs from 'fs';
import path from 'path';
import db from '../db/database';
import { channelDir, getChannel } from './channels';
import { jevAvailable } from './jevAssist';

// ---------------------------------------------------------------- settings

export interface SmartSettings {
  /** Master switch. Off = the app behaves exactly as before. */
  enabled: boolean;
  collect: boolean;
  smartPrompts: boolean;
  hookCheck: boolean;
  bestTimes: boolean;
  soundRotation: boolean;
  /** TikTok sound links or names to rotate through (used when the channel's TikTok sound is "TikTok library"). */
  sounds: string[];
  firstComment: boolean;
  /** Comment texts to rotate through. */
  comments: string[];
}

export const DEFAULT_COMMENTS = [
  'Which animal should Mr. Apple dance with next? 👇',
  'Who danced better? Tell us in the comments! 🍎',
  'Rate this dance from 1 to 10! 🔥',
];

export const DEFAULT_SMART: SmartSettings = {
  enabled: false,
  collect: true,
  smartPrompts: true,
  hookCheck: true,
  bestTimes: true,
  soundRotation: false,
  sounds: [],
  firstComment: false,
  comments: [],
};

const cleanList = (v: unknown, max: number, len: number): string[] =>
  Array.isArray(v)
    ? v
        .map((s) => String(s ?? '').trim().slice(0, len))
        .filter(Boolean)
        .slice(0, max)
    : [];

export function parseSmart(input: unknown): SmartSettings {
  const o: any = input && typeof input === 'object' ? input : {};
  const bool = (k: keyof SmartSettings) => (typeof o[k] === 'boolean' ? o[k] : (DEFAULT_SMART[k] as boolean));
  return {
    enabled: bool('enabled'),
    collect: bool('collect'),
    smartPrompts: bool('smartPrompts'),
    hookCheck: bool('hookCheck'),
    bestTimes: bool('bestTimes'),
    soundRotation: bool('soundRotation'),
    sounds: cleanList(o.sounds, 20, 500),
    firstComment: bool('firstComment'),
    comments: cleanList(o.comments, 20, 150),
  };
}

export function getSmart(channelId: number): SmartSettings {
  const row = db.prepare('SELECT smart_json FROM channels WHERE id = ?').get(channelId) as { smart_json?: string } | undefined;
  try {
    return parseSmart(row?.smart_json ? JSON.parse(row.smart_json) : {});
  } catch {
    return { ...DEFAULT_SMART };
  }
}

export function setSmart(channelId: number, input: unknown): SmartSettings {
  const next = parseSmart({ ...getSmart(channelId), ...(input && typeof input === 'object' ? input : {}) });
  db.prepare('UPDATE channels SET smart_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(JSON.stringify(next), channelId);
  return next;
}

/** Is one smart feature on? Every feature also needs the master switch. */
export function smartOn(channelId: number, feature: keyof Omit<SmartSettings, 'enabled' | 'sounds' | 'comments'>): boolean {
  const s = getSmart(channelId);
  return s.enabled && s[feature];
}

// Tables video_stats and trends, and the columns channels.smart_json and jobs.hook_score, are created in initDatabase.

// ---------------------------------------------------------------- page parsers (pure)

/** "1.2K" → 1200, "3,456" → 3456, "12M" → 12000000. NaN when it is not a count. */
export function parseCount(text: string): number {
  const m = /^(\d+(?:[.,]\d+)*)\s*([KMB])?$/i.exec(text.trim());
  if (!m) return NaN;
  const unit = (m[2] || '').toUpperCase();
  const n = unit ? Number(m[1].replace(',', '.')) : Number(m[1].replace(/,/g, ''));
  return Math.round(n * (unit === 'K' ? 1e3 : unit === 'M' ? 1e6 : unit === 'B' ? 1e9 : 1));
}

const lines = (text: string) =>
  text
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

export interface PostStat {
  title: string;
  postedAt: string;
  /** Hour of day the video went up (0–23), when the page shows a time. */
  hour: number | null;
  views: number;
  likes: number | null;
  comments: number | null;
}

function hourOf(time: string): number | null {
  const m = /(\d{1,2}):(\d{2})\s*([AP]M)/i.exec(time);
  if (!m) return null;
  return (Number(m[1]) % 12) + (m[3].toUpperCase() === 'PM' ? 12 : 0);
}

/**
 * TikTok Studio → Posts. Each posted row reads: caption, "Nov 12, 6:04 PM", privacy, views, likes, comments.
 * Rows that failed or are still processing have no date and are skipped.
 */
export function parseTikTokStudioPosts(pageText: string): PostStat[] {
  const L = lines(pageText);
  const out: PostStat[] = [];
  const date = /^[A-Z][a-z]{2} \d{1,2}(, \d{4})?, \d{1,2}:\d{2} [AP]M$/;
  const privacy = /^(Everyone|Friends|Followers|Only me|Private)$/i;
  for (let i = 1; i + 4 < L.length; i++) {
    if (!date.test(L[i]) || !privacy.test(L[i + 1])) continue;
    const [v, l, c] = [parseCount(L[i + 2]), parseCount(L[i + 3]), parseCount(L[i + 4])];
    if ([v, l, c].some(Number.isNaN)) continue;
    out.push({ title: L[i - 1], postedAt: L[i], hour: hourOf(L[i]), views: v, likes: l, comments: c });
  }
  return out;
}

/**
 * YouTube Studio → Content → Shorts. A published row reads: duration, title, [description], …, "Public",
 * "Nov 12, 2026", "Published", views, comments. Drafts have no "Published" line and are skipped.
 */
export function parseYouTubeStudioShorts(pageText: string): PostStat[] {
  const L = lines(pageText);
  const out: PostStat[] = [];
  const date = /^[A-Z][a-z]{2} \d{1,2}, \d{4}$/;
  const duration = /^\d{1,2}:\d{2}$/;
  for (let i = 2; i + 3 < L.length; i++) {
    if (!date.test(L[i]) || L[i + 1] !== 'Published') continue;
    const [v, c] = [parseCount(L[i + 2]), parseCount(L[i + 3])];
    if (Number.isNaN(v) || Number.isNaN(c)) continue;
    let d = i - 1;
    while (d > 0 && i - d < 10 && !duration.test(L[d])) d--;
    if (!duration.test(L[d]) || d + 1 >= i) continue;
    out.push({ title: L[d + 1], postedAt: L[i], hour: null, views: v, likes: null, comments: c });
  }
  return out;
}

export interface TrendItem {
  name: string;
  detail: string;
  views: number | null;
}

/** TikTok Studio → Inspiration → Topics: "1", topic name, views, …, "2", next topic name, views … */
export function parseTikTokTopics(pageText: string): TrendItem[] {
  const L = lines(pageText);
  const out: TrendItem[] = [];
  let expect = 1;
  for (let i = 0; i + 2 < L.length; i++) {
    if (L[i] !== String(expect)) continue;
    const name = L[i + 1];
    const views = parseCount(L[i + 2]);
    if (Number.isNaN(views) || !Number.isNaN(parseCount(name)) || name.length > 120) continue;
    out.push({ name, detail: '', views });
    expect++;
  }
  return out;
}

/** The research question sent to ChatGPT. The answer is read between the TRENDLIST and ENDLIST lines. */
export function researchQuestion(channelName: string, sampleTitles: string[]): string {
  const sample = sampleTitles.slice(0, 3).map((t) => `"${t.slice(0, 70)}"`).join(', ');
  return (
    `Search the web for what is trending this week on TikTok and YouTube Shorts that a kids' cartoon channel could use ` +
    `(animals, dances, challenges, songs, seasons, holidays). The channel is "${channelName}"${sample ? `; recent videos: ${sample}` : ''}. ` +
    `Answer with a line containing only TRENDLIST, then 8 lines formatted as "- trend: why it fits", then a line containing only ENDLIST.`
  );
}

/** Reads ChatGPT's research answer. [] when the answer is missing or not in the asked format. */
export function parseTrendList(pageText: string): TrendItem[] {
  const text = pageText.replace(/\r/g, '');
  const start = text.lastIndexOf('TRENDLIST');
  if (start < 0) return [];
  const end = text.indexOf('ENDLIST', start + 9);
  const block = text.slice(start + 9, end < 0 ? undefined : end);
  const out: TrendItem[] = [];
  // ChatGPT renders the "- " lines as a list, so the page text has "Name: why" lines (bullets gone), each followed by a
  // source tag ("ViralRemix", "+1"). A line counts when it has a short name, a separator and a reason.
  for (const raw of block.split('\n')) {
    const line = raw.replace(/^\s*(?:[-•*]|\d+[.)])\s*/, '').replace(/\*\*/g, '').trim();
    const m = /^(.{2,80}?)\s*(?::|\s[–—-])\s+(.{8,})$/.exec(line);
    if (!m) continue;
    out.push({ name: m[1].trim(), detail: m[2].trim().slice(0, 200), views: null });
  }
  return out.length >= 3 ? out.slice(0, 12) : [];
}

// ---------------------------------------------------------------- storing

const norm = (s: string) => s.toLowerCase().replace(/#\S+/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** Which of this channel's videos a Studio row belongs to: same start of title. */
export function matchJob(title: string, jobs: Array<{ id: string; title: string }>): string | null {
  const t = norm(title).slice(0, 40);
  if (t.length < 8) return null;
  const hit = jobs.find((j) => {
    const jt = norm(j.title).slice(0, 40);
    return jt.length >= 8 && (t.startsWith(jt) || jt.startsWith(t));
  });
  return hit ? hit.id : null;
}

export function saveStats(channelId: number, platform: 'tiktok' | 'youtube', stats: PostStat[]): number {
  const jobs = db
    .prepare('SELECT id, concept_title AS title FROM jobs WHERE channel_id = ? AND concept_title IS NOT NULL')
    .all(channelId) as Array<{ id: string; title: string }>;
  const now = new Date().toISOString();
  const up = db.prepare(`
    INSERT INTO video_stats (channel_id, platform, title, posted_at, posted_hour, views, likes, comments, job_id, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(channel_id, platform, title, posted_at) DO UPDATE SET
      views = excluded.views, likes = excluded.likes, comments = excluded.comments,
      posted_hour = COALESCE(excluded.posted_hour, video_stats.posted_hour),
      job_id = COALESCE(excluded.job_id, video_stats.job_id), fetched_at = excluded.fetched_at
  `);
  const tx = db.transaction(() => {
    for (const s of stats) {
      up.run(channelId, platform, s.title.slice(0, 300), s.postedAt, s.hour, s.views, s.likes, s.comments, matchJob(s.title, jobs), now);
    }
  });
  tx();
  return stats.length;
}

export function saveTrends(channelId: number, source: string, items: Array<TrendItem & { kidSafe?: number | null; fits?: number | null }>): void {
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM trends WHERE channel_id = ? AND source = ?').run(channelId, source);
    const ins = db.prepare(
      'INSERT OR REPLACE INTO trends (channel_id, source, name, detail, views, kid_safe, fits, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    for (const t of items) ins.run(channelId, source, t.name, t.detail || '', t.views, t.kidSafe ?? null, t.fits ?? null, now);
  });
  tx();
}

// ---------------------------------------------------------------- Jev judgments

const ENDPOINT = process.env.TYPESAFE_API_URL || 'https://api.typesafe.ai/v1/systemone';

async function askJevNouls(state: Record<string, unknown>, questions: Record<string, string>, timeoutMs = 20000): Promise<Record<string, number> | null> {
  if (!jevAvailable()) return null;
  const body = {
    model: 'jev-latest',
    state,
    questions: Object.fromEntries(Object.entries(questions).map(([k, instructions]) => [k, { type: 'noul', instructions }])),
  };
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.TYPESAFE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      console.warn(`[insights] Jev API returned ${res.status}`);
      return null;
    }
    const data: any = await res.json();
    const out: Record<string, number> = {};
    for (const k of Object.keys(questions)) {
      const v = Number(data?.answers?.[k]?.noul);
      if (Number.isFinite(v)) out[k] = v;
    }
    return out;
  } catch (err: any) {
    console.warn(`[insights] Jev API error: ${err?.message || err}`);
    return null;
  }
}

/** What Jev is told about the channel: its name and a few recent titles (the character and style show in them). */
export function channelProfile(channelId: number): { name: string; recent_titles: string[] } {
  const ch = getChannel(channelId);
  const titles = db
    .prepare("SELECT concept_title FROM jobs WHERE channel_id = ? AND concept_title IS NOT NULL ORDER BY created_at DESC LIMIT 5")
    .all(channelId)
    .map((r: any) => String(r.concept_title));
  return { name: ch?.name || `Channel ${channelId}`, recent_titles: titles };
}

/** Jev: is each trend safe for young kids, and could this channel's cartoon use it? null scores when Jev is off. */
export async function judgeTrends(channelId: number, items: TrendItem[]): Promise<Array<TrendItem & { kidSafe: number | null; fits: number | null }>> {
  const out = items.map((t) => ({ ...t, kidSafe: null as number | null, fits: null as number | null }));
  const channel = channelProfile(channelId);
  for (let from = 0; from < items.length; from += 15) {
    const batch = items.slice(from, from + 15);
    const trends: Record<string, string> = {};
    const questions: Record<string, string> = {};
    batch.forEach((t, j) => {
      const key = `t${from + j}`;
      trends[key] = t.detail ? `${t.name} (${t.detail})` : t.name;
      questions[`safe_${key}`] =
        `The trend \`trends.${key}\` is suitable for a video watched by young children: it is not about violence, fights, crime, ` +
        `adult relationships, scary content, politics or a real news event.`;
      questions[`fit_${key}`] =
        `A short, funny cartoon from the channel in \`channel\` (same characters and style as its recent titles) could be built ` +
        `around the trend \`trends.${key}\`.`;
    });
    const answers = await askJevNouls({ channel, trends }, questions);
    if (!answers) break;
    batch.forEach((_t, j) => {
      const key = `t${from + j}`;
      out[from + j].kidSafe = answers[`safe_${key}`] ?? null;
      out[from + j].fits = answers[`fit_${key}`] ?? null;
    });
  }
  return out;
}

export const HOOK_RETRY_BELOW = 0.4;

/** Jev rates a new video's title: would a child want to watch, and does it name a clear character and action? 0–1. */
export async function rateHook(channelId: number, title: string, hook: string): Promise<number | null> {
  const answers = await askJevNouls(
    { channel: channelProfile(channelId), video: { title, hook } },
    {
      curious: 'A child who reads `video.title` in a feed would want to watch the video to see what happens.',
      concrete: '`video.title` names a specific animal or character AND a specific funny thing it does.',
      fresh: '`video.title` is clearly different from every title in `channel.recent_titles` (not the same idea with another animal).',
    }
  );
  if (!answers) return null;
  const v = [answers.curious, answers.concrete, answers.fresh].filter((x) => typeof x === 'number');
  if (!v.length) return null;
  return Math.round((0.5 * (answers.curious ?? 0.5) + 0.3 * (answers.concrete ?? 0.5) + 0.2 * (answers.fresh ?? 0.5)) * 100) / 100;
}

// ---------------------------------------------------------------- reading the insights back

export const USABLE_SAFE = 0.7;
export const USABLE_FIT = 0.75;

export interface TrendRow {
  source: string;
  name: string;
  detail: string;
  views: number | null;
  kid_safe: number | null;
  fits: number | null;
  usable: boolean;
  fetched_at: string;
}

/** A trend is used only when Jev rated it safe AND a fit. Without Jev, nothing counts as usable. */
export const isUsable = (t: { kid_safe: number | null; fits: number | null }) =>
  t.kid_safe !== null && t.fits !== null && t.kid_safe >= USABLE_SAFE && t.fits >= USABLE_FIT;

export function listTrends(channelId: number): TrendRow[] {
  const rows = db.prepare('SELECT source, name, detail, views, kid_safe, fits, fetched_at FROM trends WHERE channel_id = ?').all(channelId) as any[];
  return rows
    .map((r) => ({ ...r, detail: r.detail || '', usable: isUsable(r) }))
    .sort((a, b) => Number(b.usable) - Number(a.usable) || (b.fits ?? 0) - (a.fits ?? 0) || (b.views ?? 0) - (a.views ?? 0));
}

export interface VideoRow {
  title: string;
  job_id: string | null;
  tiktok_views: number;
  youtube_views: number;
  likes: number;
  comments: number;
  views: number;
  posted_at: string;
  hook_score: number | null;
  /** Link to the TikTok video, when the app posted it (only real video links, never the Studio page). */
  tiktok_url: string | null;
  youtube_url: string | null;
}

/** A saved link only when it really points at a video (not TikTok Studio's page, which older rows stored). */
export function realVideoUrl(url: string | null | undefined, platform: 'tiktok' | 'youtube'): string | null {
  if (!url) return null;
  const ok = platform === 'tiktok' ? /tiktok\.com\/@[^/]+\/video\/\d+/.test(url) : /(youtube\.com\/shorts\/|youtu\.be\/|youtube\.com\/watch)/.test(url);
  return ok ? url : null;
}

/** One row per video (TikTok and YouTube added together), most viewed first. */
export function topVideos(channelId: number, limit = 10): VideoRow[] {
  const rows = db
    .prepare(
      `SELECT s.platform, s.title, s.posted_at, s.views, s.likes, s.comments, s.job_id, j.concept_title AS job_title, j.hook_score, j.tiktok_share_url, j.youtube_share_url
       FROM video_stats s LEFT JOIN jobs j ON j.id = s.job_id WHERE s.channel_id = ?`
    )
    .all(channelId) as any[];
  const byKey = new Map<string, VideoRow>();
  for (const r of rows) {
    const key = r.job_id || `${r.platform}:${r.title}:${r.posted_at}`;
    const v = byKey.get(key) || {
      title: r.job_title || r.title.replace(/\s#\S+/g, '').trim(),
      job_id: r.job_id,
      tiktok_views: 0,
      youtube_views: 0,
      likes: 0,
      comments: 0,
      views: 0,
      posted_at: r.posted_at,
      hook_score: r.hook_score ?? null,
      tiktok_url: realVideoUrl(r.tiktok_share_url, 'tiktok'),
      youtube_url: realVideoUrl(r.youtube_share_url, 'youtube'),
    };
    if (r.platform === 'tiktok') v.tiktok_views += r.views;
    else v.youtube_views += r.views;
    v.likes += r.likes || 0;
    v.comments += r.comments || 0;
    v.views = v.tiktok_views + v.youtube_views;
    byKey.set(key, v);
  }
  return [...byKey.values()].sort((a, b) => b.views - a.views).slice(0, limit);
}

/**
 * Average views by the hour a video went up (TikTok rows carry the time). Hours with fewer than 2 videos are left out,
 * so one lucky video does not steer the schedule.
 */
export function hourWeights(channelId: number): Record<number, number> {
  const rows = db
    .prepare("SELECT posted_hour AS h, views FROM video_stats WHERE channel_id = ? AND platform = 'tiktok' AND posted_hour IS NOT NULL")
    .all(channelId) as Array<{ h: number; views: number }>;
  return computeHourWeights(rows);
}

export function computeHourWeights(rows: Array<{ h: number; views: number }>): Record<number, number> {
  const sum: Record<number, { n: number; v: number }> = {};
  for (const r of rows) {
    sum[r.h] = sum[r.h] || { n: 0, v: 0 };
    sum[r.h].n++;
    sum[r.h].v += r.views;
  }
  const out: Record<number, number> = {};
  for (const [h, s] of Object.entries(sum)) if (s.n >= 2) out[Number(h)] = s.v / s.n;
  return out;
}

/**
 * Best-times planning: from several valid random days, keep the one whose times fall in the best hours on average.
 * Hours without data count as the overall average, so they are neither favoured nor avoided.
 */
export function pickBestDay(candidates: string[][], weights: Record<number, number>): number {
  const known = Object.values(weights);
  if (!candidates.length) return -1;
  if (!known.length) return 0;
  const avg = known.reduce((a, b) => a + b, 0) / known.length;
  const score = (times: string[]) => times.reduce((s, t) => s + (weights[Number(t.slice(0, 2))] ?? avg), 0) / times.length;
  let best = 0;
  candidates.forEach((c, i) => {
    if (score(c) > score(candidates[best])) best = i;
  });
  return best;
}

/** Trends used by the last few runs are skipped, so every video follows a different one. */
export const RECENT_TRENDS = 4;

/**
 * The message for a run: "next." plus ONE trend for this video. Only the trend is named, never earlier titles:
 * quoting the most viewed titles made ChatGPT copy them ("SNOOT DANCE" twice).
 */
export function buildNextMessage(trend: { name: string; detail?: string } | null): string {
  if (!trend) return 'next';
  const why = trend.detail ? ` (${trend.detail.slice(0, 120)})` : '';
  return (
    `next. Base this video on the trend "${trend.name.slice(0, 60)}"${why}. ` +
    'Use a new animal, a new joke and new title words, never an earlier video\'s. Keep the same answer format.'
  );
}

/** What the page shows: the trend itself is chosen when the run starts. */
export function nextMessage(channelId: number): string {
  if (!smartOn(channelId, 'smartPrompts')) return 'next';
  const n = listTrends(channelId).filter((t) => t.usable).length;
  return n ? buildNextMessage({ name: `one of ${n} trends, picked by Jev when the run starts` }) : 'next';
}

/** Index drawn in proportion to `weights` (all zero or empty: the first). */
export function weightedIndex(weights: number[], rng: () => number = Math.random): number {
  const total = weights.reduce((a, b) => a + Math.max(0, b), 0);
  if (!(total > 0)) return 0;
  let r = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= Math.max(0, weights[i]);
    if (r < 0) return i;
  }
  return weights.length - 1;
}

/** Jev: which of these trends is getting the most attention right now? Probabilities per trend, or null. */
async function trendHeat(trends: Array<{ name: string; detail: string; views?: number | null }>): Promise<number[] | null> {
  if (!jevAvailable() || trends.length < 2) return null;
  const key = (t: { name: string }, i: number) =>
    `${t.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'trend'}_${i}`;
  const criteria: Record<string, string> = {};
  trends.forEach((t, i) => {
    criteria[key(t, i)] = `${t.name}${t.detail ? ` — ${t.detail}` : ''}${t.views ? ` (${t.views.toLocaleString('en-US')} views)` : ''}`;
  });
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.TYPESAFE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'jev-latest',
        state: { today: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) },
        questions: {
          hottest: {
            type: 'choice',
            instructions: 'Which of these trends is getting the most attention from viewers on TikTok and YouTube Shorts right now?',
            criteria,
          },
        },
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const probs: Record<string, number> = (await res.json())?.answers?.hottest?.probabilities || {};
    const out = trends.map((t, i) => Number(probs[key(t, i)]) || 0);
    return out.some((v) => v > 0) ? out : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- the manager: test new trends, repeat winners

/** A video is a winner when it got at least this many views AND twice the channel's typical (median) video. */
export const WIN_MIN_VIEWS = 20;
/** Share of runs that test an untried trend while proven winners exist (before any winner: every run tests). */
export const EXPLORE_RATE = 0.35;

export interface TrendScore {
  name: string;
  detail: string;
  /** Videos made with this trend, and their average total views (TikTok + YouTube). */
  videos: number;
  avgViews: number | null;
  winner: boolean;
  /** Still in the current trend list and rated kid-safe + a fit. */
  usable: boolean;
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const v = [...xs].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

/** Views per video (both platforms added) for this channel's videos, keyed by job id. */
function viewsByJob(channelId: number): Map<string, number> {
  const rows = db
    .prepare('SELECT job_id, SUM(views) AS v FROM video_stats WHERE channel_id = ? AND job_id IS NOT NULL GROUP BY job_id')
    .all(channelId) as Array<{ job_id: string; v: number }>;
  return new Map(rows.map((r) => [r.job_id, r.v]));
}

export function winnerThreshold(allViews: number[]): number {
  return Math.max(WIN_MIN_VIEWS, 2 * median(allViews));
}

/** Titles of this channel's winning videos: their ideas may be repeated. */
export function winnerTitles(channelId: number): string[] {
  const views = viewsByJob(channelId);
  const bar = winnerThreshold([...views.values()]);
  const jobs = db.prepare('SELECT id, concept_title FROM jobs WHERE channel_id = ? AND concept_title IS NOT NULL').all(channelId) as any[];
  return jobs.filter((j) => (views.get(j.id) ?? 0) >= bar).map((j) => String(j.concept_title));
}

/** Every trend the channel has used or can use, with how its videos did. */
export function trendScores(channelId: number): TrendScore[] {
  const views = viewsByJob(channelId);
  const bar = winnerThreshold([...views.values()]);
  const byTrend = new Map<string, number[]>();
  for (const j of db.prepare('SELECT id, trend FROM jobs WHERE channel_id = ? AND trend IS NOT NULL').all(channelId) as any[]) {
    if (!views.has(j.id)) continue; // not measured yet: neither a winner nor a loser
    byTrend.set(j.trend, [...(byTrend.get(j.trend) || []), views.get(j.id)!]);
  }
  const usable = listTrends(channelId).filter((t) => t.usable);
  const names = new Set([...usable.map((t) => t.name), ...byTrend.keys()]);
  return [...names].map((name) => {
    const v = byTrend.get(name) || [];
    const avg = v.length ? v.reduce((x, y) => x + y, 0) / v.length : null;
    const t = usable.find((u) => u.name === name);
    return { name, detail: t?.detail || '', videos: v.length, avgViews: avg, winner: avg !== null && avg >= bar, usable: !!t };
  });
}

export interface TrendDecision {
  trend: { name: string; detail: string } | null;
  mode: 'test' | 'repeat' | 'none';
  reason: string;
}

/** Jev as marketing manager: which trend should the next video use to grow views? Probabilities per candidate. */
async function managerChoice(candidates: TrendScore[], typicalViews: number): Promise<number[] | null> {
  if (!jevAvailable() || candidates.length < 2) return null;
  const key = (t: { name: string }, i: number) =>
    `${t.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'trend'}_${i}`;
  const criteria: Record<string, string> = {};
  candidates.forEach((t, i) => {
    criteria[key(t, i)] =
      t.videos > 0
        ? `${t.name}: our ${t.videos} video(s) with it averaged ${Math.round(t.avgViews || 0)} views${t.winner ? ' (a proven winner)' : ''}`
        : `${t.name}: not tried yet${t.detail ? ` — ${t.detail}` : ''}`;
  });
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.TYPESAFE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'jev-latest',
        state: {
          today: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
          our_typical_video_views: Math.round(typicalViews),
        },
        questions: {
          manager: {
            type: 'choice',
            instructions:
              "As the kids' channel's social media marketing manager, which trend should the next short video use to get the most views?",
            criteria,
          },
        },
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const probs: Record<string, number> = (await res.json())?.answers?.manager?.probabilities || {};
    const out = candidates.map((t, i) => Number(probs[key(t, i)]) || 0);
    return out.some((v) => v > 0) ? out : null;
  } catch {
    return null;
  }
}

/**
 * The trend for this run, decided like a marketing manager:
 *  - TEST: until a trend has proven itself (and on EXPLORE_RATE of runs after that), try an untried trend, picked by
 *    Jev's "most attention right now" weights.
 *  - REPEAT: otherwise use the trends that WORKED. Jev (as manager) weighs proven winners against everything else,
 *    with each trend's real average views beside it; a winner can come back as often as it keeps winning.
 * Without Jev the same plan runs on the numbers alone. The decision is recorded for the page.
 */
export async function pickTrendForRun(channelId: number, rng: () => number = Math.random): Promise<TrendDecision> {
  const scores = trendScores(channelId);
  const used = readInsightsState(channelId).usedTrends || [];
  const recent = new Set(used.slice(-RECENT_TRENDS));
  const winners = scores.filter((t) => t.winner);
  const untried = scores.filter((t) => t.usable && t.videos === 0 && !recent.has(t.name));
  const typical = median([...viewsByJob(channelId).values()]);
  let decision: TrendDecision;

  if (untried.length && (!winners.length || rng() < EXPLORE_RATE)) {
    const heat = await trendHeat(untried);
    const t = untried[weightedIndex(heat ? heat.map((p) => Math.sqrt(p) + 0.05) : untried.map(() => 1), rng)];
    decision = {
      trend: t,
      mode: 'test',
      reason: `Testing a new trend (${untried.length} not tried yet${winners.length ? `; ${winners.length} proven winner(s) on hold this time` : ''}).`,
    };
  } else {
    // Winners always; other tried trends and fresh ones too, unless they were just used and did not win.
    const pool = scores.filter((t) => t.winner || ((t.usable || t.videos > 0) && !recent.has(t.name)));
    const all = pool.length ? pool : scores.filter((t) => t.usable || t.videos > 0);
    // Never the same trend twice in a row unless it is a winner.
    const fresh = all.filter((t) => t.winner || t.name !== used[used.length - 1]);
    const candidates = fresh.length ? fresh : all;
    if (!candidates.length) return { trend: null, mode: 'none', reason: 'No usable trends yet: refresh insights.' };
    const jev = await managerChoice(candidates, typical);
    // Numbers alone: a trend's average views (winners clearly ahead); untried ones count as a typical video.
    const byViews = candidates.map((t) => (t.avgViews ?? typical) + 1);
    const weights = jev ? jev.map((p, i) => p + 0.02 * (byViews[i] / Math.max(...byViews))) : byViews;
    const t = candidates[weightedIndex(weights, rng)];
    decision = {
      trend: t,
      mode: t.winner ? 'repeat' : 'test',
      reason: t.winner
        ? `Repeating a winner: its videos averaged ${Math.round(t.avgViews || 0)} views (typical ${Math.round(typical)}).`
        : `Trying "${t.name}"${t.videos ? ` again (avg ${Math.round(t.avgViews || 0)} views so far)` : ''}${jev ? ', chosen by Jev' : ''}.`,
    };
  }
  writeInsightsState(channelId, {
    usedTrends: [...used, decision.trend!.name].slice(-20),
    lastDecision: { at: new Date().toISOString(), trend: decision.trend!.name, mode: decision.mode, reason: decision.reason },
  });
  console.log(`[insights] channel ${channelId}: ${decision.mode} "${decision.trend!.name}". ${decision.reason}`);
  return decision;
}

/** The message for a run that is starting. Picks (and records) this video's trend. */
export async function nextMessageForRun(channelId: number): Promise<{ message: string; trend: string | null }> {
  if (!smartOn(channelId, 'smartPrompts')) return { message: 'next', trend: null };
  const d = await pickTrendForRun(channelId);
  if (!d.trend) return { message: 'next', trend: null };
  // A winner may be repeated on purpose: say so, so ChatGPT keeps what worked (with a new animal).
  const message =
    d.mode === 'repeat'
      ? `next. Base this video on the trend "${d.trend.name.slice(0, 60)}": our videos with it get the most views, so keep that style and music, with a new animal. Keep the same answer format.`
      : buildNextMessage(d.trend);
  return { message, trend: d.trend.name };
}

// ---------------------------------------------------------------- rotation (sounds, comments)

interface RotationState {
  sound?: string;
  comment?: string;
  collectedAt?: string;
  privateAccount?: boolean;
  /** Trends used by recent runs, oldest first. */
  usedTrends?: string[];
  lastDecision?: { at: string; trend: string; mode: string; reason: string };
}
const stateFile = (channelId: number) => path.join(channelDir(channelId), 'insights_state.json');

export function readInsightsState(channelId: number): RotationState {
  try {
    return JSON.parse(fs.readFileSync(stateFile(channelId), 'utf8'));
  } catch {
    return {};
  }
}

export function writeInsightsState(channelId: number, patch: RotationState): void {
  const next = { ...readInsightsState(channelId), ...patch };
  fs.mkdirSync(path.dirname(stateFile(channelId)), { recursive: true });
  fs.writeFileSync(stateFile(channelId), JSON.stringify(next, null, 2));
}

/** The item after the last one used; never the same one twice in a row when the list has more than one. */
export function nextInRotation(list: string[], last: string | undefined): string | null {
  if (!list.length) return null;
  const i = last === undefined ? -1 : list.indexOf(last);
  return list[(i + 1) % list.length];
}

/** The TikTok library sound for this run: the rotation's next one when rotation is on, else the channel's own setting. */
export function tikTokSoundForRun(channelId: number, fallback: string): string {
  const s = getSmart(channelId);
  if (!s.enabled || !s.soundRotation || !s.sounds.length) return fallback;
  const pick = nextInRotation(s.sounds, readInsightsState(channelId).sound) || fallback;
  writeInsightsState(channelId, { sound: pick });
  return pick;
}

export function commentForRun(channelId: number): string | null {
  const s = getSmart(channelId);
  if (!s.enabled || !s.firstComment) return null;
  const list = s.comments.length ? s.comments : DEFAULT_COMMENTS;
  const pick = nextInRotation(list, readInsightsState(channelId).comment);
  if (pick) writeInsightsState(channelId, { comment: pick });
  return pick;
}

/** Collect at most every 6 hours (each run checks; the "Refresh now" button forces it). */
export const COLLECT_EVERY_MS = 6 * 60 * 60 * 1000;
export function collectDue(channelId: number, now = Date.now()): boolean {
  if (!smartOn(channelId, 'collect')) return false;
  const at = Date.parse(readInsightsState(channelId).collectedAt || '');
  return !Number.isFinite(at) || now - at >= COLLECT_EVERY_MS;
}

export function insightsView(channelId: number) {
  const st = readInsightsState(channelId);
  const weights = hourWeights(channelId);
  const bestHours = Object.entries(weights)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([h, v]) => ({ hour: Number(h), avgViews: Math.round(v) }));
  return {
    settings: getSmart(channelId),
    jevReady: jevAvailable(),
    collectedAt: st.collectedAt || null,
    privateAccount: !!st.privateAccount,
    trends: listTrends(channelId),
    videos: topVideos(channelId, 10),
    bestHours,
    nextMessage: nextMessage(channelId),
    lastDecision: st.lastDecision || null,
    trendScores: trendScores(channelId).filter((t) => t.videos > 0).sort((a, b) => (b.avgViews ?? 0) - (a.avgViews ?? 0)),
  };
}

// ---------------------------------------------------------------- repeated ideas

const STOP = new Set(
  'this that the a an is was are to for by of and or just mr mrs apple baby tiny little big has have so too very not ready with who what how its it in on at vs got went who\'s'.split(' ')
);

const titleWords = (t: string) =>
  t
    .toLowerCase()
    .replace(/#\S+/g, ' ')
    .replace(/'s\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);

const distinctivePairs = (t: string) => {
  const w = titleWords(t);
  const out = new Set<string>();
  for (let i = 0; i + 1 < w.length; i++) {
    if (STOP.has(w[i]) || STOP.has(w[i + 1]) || w[i].length < 3 || w[i + 1].length < 3) continue;
    out.add(`${w[i]} ${w[i + 1]}`);
  }
  return out;
};

/**
 * The earlier title a new title copies, or null. A copy shares a distinctive two-word phrase ("snoot dance") with ONE
 * earlier video. Phrases found in two or more earlier titles are the channel's style ("outdanced mr", "dance moves")
 * and are allowed. Pure, for tests.
 */
export function repeatsEarlierIdea(title: string, earlier: string[]): string | null {
  const unique = [...new Set(earlier.map((t) => t.trim()).filter(Boolean))];
  const count = new Map<string, number>();
  for (const t of unique) for (const p of distinctivePairs(t)) count.set(p, (count.get(p) || 0) + 1);
  for (const p of distinctivePairs(title)) {
    if (count.get(p) !== 1) continue;
    const hit = unique.find((t) => distinctivePairs(t).has(p) && t !== title.trim());
    if (hit) return hit;
  }
  // The very same title is always a repeat.
  return unique.find((t) => titleWords(t).join(' ') === titleWords(title).join(' ')) || null;
}

/** The channel's recent video titles, newest first. */
export function recentTitles(channelId: number, limit = 30): string[] {
  return db
    .prepare('SELECT concept_title FROM jobs WHERE channel_id = ? AND concept_title IS NOT NULL ORDER BY created_at DESC LIMIT ?')
    .all(channelId, limit)
    .map((r: any) => String(r.concept_title));
}

/** Sent to the ChatGPT chat when its new idea copies an earlier video. */
export function retryMessage(newTitle: string, oldTitle: string): string {
  return (
    `next. That idea ("${newTitle.slice(0, 80)}") repeats an earlier video ("${oldTitle.slice(0, 80)}"). ` +
    'Write a completely different video: a new animal, a new kind of joke or dance, and new words in the title. Keep the same answer format.'
  );
}
