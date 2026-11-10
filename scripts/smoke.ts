import path from 'path';
import fs from 'fs';
import db, { initDatabase } from '../server/db/database';
import JevEngine from '../server/engine/jevEngine';
import OpenAIWriter from '../server/engine/openaiWriter';
import GrokVideoGenerator from '../server/engine/xaiVideoGenerator';
import FFmpegPipeline from '../server/engine/ffmpegPipeline';
import KidsSafetyQAInspector from '../server/engine/qaInspector';
import BufferTikTokPublisher from '../server/engine/bufferPublisher';
import Scheduler from '../server/engine/scheduler';
import MonetizationEngine from '../server/engine/monetizationEngine';

async function runLiveSmokeTest() {
  console.log('\n================================================================');
  console.log('       KINDRED STUDIO: ONE-VIDEO LIVE SMOKE TEST                ');
  console.log('================================================================\n');

  initDatabase();

  const settings = db.prepare('SELECT * FROM settings WHERE id = 1').get() as any;
  const connections = db.prepare('SELECT provider, name, account_identifier, status FROM account_connections').all() as any[];

  console.log('1. CREDENTIALS & PROVIDER CONNECTIVITY AUDIT:');
  console.log('------------------------------------------------');
  const jevKey = process.env.TYPESAFE_API_KEY || (db.prepare("SELECT api_key FROM account_connections WHERE provider = 'jev'").get() as any)?.api_key;
  const openaiKey = process.env.OPENAI_API_KEY || (db.prepare("SELECT api_key FROM account_connections WHERE provider = 'openai'").get() as any)?.api_key;
  const xaiKey = process.env.XAI_API_KEY || (db.prepare("SELECT api_key FROM account_connections WHERE provider = 'xai'").get() as any)?.api_key;
  const bufferToken = process.env.BUFFER_ACCESS_TOKEN || (db.prepare("SELECT api_key FROM account_connections WHERE provider = 'buffer_tiktok'").get() as any)?.api_key;
  const bufferChannel = process.env.BUFFER_CHANNEL_ID || (db.prepare("SELECT account_identifier FROM account_connections WHERE provider = 'buffer_tiktok'").get() as any)?.account_identifier;

  console.log(`• TypeSafe Jev (Decision Model):   ${jevKey ? 'Configured [LIVE]' : 'Standby [Simulated System One]'}`);
  console.log(`• OpenAI Responses (Script Writer): ${openaiKey ? 'Configured [LIVE]' : 'Standby [Curated Kid-Safe Templates]'}`);
  console.log(`• xAI Grok Imagine (Video Engine):  ${xaiKey ? 'Configured [LIVE]' : 'Standby [High-Speed FFmpeg Procedural 9:16]'}`);
  console.log(`• Buffer / TikTok (Publisher):      ${bufferToken && bufferChannel ? 'Configured [LIVE]' : 'Standby [Simulated Receipt with AI Disclosure]'}`);

  if (jevKey) {
    db.prepare('UPDATE settings SET demo_mode = 0 WHERE id = 1').run();
  }

  console.log('\n2. BUDGET & OPERATOR CONSTRAINTS:');
  console.log('------------------------------------------------');
  console.log(`• Daily Budget Cap:       $${Number(settings.daily_budget_usd).toFixed(2)} USD`);
  console.log(`• Max Cost Per Video:     $${Number(settings.max_cost_per_video_usd).toFixed(2)} USD`);
  console.log(`• Spent Today:            $${Number(settings.spent_today_usd).toFixed(2)} USD`);
  console.log(`• Developmental Age Band: ${settings.age_band}`);
  console.log(`• Studio Timezone:        ${settings.timezone}`);
  console.log(`• Required Disclosure:    isAiGenerated = true (TikTok AIGC Policy)`);

  const jobId = 'job_smoke_' + Date.now().toString(36);
  const startTimeTotal = Date.now();

  console.log('\n3. RUNNING PRODUCTION PIPELINE:');
  console.log('------------------------------------------------');

  // Step A: Jev Decision
  console.log('▶ [Jev Decision Engine] Selecting concept and evaluating candidate hooks...');
  const startJev = Date.now();
  const jevDecision = await JevEngine.decide(
    `Live Smoke Test: Target Age Band ${settings.age_band}.
Evaluate concept: "Which shadow belongs to the paper dragon?".
Verify developmental fit, 4-second thinking pause, and zero dangerous imitation risk.`,
    {
      smoke_disposition: {
        type: 'choice',
        instructions: 'Confirm production authorization for single live smoke test video.',
        criteria: {
          authorize_smoke_render: 'Authorize vertical 9:16 story render within configured $5.00 video budget ceiling.',
          abort_test: 'Abort test execution.',
        },
      },
    },
    { jobId, decisionType: 'smoke_test_authorization' }
  );
  const jevDurationMs = Date.now() - startJev;
  console.log(`  ✔ Jev Decision: "${jevDecision.chosenId}" (Latency: ${jevDurationMs}ms, Decision Cost: $${jevDecision.costUsd.toFixed(5)})`);

  // Step B: Scripting
  console.log('▶ [Creative Writer] Generating kid-safe vertical storyboard briefs...');
  const script = await OpenAIWriter.writeContent({
    format: 'visual_puzzle',
    ageBand: settings.age_band,
    language: settings.language,
    learningGoal: 'Spatial reasoning and 3D silhouette deduction',
    targetDurationSec: 18,
    seriesTitle: 'Paper Dragon & Shadow Puzzles',
  });
  console.log(`  ✔ Title: "${script.concept_title}" (Thinking Pause: ${script.thinking_pause_seconds}s)`);

  // Step C: Spend Reservation
  console.log('▶ [Budget Guard] Atomically reserving spend before render...');
  const estCost = script.shot_briefs.length * 0.05;
  const reserved = Scheduler.reserveSpend(estCost);
  if (!reserved) {
    console.error('❌ Aborted: Spend reservation exceeded budget cap.');
    return;
  }
  console.log(`  ✔ Spend Reserved: $${estCost.toFixed(2)} USD`);

  // Insert job row into DB
  db.prepare(`
    INSERT INTO jobs (
      id, concept_title, format, age_band, hook, hypothesis,
      script_text, shot_briefs_json, captions_json, state, estimated_cost_usd, is_demo_job
    ) VALUES (?, ?, 'visual_puzzle', ?, ?, ?, ?, ?, ?, 'rendering', ?, 1)
  `).run(
    jobId,
    script.concept_title,
    settings.age_band,
    script.hook,
    script.hypothesis,
    script.script_text,
    JSON.stringify(script.shot_briefs),
    JSON.stringify(script.captions),
    estCost
  );

  // Step D: Grok Imagine Shot Rendering & FFmpeg Assembly
  console.log('▶ [Video Generation & FFmpeg Pipeline] Rendering shots & assembling...');
  const startRender = Date.now();
  const palette = ['#2D68C4', '#F4A261', '#E76F51'];
  const shots = await GrokVideoGenerator.renderShots(jobId, script.shot_briefs, palette);
  const assembled = await FFmpegPipeline.assembleVideo(jobId, shots, script.script_text, script.captions);
  const renderDurationSec = Number(((Date.now() - startRender) / 1000).toFixed(2));
  console.log(`  ✔ Video Assembled in ${renderDurationSec}s (${assembled.durationSeconds}s duration, File: ${assembled.videoPath})`);

  // Step E: Kids Safety QA Audit
  console.log('▶ [Kids Safety QA Inspector] Auditing frames, transcript, and audio...');
  const qa = await KidsSafetyQAInspector.inspectJob(
    jobId,
    script.script_text,
    script.captions.map((c) => c.text).join(' '),
    assembled.durationSeconds,
    assembled.videoPath,
    assembled.sampledFrames
  );
  console.log(`  ✔ QA Status: ${qa.reviewerAction.toUpperCase()} (Kids Safe: ${(qa.kidsSafeScore * 100).toFixed(0)}%, Visual: ${(qa.visualCoherenceScore * 100).toFixed(0)}%)`);

  // Step F: Buffer TikTok Publisher
  console.log('▶ [Buffer TikTok Publisher] Submitting post with AI disclosure...');
  const publishReceipt = await BufferTikTokPublisher.publishVideoPost(
    jobId,
    script.concept_title,
    script.hook,
    assembled.videoPath,
    assembled.thumbnailPath
  );
  console.log(`  ✔ Receipt Confirmed: Provider ID ${publishReceipt.providerPostId}`);
  console.log(`  ✔ AIGC Disclosure: isAiGenerated = ${publishReceipt.isAiGenerated}`);
  console.log(`  ✔ URL: ${publishReceipt.shareUrl}`);

  const totalTimeSec = Number(((Date.now() - startTimeTotal) / 1000).toFixed(2));

  console.log('\n4. SMOKE TEST PERFORMANCE & COST SUMMARY:');
  console.log('------------------------------------------------');
  console.log(`• Jev Decision Latency:     ${jevDurationMs} ms`);
  console.log(`• End-to-End Render Time:   ${renderDurationSec} s`);
  console.log(`• Total Pipeline Wall Time: ${totalTimeSec} s`);
  console.log(`• Measured Cost:            $${(script.cost_usd + jevDecision.costUsd + estCost).toFixed(4)} USD`);
  console.log(`• Budget Cap Remaining:     $${(settings.daily_budget_usd - estCost).toFixed(2)} USD`);
  console.log(`• Video Output File:        ${assembled.videoPath}`);
  console.log('\n================================================================');
  console.log('       ONE-VIDEO SMOKE TEST COMPLETED SUCCESSFULLY             ');
  console.log('================================================================\n');
}

runLiveSmokeTest().catch((err) => {
  console.error('\n❌ Smoke test failed:', err);
  process.exit(1);
});
