import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import {
  getChannel,
  updateChannel,
  scheduleStateFile,
  channelLogFile,
  channelDir,
  saveScheduleTimes,
} from './channels';
import {
  SeriesConfig,
  HISTORY_LIMIT,
  parseSeries,
  planEveryDay,
  planRandomDay,
  patternKey,
} from './seriesPlan';
import { REPO_ROOT } from '../paths';

const execFileAsync = promisify(execFile);

/**
 * "Post a video every day at these times" using macOS LaunchAgents.
 * launchd starts `scripts/dailyRun.ts --channel <id>` at each time even when the app is closed.
 */

export const LABEL = 'com.kindredstudio.daily';
export const MIN_GAP_MINUTES = 30; // one run takes ~5 minutes; keep runs from overlapping on the same browser profile
// No fixed per-day count: the gap rule is the real limit (48 slots fit in 24 h at 30-minute spacing).
export const MAX_POSTS_PER_DAY = Math.floor((24 * 60) / MIN_GAP_MINUTES);
/** Repo root: the launchd job runs scripts/dailyRun.ts from here. Storage files go through paths.ts / channels.ts. */
const ROOT = REPO_ROOT;

export interface ScheduleConfig {
  enabled: boolean;
  times: string[]; // HH:MM, 24h, Mac local time, sorted
}

export function parseTime(time: string): { hour: number; minute: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec((time || '').trim());
  if (!m) throw new Error(`"${time}" is not a valid time. Use HH:MM, for example 18:30.`);
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) throw new Error(`"${time}" is not a valid time (00:00 – 23:59).`);
  return { hour, minute };
}

const pad = (n: number) => String(n).padStart(2, '0');
const toMinutes = (t: string) => {
  const { hour, minute } = parseTime(t);
  return hour * 60 + minute;
};

