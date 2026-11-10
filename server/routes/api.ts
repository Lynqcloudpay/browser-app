import { Router } from 'express';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';
import db, { resetContentCatalog } from '../db/database';
import { startRun, getRunStatus } from '../engine/dailyRunner';
import { getSchedule, setSchedule } from '../engine/dailySchedule';
import { getPublishTargets, setPublishTargets } from '../engine/publishTargets';
import { getAccountsOverview, startCheck, startSwitch, cancelAccountOp } from '../engine/accounts';
import { AccountKey } from '../engine/accountStatus';
import ProductionWorker from '../engine/worker';
import MonetizationEngine from '../engine/monetizationEngine';
import Scheduler from '../engine/scheduler';
import JevEngine from '../engine/jevEngine';
import OpenAIWriter from '../engine/openaiWriter';
import GrokVideoGenerator from '../engine/xaiVideoGenerator';
import KidsSafetyQAInspector from '../engine/qaInspector';
import JevBrowserAgent from '../engine/jevBrowserAutomation';

export const apiRouter = Router();

// GET /api/status - Studio state, settings, connections, and active alerts
apiRouter.get('/status', (req, res) => {
  const settings = db.prepare('SELECT * FROM settings WHERE id = 1').get() as any;
  const connections = db.prepare('SELECT provider, name, account_identifier, status, last_tested_at, last_error FROM account_connections').all();
  const heldJobsCount = (db.prepare("SELECT COUNT(*) as count FROM jobs WHERE state = 'held_for_review'").get() as any).count;
  const activeJobsCount = (db.prepare("SELECT COUNT(*) as count FROM jobs WHERE state IN ('planned', 'scripting', 'rendering', 'qa_inspection', 'ready_to_publish')").get() as any).count;
  const publishedTodayCount = (db.prepare("SELECT COUNT(*) as count FROM jobs WHERE state = 'published' AND created_at >= date('now')").get() as any).count;

  res.json({
    settings,
    connections,
    metrics: {
      heldJobsCount,
      activeJobsCount,
      publishedTodayCount,
    },
  });
});

// POST /api/settings - Update operator configuration
apiRouter.post('/settings', (req, res) => {
  const {
    is_automation_running,
    daily_posts_target,
    daily_budget_usd,
    age_band,
    language,
    timezone,
    demo_mode,
    revenue_creator_rewards_enabled,
    revenue_educational_licensing_enabled,
    revenue_brand_partnerships_enabled,
    chatgpt_chat_url,
  } = req.body || {};

  db.prepare(`
    UPDATE settings
    SET is_automation_running = COALESCE(?, is_automation_running),
        daily_posts_target = COALESCE(?, daily_posts_target),
        daily_budget_usd = COALESCE(?, daily_budget_usd),
        age_band = COALESCE(?, age_band),
        language = COALESCE(?, language),
        timezone = COALESCE(?, timezone),
        demo_mode = COALESCE(?, demo_mode),
        revenue_creator_rewards_enabled = COALESCE(?, revenue_creator_rewards_enabled),
        revenue_educational_licensing_enabled = COALESCE(?, revenue_educational_licensing_enabled),
        revenue_brand_partnerships_enabled = COALESCE(?, revenue_brand_partnerships_enabled),
        chatgpt_chat_url = COALESCE(?, chatgpt_chat_url),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
  `).run(
    is_automation_running !== undefined ? (is_automation_running ? 1 : 0) : null,
    daily_posts_target,
    daily_budget_usd,
    age_band,
    language,
    timezone,
    demo_mode !== undefined ? (demo_mode ? 1 : 0) : null,
    revenue_creator_rewards_enabled !== undefined ? (revenue_creator_rewards_enabled ? 1 : 0) : null,
    revenue_educational_licensing_enabled !== undefined ? (revenue_educational_licensing_enabled ? 1 : 0) : null,
    revenue_brand_partnerships_enabled !== undefined ? (revenue_brand_partnerships_enabled ? 1 : 0) : null,
    chatgpt_chat_url !== undefined ? chatgpt_chat_url : null
  );

  res.json({ success: true, settings: db.prepare('SELECT * FROM settings WHERE id = 1').get() });
});

