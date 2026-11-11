import db from '../db/database';
import { getAgent } from './agentRegistry';
import { isAccountOpBusy } from './accounts';
import { GrokResolution } from './types';
import { getChannel } from './channels';
import { PipelineResult } from './jevBrowserAutomation';
import { createRun, updateRun, foreignActiveRun, RunTrigger } from './runs';

/**
 * One entry point for "make and post a video" and "post an existing video", used by the buttons, the API and the
 * daily scheduled job. Runs per-channel in the background; callers poll getRunStatus(channelId).
 * Live progress is kept in memory here; every run is also recorded in the `runs` table (see runs.ts).
 */

export type RunState = 'idle' | 'running' | 'waiting_login' | 'done' | 'error' | 'cancelled';
export type RunStage = 'login' | 'chatgpt' | 'grok' | 'qa' | 'post' | 'finished';

export interface RunStatus {
  state: RunState;
  stage?: RunStage;
  step: string;
  trigger?: RunTrigger;
  runId?: string;
  startedAt?: string;
  finishedAt?: string;
  result?: PipelineResult;
  error?: string;
}

const statuses = new Map<number, RunStatus>();

export function getRunStatus(channelId = 1): RunStatus {
  return statuses.get(channelId) || { state: 'idle', step: '' };
}

export function isRunBusy(channelId: number): boolean {
  const st = getRunStatus(channelId);
  return st.state === 'running' || st.state === 'waiting_login';
}

/** How many videos went out today (Mac local time). Manual and scheduled runs both count. */
export function postedTodayCount(channelId?: number): number {
  const where = `state IN ('published', 'scheduled') AND date(updated_at, 'localtime') = date('now', 'localtime')`;
  const row = (
    channelId !== undefined
      ? db.prepare(`SELECT COUNT(*) AS n FROM jobs WHERE ${where} AND channel_id = ?`).get(channelId)
      : db.prepare(`SELECT COUNT(*) AS n FROM jobs WHERE ${where}`).get()
  ) as { n: number } | undefined;
  return row?.n || 0;
}

const STAGE_ORDER: RunStage[] = ['login', 'chatgpt', 'grok', 'qa', 'post', 'finished'];

/**
 * Which station of the production line a progress message belongs to. The sign-in messages name every site
 * ("Opening ChatGPT, Grok, TikTok…"), so they are matched on the action words the pipeline uses, not on site names.
 * Stations only ever move forward.
 */
export function stageFromStep(step: string, currentStage: RunStage = 'login'): RunStage {
  let next: RunStage = currentStage;
  if (/^writing a new prompt/i.test(step)) next = 'chatgpt';
  else if (/^generating the video/i.test(step)) next = 'grok';
  else if (/cover frame|safety check/i.test(step)) next = 'qa';
  else if (/^uploading|upload failed|^posted/i.test(step)) next = 'post';
  return STAGE_ORDER.indexOf(next) >= STAGE_ORDER.indexOf(currentStage) ? next : currentStage;
}

/** Turns a finished pipeline result into the one sentence the operator reads, and whether it counts as a success. */
export function describeResult(result: PipelineResult, republish: boolean): { ok: boolean; message: string } {
  const platform = (name: string, status: string) => {
    if (status === 'published') return `${name}: posted`;
    if (status === 'submitted') return `${name}: Post was clicked but ${name} did not confirm it, so check the account`;
    if (status === 'failed') return `${name}: failed`;
    if (status === 'skipped') return `${name}: skipped, not signed in`;
    return '';
  };
  const parts = [platform('TikTok', result.tiktokStatus), platform('YouTube', result.youtubeStatus)].filter(Boolean).join('. ');
  const title = `"${result.title}"`;

  if (!result.qaPassed) {
    return { ok: true, message: `${title} was made, but the safety check held it. Nothing was posted. Review it on the Videos page.` };
  }
  if (!result.postedAnywhere) {
    return {
      ok: false,
      message: `${title} ${republish ? 'was not posted' : 'was made, but posting failed'}. ${parts}. The video is saved: use "Post now" on the Videos page to try again.`,
    };
  }
  if (result.postFailed.length > 0) {
    return {
      ok: false,
      message: `${title} ${republish ? 'was posted to part of what was asked' : 'was made and posted'}, but ${result.postFailed.join(' and ')} did not go through. ${parts}. Use "Post to ${result.postFailed.join(' and ')}" on the Videos page to try again.`,
    };
  }
  return { ok: true, message: `${republish ? 'Posted' : 'Made and posted'} ${title} (${Math.round(result.durationSeconds)}s). ${parts}.` };
}

type Hooks = {
  onProgress: (step: string, kind?: 'running' | 'waiting_login') => void;
  onJob: (jobId: string) => void;
};

