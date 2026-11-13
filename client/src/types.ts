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
  /** TikTok audio: Grok's own sound, the channel's song, or a sound from TikTok's library. */
  tiktok_audio: 'original' | 'my_song' | 'tiktok_sound';
  /** TikTok library sound to search for, e.g. "Chicken Banana - Crazy Music Channel". */
  tiktok_sound: string;
  /** YouTube audio: Grok's own sound, the channel's song, or a track from YouTube's free Audio Library. */
  youtube_audio: 'original' | 'my_song' | 'youtube_library';
  /** Credit line added to the YouTube description for an Audio Library track. */
  youtube_track: string;
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

export interface AudioFileInfo {
  name: string;
  bytes: number;
}

export interface ChannelView extends Channel {
  /** The series pattern, or null when the channel uses plain times. */
  schedule_series: SeriesSettings | null;
  /** The channel's own song, mixed under its videos. */
  songFile: AudioFileInfo | null;
  /** A track downloaded from YouTube's free Audio Library, used for YouTube. */
  youtubeTrackFile: AudioFileInfo | null;
  /** ffmpeg is installed, so audio can be changed. */
  audioToolsReady: boolean;
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

/** Smart features switches, per channel. Off means the app works exactly as before. */
export interface SmartSettings {
  enabled: boolean;
  collect: boolean;
  smartPrompts: boolean;
  hookCheck: boolean;
  bestTimes: boolean;
  soundRotation: boolean;
  sounds: string[];
  firstComment: boolean;
  comments: string[];
}

export interface TrendRow {
  source: string;
  name: string;
  detail: string;
  views: number | null;
  kid_safe: number | null;
  fits: number | null;
  usable: boolean;
  fetched_at: string;
}

export interface InsightVideo {
  title: string;
  job_id: string | null;
  tiktok_views: number;
  youtube_views: number;
  likes: number;
  comments: number;
  views: number;
  posted_at: string;
  hook_score: number | null;
}

export interface Insights {
  settings: SmartSettings;
  jevReady: boolean;
  collectedAt: string | null;
  privateAccount: boolean;
  trends: TrendRow[];
  videos: InsightVideo[];
  bestHours: Array<{ hour: number; avgViews: number }>;
  nextMessage: string;
  refresh: { state: 'running' | 'done' | 'error'; message: string; at: string } | null;
}
