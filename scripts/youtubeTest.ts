/**
 * Safe end-to-end check of the YouTube upload using a video you already have.
 * Uploads it as PRIVATE (only you can see it) with a "[TEST]" title — delete it afterwards in YouTube Studio.
 * It does NOT touch TikTok, ChatGPT or Grok.
 *
 *   npm run youtube:test                       # newest video in storage/videos
 *   npm run youtube:test -- path/to/video.mp4
 *
 * Close the app's browser window first (this opens the same browser profile).
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '../.env') });

async function main() {
  const { default: JevBrowserAgent } = await import('../server/engine/jevBrowserAutomation');
  const { getPublishTargets } = await import('../server/engine/publishTargets');

  const videosDir = path.join(__dirname, '../storage/videos');
  const arg = process.argv.slice(2).find((a) => !a.startsWith('--'));
  const video =
    arg ||
    fs
      .readdirSync(videosDir)
      .filter((f) => f.endsWith('.mp4') && !f.startsWith('test_'))
      .map((f) => ({ f, t: fs.statSync(path.join(videosDir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)
      .map((x) => path.join(videosDir, x.f))[0];
  if (!video || !fs.existsSync(video)) throw new Error('No video found. Pass a path: npm run youtube:test -- path/to/video.mp4');

  console.log(`Uploading ${video} to YouTube as PRIVATE...`);
  const targets = getPublishTargets();
  const res = await JevBrowserAgent.uploadToYouTubeViaBrowser(video, '[TEST] Mr. Apple upload check', 'Test upload from KindredStudio. #Shorts', {
    madeForKids: targets.youtubeMadeForKids,
    visibility: 'private',
  });
  console.log('RESULT', JSON.stringify(res));
  await JevBrowserAgent.shutdown();
  process.exit(res.success ? 0 : 1);
}

main().catch(async (err) => {
  console.error('YOUTUBE TEST FAILED:', err.message);
  const { default: JevBrowserAgent } = await import('../server/engine/jevBrowserAutomation');
  await JevBrowserAgent.shutdown().catch(() => {});
  process.exit(1);
});