/** Validate, normalize to HH:MM, sort, and make sure runs are far enough apart. */
export function normalizeTimes(times: string[]): string[] {
  if (!Array.isArray(times) || times.length === 0) throw new Error('Choose at least one time.');
  if (times.length > MAX_POSTS_PER_DAY) throw new Error(`At most ${MAX_POSTS_PER_DAY} posts per day.`);
  const mins = times.map(toMinutes);
  if (new Set(mins).size !== mins.length) throw new Error('Two of the times are the same. Each post needs its own time.');
  mins.sort((a, b) => a - b);
  for (let i = 1; i < mins.length; i++) {
    if (mins[i] - mins[i - 1] < MIN_GAP_MINUTES) {
      throw new Error(`Times must be at least ${MIN_GAP_MINUTES} minutes apart — each video takes a few minutes to make and post.`);
    }
  }
  return mins.map((m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`);
}

/** Parse and sort HH:MM times without the daily gap and count rules (used for stored and series plans). */
export function cleanTimes(times: string[]): string[] {
  const mins = [...new Set(times.map(toMinutes))].sort((a, b) => a - b);
  return mins.map((m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`);
}

/** How many of today's slots have already come up (used so a missed slot is caught up, but never more than planned). */
export function slotsDueSoFar(times: string[], now = new Date()): number {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  return times.filter((t) => toMinutes(t) <= nowMin).length;
}

export function channelLabel(channelId: number): string {
  return `com.kindredstudio.channel.${channelId}`;
}

export function channelPlistPath(channelId: number): string {
  return path.join(os.homedir(), 'Library/LaunchAgents', `${channelLabel(channelId)}.plist`);
}

export const planLabel = (channelId: number) => `com.kindredstudio.plan.${channelId}`;
export const planPlistPath = (channelId: number) =>
  path.join(os.homedir(), 'Library/LaunchAgents', `${planLabel(channelId)}.plist`);

/** Runs once a night (00:05) to make tomorrow's random pattern for a channel. */
export function buildPlanPlist(channelId: number): string {
  const tsxCli = path.join(ROOT, 'node_modules/tsx/dist/cli.mjs');
  const nodeDir = path.dirname(process.execPath);
  const logFile = channelLogFile(channelId);
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${planLabel(channelId)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${esc(process.execPath)}</string>
    <string>${esc(tsxCli)}</string>
    <string>${esc(path.join(ROOT, 'scripts/planSeries.ts'))}</string>
    <string>--channel</string>
    <string>${channelId}</string>
  </array>
  <key>WorkingDirectory</key><string>${esc(ROOT)}</string>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>0</integer>
    <key>Minute</key><integer>5</integer>
  </dict>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${esc(nodeDir)}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>StandardOutPath</key><string>${esc(logFile)}</string>
  <key>StandardErrorPath</key><string>${esc(logFile)}</string>
  <key>RunAtLoad</key><false/>
</dict>
</plist>
`;
}

export function buildChannelPlist(channelId: number, times: string[]): string {
  const slots = cleanTimes(times).map(parseTime);
  const tsxCli = path.join(ROOT, 'node_modules/tsx/dist/cli.mjs');
  const nodeDir = path.dirname(process.execPath);
  const logFile = channelLogFile(channelId);
  const label = channelLabel(channelId);
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const calendar = slots
    .map(
      (s) => `    <dict>
      <key>Hour</key><integer>${s.hour}</integer>
      <key>Minute</key><integer>${s.minute}</integer>
    </dict>`
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${esc(process.execPath)}</string>
    <string>${esc(tsxCli)}</string>
    <string>${esc(path.join(ROOT, 'scripts/dailyRun.ts'))}</string>
    <string>--channel</string>
    <string>${channelId}</string>
  </array>
  <key>WorkingDirectory</key><string>${esc(ROOT)}</string>
  <key>StartCalendarInterval</key>
  <array>
${calendar}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${esc(nodeDir)}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>StandardOutPath</key><string>${esc(logFile)}</string>
  <key>StandardErrorPath</key><string>${esc(logFile)}</string>
  <key>RunAtLoad</key><false/>
</dict>
</plist>
`;
}

export interface LastRun {
  at: string;
  outcome: 'success' | 'failed' | 'skipped';
  message: string;
}

export interface ScheduleState {
  date: string; // Mac-local YYYY-MM-DD
  doneSlots: string[]; // slot times (HH:MM) the SCHEDULE has already made a video for today (manual button posts don't count)
  lastRun?: LastRun;
}

const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function readChannelState(channelId: number): ScheduleState {
  const filePath = scheduleStateFile(channelId);
  let prev: Partial<ScheduleState> = {};
  try {
    prev = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    /* first run */
  }
  const sameDay = prev.date === localDate();
  return {
    date: localDate(),
    doneSlots: sameDay && Array.isArray(prev.doneSlots) ? prev.doneSlots : [],
    lastRun: prev.lastRun,
  };
}

export function recordChannelRun(
  channelId: number,
  outcome: LastRun['outcome'],
  message: string,
  slot?: string | null
): ScheduleState {
  const st = readChannelState(channelId);
  if (outcome === 'success' && slot && !st.doneSlots.includes(slot)) st.doneSlots.push(slot);
  st.lastRun = { at: new Date().toISOString(), outcome, message: message.slice(0, 300) };
  const filePath = scheduleStateFile(channelId);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(st, null, 2));
  return st;
}

/**
 * Which slot should a scheduled run work on right now? The latest slot that has already come up today and has not been
 * completed yet. Returns null when there is none: either every due slot is done (-> skip) or no slot is due yet
 * (-> only possible when someone starts the job by hand).
 */
export function pickDueSlot(times: string[], doneSlots: string[], now = new Date()): { slot: string | null; allDue: string[] } {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const due = times.filter((t) => toMinutes(t) <= nowMin);
  const open = due.filter((t) => !doneSlots.includes(t));
  return { slot: open.length ? open[open.length - 1] : null, allDue: due };
}

async function launchctl(...args: string[]): Promise<void> {
  await execFileAsync('/bin/launchctl', args);
}

/** Tests set KINDRED_NO_LAUNCHD=1 so they never touch ~/Library/LaunchAgents or launchctl. */
const launchdDisabled = () => process.env.KINDRED_NO_LAUNCHD === '1';

/** Install (or remove) the channel's run job and, for random series, its nightly planner. */
export async function syncChannelLaunchAgent(channelId: number, enabled: boolean, times: string[]): Promise<void> {
  await syncRunAgent(channelId, enabled, times);
  await syncPlanAgent(channelId, enabled);
}

export async function syncRunAgent(channelId: number, enabled: boolean, times: string[]): Promise<void> {
  if (process.platform !== 'darwin' || launchdDisabled()) return;
  const clean = cleanTimes(times);
  const domain = `gui/${os.userInfo().uid}`;
  const label = channelLabel(channelId);
  const plistPath = channelPlistPath(channelId);
  const logFile = channelLogFile(channelId);

  // Always remove the old job first (ignore "not loaded").
  await launchctl('bootout', `${domain}/${label}`).catch(() => {});

  if (enabled) {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.mkdirSync(path.dirname(plistPath), { recursive: true });
    fs.writeFileSync(plistPath, buildChannelPlist(channelId, clean));
    await launchctl('bootstrap', domain, plistPath);
  } else if (fs.existsSync(plistPath)) {
    try {
      fs.unlinkSync(plistPath);
    } catch {}
  }
}

/**
 * Random series re-plan every night, so they need the 00:05 planner job. Other modes do not have one.
 * Never called from the planner itself: booting out a job kills that job's own process.
 */
export async function syncPlanAgent(channelId: number, enabled: boolean): Promise<void> {
  if (process.platform !== 'darwin' || launchdDisabled()) return;
  const domain = `gui/${os.userInfo().uid}`;
  const planPlist = planPlistPath(channelId);
  await launchctl('bootout', `${domain}/${planLabel(channelId)}`).catch(() => {});
  if (enabled && readSeries(channelId)?.mode === 'random') {
    fs.mkdirSync(path.dirname(planPlist), { recursive: true });
    fs.writeFileSync(planPlist, buildPlanPlist(channelId));
    await launchctl('bootstrap', domain, planPlist);
  } else if (fs.existsSync(planPlist)) {
    try {
      fs.unlinkSync(planPlist);
    } catch {}
  }
}

export async function removeChannelLaunchAgent(channelId: number): Promise<void> {
  if (process.platform !== 'darwin' || launchdDisabled()) return;
  const domain = `gui/${os.userInfo().uid}`;
  const label = channelLabel(channelId);
  const plistPath = channelPlistPath(channelId);

  await launchctl('bootout', `${domain}/${label}`).catch(() => {});
  if (fs.existsSync(plistPath)) {
    try {
      fs.unlinkSync(plistPath);
    } catch {}
  }
  await launchctl('bootout', `${domain}/${planLabel(channelId)}`).catch(() => {});
  if (fs.existsSync(planPlistPath(channelId))) {
    try {
      fs.unlinkSync(planPlistPath(channelId));
    } catch {}
  }
}

// ---- Series (every 15 min / 1 h / 2 h, or random gaps) -------------------------------------------------------

const seriesConfigFile = (channelId: number) => path.join(channelDir(channelId), 'schedule_series.json');
const seriesHistoryFile = (channelId: number) => path.join(channelDir(channelId), 'series_history.json');

/** The saved series pattern, or null when the channel uses plain "times". */
export function readSeries(channelId: number): SeriesConfig | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(seriesConfigFile(channelId), 'utf8'));
    return parseSeries(parsed);
  } catch {
    return null;
  }
}

