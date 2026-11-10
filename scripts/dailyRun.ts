/**
 * Scheduled daily job (started by launchd, see server/engine/dailySchedule.ts):
 * opens the browser, checks logins, makes one Mr. Apple video and posts it to TikTok.
 *
 *   npx tsx scripts/dailyRun.ts          # skips if a video was already posted today
 *   npx tsx scripts/dailyRun.ts --force  # always makes a video
 */
import { spawn, execFile } from 'child_process';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

const FORCE = process.argv.includes('--force');
const PORT = Number(process.env.SERVER_PORT) || 3000;
const BASE = `http://localhost:${PORT}`;

const log = (msg: string) => console.log(`[${new Date().toLocaleString()}] [daily] ${msg}`);

function notify(title: string, message: string) {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  execFile('osascript', ['-e', `display notification "${esc(message)}" with title "${esc(title)}"`], () => {});
}

async function serverIsUp(): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/api/browser/run-status`, { signal: AbortSignal.timeout(3000) });
    return r.ok;
  } catch {
    return false;
  }
}

/** The app is already open (it owns the browser window): ask it to do the run and watch its progress. */
async function runViaRunningApp(): Promise<{ ok: boolean; message: string }> {
  const start = await fetch(`${BASE}/api/browser/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trigger: 'schedule' }),
  });
  if (!start.ok) return { ok: false, message: (await start.json().catch(() => ({}))).error || `HTTP ${start.status}` };

  let lastStep = '';
  const deadline = Date.now() + 90 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 10000));
    const st: any = await (await fetch(`${BASE}/api/browser/run-status`)).json();
    if (st.step && st.step !== lastStep) {
      lastStep = st.step;
      log(st.step);
    }
    if (st.state === 'done') return { ok: true, message: st.step };
    if (st.state === 'error') return { ok: false, message: st.error || st.step };
  }
  return { ok: false, message: 'Timed out after 90 minutes.' };
}

/** The app is closed: run everything in this process. */
async function runDirect(): Promise<{ ok: boolean; message: string; stage?: string }> {
  const { initDatabase } = await import('../server/db/database');
  const { startRun, waitForRun, getRunStatus } = await import('../server/engine/dailyRunner');
  initDatabase();

  const started = startRun('schedule');
  if (!started.started) return { ok: false, message: started.reason || 'Could not start.' };

  let lastStep = '';
  const ticker = setInterval(() => {
    const st = getRunStatus();
    if (st.step !== lastStep) {
      lastStep = st.step;
      log(st.step);
    }
  }, 2000);
  const final = await waitForRun();
  clearInterval(ticker);
  return { ok: final.state === 'done', message: final.step, stage: final.stage };
}

async function main() {
  log(`Daily run starting${FORCE ? ' (--force)' : ''}.`);

  // Keep the Mac awake while we work (display may still sleep; the browser keeps running).
  const caffeinate = spawn('/usr/bin/caffeinate', ['-i', '-m', '-s', '-w', String(process.pid)], { stdio: 'ignore' });
  caffeinate.on('error', () => {});

  const { getSchedule, pickDueSlot, readState, recordRun } = await import('../server/engine/dailySchedule');

  // Each scheduled time ("slot") makes one video, and a slot is only "done" once ITS video was made. Changing the times
  // therefore never leaves a new time looking finished. Manual button posts don't use up a slot. A slot missed while the
  // Mac was asleep is caught up once, so the day never gets a burst of videos.
  let slot: string | null = null;
  if (!FORCE) {
    const times = getSchedule().times;
    const st = readState();
    const pick = pickDueSlot(times, st.doneSlots);
    if (pick.allDue.length > 0 && !pick.slot) {
      const msg = `Skipped: every slot due so far (${pick.allDue.join(', ')}) already has its video today.`;
      log(msg);
      recordRun('skipped', msg);
      notify('Mr. Apple daily video skipped', msg);
      process.exit(0);
    }
    slot = pick.slot;
    log(slot ? `Slot ${slot} has no video yet today (slots: ${times.join(', ')}) — making one now.` : `No slot is due yet (slots: ${times.join(', ')}) — started by hand, making one now.`);
  }

  const viaApp = await serverIsUp();
  log(viaApp ? 'App is open — running through it.' : 'App is closed — running directly.');

  let result = viaApp ? await runViaRunningApp() : await runDirect();

  // One retry, only if it failed before anything reached TikTok (so a video can never be posted twice).
  const stage = (result as any).stage as string | undefined;
  if (!result.ok && !viaApp && (stage === 'chatgpt' || stage === 'grok' || stage === 'login')) {
    log(`Failed at "${stage}": ${result.message}. Retrying once in 2 minutes…`);
    await new Promise((r) => setTimeout(r, 2 * 60 * 1000));
    result = await runDirect();
  }

  log(result.ok ? `SUCCESS: ${result.message}` : `FAILED: ${result.message}`);
  recordRun(result.ok ? 'success' : 'failed', result.message, slot);
  notify(result.ok ? 'Mr. Apple video posted' : 'Mr. Apple daily video FAILED', result.message.slice(0, 200));

  if (!viaApp) {
    const { default: JevBrowserAgent } = await import('../server/engine/jevBrowserAutomation');
    await JevBrowserAgent.shutdown();
  }
  process.exit(result.ok ? 0 : 1);
}

main().catch((err) => {
  log(`CRASHED: ${err?.message || err}`);
  notify('Mr. Apple daily video FAILED', String(err?.message || err).slice(0, 200));
  process.exit(1);
});
