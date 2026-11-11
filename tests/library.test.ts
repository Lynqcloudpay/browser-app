import { TEST_STORAGE, cleanup } from './helpers/env';
import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { AddressInfo } from 'net';

import { createApp } from '../server/index';
import { db } from '../server/db/database';
import { createRun, updateRun, listRuns, closeInterruptedRuns } from '../server/engine/runs';
import { stageFromStep, describeResult } from '../server/engine/dailyRunner';
import { nextRunAt } from '../server/routes/api';
import { scanTextForSafety } from '../server/engine/qaInspector';
import { shutdownAllAgents } from '../server/engine/agentRegistry';
import type { PipelineResult } from '../server/engine/jevBrowserAutomation';
import type { Channel } from '../server/engine/channels';

/**
 * Videos, run history, storage and the pure helpers behind the production line.
 * Never calls a route that launches a browser: /publish is only exercised on its refusal paths.
 */

function fakeMp4(file: string): void {
  const buf = Buffer.alloc(300_000);
  buf.write('ftyp', 4, 'ascii');
  fs.writeFileSync(file, buf);
}

function insertJob(id: string, state: string, videoPath: string | null, extra: { prompt?: string; thumb?: string } = {}): void {
  db.prepare(
    `INSERT INTO jobs (id, channel_id, concept_title, format, age_band, hook, hypothesis, script_text, state, video_path, thumbnail_path, duration_seconds)
     VALUES (?, 1, ?, 'short', 'all', 'A hook', '', ?, ?, ?, ?, 15)`
  ).run(id, `Title ${id}`, extra.prompt || 'A friendly apple dances in a sunny orchard.', state, videoPath, extra.thumb || null);
}

const result = (over: Partial<PipelineResult>): PipelineResult => ({
  success: true,
  jobId: 'job_x',
  title: 'Dance',
  hook: '',
  videoPath: '/x.mp4',
  durationSeconds: 15,
  qaPassed: true,
  tiktokStatus: 'off',
  tiktokVerified: false,
  youtubeStatus: 'off',
  youtubeVerified: false,
  postedEverywhere: false,
  postedAnywhere: false,
  message: '',
  ...over,
});

