import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { SCHEMA_SQL } from './schema';

dotenv.config();

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '../../storage/kindred_studio.db');

// Ensure storage dir exists
const storageDir = path.dirname(DB_PATH);
if (!fs.existsSync(storageDir)) {
  fs.mkdirSync(storageDir, { recursive: true });
}

export const db: Database.Database = new Database(DB_PATH);

// Enable WAL mode for high concurrency
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initDatabase() {
  db.exec(SCHEMA_SQL);

  try {
    db.exec(`ALTER TABLE settings ADD COLUMN chatgpt_chat_url TEXT NOT NULL DEFAULT ''`);
  } catch {
    // Column already exists
  }

  // Initialize singleton settings if not present
  const existingSettings = db.prepare('SELECT id FROM settings WHERE id = 1').get();
  if (!existingSettings) {
    db.prepare(`
      INSERT INTO settings (
        id, operator_name, age_band, language, timezone, daily_posts_target,
        daily_budget_usd, max_cost_per_video_usd, spent_today_usd,
        is_automation_running, is_paused_budget, demo_mode,
        revenue_creator_rewards_enabled, revenue_educational_licensing_enabled,
        revenue_brand_partnerships_enabled, updated_at
      ) VALUES (
        1, 'Adult Creator', '5-7', 'en-US', 'America/New_York', 3,
        15.00, 5.00, 0.00,
        0, 0, 1,
        1, 1, 0, CURRENT_TIMESTAMP
      )
    `).run();
  }

  // Ensure default providers are registered with disconnected status
  const defaultProviders = [
    { provider: 'jev', name: 'TypeSafe Jev (Decision Model)' },
    { provider: 'openai', name: 'OpenAI Responses API (Script Writer)' },
    { provider: 'xai', name: 'xAI Grok Imagine (Video Engine)' },
    { provider: 'buffer_tiktok', name: 'Buffer (TikTok Publisher)' },
  ];

  const insertProvider = db.prepare(`
    INSERT OR IGNORE INTO account_connections (provider, name, api_key, account_identifier, status)
    VALUES (?, ?, '', '', 'disconnected')
  `);

  for (const p of defaultProviders) {
    insertProvider.run(p.provider, p.name);
  }

  // Automatically sync environment variables from .env if present
  if (process.env.TYPESAFE_API_KEY) {
    db.prepare(`
      UPDATE account_connections
      SET api_key = ?, status = 'connected', last_tested_at = CURRENT_TIMESTAMP
      WHERE provider = 'jev'
    `).run(process.env.TYPESAFE_API_KEY);
    db.prepare('UPDATE settings SET demo_mode = 0 WHERE id = 1').run();
  }

  if (process.env.OPENAI_API_KEY) {
    db.prepare(`
      UPDATE account_connections
      SET api_key = ?, status = 'connected', last_tested_at = CURRENT_TIMESTAMP
      WHERE provider = 'openai'
    `).run(process.env.OPENAI_API_KEY);
  }

  if (process.env.XAI_API_KEY) {
    db.prepare(`
      UPDATE account_connections
      SET api_key = ?, status = 'connected', last_tested_at = CURRENT_TIMESTAMP
      WHERE provider = 'xai'
    `).run(process.env.XAI_API_KEY);
  }

  if (process.env.BUFFER_ACCESS_TOKEN) {
    db.prepare(`
      UPDATE account_connections
      SET api_key = ?, account_identifier = COALESCE(?, account_identifier), status = 'connected', last_tested_at = CURRENT_TIMESTAMP
      WHERE provider = 'buffer_tiktok'
    `).run(process.env.BUFFER_ACCESS_TOKEN, process.env.BUFFER_CHANNEL_ID || '');
  }

  // Ensure default premium children series exist
  const seriesCount = (db.prepare('SELECT COUNT(*) as count FROM series').get() as any).count;
  if (seriesCount === 0) {
    db.prepare(`
      INSERT INTO series (
        id, title, format, age_band, learning_goal, description,
        design_sheet, pronunciation_notes, palette_hex, narrator_style,
        continuity_notes, status, gross_earnings_usd
      ) VALUES (
        'ser_wonder_lab',
        'Wonder Lab: Secret Shapes & Everyday Mysteries',
        'visual_puzzle',
        '5-7',
        'Spatial deduction, geometric matching, and everyday observational wonder for young children',
        'Interactive visual riddle adventure where children spot hidden geometric patterns and everyday science wonders.',
        '{"characters": ["Pip the Curious Fox", "Wonder Box"], "setting": "Cozy sunny workshop"}',
        'Pip is pronounced with a short i.',
        '["#FF7A00", "#4A90E2", "#F5A623", "#50E3C2"]',
        'Warm, cheerful, encouraging preschool educator pacing',
        'Each episode reveals one geometric pattern and everyday science wonder.',
        'active',
        12.50
      )
    `).run();

    db.prepare(`
      INSERT INTO series (
        id, title, format, age_band, learning_goal, description,
        design_sheet, pronunciation_notes, palette_hex, narrator_style,
        continuity_notes, status, gross_earnings_usd
      ) VALUES (
        'ser_paper_dragon',
        'Paper Dragon & Shadow Puzzles',
        'visual_puzzle',
        '5-7',
        'Silhouette matching, rotational geometry, and visual deduction',
        'Charming origami dragons cast mysterious silhouettes for children to identify.',
        '{"characters": ["Origami Dragon"], "setting": "Gentle shadow play studio"}',
        'Dragon is spoken warmly.',
        '["#6C5CE7", "#A29BFE", "#FFEAA7", "#00CEC9"]',
        'Gentle, whimsical, inviting preschool storyteller',
        'Focuses on spatial silhouettes and gentle thinking pause.',
        'active',
        8.20
      )
    `).run();
  }
}

// Reset content catalog to empty state while preserving operator credentials
export function resetContentCatalog() {
  const runReset = db.transaction(() => {
    db.prepare('DELETE FROM financial_ledger').run();
    db.prepare('DELETE FROM qa_inspections').run();
    db.prepare('DELETE FROM decisions_log').run();
    db.prepare('DELETE FROM jobs').run();
    db.prepare('DELETE FROM publishing_slots').run();
    db.prepare('DELETE FROM series').run();
    db.prepare('DELETE FROM experiments').run();
    db.prepare('UPDATE settings SET spent_today_usd = 0.00 WHERE id = 1').run();
  });
  runReset();
  initDatabase();
}

export default db;

