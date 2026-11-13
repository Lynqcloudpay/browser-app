import { cleanup } from './helpers/env';
import fs from 'fs';
import os from 'os';
import path from 'path';
import assert from 'assert';
import { execFileSync } from 'child_process';
import { AddressInfo } from 'net';

import { createApp } from '../server/index';
import { shutdownAllAgents } from '../server/engine/agentRegistry';
import { audioToolsAvailable, detectSongExtension, makeMutedVideo, makeVideoWithSong, mediaDuration } from '../server/engine/audioMix';
import { parseSoundQuery, parseTikTokSoundLink, pickSoundResult, tikTokRowsFor } from '../server/engine/jevBrowserAutomation';

const ffprobeStreams = (file: string) =>
  execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', file]).toString().trim().split('\n');

async function run(): Promise<void> {
  console.log('--- RUNNING AUDIO TESTS ---');

  // 1. TikTok sound search: exact title wins, artist narrows it, nothing close means nothing picked
  assert.deepStrictEqual(parseSoundQuery('Chicken Banana - Crazy Music Channel'), { title: 'Chicken Banana', artist: 'Crazy Music Channel' });
  assert.deepStrictEqual(parseSoundQuery('Chicken Banana'), { title: 'Chicken Banana', artist: '' });
  const rows = [
    { title: 'original sound - flare.on.earth', desc: '00:10 · Flare' },
    { title: 'Chicken Banana (PHONK)', desc: '03:26 · DJ' },
    { title: 'CHICKEN BANANA', desc: '01:00 · CHICKEN' },
    { title: 'Chicken Banana', desc: '00:46 · Crazy Music Channel' },
  ];
  assert.strictEqual(pickSoundResult(rows, 'Chicken Banana'), 2, 'exact title (any case) before partial matches');
  assert.strictEqual(pickSoundResult(rows, 'Chicken Banana', 'Crazy Music Channel'), 3, 'artist picks the exact one');
  assert.strictEqual(pickSoundResult(rows, 'phonk'), 1, 'partial title when there is no exact one');
  assert.strictEqual(pickSoundResult(rows, 'Baby Shark'), -1, 'never a wrong song');
  assert.strictEqual(pickSoundResult(rows, 'Chicken Banana', 'CrazyMusicChannel'), 3, 'creator name from the sound page (no spaces) still matches');

  // 1a. Pasted TikTok sound links
  assert.deepStrictEqual(parseTikTokSoundLink('https://www.tiktok.com/music/Chicken-Banana-7465696476092042006?is_from_webapp=1&sender_device=pc'), {
    url: 'https://www.tiktok.com/music/Chicken-Banana-7465696476092042006', id: '7465696476092042006', slugTitle: 'Chicken Banana',
  });
  assert.strictEqual(parseTikTokSoundLink('tiktok.com/music/original-sound-7123456789012345678/')?.slugTitle, 'original sound');
  assert.strictEqual(parseTikTokSoundLink('https://m.tiktok.com/music/Caf%C3%A9-Song-7123456789012345678')?.slugTitle, 'Café Song');
  assert.strictEqual(parseTikTokSoundLink('Chicken Banana - Crazy Music Channel'), null, 'a name is not a link');
  assert.strictEqual(parseTikTokSoundLink('https://www.tiktok.com/@someone/video/7123456789012345678'), null, 'a video link is not a sound');
  console.log('ok TikTok sound matching');

  // 1b. TikTok Posts list: a re-post leaves several rows with one title; each is judged on its own status
  const title = "This Baby Tapir's SNOOT DANCE Is Too Funny! 🍎🐾😂🔥";
  const listText = [
    'Posts (Created on)', 'Privacy',
    `${title} #MrApple`, 'Failed to publish', 'Retry', 'Everyone', '0',
    `${title} #MrApple`, 'Content under review', 'Only me', '0',
    `${title} #MrApple`, 'Nov 12, 4:56 PM', 'Everyone', '0',
    'This Smiling Baby Quokka Has CRAZY Dance Moves!', 'Nov 12, 4:01 PM',
  ].join('\n');
  const found = tikTokRowsFor(listText, title);
  assert.strictEqual(found.length, 3, 'three rows for the re-posted video');
  assert.ok(/Failed to publish/.test(found[0]) && !/Failed/.test(found[1]) && /4:56 PM/.test(found[2]));
  assert.ok(!/Quokka/.test(found[2]), 'a row stops before the next video');
  assert.deepStrictEqual(tikTokRowsFor(listText, 'Some other video'), []);
  console.log('ok TikTok Posts rows');

  // 2. Song file types
  assert.strictEqual(detectSongExtension(Buffer.concat([Buffer.from('ID3'), Buffer.alloc(20)])), '.mp3');
  assert.strictEqual(detectSongExtension(Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypM4A '), Buffer.alloc(20)])), '.m4a');
  assert.strictEqual(detectSongExtension(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.alloc(20)])), '.wav');
  assert.strictEqual(detectSongExtension(Buffer.from('hello world, not audio')), null);
  console.log('ok song file types');

  // 3. Mixing (needs ffmpeg; skipped with a note when it is missing)
  if (audioToolsAvailable()) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kindred-audio-'));
    const video = path.join(dir, 'clip.mp4');
    const song = path.join(dir, 'song.mp3');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=180x320:rate=24:duration=4',
      '-f', 'lavfi', '-i', 'sine=frequency=220:duration=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', video]);
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=1.5', '-c:a', 'libmp3lame', song]);
    assert.strictEqual(detectSongExtension(fs.readFileSync(song)), '.mp3');

    const muted = await makeMutedVideo(video);
    assert.deepStrictEqual(ffprobeStreams(muted).sort(), ['audio', 'video'], 'silent file keeps an audio track (TikTok needs one)');
    const vol = execFileSync('sh', ['-c', `ffmpeg -i "${muted}" -map 0:a -af volumedetect -f null - 2>&1 | grep max_volume`]).toString();
    assert.ok(/max_volume: -(9\d|inf)/.test(vol) || /-inf/.test(vol), `the audio track is silent (${vol.trim()})`);

    const mixed = await makeVideoWithSong(video, song);
    assert.deepStrictEqual(ffprobeStreams(mixed).sort(), ['audio', 'video'], 'song file has one audio track');
    const [dv, dm] = [await mediaDuration(video), await mediaDuration(mixed)];
    assert.ok(Math.abs(dv - dm) < 0.2, `short song loops to the full video length (${dv} vs ${dm})`);
    fs.rmSync(dir, { recursive: true, force: true });
    console.log('ok mute and song mixing');
  } else {
    console.log('note: ffmpeg not installed, mixing checks skipped');
  }

  // 4. Settings and audio files through the API
  const app = createApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const created: any = await (await fetch(`${base}/api/channels`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Mr. Banana' }),
    })).json();
    const id = created.id;

    const fresh: any = await (await fetch(`${base}/api/channels/${id}`)).json();
    assert.strictEqual(fresh.tiktok_audio, 'original', 'new channels keep Grok sound');
    assert.strictEqual(fresh.youtube_audio, 'original');
    assert.strictEqual(fresh.songFile, null);

    const patched: any = await (await fetch(`${base}/api/channels/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tiktok_audio: 'tiktok_sound', tiktok_sound: '  Chicken Banana - Crazy Music Channel ', youtube_audio: 'bogus' }),
    })).json();
    assert.strictEqual(patched.tiktok_audio, 'tiktok_sound');
    assert.strictEqual(patched.tiktok_sound, 'Chicken Banana - Crazy Music Channel', 'sound name trimmed');
    assert.strictEqual(patched.youtube_audio, 'original', 'unknown option falls back to Grok sound');

    const mp3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(4000, 1)]);
    const up = await fetch(`${base}/api/channels/${id}/audio/song`, { method: 'POST', headers: { 'Content-Type': 'audio/mpeg' }, body: mp3 });
    assert.strictEqual(up.status, 200);
    const withSong: any = await (await fetch(`${base}/api/channels/${id}`)).json();
    assert.deepStrictEqual(withSong.songFile, { name: 'song.mp3', bytes: mp3.length });

    const bad = await fetch(`${base}/api/channels/${id}/audio/song`, {
      method: 'POST', headers: { 'Content-Type': 'audio/mpeg' }, body: Buffer.alloc(4000, 7),
    });
    assert.strictEqual(bad.status, 400, 'non-audio file refused');
    assert.strictEqual((await fetch(`${base}/api/channels/${id}/audio/other`)).status, 404, 'unknown slot');

    const got = await fetch(`${base}/api/channels/${id}/audio/song`);
    assert.strictEqual(got.status, 200);
    assert.strictEqual((await got.arrayBuffer()).byteLength, mp3.length);

    await fetch(`${base}/api/channels/${id}/audio/song`, { method: 'DELETE' });
    const gone: any = await (await fetch(`${base}/api/channels/${id}`)).json();
    assert.strictEqual(gone.songFile, null, 'song removed');
    console.log('ok audio settings and files through the API');
  } finally {
    server.close();
    await shutdownAllAgents();
  }
  console.log('--- ALL AUDIO TESTS PASSED ---');
}

run()
  .then(() => {
    cleanup();
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    cleanup();
    process.exit(1);
  });
