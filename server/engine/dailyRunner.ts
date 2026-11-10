import db from '../db/database';
import JevBrowserAgent from './jevBrowserAutomation';
import { isAccountOpBusy } from './accounts';
import { getGrokSettings, GrokResolution } from './grokSettings';

/**
 * One entry point for "make and post a video", used by the Run button, the /api, and the daily scheduled job.
 * The run happens in the background; callers poll getRunStatus().
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

let status: RunStatus = { state: 'idle', step: '' };

export function getRunStatus(): RunStatus {
  return { ...status };
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
export function postedTodayCount(): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM jobs
       WHERE state IN ('published', 'scheduled')
         AND date(created_at, 'localtime') = date('now', 'localtime')`
    )
    .get() as any;
  return row?.n || 0;
}

function stageFromStep(step: string): RunStage {
  if (/sign in|login|logged/i.test(step)) return 'login';
  if (/chatgpt/i.test(step)) return 'chatgpt';
  if (/grok/i.test(step)) return 'grok';
  if (/safety|qa/i.test(step)) return 'qa';
  if (/tiktok/i.test(step)) return 'tiktok';
  return status.stage || 'login';
}

export function startRun(
  trigger: 'button' | 'schedule',
  targetDurationSec?: number,
  targetResolution?: GrokResolution
): { started: boolean; reason?: string } {
  if (status.state === 'running' || status.state === 'waiting_login') {
    return { started: false, reason: 'A video is already being produced. Wait for it to finish.' };
  }

  if (isAccountOpBusy()) {
    return { started: false, reason: 'An account change is in progress. Finish it first (Settings → Accounts).' };
  }

  const grok = getGrokSettings();
  const effDuration = targetDurationSec || grok.duration || 15;
  const effResolution = targetResolution || grok.resolution || '720p';

  const settings = db.prepare('SELECT * FROM settings WHERE id = 1').get() as any;
  const jobsSoFar = (db.prepare('SELECT COUNT(*) AS n FROM jobs').get() as any)?.n || 0;
  const theme = THEMES[jobsSoFar % THEMES.length];

  status = {
    state: 'running',
    stage: 'login',
    step: 'Opening the browser and checking your ChatGPT, Grok and TikTok logins…',
    trigger,
    startedAt: new Date().toISOString(),
  };

  void JevBrowserAgent.runFullAutonomousPipeline({
    format: theme.format,
    ageBand: settings.age_band,
    seriesTitle: theme.seriesTitle,
    creativeTopic: theme.topic,
    learningGoal: theme.goal,
    targetDurationSec: effDuration,
    targetResolution: effResolution,
    onProgress: (step, kind) => {
      status = {
        ...status,
        state: kind === 'waiting_login' ? 'waiting_login' : 'running',
        stage: stageFromStep(step),
        step,
      };
    },
  })
    .then((result) => {
      status = {
        ...status,
        state: 'done',
        stage: 'finished',
        step: `Finished: "${result.title}" (${result.durationSeconds}s) — QA ${result.qaPassed ? 'passed' : 'held for review'}, TikTok: ${result.tiktokStatus}, YouTube: ${result.youtubeStatus}.${result.postedEverywhere ? ' Browser closed — ready for the next video.' : ''}`,
        finishedAt: new Date().toISOString(),
        result,
      };
    })
    .catch((err: any) => {
      status = {
        ...status,
        state: 'error',
        step: err?.message || 'The run failed.',
        error: err?.message || 'The run failed.',
        finishedAt: new Date().toISOString(),
      };
    });

  return { started: true };
}

/** Resolves when the current run has finished (used by the scheduled job). */
export async function waitForRun(pollMs = 3000): Promise<RunStatus> {
  while (status.state === 'running' || status.state === 'waiting_login') {
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return getRunStatus();
}
