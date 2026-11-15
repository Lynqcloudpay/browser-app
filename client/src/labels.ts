import type { AccountsOverview, Channel, RunState, RunStage, RunStatus, RunTrigger, VideoState } from './types';

export interface StageInfo {
  key: Exclude<RunStage, 'finished'>;
  label: string;
}

export const STAGES: StageInfo[] = [
  { key: 'login', label: 'Sign-in' },
  { key: 'chatgpt', label: 'Prompt' },
  { key: 'grok', label: 'Video' },
  { key: 'qa', label: 'Safety check' },
  { key: 'post', label: 'Post' },
];

export function stageLabel(stage: RunStage | null | undefined): string {
  if (!stage) return '';
  if (stage === 'finished') return 'Finished';
  return STAGES.find((s) => s.key === stage)?.label ?? stage;
}

export const RUN_STATE_LABEL: Record<RunState, string> = {
  idle: 'Idle',
  running: 'Running',
  waiting_login: 'Waiting for sign-in',
  done: 'Done',
  error: 'Failed',
  cancelled: 'Stopped',
};

export const RUN_TRIGGER_LABEL: Record<RunTrigger, string> = {
  button: 'You',
  schedule: 'Daily schedule',
  republish: 'Republish',
};

export const VIDEO_STATE_LABEL: Record<VideoState, string> = {
  rendering: 'Making',
  ready_to_publish: 'Ready to post',
  scheduled: 'Posting unconfirmed',
  published: 'Posted',
  held_for_review: 'Needs review',
  rejected: 'Discarded',
  failed: 'Failed',
};

/** Login sites in display order. Keys follow the account endpoints. */
export const LOGIN_SITES: { key: string; label: string }[] = [
  { key: 'chatgpt', label: 'ChatGPT' },
  { key: 'grok', label: 'Grok' },
  { key: 'tiktok', label: 'TikTok' },
  { key: 'youtube', label: 'YouTube' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'facebook', label: 'Facebook' },
];

export function isRunBusy(run: Pick<RunStatus, 'state'> | null | undefined): boolean {
  return run?.state === 'running' || run?.state === 'waiting_login';
}

export function isAccountBusy(acc: AccountsOverview | null | undefined): boolean {
  return acc?.op.state === 'working' || acc?.op.state === 'waiting_login';
}

/** Human list of enabled posting destinations, or "" when nothing is on. */
export function platformsText(ch: Pick<Channel, 'post_tiktok' | 'post_youtube' | 'post_instagram' | 'post_facebook'>): string {
  const names = [
    ch.post_tiktok ? 'TikTok' : '',
    ch.post_youtube ? 'YouTube Shorts' : '',
    ch.post_instagram ? 'Instagram Reels' : '',
    ch.post_facebook ? 'Facebook Reels' : '',
  ].filter(Boolean);
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}
