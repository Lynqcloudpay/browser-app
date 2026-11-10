import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import db from '../db/database';
import JevEngine, { JevQuestionChoice } from './jevEngine';
import OpenAIWriter from './openaiWriter';
import GrokVideoGenerator from './xaiVideoGenerator';
import KidsSafetyQAInspector from './qaInspector';
import BufferTikTokPublisher from './bufferPublisher';
import Scheduler from './scheduler';

export class ProductionWorker {
  private static isRunning = false;

  /**
   * Run one full execution cycle of the Jev Production Decision Loop.
   */
  public static async executeCycle(): Promise<{ status: string; message: string; jobId?: string }> {
    const settings = db.prepare('SELECT * FROM settings WHERE id = 1').get() as any;

    if (settings.is_automation_running === 0) {
      return { status: 'idle', message: 'Studio automation is currently switched off.' };
    }

    if (settings.is_paused_budget === 1) {
      return { status: 'paused_budget', message: 'Daily budget cap reached ($15.00). Automation paused.' };
    }

    if (!Scheduler.tryAcquireLock()) {
      return { status: 'locked', message: 'Another worker cycle is currently active.' };
    }

    try {
      // 1. Ensure slots are populated and sanitize missed slots
      Scheduler.ensureDailySlots();
      Scheduler.sanitizeMissedSlots();

      // 2. Cold Start Check: If content catalog is empty, let Jev originate the initial series
      const seriesCount = db.prepare('SELECT COUNT(*) as count FROM series').get() as { count: number };
      if (seriesCount.count === 0) {
        const newSeriesId = await this.jevColdStartSeriesOrigination(settings);
        Scheduler.releaseLock();
        return { status: 'cold_start_initialized', message: `Jev created new pilot series: ${newSeriesId}` };
      }

      // 3. Find existing in-progress job or initiate a new job for an open slot
      let activeJob = db.prepare(`
        SELECT * FROM jobs
        WHERE state IN ('planned', 'scripting', 'rendering', 'qa_inspection', 'ready_to_publish')
        ORDER BY created_at ASC
        LIMIT 1
      `).get() as any;

      if (!activeJob) {
        // Find next open publishing slot for today
        const openSlot = db.prepare(`
          SELECT * FROM publishing_slots
          WHERE status = 'unassigned'
          ORDER BY target_time ASC
          LIMIT 1
        `).get() as any;

        if (!openSlot) {
          Scheduler.releaseLock();
          return { status: 'no_slots_available', message: 'All scheduled slots for today are filled or published.' };
        }

        // Commission a new job for the slot
        activeJob = await this.jevCreateNewJob(openSlot, settings);
      }

      // 4. Progress active job through the typed decision loop step
      const result = await this.stepJob(activeJob, settings);
      Scheduler.releaseLock();
      return result;
    } catch (err: any) {
      Scheduler.releaseLock();
      console.error('[ProductionWorker] Error in execution cycle:', err.message);
      return { status: 'error', message: err.message };
    }
  }

