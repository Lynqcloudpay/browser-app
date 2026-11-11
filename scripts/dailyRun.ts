/**
 * Scheduled daily job (started by launchd, see server/engine/dailySchedule.ts):
 * opens the browser, checks logins, makes one video for the channel and posts it.
 *
 *   npx tsx scripts/dailyRun.ts                     # runs channel 1, skips if slot done
 *   npx tsx scripts/dailyRun.ts --channel 2         # runs channel 2
 *   npx tsx scripts/dailyRun.ts --channel 2 --force # runs channel 2 even if slot already done
 */
import { spawn, execFile } from 'child_process';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

const FORCE = process.argv.includes('--force');
const chArgIdx = process.argv.indexOf('--channel');
const CHANNEL_ID = chArgIdx !== -1 && process.argv[chArgIdx + 1] ? Number(process.argv[chArgIdx + 1]) || 1 : 1;

const PORT = Number(process.env.SERVER_PORT) || 3000;
const BASE = `http://127.0.0.1:${PORT}`;

const log = (msg: string) => console.log(`[${new Date().toLocaleString()}] [daily-ch${CHANNEL_ID}] ${msg}`);

function notify(title: string, message: string) {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  execFile('osascript', ['-e', `display notification "${esc(message)}" with title "${esc(title)}"`], () => {});
}

async function serverIsUp(): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/api/channels/${CHANNEL_ID}/run-status`, { signal: AbortSignal.timeout(3000) });
    return r.ok;
  } catch {
    return false;
  }
}

/** The app is already open (it owns the browser window): ask it to do the run and watch its progress. */
async function runViaRunningApp(): Promise<{ ok: boolean; message: string }> {
  const start = await fetch(`${BASE}/api/channels/${CHANNEL_ID}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trigger: 'schedule' }),
  });
  if (!start.ok) return { ok: false, message: (await start.json().catch(() => ({}))).error || `HTTP ${start.status}` };

  let lastStep = '';
  const deadline = Date.now() + 90 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 10000));
    const st: any = await (await fetch(`${BASE}/api/channels/${CHANNEL_ID}/run-status`)).json();
    if (st.step && st.step !== lastStep) {
      lastStep = st.step;
      log(st.step);
    }
    if (st.state === 'done') return { ok: true, message: st.step };
    if (st.state === 'error') return { ok: false, message: st.error || st.step };
    if (st.state === 'cancelled') return { ok: false, message: 'The run was stopped from the app.' };
  }
  return { ok: false, message: 'Timed out after 90 minutes.' };
}

/** The app is closed: run everything in this process. */
async function runDirect(): Promise<{ ok: boolean; message: string; stage?: string }> {
  const { initDatabase } = await import('../server/db/database');
  const { startRun, waitForRun, getRunStatus } = await import('../server/engine/dailyRunner');
  initDatabase();
  (await import('../server/engine/runs')).closeInterruptedRuns();

  const started = startRun('schedule', CHANNEL_ID);
  if (!started.started) return { ok: false, message: started.reason || 'Could not start.' };

  let lastStep = '';
  const ticker = setInterval(() => {
    const st = getRunStatus(CHANNEL_ID);
    if (st.step !== lastStep) {
      lastStep = st.step;
      log(st.step);
    }
  }, 2000);
  const final = await waitForRun(CHANNEL_ID);
  clearInterval(ticker);
  return { ok: final.state === 'done', message: final.step, stage: final.stage };
}

async function main() {
  log(`Daily run starting for channel ${CHANNEL_ID}${FORCE ? ' (--force)' : ''}.`);

  // Keep the Mac awake while we work (display may still sleep; the browser keeps running).
  const caffeinate = spawn('/usr/bin/caffeinate', ['-i', '-m', '-s', '-w', String(process.pid)], { stdio: 'ignore' });
  caffeinate.on('error', () => {});

  const { getChannel } = await import('../server/engine/channels');
  const ch = getChannel(CHANNEL_ID);
  const channelName = ch ? ch.name : `Channel ${CHANNEL_ID}`;

  const { getChannelSchedule, pickDueSlot, readChannelState, recordChannelRun } = await import('../server/engine/dailySchedule');

  // Each scheduled time ("slot") makes one video, and a slot is only "done" once ITS video was made.
  let slot: string | null = null;
  if (!FORCE) {
    const sched = getChannelSchedule(CHANNEL_ID);
    const times = sched.times;
    const st = readChannelState(CHANNEL_ID);
    const pick = pickDueSlot(times, st.doneSlots);
    if (pick.allDue.length > 0 && !pick.slot) {
      const msg = `Skipped: every slot due so far (${pick.allDue.join(', ')}) already has its video today.`;
      log(msg);
      recordChannelRun(CHANNEL_ID, 'skipped', msg);
      notify(`${channelName} daily video skipped`, msg);
      process.exit(0);
    }
    slot = pick.slot;
    log(slot ? `Slot ${slot} has no video yet today (slots: ${times.join(', ')}) — making one now.` : `No slot is due yet (slots: ${times.join(', ')}) — started by hand, making one now.`);
  }

  const viaApp = await serverIsUp();
  log(viaApp ? 'App is open — running through it.' : 'App is closed — running directly.');

  const result = viaApp ? await runViaRunningApp() : await runDirect();

  // Retries (a fresh start before any video exists, a re-post to a platform that failed) happen inside the run itself.
  log(result.ok ? `SUCCESS: ${result.message}` : `FAILED: ${result.message}`);
  recordChannelRun(CHANNEL_ID, result.ok ? 'success' : 'failed', result.message, slot);
  notify(result.ok ? `${channelName} video posted` : `${channelName} daily video FAILED`, result.message.slice(0, 200));

  if (!viaApp) {
    const { getAgent } = await import('../server/engine/agentRegistry');
    await getAgent(CHANNEL_ID).shutdown();
  }
  process.exit(result.ok ? 0 : 1);
}

main().catch(async (err) => {
  log(`CRASHED: ${err?.message || err}`);
  let channelName = `Channel ${CHANNEL_ID}`;
  try {
    const { getChannel } = await import('../server/engine/channels');
    const ch = getChannel(CHANNEL_ID);
    if (ch) channelName = ch.name;
  } catch {}
  notify(`${channelName} daily video FAILED`, String(err?.message || err).slice(0, 200));
  process.exit(1);
});
