/**
 * Safe end-to-end check of the YouTube upload using a video you already have.
 * Uploads it as PRIVATE (only you can see it) with a "[TEST]" title — delete it afterwards in YouTube Studio.
 * It does NOT touch TikTok, ChatGPT or Grok.
 *
 *   npm run youtube:test                              # newest video in storage/videos, channel 1
 *   npm run youtube:test -- path/to/video.mp4         # a specific file
 *   npm run youtube:test -- --channel 2               # use channel 2's browser profile and made-for-kids setting
 *
 * Close the app's browser window first (this opens the same browser profile).
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '../.env') });

const chArgIdx = process.argv.indexOf('--channel');
const CHANNEL_ID = chArgIdx !== -1 && process.argv[chArgIdx + 1] ? Number(process.argv[chArgIdx + 1]) || 1 : 1;

async function main() {
  const { initDatabase } = await import('../server/db/database');
  const { getChannel } = await import('../server/engine/channels');
  const { getAgent } = await import('../server/engine/agentRegistry');
  const { STORAGE_ROOT } = await import('../server/paths');
  initDatabase();

  const channel = getChannel(CHANNEL_ID);
  if (!channel) throw new Error(`Channel ${CHANNEL_ID} not found.`);
  const agent = getAgent(CHANNEL_ID);

  const videosDir = path.join(STORAGE_ROOT, 'videos');
  const arg = process.argv.slice(2).find((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--channel');
  const video =
    arg ||
    fs
      .readdirSync(videosDir)
      .filter((f) => f.endsWith('.mp4') && !f.startsWith('test_'))
      .map((f) => ({ f, t: fs.statSync(path.join(videosDir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)
      .map((x) => path.join(videosDir, x.f))[0];
  if (!video || !fs.existsSync(video)) throw new Error('No video found. Pass a path: npm run youtube:test -- path/to/video.mp4');

  console.log(`Uploading ${video} to YouTube (channel ${CHANNEL_ID}) as PRIVATE...`);
  const res = await agent.uploadToYouTubeViaBrowser(video, '[TEST] Mr. Apple upload check', 'Test upload from KindredStudio. #Shorts', {
    madeForKids: channel.youtube_made_for_kids,
    visibility: 'private',
  });
  console.log('RESULT', JSON.stringify(res));
  await agent.shutdown();
  process.exit(res.success ? 0 : 1);
}

main().catch(async (err) => {
  console.error('YOUTUBE TEST FAILED:', err.message);
  try {
    const { getAgent } = await import('../server/engine/agentRegistry');
    await getAgent(CHANNEL_ID).shutdown();
  } catch {}
  process.exit(1);
});