async function main(): Promise<void> {
  console.log('--- RUNNING LIBRARY TESTS ---');
  const app = createApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const json = async (url: string, init?: RequestInit) => {
    const r = await fetch(base + url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
    return { status: r.status, body: (await r.json()) as any };
  };

  try {
    // ── Production line stages ──
    assert.strictEqual(stageFromStep('Opening ChatGPT, Grok, TikTok, YouTube…'), 'login', 'opening tabs names every site but is still sign-in');
    assert.strictEqual(stageFromStep('Checking your Grok login…', 'login'), 'login');
    assert.strictEqual(stageFromStep('Writing a new prompt in ChatGPT…', 'login'), 'chatgpt');
    assert.strictEqual(stageFromStep('Generating the video in Grok (about 1–3 minutes)…', 'chatgpt'), 'grok');
    assert.strictEqual(stageFromStep('Picking a cover frame…', 'grok'), 'qa');
    assert.strictEqual(stageFromStep('Running the kids-safety check…', 'qa'), 'qa');
    assert.strictEqual(stageFromStep('Uploading to TikTok and posting…', 'qa'), 'post');
    assert.strictEqual(stageFromStep('Uploading to YouTube…', 'post'), 'post');
    assert.strictEqual(stageFromStep('Checking your TikTok login…', 'post'), 'post', 'stations never move backwards');
    console.log('ok progress messages map to the right station');

    // ── Result wording ──
    const posted = describeResult(result({ tiktokStatus: 'published', tiktokVerified: true, postedAnywhere: true, postedEverywhere: true }), false);
    assert(posted.ok && /Made and posted/.test(posted.message) && /TikTok: posted/.test(posted.message));
    const failed = describeResult(result({ tiktokStatus: 'failed', youtubeStatus: 'failed' }), false);
    assert(!failed.ok && /Post now/.test(failed.message), 'a made-but-unposted video is a failed run that points at Post now');
    const held = describeResult(result({ qaPassed: false }), false);
    assert(held.ok && /held/.test(held.message));
    console.log('ok run results are worded and classified correctly');

    // ── Next scheduled time ──
    const channel = { schedule_enabled: true, schedule_times: ['10:00', '18:30'] } as Channel;
    const at = (h: number, m: number) => new Date(2026, 10, 10, h, m, 0, 0);
    assert.strictEqual(new Date(nextRunAt(channel, at(9, 0))!).getHours(), 10);
    assert.strictEqual(new Date(nextRunAt(channel, at(12, 0))!).getHours(), 18);
    const tomorrow = new Date(nextRunAt(channel, at(23, 0))!);
    assert.strictEqual(tomorrow.getDate(), 11);
    assert.strictEqual(tomorrow.getHours(), 10);
    assert.strictEqual(nextRunAt({ ...channel, schedule_enabled: false } as Channel), null);
    console.log('ok next scheduled time');

    // ── Safety scan: risky phrases are held, ordinary description is not ──
    for (const safe of ['a lighter shade of red', 'a red fire truck', 'the dancer is on a roll', 'a stranger arrives with gifts', 'he purchased apples']) {
      assert.deepStrictEqual(scanTextForSafety(safe), [], `"${safe}" must not be held`);
    }
    for (const risky of ['the fox is playing with fire', 'holding a gun', 'tell me your phone number', 'a bloody scene']) {
      assert(scanTextForSafety(risky).length > 0, `"${risky}" must be held`);
    }
    console.log('ok safety scan phrases');

    // ── Run history ──
    const runId = createRun(1, 'button', 'Opening…');
    updateRun(runId, { state: 'done', stage: 'finished', message: 'Made and posted', finished: true });
    const deadRun = createRun(1, 'schedule', 'Opening…');
    db.prepare('UPDATE runs SET pid = ? WHERE id = ?').run(999_999_999, deadRun); // no such process
    assert.strictEqual(closeInterruptedRuns(), 1, 'a run whose process is gone is closed out');
    const closed = listRuns({ channelId: 1 }).find((r) => r.id === deadRun)!;
    assert.strictEqual(closed.state, 'error');
    assert(/Interrupted/.test(closed.message));
    const runs = await json('/api/runs?channel_id=1');
    assert.strictEqual(runs.status, 200);
    assert.strictEqual(runs.body.runs.length, 2);
    assert.strictEqual(runs.body.runs.find((r: any) => r.id === runId).channel_name, 'Mr. Apple');
    assert.strictEqual((await json('/api/runs?channel_id=abc')).status, 400);
    console.log('ok run history is recorded, listed, and interrupted runs are closed');

    // ── Channel view carries stats ──
    const videosDir = path.join(TEST_STORAGE, 'videos');
    const framesDir = path.join(TEST_STORAGE, 'frames');
    const goodFile = path.join(videosDir, 'good_job_a.mp4');
    fakeMp4(goodFile);
    const cover = path.join(TEST_STORAGE, 'thumbnails', 'thumb_job_a.jpg');
    fs.writeFileSync(cover, Buffer.alloc(2000, 1));
    insertJob('job_a', 'ready_to_publish', goodFile, { thumb: cover });
    insertJob('job_held', 'held_for_review', goodFile);
    insertJob('job_gone', 'failed', path.join(videosDir, 'missing.mp4'));
    insertJob('job_done', 'published', goodFile);
    // a project folder that was moved: the saved absolute path is stale but the file name still resolves
    insertJob('job_moved', 'ready_to_publish', '/old/place/storage/videos/good_job_a.mp4');

    const ch = await json('/api/channels/1');
    assert.strictEqual(ch.body.stats.totalVideos, 5);
    assert.strictEqual(ch.body.stats.heldForReview, 1);
    assert.strictEqual(ch.body.lastRun.channel_id, 1);
    assert.strictEqual(ch.body.nextRunAt, null);
    const overview = await json('/api/overview');
    assert.strictEqual(overview.body.counts.heldForReview, 1);
    assert.strictEqual(overview.body.counts.running, 0);
    console.log('ok channel stats and overview');

    // ── Videos ──
    const list = await json('/api/videos');
    assert.strictEqual(list.body.total, 5);
    const a = list.body.videos.find((v: any) => v.id === 'job_a');
    assert.strictEqual(a.video_url, '/media/videos/good_job_a.mp4');
    assert.strictEqual(a.thumbnail_url, '/media/thumbnails/thumb_job_a.jpg');
    assert.strictEqual(a.file_exists, true);
    assert(a.created_at.endsWith('Z') && a.created_at.includes('T'), 'timestamps are ISO-8601 UTC');
    assert.strictEqual((await fetch(base + a.video_url)).status, 200, 'the video URL is served');
    const gone = list.body.videos.find((v: any) => v.id === 'job_gone');
    assert.strictEqual(gone.file_exists, false);
    assert.strictEqual(gone.video_url, null);
    assert.strictEqual(list.body.videos.find((v: any) => v.id === 'job_moved').file_exists, true, 'a moved project still finds its files');
    assert.strictEqual((await json('/api/videos?state=held_for_review')).body.total, 1);
    assert.strictEqual((await json('/api/videos/nope')).status, 404);
    console.log('ok videos list, media URLs and filters');

    // approve / reject
    assert.strictEqual((await json('/api/videos/job_a/approve', { method: 'POST' })).status, 400, 'only held videos can be approved');
    const approved = await json('/api/videos/job_held/approve', { method: 'POST' });
    assert.strictEqual(approved.body.state, 'ready_to_publish');
    assert.strictEqual((await json('/api/videos/job_done/reject', { method: 'POST' })).status, 400, 'a posted video cannot be discarded');
    assert.strictEqual((await json('/api/videos/job_a/reject', { method: 'POST' })).body.state, 'rejected');
    console.log('ok approve and discard');

    // publish refusals (the success path opens a real browser and is never run in tests)
    assert.strictEqual((await json('/api/videos/job_done/publish', { method: 'POST' })).status, 400, 'a posted video is not posted again');
    assert.strictEqual((await json('/api/videos/job_gone/publish', { method: 'POST' })).status, 400, 'a missing file cannot be posted');
    insertJob('job_risky', 'failed', goodFile, { prompt: 'The apple is playing with fire in the kitchen.' });
    const risky = await json('/api/videos/job_risky/publish', { method: 'POST' });
    assert.strictEqual(risky.status, 400, 'a video with no safety check on record is checked before posting');
    assert.strictEqual((await json('/api/videos/job_risky')).body.state, 'held_for_review');
    console.log('ok post-now refuses posted, missing and unsafe videos');

    // ── Storage ──
    fakeMp4(path.join(videosDir, 'orphan_old.mp4'));
    fakeMp4(path.join(videosDir, 'orphan_new.mp4'));
    fs.writeFileSync(path.join(framesDir, 'debug_old.png'), Buffer.alloc(5000, 2));
    const longAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
    fs.utimesSync(path.join(videosDir, 'orphan_old.mp4'), longAgo, longAgo);
    fs.utimesSync(path.join(framesDir, 'debug_old.png'), longAgo, longAgo);
    fs.utimesSync(goodFile, longAgo, longAgo);

    const status = await json('/api/storage/status');
    assert.strictEqual(status.body.orphanVideos.count, 2);
    assert.strictEqual(status.body.videos.count, 3);
    const clean = await json('/api/storage/cleanup', { method: 'POST', body: JSON.stringify({ frames: true, orphanVideos: true }) });
    assert.strictEqual(clean.body.deletedCount, 2, 'old orphan video + old debug frame');
    assert(fs.existsSync(goodFile), 'a video a record points at is never removed');
    assert(fs.existsSync(path.join(videosDir, 'orphan_new.mp4')), 'a file written in the last hour is left alone');
    assert(fs.existsSync(cover), 'covers are not debug frames');
    assert.strictEqual((await json('/api/storage/open-folder', { method: 'POST', body: JSON.stringify({ target: '../etc' }) })).status, 400);
    console.log('ok storage status and cleanup');

    // ── Delete ──
    assert.strictEqual((await json('/api/videos/job_held?record=1', { method: 'DELETE' })).status, 200);
    assert.strictEqual((await json('/api/videos/job_held')).status, 404);
    insertJob('job_solo', 'failed', path.join(videosDir, 'orphan_new.mp4'));
    assert.strictEqual((await json('/api/videos/job_solo', { method: 'DELETE' })).status, 200);
    assert(!fs.existsSync(path.join(videosDir, 'orphan_new.mp4')), 'delete removes the file');
    assert.strictEqual((await json('/api/videos/job_solo')).body.file_exists, false, 'without record=1 the record stays');
    console.log('ok delete file and delete record');

    // ── System check answers without starting a browser ──
    const check = await json('/api/system/check');
    assert.deepStrictEqual(
      check.body.checks.map((c: any) => c.id),
      ['node', 'platform', 'chromium', 'database', 'storage', 'schedules']
    );
    assert.strictEqual(check.body.checks.find((c: any) => c.id === 'database').ok, true);
    console.log('ok system check');

    console.log('--- ALL LIBRARY TESTS PASSED ---');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await shutdownAllAgents();
    cleanup();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('LIBRARY TESTS FAILED:', err);
    cleanup();
    process.exit(1);
  });
