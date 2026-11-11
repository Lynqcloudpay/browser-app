import db from '../db/database';
import { getAgent } from './agentRegistry';
import { isAccountOpBusy } from './accounts';
import { GrokResolution } from './types';
import { getChannel } from './channels';
import { execFile } from 'child_process';
import { PipelineResult, isRetryableError, shortReason, ChannelBrowserAgent } from './jevBrowserAutomation';
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

// ───────────────────────── Unattended recovery ─────────────────────────

/** A single attempt that runs longer than this is stuck (a normal run takes 4–8 minutes): the browser is closed. */
export const ATTEMPT_LIMIT_MS = 25 * 60 * 1000;
/** Pause before starting over after a failure that happened before any video existed. */
export const RETRY_DELAY_MS = 60 * 1000;
/** Pause before posting again to a platform that failed. */
export const REPOST_DELAY_MS = 2 * 60 * 1000;

const stopRequested = new Set<number>();

function stoppedError(): Error {
  const err: any = new Error('Run stopped.');
  err.code = 'RUN_CANCELLED';
  return err;
}

/** Waits, but gives up at once if the operator pressed Stop. */
async function pause(channelId: number, ms: number): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (stopRequested.has(channelId)) throw stoppedError();
    await new Promise((r) => setTimeout(r, Math.min(1000, until - Date.now())));
  }
  if (stopRequested.has(channelId)) throw stoppedError();
}

/** Runs one attempt with a time limit: when it is exceeded the browser is closed, which ends the stuck step. */
async function withTimeLimit<T>(agent: ChannelBrowserAgent, work: () => Promise<T>): Promise<T> {
  const timer = setTimeout(() => {
    console.warn(`[runner] Channel ${agent.channelId}: attempt passed ${ATTEMPT_LIMIT_MS / 60000} minutes — closing the browser.`);
    void agent.requestCancel('timeout');
  }, ATTEMPT_LIMIT_MS);
  try {
    return await work();
  } finally {
    clearTimeout(timer);
  }
}

/** Which platforms of a finished pipeline are worth an automatic second post (never one that may already be up). */
export function platformsToRepost(result: PipelineResult): string[] {
  if (!result.qaPassed) return [];
  return result.postFailed.filter((name) => {
    const status = name === 'TikTok' ? result.tiktokStatus : result.youtubeStatus;
    return status === 'failed';
  });
}

/** Combines the first pipeline result with a later re-post of the same video. */
export function mergeRepost(first: PipelineResult, again: PipelineResult): PipelineResult {
  const accepted = (s: string) => s === 'published' || s === 'submitted';
  const tiktokStatus = accepted(again.tiktokStatus) || !accepted(first.tiktokStatus) ? again.tiktokStatus : first.tiktokStatus;
  const youtubeStatus = accepted(again.youtubeStatus) || !accepted(first.youtubeStatus) ? again.youtubeStatus : first.youtubeStatus;
  const failed = [
    first.postFailed.includes('TikTok') && !accepted(tiktokStatus) ? 'TikTok' : '',
    first.postFailed.includes('YouTube') && !accepted(youtubeStatus) ? 'YouTube' : '',
  ].filter(Boolean);
  return {
    ...first,
    tiktokStatus,
    youtubeStatus,
    tiktokVerified: first.tiktokVerified || again.tiktokVerified,
    youtubeVerified: first.youtubeVerified || again.youtubeVerified,
    tiktokUrl: again.tiktokUrl || first.tiktokUrl,
    youtubeUrl: again.youtubeUrl || first.youtubeUrl,
    postedAnywhere: first.postedAnywhere || again.postedAnywhere,
    postedEverywhere: failed.length === 0 && (first.postedEverywhere || again.postedEverywhere),
    postFailed: failed,
  };
}

/** Shows a macOS notification so a failure in an unattended run is seen. Silent in tests and off macOS. */
function notify(title: string, message: string): void {
  if (process.platform !== 'darwin' || process.env.KINDRED_NO_NOTIFY === '1') return;
  const esc = (t: string) => t.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  execFile('osascript', ['-e', `display notification "${esc(message.slice(0, 200))}" with title "${esc(title)}"`], () => {});
}

/**
 * Make and post one video without a person: one full retry with a fresh browser when the failure came before a video
 * existed (nothing spent on Grok, nothing posted), and one automatic re-post to a platform whose upload failed.
 */
