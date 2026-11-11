import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { SCHEMA_SQL, POST_MIGRATION_SQL } from './schema';
import { seedDefaultChannelIfNeeded } from '../engine/channels';
import { STORAGE_ROOT } from '../paths';

dotenv.config();

const DB_PATH = process.env.DATABASE_PATH || path.join(STORAGE_ROOT, 'kindred_studio.db');

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
  addColumnIfMissing('runs', 'timings_json', 'TEXT');
  db.exec(POST_MIGRATION_SQL);

  try {
    seedDefaultChannelIfNeeded();
  } catch (err: any) {
    console.warn('[Database] Could not seed default channel:', err.message);
  }
}

export default db;
