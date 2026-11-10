export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  operator_name TEXT NOT NULL DEFAULT 'Adult Creator',
  age_band TEXT NOT NULL DEFAULT '5-7',
  language TEXT NOT NULL DEFAULT 'en-US',
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  daily_posts_target INTEGER NOT NULL DEFAULT 3,
  daily_budget_usd REAL NOT NULL DEFAULT 15.00,
  max_cost_per_video_usd REAL NOT NULL DEFAULT 5.00,
  spent_today_usd REAL NOT NULL DEFAULT 0.00,
  last_budget_reset_date TEXT NOT NULL DEFAULT '',
  is_automation_running INTEGER NOT NULL DEFAULT 0,
  is_paused_budget INTEGER NOT NULL DEFAULT 0,
  demo_mode INTEGER NOT NULL DEFAULT 1,
  revenue_creator_rewards_enabled INTEGER NOT NULL DEFAULT 1,
  revenue_educational_licensing_enabled INTEGER NOT NULL DEFAULT 1,
  revenue_brand_partnerships_enabled INTEGER NOT NULL DEFAULT 0,
  chatgpt_chat_url TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS account_connections (
  provider TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  api_key TEXT NOT NULL DEFAULT '',
  account_identifier TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'disconnected', -- connected, disconnected, standby, error
  last_tested_at TEXT,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS series (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  format TEXT NOT NULL, -- visual_puzzle, simple_science, kindness_story, rhythm_rhyme
  age_band TEXT NOT NULL,
  learning_goal TEXT NOT NULL,
  description TEXT NOT NULL,
  design_sheet TEXT NOT NULL, -- JSON string
  pronunciation_notes TEXT NOT NULL,
  palette_hex TEXT NOT NULL, -- JSON array
  narrator_style TEXT NOT NULL,
  continuity_notes TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pilot', -- pilot, active, paused, graduated
  total_jobs INTEGER NOT NULL DEFAULT 0,
  total_published INTEGER NOT NULL DEFAULT 0,
  total_spend_usd REAL NOT NULL DEFAULT 0.00,
  gross_earnings_usd REAL NOT NULL DEFAULT 0.00,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS publishing_slots (
  id TEXT PRIMARY KEY,
  slot_date TEXT NOT NULL, -- YYYY-MM-DD
  target_time TEXT NOT NULL, -- HH:MM
  target_timestamp_utc TEXT NOT NULL,
  min_spacing_hours REAL NOT NULL DEFAULT 3.0,
  status TEXT NOT NULL DEFAULT 'unassigned', -- unassigned, reserved, ready, published, missed, cancelled
  assigned_job_id TEXT,
  published_at TEXT
);

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
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  channel_id INTEGER,
  series_id TEXT,
  slot_id TEXT,
  concept_title TEXT NOT NULL,
  format TEXT NOT NULL,
  age_band TEXT NOT NULL,
  hook TEXT NOT NULL,
  hypothesis TEXT NOT NULL,
  script_text TEXT NOT NULL DEFAULT '',
  shot_briefs_json TEXT NOT NULL DEFAULT '[]',
  captions_json TEXT NOT NULL DEFAULT '[]',
  state TEXT NOT NULL DEFAULT 'planned', -- planned, scripting, rendering, qa_inspection, ready_to_publish, awaiting_action, scheduled, published, held_for_review, rejected, failed
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
  is_ai_generated INTEGER NOT NULL DEFAULT 1,
  awaiting_action_notes TEXT,
  is_demo_job INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (series_id) REFERENCES series(id),
  FOREIGN KEY (slot_id) REFERENCES publishing_slots(id)
);

CREATE TABLE IF NOT EXISTS decisions_log (
  id TEXT PRIMARY KEY,
  job_id TEXT,
  series_id TEXT,
  decision_type TEXT NOT NULL, -- select_series, select_hook, evaluate_script, approve_render_plan, qa_disposition, select_slot, next_experiment
  state_summary TEXT NOT NULL,
  options_json TEXT NOT NULL, -- compact candidate sets
  chosen_id TEXT NOT NULL,
  probabilities_json TEXT NOT NULL, -- probability distribution
  confidence REAL NOT NULL,
  latency_ms INTEGER NOT NULL,
  cost_usd REAL NOT NULL,
  outcome TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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

CREATE TABLE IF NOT EXISTS financial_ledger (
  id TEXT PRIMARY KEY,
  job_id TEXT,
  series_id TEXT,
  category TEXT NOT NULL, -- writing_openai, decision_jev, rendering_xai, retry_xai, publishing_hosting, revenue_creator_rewards, revenue_licensing
  amount_usd REAL NOT NULL,
  is_revenue INTEGER NOT NULL DEFAULT 0, -- 0: cost, 1: revenue
  status TEXT NOT NULL DEFAULT 'confirmed', -- estimated, reserved, confirmed, unavailable
  is_demo_data INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS experiments (
  id TEXT PRIMARY KEY,
  week_number TEXT NOT NULL,
  title TEXT NOT NULL,
  audience_need TEXT NOT NULL,
  route_to_revenue TEXT NOT NULL,
  test_plan TEXT NOT NULL,
  cost_ceiling_usd REAL NOT NULL,
  success_metric TEXT NOT NULL,
  target_metric_type TEXT NOT NULL, -- watch_time_pct, completion_rate_pct, shares_per_k_views, licensing_inquiry
  current_value REAL NOT NULL DEFAULT 0.0,
  status TEXT NOT NULL DEFAULT 'proposed', -- proposed, approved, testing, graduated, closed
  jev_verdict TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_jobs_state ON jobs(state);
CREATE INDEX IF NOT EXISTS idx_jobs_series ON jobs(series_id);
CREATE INDEX IF NOT EXISTS idx_decisions_job ON decisions_log(job_id);
CREATE INDEX IF NOT EXISTS idx_decisions_created ON decisions_log(created_at);
CREATE INDEX IF NOT EXISTS idx_ledger_series ON financial_ledger(series_id);
CREATE INDEX IF NOT EXISTS idx_ledger_job ON financial_ledger(job_id);
CREATE INDEX IF NOT EXISTS idx_slots_date ON publishing_slots(slot_date);
`;