  /**
   * Cold start: Jev selects the inaugural pilot format from original clean templates.
   */
  private static async jevColdStartSeriesOrigination(settings: any): Promise<string> {
    const state = `Cold Start: Content catalog is completely empty.
Operator configuration:
- Age band: ${settings.age_band} (Target developmental range)
- Language: ${settings.language}
- Daily target: ${settings.daily_posts_target} posts
- Permitted revenue sources: TikTok Creator Rewards, Educational Licensing
Select the initial original kids series format to establish the channel concept.`;

    const question: JevQuestionChoice = {
      type: 'choice',
      instructions: 'Which original kids format template should be selected for the inaugural pilot series?',
      criteria: {
        visual_puzzle: 'Interactive Visual Puzzles: e.g. "Which shadow belongs to the paper dragon?" with 3-5s thinking room and satisfying reveal.',
        simple_science: 'Everyday Science Wonders: e.g. "Why are bubbles always round?" physical demonstration of surface tension.',
        kindness_story: 'Short Character Kindness Tales: e.g. "The Snail\'s Rainy Day Crossing" teaching empathy and quiet patience.',
      },
    };

    const jevDecision = await JevEngine.decide(state, { inaugural_format: question }, {
      decisionType: 'cold_start_series_selection',
    });

    const chosenFormat = jevDecision.chosenId;
    let seriesData = {
      id: 'ser_origami_dragons',
      title: 'Paper Dragon & Shadow Puzzles',
      format: 'visual_puzzle',
      age_band: settings.age_band,
      learning_goal: 'Spatial reasoning, rotational geometry, and visual deduction for young minds.',
      description: 'Charming origami paper dragons and whimsical animals challenge young viewers to match 3D shapes to their cast shadows before a magical rotating reveal.',
      design_sheet: JSON.stringify({
        primary_character: 'Emerald Origami Dragon with curved horns and gentle smiling expression',
        tabletop_texture: 'Warm honey birch wood',
        lighting: 'Soft directional studio key light creating sharp, clean shadows',
      }),
      pronunciation_notes: 'Slow, playful, melodic cadence. Clear pauses between clue descriptions.',
      palette_hex: JSON.stringify(['#2D68C4', '#F4A261', '#E76F51', '#2A9D8F']),
      narrator_style: 'Warm, encouraging preschool educator with cheerful curiosity.',
      continuity_notes: 'Always maintain 9:16 vertical framing, origami paper fold lines, and golden sparkle reveal.',
    };

    if (chosenFormat === 'simple_science') {
      seriesData = {
        id: 'ser_bubble_science',
        title: 'Wonder Lab: Everyday Science',
        format: 'simple_science',
        age_band: settings.age_band,
        learning_goal: 'Fundamental physics and chemistry concepts observed through playful hands-on questions.',
        description: 'Vibrant studio demonstrations showing children the invisible rules of nature—like surface tension, capillary action, and rainbows.',
        design_sheet: JSON.stringify({
          props: 'Pastel yellow and turquoise bubble wands, clear glass beakers',
          lighting: 'Bright sunny morning light highlighting iridescent soapy films',
        }),
        pronunciation_notes: 'Enthusiastic, wonder-filled, clear scientific terms explained simply.',
        palette_hex: JSON.stringify(['#06D6A0', '#118AB2', '#FFD166', '#EF476F']),
        narrator_style: 'Curious, friendly science explorer.',
        continuity_notes: 'Always verify facts against standard elementary physics benchmarks.',
      };
    } else if (chosenFormat === 'kindness_story') {
      seriesData = {
        id: 'ser_snail_kindness',
        title: 'Pip & Friends: Tiny Garden Acts',
        format: 'kindness_story',
        age_band: settings.age_band,
        learning_goal: 'Empathy, emotional regulation, and consideration for small creatures.',
        description: 'Cozy stop-motion styled stories of Pip the acorn-shell snail and his quiet garden neighbors overcoming gentle daily hurdles through kindness.',
        design_sheet: JSON.stringify({
          protagonist: 'Pip the snail with an acorn shell and expressive eyes',
          environment: 'Lush rainy clover patches and smooth river stones',
        }),
        pronunciation_notes: 'Soothing, gentle, storybook bedtime warmth.',
        palette_hex: JSON.stringify(['#606C38', '#283618', '#DDA15E', '#BC6C25']),
        narrator_style: 'Cozy, reassuring storyteller.',
        continuity_notes: 'No villains or loud frights; peaceful resolution.',
      };
    }

    db.prepare(`
      INSERT INTO series (
        id, title, format, age_band, learning_goal, description,
        design_sheet, pronunciation_notes, palette_hex, narrator_style,
        continuity_notes, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pilot', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(
      seriesData.id,
      seriesData.title,
      seriesData.format,
      seriesData.age_band,
      seriesData.learning_goal,
      seriesData.description,
      seriesData.design_sheet,
      seriesData.pronunciation_notes,
      seriesData.palette_hex,
      seriesData.narrator_style,
      seriesData.continuity_notes
    );

    return seriesData.id;
  }

  /**
   * Jev selects which series to produce and binds it to the open publishing slot.
   */
  private static async jevCreateNewJob(slot: any, settings: any): Promise<any> {
    const seriesList = db.prepare("SELECT * FROM series WHERE status IN ('pilot', 'active')").all() as any[];
    const criteria: Record<string, string> = {};
    for (const ser of seriesList) {
      criteria[ser.id] = `${ser.title} (${ser.format}, age ${ser.age_band}): ${ser.description}`;
    }

    const state = `New Publishing Slot: ${slot.target_time} on ${slot.slot_date} (Timezone: ${settings.timezone}).
Select the series for this slot to advance the channel discovery goal.`;

    const question: JevQuestionChoice = {
      type: 'choice',
      instructions: 'Which series should be scheduled for production in this available publishing slot?',
      criteria,
    };

    const jevDecision = await JevEngine.decide(state, { series_selection: question }, {
      decisionType: 'select_series_for_slot',
    });

    let chosenSeriesId = jevDecision.chosenId || (seriesList[0]?.id);
    let series = chosenSeriesId ? db.prepare('SELECT * FROM series WHERE id = ?').get(chosenSeriesId) as any : null;
    if (!series) {
      series = db.prepare("SELECT * FROM series LIMIT 1").get() as any;
      if (!series) {
        const fallbackId = await this.jevColdStartSeriesOrigination(settings);
        series = db.prepare('SELECT * FROM series WHERE id = ?').get(fallbackId) as any;
      }
    }

    const jobId = 'job_' + crypto.randomUUID().slice(0, 10);
    const estimatedCost = 0.25; // estimated total cost for script + render

    // Atomically reserve slot
    db.prepare(`
      UPDATE publishing_slots
      SET status = 'reserved',
          assigned_job_id = ?
      WHERE id = ?
    `).run(jobId, slot.id);

    // Insert new planned job
    db.prepare(`
      INSERT INTO jobs (
        id, series_id, slot_id, concept_title, format, age_band,
        hook, hypothesis, state, estimated_cost_usd, is_demo_job, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, '', '', 'planned', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(
      jobId,
      series.id,
      slot.id,
      `Episode: ${series.title}`,
      series.format,
      series.age_band,
      estimatedCost,
      settings.demo_mode
    );

    return db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
  }

  /**
   * Advance a job through its state machine using Jev for typed decisions.
   */
  private static async stepJob(job: any, settings: any): Promise<{ status: string; message: string; jobId: string }> {
    const series = db.prepare('SELECT * FROM series WHERE id = ?').get(job.series_id) as any;

    // STEP 1: PLANNED -> SCRIPTING
    if (job.state === 'planned') {
      const state = `Job: ${job.id} for Series "${series.title}".
Format: ${series.format}, Age: ${series.age_band}.
Learning goal: ${series.learning_goal}.
Jev decision: Commission on-demand creative writing from OpenAI tool.`;

      const question: JevQuestionChoice = {
        type: 'choice',
        instructions: 'Confirm creative brief parameters before calling the on-demand OpenAI writer tool.',
        criteria: {
          standard_short: 'Commission standard 18-second vertical storyboard with opening hook, visual puzzle, and prompt payoff.',
          creator_rewards_65s: 'Commission 65-second long-form episode with multi-step progression suitable for Creator Rewards eligibility.',
        },
      };

      const jevChoice = await JevEngine.decide(state, { duration_brief: question }, {
        jobId: job.id,
        seriesId: series.id,
        decisionType: 'approve_script_brief',
      });

      const targetDurationSec = jevChoice.chosenId === 'creator_rewards_65s' ? 65 : 18;

      // Call OpenAI Writer Tool
      const scriptPackage = await OpenAIWriter.writeContent({
        format: series.format,
        ageBand: series.age_band,
        language: settings.language,
        learningGoal: series.learning_goal,
        targetDurationSec,
        seriesTitle: series.title,
        designSheet: series.design_sheet,
      });

      // Record OpenAI writing cost in ledger
      db.prepare(`
        INSERT INTO financial_ledger (
          id, job_id, series_id, category, amount_usd, is_revenue, status, is_demo_data, notes
        ) VALUES (?, ?, ?, 'writing_openai', ?, 0, 'confirmed', ?, 'OpenAI Responses API scriptwriting')
      `).run(
        'led_' + crypto.randomUUID().slice(0, 10),
        job.id,
        series.id,
        scriptPackage.cost_usd,
        settings.demo_mode
      );

      // Update job with script and advance to scripting state
      db.prepare(`
        UPDATE jobs
        SET concept_title = ?,
            hook = ?,
            hypothesis = ?,
            script_text = ?,
            shot_briefs_json = ?,
            captions_json = ?,
            state = 'scripting',
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        scriptPackage.concept_title,
        scriptPackage.hook,
        scriptPackage.hypothesis,
        scriptPackage.script_text,
        JSON.stringify(scriptPackage.shot_briefs),
        JSON.stringify(scriptPackage.captions),
        job.id
      );

      return { status: 'script_completed', message: `Script commissioned: "${scriptPackage.concept_title}"`, jobId: job.id };
    }

    // STEP 2: SCRIPTING -> RENDERING
    if (job.state === 'scripting') {
      const shotBriefs = JSON.parse(job.shot_briefs_json || '[]');
      const estRenderCost = shotBriefs.length * 0.05; // ~$0.15

      // Check budget reservation before any paid render!
      const canSpend = Scheduler.reserveSpend(estRenderCost);
      if (!canSpend) {
        return { status: 'budget_held', message: 'Budget limit reached. Render held until daily budget resets.', jobId: job.id };
      }

      // Jev reviews the render plan
      const state = `Render Plan Review for Job ${job.id}:
Concept: "${job.concept_title}"
Hook: "${job.hook}"
Shots count: ${shotBriefs.length}. Estimated render cost: $${estRenderCost.toFixed(2)}.
Continuity check: Fictional characters only, no human child likenesses.`;

      const question: JevQuestionChoice = {
        type: 'choice',
        instructions: 'Approve Grok Imagine video render plan and proceed with shot production.',
        criteria: {
          approve_render: `Approve rendering ${shotBriefs.length} distinct shots with budget reservation $${estRenderCost.toFixed(2)}.`,
          request_script_revision: 'Reject plan and request creative revision.',
        },
      };

      const jevChoice = await JevEngine.decide(state, { render_disposition: question }, {
        jobId: job.id,
        seriesId: series.id,
        decisionType: 'approve_render_plan',
      });

      if (jevChoice.chosenId === 'request_script_revision') {
        db.prepare("UPDATE jobs SET state = 'planned' WHERE id = ?").run(job.id);
        return { status: 'revision_requested', message: 'Jev requested script revision.', jobId: job.id };
      }

      db.prepare(`
        UPDATE jobs
        SET state = 'rendering',
            spend_reserved_usd = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(estRenderCost, job.id);

      // Render distinct shots via Grok Video Generator
      const palette = JSON.parse(series.palette_hex || '["#2D68C4", "#F4A261", "#E76F51"]');
      const renderedShots = await GrokVideoGenerator.renderShots(job.id, shotBriefs, palette);

      const actualRenderCost = renderedShots.reduce((acc, s) => acc + s.costUsd, 0);

      // Record rendering cost in ledger
      db.prepare(`
        INSERT INTO financial_ledger (
          id, job_id, series_id, category, amount_usd, is_revenue, status, is_demo_data, notes
        ) VALUES (?, ?, ?, 'rendering_xai', ?, 0, 'confirmed', ?, 'Grok Imagine video shot generation')
      `).run(
        'led_' + crypto.randomUUID().slice(0, 10),
        job.id,
        series.id,
        actualRenderCost,
        settings.demo_mode
      );

      // Use raw video directly (preserve original video & audio without FFmpeg editing)
      const rawPath = renderedShots[0]?.filePath || '';
      const finalVideoPath = path.join(__dirname, `../../storage/videos/final_${job.id}.mp4`);
      if (rawPath && fs.existsSync(rawPath)) {
        fs.copyFileSync(rawPath, finalVideoPath);
      }

      const videoDuration = renderedShots[0]?.durationSeconds || 15;

      // Advance to QA Inspection
      db.prepare(`
        UPDATE jobs
        SET video_path = ?,
            thumbnail_path = ?,
            duration_seconds = ?,
            actual_cost_usd = actual_cost_usd + ?,
            state = 'qa_inspection',
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        finalVideoPath,
        null,
        videoDuration,
        actualRenderCost,
        job.id
      );

      // Run automated QA check immediately
      const captions = JSON.parse(job.captions_json || '[]');
      const qaResult = await KidsSafetyQAInspector.inspectJob(
        job.id,
        job.script_text,
        captions.map((c: any) => c.text || '').join(' '),
        videoDuration,
        finalVideoPath,
        []
      );

      return {
        status: 'render_and_qa_completed',
        message: `Video assembled (${videoDuration}s). QA Result: ${qaResult.passed ? 'PASSED' : 'HELD FOR REVIEW'}`,
        jobId: job.id,
      };
    }

    // STEP 3: READY_TO_PUBLISH -> PUBLISHED / SCHEDULED
    if (job.state === 'ready_to_publish') {
      const slot = db.prepare('SELECT * FROM publishing_slots WHERE id = ?').get(job.slot_id) as any;

      const publishResult = await BufferTikTokPublisher.publishVideoPost(
        job.id,
        job.concept_title,
        job.hook,
        job.video_path,
        job.thumbnail_path,
        slot?.target_timestamp_utc
      );

      if (publishResult.status === 'published') {
        db.prepare(`
          UPDATE jobs
          SET state = 'published',
              buffer_post_id = ?,
              tiktok_share_url = ?,
              is_ai_generated = 1,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(publishResult.providerPostId, publishResult.shareUrl, job.id);

        db.prepare(`
          UPDATE publishing_slots
          SET status = 'published',
              published_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(slot.id);

        db.prepare(`
          UPDATE series
          SET total_published = total_published + 1,
              total_spend_usd = total_spend_usd + ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(job.actual_cost_usd, series.id);

        return { status: 'published', message: `Post live! URL: ${publishResult.shareUrl}`, jobId: job.id };
      } else if (publishResult.status === 'scheduled') {
        db.prepare(`
          UPDATE jobs
          SET state = 'scheduled',
              buffer_post_id = ?,
              is_ai_generated = 1,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(publishResult.providerPostId, job.id);

        db.prepare(`
          UPDATE publishing_slots
          SET status = 'ready'
          WHERE id = ?
        `).run(slot.id);

        return { status: 'scheduled', message: `Post scheduled for ${slot.target_time} via Buffer.`, jobId: job.id };
      } else {
        db.prepare(`
          UPDATE jobs
          SET state = 'awaiting_action',
              awaiting_action_notes = ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(publishResult.actionNotes || 'Requires manual action in TikTok.', job.id);

        return { status: 'awaiting_action', message: publishResult.actionNotes || 'Awaiting operator action', jobId: job.id };
      }
    }

    return { status: 'no_action_needed', message: `Job ${job.id} is in state ${job.state}`, jobId: job.id };
  }
}

export default ProductionWorker;

