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
} from './channels';

const execFileAsync = promisify(execFile);

/**
 * "Post a video every day at these times" using macOS LaunchAgents.
 * launchd starts `scripts/dailyRun.ts --channel <id>` at each time even when the app is closed.
 */

export const LABEL = 'com.kindredstudio.daily';
export const MAX_POSTS_PER_DAY = 8;
export const MIN_GAP_MINUTES = 30; // one run takes ~5 minutes; keep runs from overlapping on the same browser profile
const ROOT = path.join(__dirname, '../..');
const CONFIG_FILE = path.join(ROOT, 'storage/schedule.json');
const LOG_FILE = path.join(ROOT, 'storage/logs/daily.log');
const STATE_FILE = process.env.KINDRED_STATE_FILE || path.join(ROOT, 'storage/schedule_state.json');
const PLIST_PATH = path.join(os.homedir(), 'Library/LaunchAgents', `${LABEL}.plist`);

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

export function buildChannelPlist(channelId: number, times: string[]): string {
  const slots = normalizeTimes(times).map(parseTime);
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

export function buildPlist(times: string[]): string {
  return buildChannelPlist(1, times);
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

export function readState(): ScheduleState {
  return readChannelState(1);
}

export function recordRun(outcome: LastRun['outcome'], message: string, slot?: string | null): ScheduleState {
  return recordChannelRun(1, outcome, message, slot);
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

function readLegacyConfig(): ScheduleConfig {
  try {
    const c = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    const raw: string[] = Array.isArray(c.times) ? c.times : typeof c.time === 'string' ? [c.time] : [];
    return { enabled: !!c.enabled, times: raw.length ? normalizeTimes(raw) : ['10:00'] };
  } catch {
    return { enabled: false, times: ['10:00'] };
  }
}

async function launchctl(...args: string[]): Promise<void> {
  await execFileAsync('/bin/launchctl', args);
}

export async function syncChannelLaunchAgent(channelId: number, enabled: boolean, times: string[]): Promise<void> {
  if (process.platform !== 'darwin') return;
  const clean = normalizeTimes(times);
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

export async function removeChannelLaunchAgent(channelId: number): Promise<void> {
  if (process.platform !== 'darwin') return;
  const domain = `gui/${os.userInfo().uid}`;
  const label = channelLabel(channelId);
  const plistPath = channelPlistPath(channelId);

  await launchctl('bootout', `${domain}/${label}`).catch(() => {});
  if (fs.existsSync(plistPath)) {
    try {
      fs.unlinkSync(plistPath);
    } catch {}
  }
}

export function getChannelSchedule(channelId: number): ScheduleConfig & {
  installed: boolean;
  logFile: string;
  platformSupported: boolean;
  completedToday: number;
  lastRun?: LastRun;
} {
  const channel = getChannel(channelId);
  if (!channel) throw new Error(`Channel ${channelId} not found.`);
  const times = channel.schedule_times.length ? normalizeTimes(channel.schedule_times) : ['10:00'];
  const st = readChannelState(channelId);
  const plistPath = channelPlistPath(channelId);
  return {
    enabled: channel.schedule_enabled,
    times,
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
  updateChannel(channelId, { schedule_enabled: enabled, schedule_times: clean });
  await syncChannelLaunchAgent(channelId, enabled, clean);
  return getChannelSchedule(channelId);
}

export function getSchedule(): ScheduleConfig & {
  installed: boolean;
  logFile: string;
  platformSupported: boolean;
  completedToday: number;
  lastRun?: LastRun;
} {
  try {
    return getChannelSchedule(1);
  } catch {
    const cfg = readLegacyConfig();
    const st = readState();
    return {
      ...cfg,
      completedToday: cfg.times.filter((t) => st.doneSlots.includes(t)).length,
      lastRun: st.lastRun,
      installed: fs.existsSync(PLIST_PATH),
      logFile: LOG_FILE,
      platformSupported: process.platform === 'darwin',
    };
  }
}

export async function setSchedule(enabled: boolean, times: string[]): Promise<ReturnType<typeof getSchedule>> {
  return setChannelSchedule(1, enabled, times);
}

export async function migrateLegacySchedule(): Promise<void> {
  if (process.platform !== 'darwin') return;
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
