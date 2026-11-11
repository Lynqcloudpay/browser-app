/**
 * Current schema. Only the tables the live browser flow uses: channels, jobs and qa_inspections.
 * Old databases may still carry legacy tables (settings, series, publishing_slots, ...). They are left untouched.
 * Columns added after the first release of `jobs` are created by database.ts (addColumnIfMissing), so this file
 * only describes fresh databases.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  chatgpt_chat_url TEXT NOT NULL DEFAULT '',
  chatgpt_chat_name TEXT NOT NULL DEFAULT '',
  grok_resolution TEXT NOT NULL DEFAULT '720p',
  grok_duration INTEGER NOT NULL DEFAULT 15,
  post_tiktok INTEGER NOT NULL DEFAULT 1,
  post_youtube INTEGER NOT NULL DEFAULT 1,
  youtube_made_for_kids INTEGER NOT NULL DEFAULT 1,
  hashtag_hint TEXT NOT NULL DEFAULT '',
  schedule_enabled INTEGER NOT NULL DEFAULT 0,
  schedule_times TEXT NOT NULL DEFAULT '[]',
  keep_browser_open INTEGER NOT NULL DEFAULT 1, -- keep the channel's browser window open between videos
  hold_flagged_videos INTEGER NOT NULL DEFAULT 0, -- 1: a safety-check hit holds the video for a person; 0: post anyway, record it
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  channel_id INTEGER,
  series_id TEXT,
  slot_id TEXT,
  concept_title TEXT NOT NULL,
  format TEXT NOT NULL DEFAULT 'short',
  age_band TEXT NOT NULL DEFAULT 'all',
  hook TEXT NOT NULL DEFAULT '',
  hypothesis TEXT NOT NULL DEFAULT '',
  script_text TEXT NOT NULL DEFAULT '',
  shot_briefs_json TEXT NOT NULL DEFAULT '[]',
  captions_json TEXT NOT NULL DEFAULT '[]',
  state TEXT NOT NULL DEFAULT 'planned', -- rendering, ready_to_publish, scheduled, published, held_for_review, rejected, failed
  hold_reason TEXT,
  hold_timestamp_sec REAL,
  estimated_cost_usd REAL NOT NULL DEFAULT 0.00,
  spend_reserved_usd REAL NOT NULL DEFAULT 0.00,
  actual_cost_usd REAL NOT NULL DEFAULT 0.00,
  video_path TEXT,
  thumbnail_path TEXT,
  duration_seconds REAL,
  buffer_post_id TEXT,
  tiktok_share_url TEXT,
  youtube_share_url TEXT,
  tiktok_status TEXT,
  youtube_status TEXT,
  is_ai_generated INTEGER NOT NULL DEFAULT 1,
  awaiting_action_notes TEXT,
  is_demo_job INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS qa_inspections (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  passed INTEGER NOT NULL,
  overall_score REAL NOT NULL,
  flagged_reasons_json TEXT NOT NULL DEFAULT '[]',
  sampled_frames_json TEXT NOT NULL DEFAULT '[]',
  kids_safe_score REAL NOT NULL,
  audio_clarity_score REAL NOT NULL,
  visual_coherence_score REAL NOT NULL,
  reviewer_action TEXT NOT NULL DEFAULT 'auto_passed', -- auto_passed, held, manually_approved, discarded
  reviewed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  channel_id INTEGER NOT NULL,
  trigger TEXT NOT NULL DEFAULT 'button',   -- button, schedule, republish
  state TEXT NOT NULL DEFAULT 'running',    -- running, waiting_login, done, error, cancelled
  stage TEXT NOT NULL DEFAULT 'login',      -- login, chatgpt, grok, qa, post, finished
  message TEXT NOT NULL DEFAULT '',
  job_id TEXT,
  pid INTEGER,                              -- process doing the run, to tell a live run from an interrupted one
  started_at TEXT NOT NULL,                 -- ISO-8601 UTC
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_jobs_state ON jobs(state);
CREATE INDEX IF NOT EXISTS idx_runs_channel ON runs(channel_id, started_at);
`;

/** Indexes that need columns which old databases only receive in the migrations, so they run after those. */
export const POST_MIGRATION_SQL = `
CREATE INDEX IF NOT EXISTS idx_jobs_channel ON jobs(channel_id, created_at);
`;
