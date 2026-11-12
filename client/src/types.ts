// Shapes of the REST API. See the API CONTRACT in the project spec.

export type RunState = 'idle' | 'running' | 'waiting_login' | 'done' | 'error' | 'cancelled';
export type RunStage = 'login' | 'chatgpt' | 'grok' | 'qa' | 'post' | 'finished';
export type RunTrigger = 'button' | 'schedule' | 'republish';

export interface RunStatus {
  state: RunState;
  stage?: RunStage;
  step: string;
  trigger?: RunTrigger;
  runId?: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  result?: any;
}

export interface Channel {
  id: number;
  name: string;
  chatgpt_chat_url: string;
  chatgpt_chat_name: string;
  grok_resolution: '480p' | '720p';
  grok_duration: 6 | 10 | 15;
  post_tiktok: boolean;
  post_youtube: boolean;
  youtube_made_for_kids: boolean;
  /** Keep the channel's browser window open between videos (on by default). */
  keep_browser_open: boolean;
  hashtag_hint: string;
  schedule_enabled: boolean;
  schedule_times: string[];
  created_at: string;
  updated_at: string;
}

export type ChannelPatch = Partial<Channel>;

/** Response of PATCH /api/channels/:id. The server may add a scheduling warning. */
export interface ChannelUpdate extends Channel {
  scheduleWarning?: string;
}

export interface ChannelStats {
  postedToday: number;
  totalVideos: number;
  heldForReview: number;
}

export interface AccountSite {
  key: string;
  name: string;
  state: 'in' | 'out' | 'unknown';
  checkedAt?: string;
}

export interface AccountOp {
  state: 'idle' | 'working' | 'waiting_login' | 'done' | 'error';
  kind?: string;
  site?: string;
  step: string;
}

export interface AccountsOverview {
  sites: AccountSite[];
  grokSettings?: Record<string, unknown>;
  op: AccountOp;
}

export interface Run {
  id: string;
  channel_id: number;
  channel_name: string;
  trigger: RunTrigger;
  state: Exclude<RunState, 'idle'>;
  stage: RunStage | null;
  message: string;
  job_id: string | null;
  started_at: string;
  finished_at: string | null;
  duration_sec: number | null;
}

/** A series pattern: fixed step, or random gaps (30 min to under 2 hours). Times are HH:MM, same day. */
export type SeriesSettings =
  | { mode: 'every'; everyMinutes: 15 | 60 | 120; start: string; end: string }
  | { mode: 'random'; start: string; end: string };

export interface ChannelView extends Channel {
  /** The series pattern, or null when the channel uses plain times. */
  schedule_series: SeriesSettings | null;
  hasReferenceImage: boolean;
  /** Whether the channel's browser window is open right now. */
  browserOpen: boolean;
  runStatus: RunStatus;
  accounts: AccountsOverview;
  stats: ChannelStats;
  lastRun: Run | null;
  nextRunAt: string | null;
}

export type VideoState =
  | 'rendering'
  | 'ready_to_publish'
  | 'scheduled'
  | 'published'
  | 'held_for_review'
  | 'rejected'
  | 'failed';

export interface QaFlag {
  issue: string;
  severity: 'critical' | 'warning';
}

export interface VideoQa {
  passed: boolean;
  score: number;
  flags: QaFlag[];
}

export interface Video {
  id: string;
  channel_id: number;
  channel_name: string;
  title: string | null;
  hook: string | null;
  prompt: string | null;
  state: VideoState;
  hold_reason: string | null;
  duration_seconds: number | null;
  video_url: string | null;
  thumbnail_url: string | null;
  file_exists: boolean;
  size_mb: number | null;
  tiktok_url: string | null;
  youtube_url: string | null;
  tiktok_status: string | null;
  youtube_status: string | null;
  qa: VideoQa | null;
  created_at: string;
  updated_at: string;
}

export interface Health {
  ok: boolean;
  name: string;
  version: string;
  startedAt: string;
  uptimeSec: number;
  pid: number;
}

export interface Overview {
  counts: {
    channels: number;
    running: number;
    waitingLogin: number;
    postedToday: number;
    heldForReview: number;
    failedToday: number;
  };
  lastRun: Run | null;
}

export interface SystemCheckItem {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  fix?: string;
}

export interface SystemCheck {
  checks: SystemCheckItem[];
}

export interface StorageUsage {
  count: number;
  sizeMb: number;
}

export interface StorageStatus {
  root: string;
  videos: StorageUsage;
  frames: StorageUsage;
  thumbnails: StorageUsage;
  profiles: StorageUsage;
  orphanVideos: StorageUsage;
  totalMb: number;
}

export interface CleanupResult {
  success: boolean;
  deletedCount: number;
  freedMb: number;
  message: string;
}
