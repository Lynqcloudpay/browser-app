import crypto from 'crypto';
import db from '../db/database';

export interface PublishingSlot {
  id: string;
  slot_date: string;
  target_time: string;
  target_timestamp_utc: string;
  min_spacing_hours: number;
  status: 'unassigned' | 'reserved' | 'ready' | 'published' | 'missed' | 'cancelled';
  assigned_job_id: string | null;
  published_at: string | null;
}

export class Scheduler {
  private static isTickLocked = false;

  /**
   * Generates or refreshes daily publishing slots for the configured timezone and posting target.
   */
  public static ensureDailySlots(): PublishingSlot[] {
    const settings = db.prepare('SELECT * FROM settings WHERE id = 1').get() as any;
    const now = new Date();
    const todayDateStr = now.toISOString().split('T')[0];

    // Check if daily budget should reset for new day
    if (settings.last_budget_reset_date !== todayDateStr) {
      db.prepare(`
        UPDATE settings
        SET spent_today_usd = 0.00,
            is_paused_budget = 0,
            last_budget_reset_date = ?
        WHERE id = 1
      `).run(todayDateStr);
    }

    const existingSlots = db.prepare(`
      SELECT * FROM publishing_slots
      WHERE slot_date = ?
      ORDER BY target_time ASC
    `).all(todayDateStr) as PublishingSlot[];

    const targetPosts = settings.daily_posts_target || 3;

    if (existingSlots.length >= targetPosts) {
      return existingSlots;
    }

    // Default 3 standard publishing slots spaced throughout the day (e.g. 10:00, 14:30, 18:30)
    const slotTimes = ['10:00', '14:30', '18:30'];
    if (targetPosts === 1) slotTimes.splice(1, 2);
    else if (targetPosts === 2) slotTimes.splice(1, 1);
    else if (targetPosts > 3) {
      // distribute evenly
      slotTimes.length = 0;
      const intervalH = 12 / targetPosts;
      for (let i = 0; i < targetPosts; i++) {
        const hour = Math.floor(9 + i * intervalH);
        slotTimes.push(`${String(hour).padStart(2, '0')}:00`);
      }
    }

    const insertSlot = db.prepare(`
      INSERT OR IGNORE INTO publishing_slots (
        id, slot_date, target_time, target_timestamp_utc, min_spacing_hours, status
      ) VALUES (?, ?, ?, ?, 3.0, 'unassigned')
    `);

    for (let i = 0; i < slotTimes.length; i++) {
      const timeStr = slotTimes[i];
      const slotId = `slot_${todayDateStr.replace(/-/g, '')}_${timeStr.replace(':', '')}`;
      const targetUtc = new Date(`${todayDateStr}T${timeStr}:00Z`).toISOString();
      insertSlot.run(slotId, todayDateStr, timeStr, targetUtc);
    }

    return db.prepare(`
      SELECT * FROM publishing_slots
      WHERE slot_date = ?
      ORDER BY target_time ASC
    `).all(todayDateStr) as PublishingSlot[];
  }

  /**
   * Anti-flood protection: Marks past unfulfilled slots as 'missed' to avoid
   * bursting or flooding the account after an outage or server pause.
   */
  public static sanitizeMissedSlots() {
    const nowIso = new Date().toISOString();
    db.prepare(`
      UPDATE publishing_slots
      SET status = 'missed'
      WHERE status = 'unassigned'
        AND target_timestamp_utc < ?
    `).run(nowIso);
  }

  /**
   * Atomically reserve spend before rendering or external calls.
   * Prevents overspending and ensures concurrent jobs do not exceed budget.
   */
  public static reserveSpend(estimatedCostUsd: number): boolean {
    const settings = db.prepare('SELECT daily_budget_usd, spent_today_usd, is_paused_budget FROM settings WHERE id = 1').get() as any;

    if (settings.is_paused_budget === 1) {
      return false;
    }

    if (settings.spent_today_usd + estimatedCostUsd > settings.daily_budget_usd) {
      // Pause budget
      db.prepare('UPDATE settings SET is_paused_budget = 1 WHERE id = 1').run();
      return false;
    }

    // Reserve spend
    db.prepare(`
      UPDATE settings
      SET spent_today_usd = spent_today_usd + ?
      WHERE id = 1
    `).run(estimatedCostUsd);

    return true;
  }

  /**
   * Lock mutex for worker execution to prevent duplicate posts across concurrent worker ticks.
   */
  public static tryAcquireLock(): boolean {
    if (this.isTickLocked) return false;
    this.isTickLocked = true;
    return true;
  }

  public static releaseLock() {
    this.isTickLocked = false;
  }
}

export default Scheduler;