function writeSeries(channelId: number, cfg: SeriesConfig | null): void {
  const file = seriesConfigFile(channelId);
  if (!cfg) {
    if (fs.existsSync(file)) fs.unlinkSync(file);
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
}

function readHistory(channelId: number): string[] {
  try {
    const list = JSON.parse(fs.readFileSync(seriesHistoryFile(channelId), 'utf8'));
    return Array.isArray(list) ? list.map(String) : [];
  } catch {
    return [];
  }
}

/** Today's (or tomorrow's) launch times for a series. Random days are remembered so no pattern comes back. */
function planSeriesTimes(channelId: number, cfg: SeriesConfig): string[] {
  if (cfg.mode === 'every') return planEveryDay(cfg);
  const history = readHistory(channelId);
  const { times, key } = planRandomDay(cfg, new Set(history));
  const next = [...history, key].slice(-HISTORY_LIMIT);
  fs.mkdirSync(path.dirname(seriesHistoryFile(channelId)), { recursive: true });
  fs.writeFileSync(seriesHistoryFile(channelId), JSON.stringify(next));
  return times;
}

/** Save a series pattern: check it, plan the first day, install launchd. Switches the channel to series mode. */
export async function setChannelSeries(
  channelId: number,
  enabled: boolean,
  input: unknown
): Promise<ReturnType<typeof getChannelSchedule>> {
  if (process.platform !== 'darwin') throw new Error('Daily scheduling uses macOS launchd and only works on a Mac.');
  const cfg = parseSeries(input);
  const times = planSeriesTimes(channelId, cfg);
  writeSeries(channelId, cfg);
  saveScheduleTimes(channelId, times);
  updateChannel(channelId, { schedule_enabled: enabled });
  await syncChannelLaunchAgent(channelId, enabled, times);
  return getChannelSchedule(channelId);
}

/** Nightly planner entry point: make tomorrow's random times and reinstall the channel's launch times. */
export async function planChannelSeries(channelId: number): Promise<string[] | null> {
  const cfg = readSeries(channelId);
  const channel = getChannel(channelId);
  if (!cfg || cfg.mode !== 'random' || !channel || !channel.schedule_enabled) return null;
  const times = planSeriesTimes(channelId, cfg);
  saveScheduleTimes(channelId, times);
  await syncRunAgent(channelId, true, times); // not syncChannelLaunchAgent: it would boot out this planner job
  return times;
}

export function getChannelSchedule(channelId: number): ScheduleConfig & {
  series: SeriesConfig | null;
  installed: boolean;
  logFile: string;
  platformSupported: boolean;
  completedToday: number;
  lastRun?: LastRun;
} {
  const channel = getChannel(channelId);
  if (!channel) throw new Error(`Channel ${channelId} not found.`);
  const times = channel.schedule_times.length ? cleanTimes(channel.schedule_times) : ['10:00'];
  const st = readChannelState(channelId);
  const plistPath = channelPlistPath(channelId);
  return {
    enabled: channel.schedule_enabled,
    times,
    series: readSeries(channelId),
    completedToday: times.filter((t) => st.doneSlots.includes(t)).length,
    lastRun: st.lastRun,
    installed: fs.existsSync(plistPath),
    logFile: channelLogFile(channelId),
    platformSupported: process.platform === 'darwin',
  };
}

export async function setChannelSchedule(
  channelId: number,
  enabled: boolean,
  times: string[]
): Promise<ReturnType<typeof getChannelSchedule>> {
  if (process.platform !== 'darwin') throw new Error('Daily scheduling uses macOS launchd and only works on a Mac.');
  const clean = normalizeTimes(times);
  writeSeries(channelId, null); // plain times mode replaces any series pattern
  updateChannel(channelId, { schedule_enabled: enabled, schedule_times: clean });
  await syncChannelLaunchAgent(channelId, enabled, clean);
  return getChannelSchedule(channelId);
}

export async function migrateLegacySchedule(): Promise<void> {
  if (process.platform !== 'darwin' || launchdDisabled()) return;
  const domain = `gui/${os.userInfo().uid}`;
  const legacyPlist = path.join(os.homedir(), 'Library/LaunchAgents', 'com.kindredstudio.daily.plist');
  if (fs.existsSync(legacyPlist)) {
    try {
      await launchctl('bootout', `${domain}/com.kindredstudio.daily`).catch(() => {});
      fs.unlinkSync(legacyPlist);
      console.log('[Schedule] Migrated legacy com.kindredstudio.daily LaunchAgent.');
    } catch (err: any) {
      console.warn('[Schedule] Could not remove legacy plist:', err.message);
    }
  }

  // Ensure channel 1 schedule is installed if enabled
  const ch1 = getChannel(1);
  if (ch1 && ch1.schedule_enabled) {
    await syncChannelLaunchAgent(1, true, ch1.schedule_times).catch((e) => {
      console.warn('[Schedule] Could not sync channel 1 schedule:', e.message);
    });
  }
}