async function makeVideoUnattended(
  channelId: number,
  agent: ChannelBrowserAgent,
  options: { targetDurationSec: number; targetResolution: GrokResolution },
  hooks: Hooks
): Promise<PipelineResult> {
  for (let attempt = 1; ; attempt++) {
    let videoMade = false;
    const onJob = (id: string) => {
      videoMade = true;
      hooks.onJob(id);
    };
    try {
      let result = await withTimeLimit(agent, () => agent.runFullAutonomousPipeline({ ...options, onProgress: hooks.onProgress, onJob }));
      const repost = platformsToRepost(result);
      if (repost.length) {
        hooks.onProgress(`${repost.join(' and ')} did not post. Posting it again in 2 minutes…`);
        await pause(channelId, REPOST_DELAY_MS);
        try {
          const again = await withTimeLimit(agent, () => agent.publishExistingVideo(result.jobId, { onProgress: hooks.onProgress, onJob }));
          result = mergeRepost(result, again);
        } catch (err: any) {
          if (err?.code === 'RUN_CANCELLED') throw err;
          console.warn(`[runner] Channel ${channelId}: automatic re-post failed: ${err?.message}`);
        }
      }
      return result;
    } catch (err: any) {
      if (stopRequested.has(channelId) || err?.code === 'RUN_CANCELLED') throw stoppedError();
      if (attempt >= 2 || videoMade || !isRetryableError(err)) throw err;
      console.warn(`[runner] Channel ${channelId}: attempt ${attempt} failed before a video existed, starting over: ${err?.message}`);
      hooks.onProgress(`Something went wrong (${shortReason(err)}). Starting over in 1 minute with a fresh browser…`);
      await agent.shutdown().catch(() => {});
      await pause(channelId, RETRY_DELAY_MS);
      hooks.onProgress('Starting over: opening the browser and checking your logins…');
    }
  }
}

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
  stopRequested.delete(channelId);
  statuses.set(channelId, { state: 'running', stage: 'login', step: firstStep, trigger, runId, startedAt: new Date().toISOString() });
  return { started: true, runId };
}

function track(channelId: number, runId: string, republish: boolean, work: (hooks: Hooks) => Promise<PipelineResult>): void {
  let jobId: string | undefined;
  const current = () => statuses.get(channelId) as RunStatus;

  // Time spent in each station, so slow steps show up in the run history ("timings") and the server log.
  const timings: Record<string, number> = {};
  let timedStage: RunStage = current().stage || 'login';
  let stageStartedAt = Date.now();
  const closeStage = (next?: RunStage) => {
    const seconds = Math.round((Date.now() - stageStartedAt) / 1000);
    timings[timedStage] = (timings[timedStage] || 0) + seconds;
    console.log(`[timing] channel ${channelId} ${timedStage}: ${seconds}s`);
    if (next) timedStage = next;
    stageStartedAt = Date.now();
  };

  const onProgress: Hooks['onProgress'] = (step, kind) => {
    const prev = current();
    if (prev.runId !== runId) return;
    const state: RunState = kind === 'waiting_login' ? 'waiting_login' : 'running';
    const stage = kind === 'waiting_login' ? prev.stage || 'login' : stageFromStep(step, prev.stage);
    if (stage !== timedStage) closeStage(stage);
    statuses.set(channelId, { ...prev, state, stage, step });
    updateRun(runId, { state, stage, message: step, timings });
  };
  const onJob: Hooks['onJob'] = (id) => {
    jobId = id;
    updateRun(runId, { jobId: id });
  };

  void work({ onProgress, onJob })
    .then((result) => {
      closeStage();
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
      updateRun(runId, { state: ok ? 'done' : 'error', stage: ok ? 'finished' : 'post', message, jobId: result.jobId, finished: true, timings });
      stopRequested.delete(channelId);
      if (!ok && current().trigger !== 'schedule') notify(`${getChannel(channelId)?.name || 'Channel'}: posting failed`, message);
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
      closeStage();
      updateRun(runId, { state: cancelled ? 'cancelled' : 'error', message, finished: true, timings });
      stopRequested.delete(channelId);
      // The scheduled job sends its own notification.
      if (!cancelled && current().trigger !== 'schedule') notify(`${getChannel(channelId)?.name || 'Channel'}: video failed`, shortReason(err));
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
    makeVideoUnattended(
      channelId,
      agent,
      {
        targetDurationSec: targetDurationSec || channel.grok_duration || 15,
        targetResolution: targetResolution || channel.grok_resolution || '720p',
      },
      hooks
    )
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
  track(channelId, b.runId, true, (hooks) => withTimeLimit(agent, () => agent.publishExistingVideo(jobId, hooks)));
  return { started: true, channelId };
}

/** "Stop": closes the channel's browser so the run in flight ends. */
export async function cancelRun(channelId: number): Promise<{ success: boolean; message: string }> {
  if (!isRunBusy(channelId)) return { success: false, message: 'Nothing is running for this channel.' };
  stopRequested.add(channelId);
  await getAgent(channelId).requestCancel('user');
  return { success: true, message: 'Stopping the run and closing the browser window.' };
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