// POST /api/connections - Save credentials
apiRouter.post('/connections', (req, res) => {
  const { provider, api_key, account_identifier } = req.body || {};
  if (!provider) return res.status(400).json({ error: 'Provider is required' });

  const status = api_key && api_key.trim().length > 0 ? 'connected' : 'disconnected';
  db.prepare(`
    UPDATE account_connections
    SET api_key = ?,
        account_identifier = COALESCE(?, account_identifier),
        status = ?,
        last_tested_at = CURRENT_TIMESTAMP,
        last_error = NULL
    WHERE provider = ?
  `).run(api_key, account_identifier, status, provider);

  res.json({ success: true, provider, status });
});

// GET /api/slots - Publishing schedule
apiRouter.get('/slots', (req, res) => {
  Scheduler.ensureDailySlots();
  Scheduler.sanitizeMissedSlots();
  const slots = db.prepare(`
    SELECT ps.*, j.concept_title, j.state as job_state, j.video_path, j.thumbnail_path, j.tiktok_share_url
    FROM publishing_slots ps
    LEFT JOIN jobs j ON ps.assigned_job_id = j.id
    ORDER BY ps.slot_date DESC, ps.target_time ASC
  `).all();
  res.json({ slots });
});

// GET /api/series - Content Catalog
apiRouter.get('/series', (req, res) => {
  const series = db.prepare('SELECT * FROM series ORDER BY created_at DESC').all();
  res.json({ series });
});

