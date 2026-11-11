import crypto from 'crypto';
import db from '../db/database';

/**
 * Persistent run history. Every "make a video" or "post an existing video" attempt gets one row, so a failed or
 * stopped run is still visible after the app restarts. Live progress stays in memory (dailyRunner); this is the record.
 */

export type RunTrigger = 'button' | 'schedule' | 'republish';
export type RunRecordState = 'running' | 'waiting_login' | 'done' | 'error' | 'cancelled';

export interface Run {
  id: string;
  channel_id: number;
  channel_name: string;
  trigger: RunTrigger;
  state: RunRecordState;
  stage: string;
  message: string;
  job_id: string | null;
  started_at: string;
  finished_at: string | null;
  duration_sec: number | null;
  /** Seconds spent in each station of the production line, in order. */
  timings: Record<string, number>;
}

function rowToRun(row: any): Run {
  const started = Date.parse(row.started_at);
  const finished = row.finished_at ? Date.parse(row.finished_at) : NaN;
  return {
    id: row.id,
    channel_id: row.channel_id,
    channel_name: row.channel_name || `Channel ${row.channel_id}`,
    trigger: row.trigger,
    state: row.state,
    stage: row.stage || '',
    message: row.message || '',
    job_id: row.job_id || null,
    started_at: row.started_at,
    finished_at: row.finished_at || null,
    duration_sec: Number.isFinite(started) && Number.isFinite(finished) ? Math.max(0, Math.round((finished - started) / 1000)) : null,
    timings: (() => {
      try {
        return row.timings_json ? JSON.parse(row.timings_json) : {};
      } catch {
        return {};
      }
    })(),
  };
}

const SELECT = `SELECT r.*, c.name AS channel_name FROM runs r LEFT JOIN channels c ON c.id = r.channel_id`;

export function createRun(channelId: number, trigger: RunTrigger, message: string): string {
  const id = 'run_' + crypto.randomUUID().slice(0, 12);
  db.prepare(
    `INSERT INTO runs (id, channel_id, trigger, state, stage, message, pid, started_at)
     VALUES (?, ?, ?, 'running', 'login', ?, ?, ?)`
  ).run(id, channelId, trigger, message, process.pid, new Date().toISOString());
  return id;
}

export function updateRun(
  id: string,
  patch: { state?: RunRecordState; stage?: string; message?: string; jobId?: string; finished?: boolean; timings?: Record<string, number> }
): void {
  const sets: string[] = [];
  const params: any[] = [];
  if (patch.state !== undefined) (sets.push('state = ?'), params.push(patch.state));
  if (patch.stage !== undefined) (sets.push('stage = ?'), params.push(patch.stage));
  if (patch.message !== undefined) (sets.push('message = ?'), params.push(patch.message));
  if (patch.jobId !== undefined) (sets.push('job_id = ?'), params.push(patch.jobId));
  if (patch.finished) (sets.push('finished_at = ?'), params.push(new Date().toISOString()));
  if (patch.timings !== undefined) (sets.push('timings_json = ?'), params.push(JSON.stringify(patch.timings)));
  if (!sets.length) return;
  params.push(id);
  db.prepare(`UPDATE runs SET ${sets.join(', ')} WHERE id = ?`).run(...params);
}

export function listRuns(opts: { channelId?: number; limit?: number } = {}): Run[] {
  const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 500);
  const rows = opts.channelId
    ? db.prepare(`${SELECT} WHERE r.channel_id = ? ORDER BY r.started_at DESC LIMIT ?`).all(opts.channelId, limit)
    : db.prepare(`${SELECT} ORDER BY r.started_at DESC LIMIT ?`).all(limit);
  return rows.map(rowToRun);
}

export function lastRun(channelId?: number): Run | null {
  return listRuns({ channelId, limit: 1 })[0] || null;
}

function processAlive(pid: number): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    return err?.code === 'EPERM';
  }
}

/**
 * Runs still marked in progress whose process is gone (the app was closed or crashed mid-run) are closed out as
 * errors. A run owned by another live process (the scheduled job running on its own) is left alone.
 */
export function closeInterruptedRuns(): number {
  const open = db.prepare(`SELECT id, pid FROM runs WHERE state IN ('running', 'waiting_login')`).all() as Array<{ id: string; pid: number }>;
  let closed = 0;
  for (const run of open) {
    if (run.pid === process.pid || processAlive(run.pid)) continue;
    updateRun(run.id, {
      state: 'error',
      message: 'Interrupted: the app was closed or restarted while this run was in progress.',
      finished: true,
    });
    closed++;
  }
  return closed;
}

/** A run for this channel that another live process (the scheduled job) is doing right now. */
export function foreignActiveRun(channelId: number): Run | null {
  const rows = db
    .prepare(`${SELECT} WHERE r.channel_id = ? AND r.state IN ('running', 'waiting_login') ORDER BY r.started_at DESC`)
    .all(channelId) as any[];
  const row = rows.find((r) => r.pid !== process.pid && processAlive(r.pid));
  return row ? rowToRun(row) : null;
}
