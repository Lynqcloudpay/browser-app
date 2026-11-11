import { TEST_STORAGE, cleanup } from './helpers/env';
import fs from 'fs';
import path from 'path';
import assert from 'assert';

import { initDatabase, db } from '../server/db/database';
import { scanTextForSafety, inspectJob } from '../server/engine/qaInspector';

async function runQaTests(): Promise<void> {
  console.log('--- RUNNING QA TESTS ---');
  initDatabase();

  // Text scan
  const clean = 'A friendly cartoon robot sorts colourful shapes on a sunny hill. Can you find the star?';
  assert.deepStrictEqual(scanTextForSafety(clean), [], 'clean prompt must pass');
  console.log('ok clean prompt passes');

  const knife = scanTextForSafety('The otter plays with a knife in the sand.');
  assert(knife.some((f) => f.severity === 'critical'), '"plays with a knife" must be flagged critical');
  console.log('ok knife is flagged');

  assert.deepStrictEqual(scanTextForSafety('Fireworks over a firefly meadow'), [], 'fireworks / firefly must not be flagged');
  console.log('ok fireworks and firefly are not flagged');

  const buy = scanTextForSafety('Kids, buy now for the best toy!');
  assert(buy.some((f) => f.severity === 'critical'), '"buy now" must be flagged critical');
  console.log('ok "buy now" is flagged');

  // inspectJob with a missing video
  db.prepare(`
    INSERT INTO jobs (id, channel_id, concept_title, format, age_band, hook, hypothesis, state, created_at, updated_at)
    VALUES ('job_qa_missing', 1, 'Test', 'short', 'all', 'hook', '', 'rendering', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run();
  const missing = await inspectJob('job_qa_missing', {
    title: 'Test',
    hook: 'hook',
    prompt: clean,
    videoPath: path.join(TEST_STORAGE, 'does-not-exist.mp4'),
    coverPath: null,
  });
  assert.strictEqual(missing.passed, false, 'missing video must not pass');
  const heldRow = db.prepare('SELECT state, hold_reason FROM jobs WHERE id = ?').get('job_qa_missing') as any;
  assert.strictEqual(heldRow.state, 'held_for_review', 'job must be held for review');
  assert(heldRow.hold_reason && heldRow.hold_reason.length > 0, 'hold reason must be recorded');
  console.log('ok missing video holds the job for review');

  // inspectJob with a plausible MP4 container passes
  const goodPath = path.join(TEST_STORAGE, 'good.mp4');
  const fakeMp4 = Buffer.alloc(300000);
  fakeMp4.write('ftyp', 4, 'ascii');
  fs.writeFileSync(goodPath, fakeMp4);
  db.prepare(`
    INSERT INTO jobs (id, channel_id, concept_title, format, age_band, hook, hypothesis, state, created_at, updated_at)
    VALUES ('job_qa_good', 1, 'Test', 'short', 'all', 'hook', '', 'rendering', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run();
  const good = await inspectJob('job_qa_good', { title: 'Test', hook: 'hook', prompt: clean, videoPath: goodPath });
  assert.strictEqual(good.passed, true, 'clean prompt with a valid video must pass');
  const readyRow = db.prepare('SELECT state FROM jobs WHERE id = ?').get('job_qa_good') as any;
  assert.strictEqual(readyRow.state, 'ready_to_publish');
  console.log('ok valid video with clean prompt is ready_to_publish');

  // Without the hold setting, flagged words are recorded but the video still posts; with it, the video is held.
  const flagged = 'The apple is playing with fire in the kitchen.';
  for (const [id, hold] of [['job_qa_warn', false], ['job_qa_hold', true]] as const) {
    db.prepare(`
      INSERT INTO jobs (id, channel_id, concept_title, format, age_band, hook, hypothesis, state, created_at, updated_at)
      VALUES (?, 1, 'Test', 'short', 'all', 'hook', '', 'rendering', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(id);
    const r = await inspectJob(id, { title: 'Test', hook: 'hook', prompt: flagged, videoPath: goodPath, holdOnFlags: hold });
    assert.strictEqual(r.passed, !hold, hold ? 'hold on: flagged video is held' : 'hold off: flagged video still posts');
    assert(r.flaggedReasons.length > 0, 'the flag is recorded either way');
    const row = db.prepare('SELECT state FROM jobs WHERE id = ?').get(id) as any;
    assert.strictEqual(row.state, hold ? 'held_for_review' : 'ready_to_publish');
  }
  console.log('ok flags are warnings unless the channel holds flagged videos');

  console.log('--- ALL QA TESTS PASSED ---');
}

runQaTests()
  .then(() => {
    cleanup();
    process.exit(0);
  })
  .catch((err) => {
    console.error('QA test failed:', err);
    cleanup();
    process.exit(1);
  });
