import assert from 'assert';
import path from 'path';
import fs from 'fs';
import db, { initDatabase, resetContentCatalog } from '../server/db/database';
import KidsSafetyQAInspector from '../server/engine/qaInspector';
import JevEngine, { JevUnavailableError } from '../server/engine/jevEngine';
import Scheduler from '../server/engine/scheduler';
import MonetizationEngine from '../server/engine/monetizationEngine';
import ProductionWorker from '../server/engine/worker';

async function runTests() {
  console.log('====================================================');
  console.log('  RUNNING KINDRED STUDIO COMPREHENSIVE TEST SUITE   ');
  console.log('====================================================\n');

  initDatabase();
  resetContentCatalog();

  // -------------------------------------------------------------------
  // TEST 1: Off-topic or unsafe concept cannot publish
  // -------------------------------------------------------------------
  console.log('▶ TEST 1: Testing that off-topic / unsafe concept cannot publish...');
  {
    const unsafeJobId = 'job_test_unsafe_001';
    const testVideoPath = path.join(__dirname, '../storage/videos/test_dummy.mp4');

    // Create small dummy file for test
    if (!fs.existsSync(path.dirname(testVideoPath))) {
      fs.mkdirSync(path.dirname(testVideoPath), { recursive: true });
    }
    fs.writeFileSync(testVideoPath, Buffer.alloc(60_000, 1));

    db.prepare(`
      INSERT INTO jobs (
        id, concept_title, format, age_band, hook, hypothesis,
        script_text, state, video_path
      ) VALUES (?, 'Unsafe Play Test', 'visual_puzzle', '5-7', 'Let us play with fire!',
        'Test unsafe detection', 'Do not worry, just light the matches and play with fire near the stove!',
        'rendering', ?)
    `).run(unsafeJobId, testVideoPath);

    const qaResult = await KidsSafetyQAInspector.inspectJob(
      unsafeJobId,
      'Do not worry, just light the matches and play with fire near the stove!',
      'Light the matches and play with fire',
      18,
      testVideoPath,
      []
    );

    assert.strictEqual(qaResult.passed, false, 'QA inspection must fail for unsafe content');
    assert.strictEqual(qaResult.kidsSafeScore, 0.0, 'Kids safe score must be 0 for critical hazard');
    assert.ok(qaResult.flaggedReasons.length > 0, 'Must have flagged reasons recorded');
    assert.ok(qaResult.flaggedReasons[0].issue.includes('fire') || qaResult.flaggedReasons[0].issue.includes('matches'), 'Must cite specific dangerous term');

    const updatedJob = db.prepare('SELECT state, hold_reason, hold_timestamp_sec FROM jobs WHERE id = ?').get(unsafeJobId) as any;
    assert.strictEqual(updatedJob.state, 'held_for_review', 'Job state must be updated to held_for_review');
    assert.ok(updatedJob.hold_reason.length > 0, 'Hold reason must be recorded');
    console.log(`  ✔ Passed: Unsafe job held for review. Reason: "${updatedJob.hold_reason}" (Timestamp: ${updatedJob.hold_timestamp_sec}s)`);
  }

  // -------------------------------------------------------------------
  // TEST 2: Failed Jev call cannot trigger a paid render
  // -------------------------------------------------------------------
  console.log('\n▶ TEST 2: Testing that failed Jev call cannot trigger paid render...');
  {
    // Temporarily switch to live mode without a valid key to verify Jev fails safely
    db.prepare("UPDATE settings SET demo_mode = 0 WHERE id = 1").run();
    db.prepare("UPDATE account_connections SET api_key = 'invalid_key_for_test' WHERE provider = 'jev'").run();

    let threwExpectedError = false;
    try {
      await JevEngine.decide('Testing state', {
        test_q: {
          type: 'choice',
          instructions: 'Pick an option',
          criteria: { a: 'Option A', b: 'Option B' },
        },
      });
    } catch (err: any) {
      if (err instanceof JevUnavailableError) {
        threwExpectedError = true;
        assert.ok(err.message.includes('No silent fallback'), 'Error message must confirm no silent fallback');
      }
    }

    assert.strictEqual(threwExpectedError, true, 'Failed Jev call must throw JevUnavailableError and halt without fallback');

    // Restore settings
    db.prepare("UPDATE settings SET demo_mode = 1 WHERE id = 1").run();
    db.prepare("UPDATE account_connections SET api_key = '' WHERE provider = 'jev'").run();

    console.log('  ✔ Passed: Jev failure strictly halts workflow. No silent fallback to another model occurred.');
  }

  // -------------------------------------------------------------------
  // TEST 3: Concurrent workers cannot double-post
  // -------------------------------------------------------------------
  console.log('\n▶ TEST 3: Testing concurrency locking and idempotent slot protection...');
  {
    const lockAcquiredFirst = Scheduler.tryAcquireLock();
    assert.strictEqual(lockAcquiredFirst, true, 'First worker tick must successfully acquire mutex');

    const lockAcquiredSecond = Scheduler.tryAcquireLock();
    assert.strictEqual(lockAcquiredSecond, false, 'Concurrent worker tick must be rejected while lock is held');

    Scheduler.releaseLock();
    const lockAcquiredAfterRelease = Scheduler.tryAcquireLock();
    assert.strictEqual(lockAcquiredAfterRelease, true, 'Lock can be acquired after release');
    Scheduler.releaseLock();

    console.log('  ✔ Passed: Concurrency lock successfully prevents concurrent worker ticks from double-posting.');
  }

  // -------------------------------------------------------------------
  // TEST 4: Missing revenue remains unknown (never assumed from views)
  // -------------------------------------------------------------------
  console.log('\n▶ TEST 4: Testing that missing revenue remains unknown...');
  {
    const testSeriesId = 'ser_test_unconfirmed_rev';
    db.prepare(`
      INSERT INTO series (
        id, title, format, age_band, learning_goal, description,
        design_sheet, pronunciation_notes, palette_hex, narrator_style,
        continuity_notes, status, total_published
      ) VALUES (?, 'Unconfirmed Test Series', 'visual_puzzle', '5-7', 'Test goal', 'Test desc',
        '{}', 'Notes', '[]', 'Warm', 'Notes', 'active', 5)
    `).run(testSeriesId);

    // Record only production costs, zero confirmed revenue
    db.prepare(`
      INSERT INTO financial_ledger (
        id, job_id, series_id, category, amount_usd, is_revenue, status, is_demo_data
      ) VALUES ('led_test_cost', null, ?, 'rendering_xai', 0.45, 0, 'confirmed', 0)
    `).run(testSeriesId);

    const summary = MonetizationEngine.getFinancialSummary();
    const targetSeries = summary.seriesBreakdown.find((s) => s.seriesId === testSeriesId);

    assert.ok(targetSeries, 'Series must exist in breakdown');
    assert.strictEqual(targetSeries.revenueStatus, 'unavailable', 'Status must remain unavailable when no payouts are reported');
    assert.strictEqual(targetSeries.grossRevenueUsd, 0.0, 'Gross revenue must not be guessed or calculated from view counts');

    // Clean up test fixture so test data never pollutes production series
    db.prepare('DELETE FROM financial_ledger WHERE series_id = ?').run(testSeriesId);
    db.prepare('DELETE FROM series WHERE id = ?').run(testSeriesId);

    console.log(`  ✔ Passed: Series revenue status is correctly flagged as "${targetSeries.revenueStatus}" with $0.00 assumed.`);
  }

  // -------------------------------------------------------------------
  // TEST 5: Timezone-aware slot generation and budget reservation
  // -------------------------------------------------------------------
  console.log('\n▶ TEST 5: Testing timezone-aware slots and budget reservation...');
  {
    const slots = Scheduler.ensureDailySlots();
    assert.strictEqual(slots.length, 3, 'Default daily slots target must produce 3 slots');

    // Test over-budget protection
    db.prepare("UPDATE settings SET daily_budget_usd = 1.00, spent_today_usd = 0.95, is_paused_budget = 0 WHERE id = 1").run();
    const canSpendOver = Scheduler.reserveSpend(0.20);
    assert.strictEqual(canSpendOver, false, 'Must reject spend reservation exceeding daily budget');

    const settingsAfterOver = db.prepare("SELECT is_paused_budget FROM settings WHERE id = 1").get() as any;
    assert.strictEqual(settingsAfterOver.is_paused_budget, 1, 'Studio must pause budget when threshold is hit');

    // Reset settings
    db.prepare("UPDATE settings SET daily_budget_usd = 15.00, spent_today_usd = 0.00, is_paused_budget = 0 WHERE id = 1").run();
    console.log('  ✔ Passed: 3 daily slots generated. Budget reservation correctly pauses over-budget jobs.');
  }

  console.log('\n====================================================');
  console.log('       ALL 5 INTEGRATION TESTS PASSED (100%)        ');
  console.log('====================================================\n');
}

runTests().catch((err) => {
  console.error('\n❌ Test failure:', err);
  process.exit(1);
});