// POST /api/series/pilot - Commission fresh pilot series with Jev
apiRouter.post('/series/pilot', async (req, res) => {
  try {
    const settings = db.prepare('SELECT * FROM settings WHERE id = 1').get() as any;
    const format = req.body.format || 'visual_puzzle';

    const state = `Operator requested commissioning a new pilot series in format: ${format}.
Target Age Band: ${settings.age_band}.
Evaluate original concept options and originate fresh characters and design sheet.`;

    const jevRes = await JevEngine.decide(state, {
      pilot_concept: {
        type: 'choice',
        instructions: 'Select concept angle for the new pilot series.',
        criteria: {
          concept_a: 'Original visual puzzle: geometric animal silhouette deductions with step reveal.',
          concept_b: 'Everyday physical wonder: micro nature patterns and gentle curiosity.',
          concept_c: 'Social-emotional cooperative story: helping forest friends solve small dilemmas.',
        },
      },
    }, { decisionType: 'originate_pilot_series' });

    const newSeriesId = 'ser_' + Date.now().toString(36);
    const title = format === 'visual_puzzle' ? 'Origami Shadow Explorers' : (format === 'simple_science' ? 'Curious Micro Lab' : 'Forest Meadow Friends');

    db.prepare(`
      INSERT INTO series (
        id, title, format, age_band, learning_goal, description,
        design_sheet, pronunciation_notes, palette_hex, narrator_style,
        continuity_notes, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pilot')
    `).run(
      newSeriesId,
      title,
      format,
      settings.age_band,
      'Early childhood cognitive reasoning and observation.',
      `Brand new original series originated by Jev (${jevRes.chosenId}).`,
      JSON.stringify({ style: 'Handmade tactile papercraft aesthetic', palette: 'High contrast pastel' }),
      'Cheerful, gentle, clear enunciation.',
      JSON.stringify(['#2A9D8F', '#E76F51', '#F4A261']),
      'Warm encouraging educator.',
      'Always 9:16 vertical framing with clear reveal payoff.'
    );

    res.json({ success: true, seriesId: newSeriesId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/series/creator-rewards-pilot - Long-form (>60s) episode with upfront budget lock
apiRouter.post('/series/creator-rewards-pilot', async (req, res) => {
  try {
    const settings = db.prepare('SELECT * FROM settings WHERE id = 1').get() as any;
    const series = db.prepare("SELECT * FROM series WHERE status IN ('pilot', 'active') LIMIT 1").get() as any;
    if (!series) {
      return res.status(400).json({ error: 'No active series found. Originate a pilot first.' });
    }

    // Creator Rewards Experiment: Verify duration requirement (> 60s) & budget complete story before render
    const estRenderCost = 0.25; // estimated 4 shots
    const reserved = Scheduler.reserveSpend(estRenderCost);
    if (!reserved) {
      return res.status(400).json({ error: 'Insufficient daily budget cap to commission Creator Rewards long-form video.' });
    }

    const state = `Creator Rewards Experiment: Commissioning >60-second episode for Series "${series.title}".
Format: ${series.format}. Multi-step progression with 4 distinct scenes.`;

    const jevChoice = await JevEngine.decide(state, {
      creator_rewards_approval: {
        type: 'choice',
        instructions: 'Confirm eligibility and approve Creator Rewards long-form storyboard budget.',
        criteria: {
          approve_long_form: 'Approve 65-second episode with 4 distinct scenes and upfront budget lock.',
          defer_test: 'Defer test to next cycle.',
        },
      },
    }, { seriesId: series.id, decisionType: 'creator_rewards_authorization' });

    const script = await OpenAIWriter.writeContent({
      format: series.format,
      ageBand: series.age_band,
      language: settings.language,
      learningGoal: series.learning_goal,
      targetDurationSec: 65,
      seriesTitle: series.title,
    });

    const jobId = 'job_cr_' + Date.now().toString(36);
    db.prepare(`
      INSERT INTO jobs (
        id, series_id, concept_title, format, age_band, hook, hypothesis,
        script_text, shot_briefs_json, captions_json, state, estimated_cost_usd,
        spend_reserved_usd, is_demo_job
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scripting', ?, ?, ?)
    `).run(
      jobId,
      series.id,
      `Creator Rewards: ${script.concept_title}`,
      series.format,
      series.age_band,
      script.hook,
      'Episodes >60s with multi-step progression qualify for Creator Rewards pool and generate higher RPM.',
      script.script_text,
      JSON.stringify(script.shot_briefs),
      JSON.stringify(script.captions),
      estRenderCost,
      estRenderCost,
      settings.demo_mode
    );

    res.json({
      success: true,
      jobId,
      title: script.concept_title,
      durationTarget: '65s (>60s Creator Rewards Qualified)',
      jevChoice: jevChoice.chosenId,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/jobs - Production jobs list
apiRouter.get('/jobs', (req, res) => {
  const { state } = req.query;
  let query = 'SELECT * FROM jobs';
  const params: any[] = [];
  if (state) {
    query += ' WHERE state = ?';
    params.push(state);
  }
  query += ' ORDER BY created_at DESC LIMIT 50';
  const jobs = db.prepare(query).all(...params);
  res.json({ jobs });
});

// GET /api/jobs/:id - Single job details with QA inspection
apiRouter.get('/jobs/:id', (req, res) => {
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id) as any;
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const qa = db.prepare('SELECT * FROM qa_inspections WHERE job_id = ? ORDER BY reviewed_at DESC LIMIT 1').get(job.id);
  const decisions = db.prepare('SELECT * FROM decisions_log WHERE job_id = ? ORDER BY created_at ASC').all(job.id);
  const ledger = db.prepare('SELECT * FROM financial_ledger WHERE job_id = ?').all(job.id);

  res.json({
    job,
    qa,
    decisions,
    ledger,
  });
});

// POST /api/jobs/:id/action - Manual QA disposition or retry
apiRouter.post('/jobs/:id/action', (req, res) => {
  const { action } = req.body;
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id) as any;
  if (!job) return res.status(404).json({ error: 'Job not found' });

  if (action === 'approve_held') {
    db.prepare("UPDATE jobs SET state = 'ready_to_publish', hold_reason = NULL WHERE id = ?").run(job.id);
    db.prepare("UPDATE qa_inspections SET reviewer_action = 'manually_approved' WHERE job_id = ?").run(job.id);
  } else if (action === 'discard') {
    db.prepare("UPDATE jobs SET state = 'rejected' WHERE id = ?").run(job.id);
    db.prepare("UPDATE qa_inspections SET reviewer_action = 'discarded' WHERE job_id = ?").run(job.id);
  }

  res.json({ success: true, state: action === 'approve_held' ? 'ready_to_publish' : 'rejected' });
});

// GET /api/decisions - Trace Log of Jev Choices
apiRouter.get('/decisions', (req, res) => {
  const decisions = db.prepare('SELECT * FROM decisions_log ORDER BY created_at DESC LIMIT 100').all();
  res.json({ decisions });
});

// GET /api/economics - Full Studio Financials & Series P&L
apiRouter.get('/economics', (req, res) => {
  MonetizationEngine.seedWeeklyExperiments();
  const summary = MonetizationEngine.getFinancialSummary();
  const experiments = db.prepare('SELECT * FROM experiments ORDER BY created_at DESC').all();

  res.json({
    summary,
    experiments,
  });
});

// POST /api/economics/revenue - Record confirmed platform or licensing payout
apiRouter.post('/economics/revenue', (req, res) => {
  const { seriesId, category, amountUsd, notes } = req.body;
  if (!seriesId || !amountUsd || !category) {
    return res.status(400).json({ error: 'seriesId, category, and amountUsd are required.' });
  }

  const ledId = 'led_rev_' + crypto.randomUUID().slice(0, 8);
  db.prepare(`
    INSERT INTO financial_ledger (
      id, series_id, category, amount_usd, is_revenue, status, is_demo_data, notes, created_at
    ) VALUES (?, ?, ?, ?, 1, 'confirmed', 0, ?, CURRENT_TIMESTAMP)
  `).run(ledId, seriesId, category, parseFloat(amountUsd), notes || 'Manual revenue entry');

  db.prepare(`
    UPDATE series
    SET gross_earnings_usd = gross_earnings_usd + ?
    WHERE id = ?
  `).run(parseFloat(amountUsd), seriesId);

  res.json({ success: true, id: ledId, seriesId, amountUsd });
});

// GET /api/economics/export - CSV Export of Itemized Financial Ledger
apiRouter.get('/economics/export', (req, res) => {
  const rows = db.prepare(`
    SELECT fl.id, fl.created_at, fl.series_id, s.title as series_title,
           fl.category, fl.amount_usd, fl.is_revenue, fl.status, fl.is_demo_data, fl.notes
    FROM financial_ledger fl
    LEFT JOIN series s ON fl.series_id = s.id
    ORDER BY fl.created_at DESC
  `).all() as any[];

  let csv = 'ID,Date,SeriesID,SeriesTitle,Category,AmountUSD,IsRevenue,Status,IsDemo,Notes\n';
  for (const r of rows) {
    csv += `"${r.id}","${r.created_at}","${r.series_id || ''}","${(r.series_title || '').replace(/"/g, '""')}","${r.category}",${r.amount_usd},${r.is_revenue},"${r.status}",${r.is_demo_data},"${(r.notes || '').replace(/"/g, '""')}"\n`;
  }

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="KindredStudio_Financial_Ledger.csv"');
  res.send(csv);
});

// POST /api/worker/tick - Trigger worker cycle manually
apiRouter.post('/worker/tick', async (req, res) => {
  const result = await ProductionWorker.executeCycle();
  res.json(result);
});

// POST /api/catalog/reset - Reset content catalog to empty state
apiRouter.post('/catalog/reset', (req, res) => {
  resetContentCatalog();
  res.json({ success: true, message: 'Content catalog has been completely emptied.' });
});

// POST /browser/open - Open visible browser window to authenticate ChatGPT & Grok
apiRouter.post('/browser/open', async (req, res) => {
  try {
    const result = await JevBrowserAgent.openInteractiveSession();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /browser/inspect - Inspect active tabs and elements
apiRouter.get('/browser/inspect', async (req, res) => {
  try {
    const result = await JevBrowserAgent.inspectSession();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /browser/detect-chatgpt - Detect and pin "Create Mr Apple Videos" conversation from ChatGPT sidebar
apiRouter.post('/browser/detect-chatgpt', async (req, res) => {
  try {
    const result = await JevBrowserAgent.detectAndSetChatGptUrl();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /browser/set-chatgpt-url - Explicitly configure the ChatGPT conversation URL
apiRouter.post('/browser/set-chatgpt-url', (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url || typeof url !== 'string' || !url.startsWith('http')) {
      return res.status(400).json({ error: 'A valid ChatGPT conversation URL starting with https:// is required.' });
    }
    JevBrowserAgent.saveChatGptUrl(url.trim());
    res.json({ success: true, url: url.trim(), message: 'ChatGPT conversation URL updated and saved.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /browser/run - ONE button: opens the browser, signs in only if needed, then ChatGPT -> Grok -> TikTok.
// Runs in the background; poll GET /browser/run-status.
apiRouter.post('/browser/run', (req, res) => {
  const trigger = req.body?.trigger === 'schedule' ? 'schedule' : 'button';
  const result = startRun(trigger, Number(req.body?.targetDurationSec) || 15);
  if (!result.started) return res.status(409).json({ error: result.reason, ...getRunStatus() });
  res.status(202).json({ started: true, ...getRunStatus() });
});

// "I'm already signed in — continue": stops the run from waiting on a sign-in it wrongly thinks is needed.
apiRouter.post('/browser/skip-login', (req, res) => {
  JevBrowserAgent.skipLoginWait();
  res.json({ success: true });
});

apiRouter.get('/browser/run-status', (req, res) => {
  res.json(getRunStatus());
});

// Accounts: see which platforms are signed in, and switch each one to a different account.
apiRouter.get('/accounts', (req, res) => {
  res.json(getAccountsOverview());
});

apiRouter.post('/accounts/check', (req, res) => {
  const r = startCheck();
  if (!r.started) return res.status(409).json({ error: r.reason, ...getAccountsOverview() });
  res.status(202).json(getAccountsOverview());
});

apiRouter.post('/accounts/cancel', (req, res) => {
  cancelAccountOp();
  res.json({ success: true });
});

apiRouter.post('/accounts/:site/switch', (req, res) => {
  const r = startSwitch(req.params.site as AccountKey);
  if (!r.started) return res.status(409).json({ error: r.reason, ...getAccountsOverview() });
  res.status(202).json(getAccountsOverview());
});

// Where videos are posted (TikTok / YouTube) and YouTube's audience + visibility choices
apiRouter.get('/publish-targets', (req, res) => {
  res.json(getPublishTargets());
});

apiRouter.post('/publish-targets', (req, res) => {
  try {
    res.json(setPublishTargets(req.body || {}));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Daily automatic posting (macOS LaunchAgent)
apiRouter.get('/schedule', (req, res) => {
  res.json(getSchedule());
});

apiRouter.post('/schedule', async (req, res) => {
  try {
    const enabled = !!req.body?.enabled;
    const times: string[] = Array.isArray(req.body?.times) ? req.body.times.map(String) : [String(req.body?.time || '10:00')];
    res.json(await setSchedule(enabled, times));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Storage Management Endpoints (View, Open in Finder, Clean to free space)
apiRouter.post('/storage/open-videos-folder', (req, res) => {
  const videosDir = path.join(__dirname, '../../storage/videos');
  if (!fs.existsSync(videosDir)) fs.mkdirSync(videosDir, { recursive: true });
  exec(`open "${videosDir}"`, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, path: videosDir });
  });
});

apiRouter.get('/storage/status', (req, res) => {
  const storageDir = path.join(__dirname, '../../storage');
  const videosDir = path.join(storageDir, 'videos');
  const framesDir = path.join(storageDir, 'frames');
  const thumbsDir = path.join(storageDir, 'thumbnails');

  const getDirSize = (dir: string) => {
    if (!fs.existsSync(dir)) return 0;
    return fs.readdirSync(dir).reduce((acc, file) => {
      try {
        const stats = fs.statSync(path.join(dir, file));
        return acc + stats.size;
      } catch {
        return acc;
      }
    }, 0);
  };

  const videosSizeBytes = getDirSize(videosDir);
  const framesSizeBytes = getDirSize(framesDir);
  const thumbsSizeBytes = getDirSize(thumbsDir);
  const totalSizeBytes = videosSizeBytes + framesSizeBytes + thumbsSizeBytes;

  const videoFiles = fs.existsSync(videosDir)
    ? fs.readdirSync(videosDir)
      .filter(f => f.endsWith('.mp4'))
      .map(f => {
        const stats = fs.statSync(path.join(videosDir, f));
        return {
          fileName: f,
          sizeBytes: stats.size,
          sizeMb: (stats.size / (1024 * 1024)).toFixed(2),
          createdAt: stats.birthtime,
          isFinal: f.startsWith('final_'),
          isShot: f.startsWith('shot_'),
        };
      })
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    : [];

  res.json({
    videosFolder: videosDir,
    totalSizeBytes,
    totalSizeMb: (totalSizeBytes / (1024 * 1024)).toFixed(1),
    videosSizeMb: (videosSizeBytes / (1024 * 1024)).toFixed(1),
    framesSizeMb: (framesSizeBytes / (1024 * 1024)).toFixed(1),
    thumbsSizeMb: (thumbsSizeBytes / (1024 * 1024)).toFixed(1),
    videoFiles,
  });
});

apiRouter.delete('/storage/videos/:fileName', (req, res) => {
  const fileName = path.basename(req.params.fileName);
  const filePath = path.join(__dirname, '../../storage/videos', fileName);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return res.json({ success: true, message: `Deleted ${fileName}` });
  }
  res.status(404).json({ error: 'File not found' });
});

apiRouter.post('/storage/clean-temp-files', (req, res) => {
  const storageDir = path.join(__dirname, '../../storage');
  const videosDir = path.join(storageDir, 'videos');
  const framesDir = path.join(storageDir, 'frames');
  let deletedCount = 0;
  let freedBytes = 0;

  if (fs.existsSync(videosDir)) {
    for (const f of fs.readdirSync(videosDir)) {
      if (f.startsWith('shot_') || f.endsWith('.srt') || f.endsWith('.vtt') || f.endsWith('.m4a') || f.endsWith('.aiff') || f.includes('dummy')) {
        try {
          const fp = path.join(videosDir, f);
          freedBytes += fs.statSync(fp).size;
          fs.unlinkSync(fp);
          deletedCount++;
        } catch { }
      }
    }
  }

  if (fs.existsSync(framesDir)) {
    for (const f of fs.readdirSync(framesDir)) {
      if (f.endsWith('.png') || f.endsWith('.jpg')) {
        try {
          const fp = path.join(framesDir, f);
          freedBytes += fs.statSync(fp).size;
          fs.unlinkSync(fp);
          deletedCount++;
        } catch { }
      }
    }
  }

  res.json({
    success: true,
    deletedCount,
    freedMb: (freedBytes / (1024 * 1024)).toFixed(2),
    message: `Cleaned up ${deletedCount} temporary files, freeing ${(freedBytes / (1024 * 1024)).toFixed(2)} MB!`,
  });
});
