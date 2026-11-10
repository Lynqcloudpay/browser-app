import db from '../db/database';
import { getAgent } from './agentRegistry';
import { isAccountOpBusy } from './accounts';
import { GrokResolution } from './grokSettings';
import { getChannel } from './channels';

/**
 * One entry point for "make and post a video", used by the Run button, the /api, and the daily scheduled job.
 * Runs per-channel in the background; callers poll getRunStatus(channelId).
 */

export type RunState = 'idle' | 'running' | 'waiting_login' | 'done' | 'error';
export type RunStage = 'login' | 'chatgpt' | 'grok' | 'qa' | 'tiktok' | 'finished';

export interface RunStatus {
  state: RunState;
  stage?: RunStage;
  step: string;
  trigger?: 'button' | 'schedule';
  startedAt?: string;
  finishedAt?: string;
  result?: any;
  error?: string;
}

const statuses = new Map<number, RunStatus>();

export function getRunStatus(channelId = 1): RunStatus {
  return statuses.get(channelId) || { state: 'idle', step: '' };
}

export function getAllRunStatuses(): Record<number, RunStatus> {
  const out: Record<number, RunStatus> = {};
  for (const [id, st] of statuses.entries()) {
    out[id] = { ...st };
  }
  return out;
}

const THEMES = [
  {
    seriesTitle: 'Wonder Lab: Secret Shapes & Everyday Mysteries',
    format: 'visual_puzzle',
    topic: 'The Glowing Sea Shell Mystery: A curious baby sea otter finding magical swirling shell patterns under bioluminescent waves',
    goal: 'Marine curiosity, color patterns, and underwater shape matching',
  },
  {
    seriesTitle: 'Wonder Lab: Secret Shapes & Everyday Mysteries',
    format: 'visual_puzzle',
    topic: 'The Little Star Rover: A friendly cartoon robot discovering sparkling geometric crystal shapes on a candy galaxy moon',
    goal: 'Astronomy curiosity, rotational shape matching, and playful discovery',
  },
  {
    seriesTitle: 'Paper Dragon & Shadow Puzzles',
    format: 'visual_puzzle',
    topic: 'The Enchanted Forest Bakery: A cute baby hedgehog baking rainbow berry tarts with secret leaf shape stamps',
    goal: 'Sequencing, sensory observation, and nature silhouettes',
  },
  {
    seriesTitle: 'Paper Dragon & Shadow Puzzles',
    format: 'visual_puzzle',
    topic: 'The Detective Dinosaur: A joyful baby Triceratops following mysterious glowing footprint tracks through giant ferns',
    goal: 'Size comparison, deductive tracking, and fossil clue puzzles',
  },
  {
    seriesTitle: 'Wonder Lab: Secret Shapes & Everyday Mysteries',
    format: 'visual_puzzle',
    topic: 'The Clockwork Cloud Castle: A playful winged dragon sorting bouncing star-shaped wind-up gears',
    goal: 'Mechanical cause-and-effect, sorting logic, and celebratory problem solving',
  },
  {
    seriesTitle: 'Wonder Lab: Secret Shapes & Everyday Mysteries',
    format: 'visual_puzzle',
    topic: 'The Rainbow Dewdrop Garden: Dancing water droplets on giant clover leaves reflecting hidden garden creatures',
    goal: 'Visual deduction, color reflection, and gentle pattern recognition',
  },
];

/** How many videos were published/scheduled today (Mac local time) — manual and scheduled runs both count. */
export function postedTodayCount(channelId?: number): number {
  if (channelId !== undefined) {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS n FROM jobs
         WHERE state IN ('published', 'scheduled')
           AND channel_id = ?
           AND date(created_at, 'localtime') = date('now', 'localtime')`
      )
      .get(channelId) as any;
    return row?.n || 0;
  }
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM jobs
       WHERE state IN ('published', 'scheduled')
         AND date(created_at, 'localtime') = date('now', 'localtime')`
    )
    .get() as any;
  return row?.n || 0;
}

function stageFromStep(step: string, currentStage?: RunStage): RunStage {
  if (/sign in|login|logged/i.test(step)) return 'login';
  if (/chatgpt/i.test(step)) return 'chatgpt';
  if (/grok/i.test(step)) return 'grok';
  if (/safety|qa/i.test(step)) return 'qa';
  if (/tiktok/i.test(step)) return 'tiktok';
  return currentStage || 'login';
}

export function startRun(
  trigger: 'button' | 'schedule',
  channelId = 1,
  targetDurationSec?: number,
  targetResolution?: GrokResolution
): { started: boolean; reason?: string } {
  const current = getRunStatus(channelId);
  if (current.state === 'running' || current.state === 'waiting_login') {
    return { started: false, reason: 'A video is already being produced for this channel. Wait for it to finish.' };
  }

  if (isAccountOpBusy(channelId)) {
    return { started: false, reason: 'An account change is in progress for this channel. Finish it first (Settings → Accounts).' };
  }

  const channel = getChannel(channelId);
  if (!channel) return { started: false, reason: `Channel ${channelId} not found.` };

  const effDuration = targetDurationSec || channel.grok_duration || 15;
  const effResolution = targetResolution || channel.grok_resolution || '720p';

  const settings = db.prepare('SELECT * FROM settings WHERE id = 1').get() as any;
  const jobsSoFar = (db.prepare('SELECT COUNT(*) AS n FROM jobs WHERE channel_id = ?').get(channelId) as any)?.n || 0;
  const theme = THEMES[jobsSoFar % THEMES.length];

  let status: RunStatus = {
    state: 'running',
    stage: 'login',
    step: 'Opening the browser and checking your ChatGPT, Grok and TikTok logins…',
    trigger,
    startedAt: new Date().toISOString(),
  };
  statuses.set(channelId, status);

  const agent = getAgent(channelId);
  void agent.runFullAutonomousPipeline({
    format: theme.format,
    ageBand: settings.age_band,
    seriesTitle: theme.seriesTitle,
    creativeTopic: theme.topic,
    learningGoal: theme.goal,
    targetDurationSec: effDuration,
    targetResolution: effResolution,
    onProgress: (step, kind) => {
      const prev = statuses.get(channelId) || status;
      statuses.set(channelId, {
        ...prev,
        state: kind === 'waiting_login' ? 'waiting_login' : 'running',
        stage: stageFromStep(step, prev.stage),
        step,
      });
    },
  })
    .then((result) => {
      const prev = statuses.get(channelId) || status;
      statuses.set(channelId, {
        ...prev,
        state: 'done',
        stage: 'finished',
        step: `Finished: "${result.title}" (${result.durationSeconds}s) — QA ${result.qaPassed ? 'passed' : 'held for review'}, TikTok: ${result.tiktokStatus}, YouTube: ${result.youtubeStatus}.${result.postedEverywhere ? ' Browser closed — ready for the next video.' : ''}`,
        finishedAt: new Date().toISOString(),
        result,
      });
    })
    .catch((err: any) => {
      const prev = statuses.get(channelId) || status;
      statuses.set(channelId, {
        ...prev,
        state: 'error',
        step: err?.message || 'The run failed.',
        error: err?.message || 'The run failed.',
        finishedAt: new Date().toISOString(),
      });
    });

  return { started: true };
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