function begin(channelId: number, trigger: RunTrigger, firstStep: string): { started: false; reason: string } | { started: true; runId: string } {
  if (isRunBusy(channelId)) {
    return { started: false, reason: 'This channel is already making or posting a video. Wait for it to finish.' };
  }
  if (isAccountOpBusy(channelId)) {
    return { started: false, reason: 'A login check or account switch is in progress for this channel. Finish it first.' };
  }
  if (!getChannel(channelId)) return { started: false, reason: `Channel ${channelId} not found.` };
  if (foreignActiveRun(channelId)) {
    return { started: false, reason: 'The daily schedule is making a video for this channel right now. Wait for it to finish.' };
  }

  const runId = createRun(channelId, trigger, firstStep);
  statuses.set(channelId, { state: 'running', stage: 'login', step: firstStep, trigger, runId, startedAt: new Date().toISOString() });
  return { started: true, runId };
}

function track(channelId: number, runId: string, republish: boolean, work: (hooks: Hooks) => Promise<PipelineResult>): void {
  let jobId: string | undefined;
  const current = () => statuses.get(channelId) as RunStatus;

  const onProgress: Hooks['onProgress'] = (step, kind) => {
    const prev = current();
    if (prev.runId !== runId) return;
    const state: RunState = kind === 'waiting_login' ? 'waiting_login' : 'running';
    const stage = kind === 'waiting_login' ? prev.stage || 'login' : stageFromStep(step, prev.stage);
    statuses.set(channelId, { ...prev, state, stage, step });
    updateRun(runId, { state, stage, message: step });
  };
  const onJob: Hooks['onJob'] = (id) => {
    jobId = id;
    updateRun(runId, { jobId: id });
  };

  void work({ onProgress, onJob })
    .then((result) => {
      const { ok, message } = describeResult(result, republish);
      statuses.set(channelId, {
        ...current(),
        state: ok ? 'done' : 'error',
        stage: ok ? 'finished' : 'post',
        step: message,
        error: ok ? undefined : message,
        finishedAt: new Date().toISOString(),
        result,
      });
      updateRun(runId, { state: ok ? 'done' : 'error', stage: ok ? 'finished' : 'post', message, jobId: result.jobId, finished: true });
    })
    .catch((err: any) => {
      const cancelled = err?.code === 'RUN_CANCELLED';
      const message = cancelled ? 'Run stopped.' : err?.message || 'The run failed.';
      statuses.set(channelId, {
        ...current(),
        state: cancelled ? 'cancelled' : 'error',
        step: message,
        error: cancelled ? undefined : message,
        finishedAt: new Date().toISOString(),
      });
      updateRun(runId, { state: cancelled ? 'cancelled' : 'error', message, finished: true });
      // A video that exists but never reached the safety check or posting must not sit in "making" forever.
      if (jobId) {
        db.prepare(
          `UPDATE jobs SET state = 'failed', hold_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND state = 'rendering'`
        ).run(cancelled ? 'The run was stopped before this video was posted.' : `The run failed before this video was posted: ${message}`, jobId);
      }
    });
}

export function startRun(
  trigger: 'button' | 'schedule',
  channelId = 1,
  targetDurationSec?: number,
  targetResolution?: GrokResolution
): { started: boolean; reason?: string } {
  const b = begin(channelId, trigger, 'Opening the browser and checking your logins…');
  if (!b.started) return b;
  const channel = getChannel(channelId)!;
  const agent = getAgent(channelId);
  track(channelId, b.runId, false, (hooks) =>
    agent.runFullAutonomousPipeline({
      targetDurationSec: targetDurationSec || channel.grok_duration || 15,
      targetResolution: targetResolution || channel.grok_resolution || '720p',
      ...hooks,
    })
  );
  return { started: true };
}

/** Posts a video that already exists on disk, without making a new one. */
export function startRepublish(jobId: string): { started: boolean; reason?: string; channelId?: number } {
  const job = db.prepare('SELECT id, channel_id FROM jobs WHERE id = ?').get(jobId) as { id: string; channel_id: number | null } | undefined;
  if (!job) return { started: false, reason: 'That video no longer exists.' };
  const channelId = job.channel_id || 1;
  const b = begin(channelId, 'republish', 'Opening the browser to post an existing video…');
  if (!b.started) return { ...b, channelId };
  // Posting is the only station an existing video goes through.
  statuses.set(channelId, { ...(statuses.get(channelId) as RunStatus), stage: 'post' });
  updateRun(b.runId, { stage: 'post', jobId });
  const agent = getAgent(channelId);
  track(channelId, b.runId, true, (hooks) => agent.publishExistingVideo(jobId, hooks));
  return { started: true, channelId };
}

/** "Stop": closes the channel's browser so the run in flight ends. */
export async function cancelRun(channelId: number): Promise<{ success: boolean; message: string }> {
  if (!isRunBusy(channelId)) return { success: false, message: 'Nothing is running for this channel.' };
  const stopped = await getAgent(channelId).requestCancel();
  return stopped
    ? { success: true, message: 'Stopping the run and closing the browser window.' }
    : { success: false, message: 'The run had already finished.' };
}

/** Resolves when the current run has finished (used by the scheduled job). */
export async function waitForRun(channelId = 1, pollMs = 3000): Promise<RunStatus> {
  let st = getRunStatus(channelId);
  while (st.state === 'running' || st.state === 'waiting_login') {
    await new Promise((r) => setTimeout(r, pollMs));
    st = getRunStatus(channelId);
  }
  return st;
}
