import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { SCHEMA_SQL, POST_MIGRATION_SQL } from './schema';
import { seedDefaultChannelIfNeeded } from '../engine/channels';
import { REPO_ROOT, STORAGE_ROOT } from '../paths';

// Load the repo's .env, not whatever .env sits in the current folder: scheduled jobs (launchd) start in the home folder.
dotenv.config({ path: path.join(REPO_ROOT, '.env') });

// A relative DATABASE_PATH (".env" ships "./storage/kindred_studio.db") is relative to the repo, never to the current
// folder. Otherwise a scheduled job opens a new, empty database in ~/storage and fails with "no such table".
const DB_PATH = process.env.DATABASE_PATH
  ? path.resolve(REPO_ROOT, process.env.DATABASE_PATH)
  : path.join(STORAGE_ROOT, 'kindred_studio.db');

// Ensure storage dir exists
const storageDir = path.dirname(DB_PATH);
if (!fs.existsSync(storageDir)) {
  fs.mkdirSync(storageDir, { recursive: true });
}

export const db: Database.Database = new Database(DB_PATH);

// Enable WAL mode for high concurrency
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/** Adds a column to an existing table when it is missing. Safe to run any number of times. */
export function addColumnIfMissing(table: string, column: string, ddl: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
}

/**
 * Creates the schema and upgrades older databases. Never drops anything; legacy tables are left in place.
 * Safe to call more than once.
 */
export function initDatabase(): void {
  db.exec(SCHEMA_SQL);

  addColumnIfMissing('jobs', 'youtube_share_url', 'TEXT');
  addColumnIfMissing('jobs', 'channel_id', 'INTEGER');
  addColumnIfMissing('jobs', 'tiktok_status', 'TEXT');
  addColumnIfMissing('jobs', 'youtube_status', 'TEXT');
  addColumnIfMissing('channels', 'keep_browser_open', 'INTEGER NOT NULL DEFAULT 1');
  addColumnIfMissing('channels', 'hold_flagged_videos', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing('channels', 'tiktok_audio', "TEXT NOT NULL DEFAULT 'original'");
  addColumnIfMissing('channels', 'tiktok_sound', "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing('channels', 'youtube_audio', "TEXT NOT NULL DEFAULT 'original'");
  addColumnIfMissing('channels', 'youtube_track', "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing('runs', 'timings_json', 'TEXT');
  addColumnIfMissing('channels', 'smart_json', 'TEXT');
  addColumnIfMissing('jobs', 'hook_score', 'REAL');
  addColumnIfMissing('jobs', 'trend', 'TEXT');
  // Smart features (server/engine/insights.ts): views per posted video, and trends with Jev's judgments.
  db.exec(`
    CREATE TABLE IF NOT EXISTS video_stats (
      channel_id INTEGER NOT NULL,
      platform TEXT NOT NULL,
      title TEXT NOT NULL,
      posted_at TEXT NOT NULL,
      posted_hour INTEGER,
      views INTEGER NOT NULL DEFAULT 0,
      likes INTEGER,
      comments INTEGER,
      job_id TEXT,
      fetched_at TEXT NOT NULL,
      PRIMARY KEY (channel_id, platform, title, posted_at)
    );
    CREATE TABLE IF NOT EXISTS trends (
      channel_id INTEGER NOT NULL,
      source TEXT NOT NULL,
      name TEXT NOT NULL,
      detail TEXT,
      views INTEGER,
      kid_safe REAL,
      fits REAL,
      fetched_at TEXT NOT NULL,
      PRIMARY KEY (channel_id, source, name)
    );
  `);
  addColumnIfMissing('trends', 'song', "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing('trends', 'moves', "TEXT NOT NULL DEFAULT ''");
  db.exec(POST_MIGRATION_SQL);

  try {
    seedDefaultChannelIfNeeded();
  } catch (err: any) {
    console.warn('[Database] Could not seed default channel:', err.message);
  }
}

export default db;
