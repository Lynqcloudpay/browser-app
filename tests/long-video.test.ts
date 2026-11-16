import { cleanup } from './helpers/env';
import fs from 'fs';
import os from 'os';
import path from 'path';
import assert from 'assert';
import { execFileSync } from 'child_process';

import { initDatabase } from '../server/db/database';
import { createChannel, updateChannel, getChannel } from '../server/engine/channels';
import { LONG_SCENES, scenesQuestion, parseScenes, parsePlan, sceneImages, sceneImageLegend } from '../server/engine/longVideo';
import { chromium } from 'playwright';
import { getAgent } from '../server/engine/agentRegistry';
import { audioToolsAvailable, concatClips, lastFrame, mediaDuration } from '../server/engine/audioMix';
import { describeResult } from '../server/engine/dailyRunner';

/** 1-minute videos: scene split (ChatGPT answer parsing), clip joining (ffmpeg), the channel switch, make-only message. */
async function run(): Promise<void> {
  console.log('--- RUNNING LONG VIDEO TESTS ---');
  initDatabase();

  // 1. Parsing ChatGPT's scene answer from page text
  const base = 'Create an adorable 15-second vertical 9:16 3D cartoon of Mr. Marshmallow finding treasure. 15 seconds • Vertical 9:16 • 720p';
  const question = scenesQuestion(base, 'Treasure Time');
  assert.ok(question.includes('SCENES_BEGIN') && question.includes('SCENES_END'), 'the question shows the markers');
  assert.deepStrictEqual(parseScenes(question), [], 'the question alone (template) is never read as an answer');

  const scene = (n: number) =>
    `Mr. Marshmallow, a soft cream marshmallow with rosy cheeks, stands on the sunny beach of Marshmallow Village. Scene ${n} action happens here. 15 seconds • Vertical 9:16 • 720p`;
  const cast = 'Mr. Marshmallow exactly as in @Image 1 standing next to Baby Sheep, who is half as tall as him, in a pastel meadow.';
  const place = 'A sunny pastel meadow with a big pink bush, a hollow log and a blue wheelbarrow, no characters.';
  const pictures = ['CAST IMAGE:', cast, 'PLACE IMAGE:', place];
  const answer = ['SCENES_BEGIN', ...pictures, ...[1, 2, 3, 4].flatMap((n) => [`SCENE ${n}:`, scene(n)]), 'SCENES_END'].join('\n');
  const page = `You said:\n${question}\nChatGPT said:\n${answer}\nChatGPT can make mistakes.`;
  const scenes = parseScenes(page);
  assert.strictEqual(scenes.length, LONG_SCENES, 'four scenes read after the question');
  assert.ok(scenes[0].includes('Scene 1 action') && scenes[3].includes('Scene 4 action'), 'scenes in order');
  assert.ok(!scenes.some((s) => /SCENE \d:/.test(s)), 'scene labels are not part of the prompts');

  const bold = answer.replace(/SCENE (\d):/g, '**SCENE $1**');
  assert.strictEqual(parseScenes(bold).length, 4, 'bold scene labels are read too');
  const three = ['SCENES_BEGIN', ...pictures, ...[1, 2, 3].flatMap((n) => [`SCENE ${n}:`, scene(n)]), 'SCENES_END'].join('\n');
  assert.deepStrictEqual(parseScenes(three), [], 'three scenes: rejected, never a short video');
  const unfinished = ['SCENES_BEGIN', 'SCENE 1:', scene(1), 'SCENE 2:', scene(2)].join('\n');
  assert.deepStrictEqual(parseScenes(`${question}\n${unfinished}`), [], 'an answer without its end marker is not read');
  const shortOne = answer.replace(scene(2), 'too short');
  assert.deepStrictEqual(parseScenes(shortOne), [], 'a scene too short to be a prompt is rejected');
  const plan = parsePlan(page)!;
  assert.ok(plan && plan.castImage === cast && plan.placeImage === place, 'both picture prompts are read');
  const noPlace = ['SCENES_BEGIN', 'CAST IMAGE:', cast, ...[1, 2, 3, 4].flatMap((n) => [`SCENE ${n}:`, scene(n)]), 'SCENES_END'].join('\n');
  assert.strictEqual(parsePlan(noPlace), null, 'a plan without the place picture is rejected');
  console.log('ok scene answer parsing');

  // pictures attached to a scene keep their numbering even when one is missing
  const all = sceneImages({ first: 'f.jpg', character: 'ref.png', cast: 'cast.jpg', place: 'place.jpg' });
  assert.deepStrictEqual(all.map((i) => `${i.role}:${i.path}`), ['first:f.jpg', 'reference:ref.png', 'reference:cast.jpg', 'reference:place.jpg'], 'order and roles');
  const noPlacePic = sceneImages({ first: 'f.jpg', character: 'ref.png', cast: 'cast.jpg' });
  assert.strictEqual(noPlacePic.length, 4, 'still 4 pictures when the place picture failed');
  assert.strictEqual(noPlacePic[3].path, 'cast.jpg', 'the cast picture stands in for the place');
  assert.deepStrictEqual(sceneImages({}), [], 'nothing to attach: none');
  assert.ok(/@Image 1 = the first frame/.test(sceneImageLegend(1)) && /@Image 4 = the place/.test(sceneImageLegend(2)), 'legend names all 4 pictures');
  console.log('ok scene pictures and legend');

  // 2. The channel switch
  const ch = createChannel('Long Test Channel');
  assert.strictEqual(getChannel(ch.id)!.long_video, false, '1-minute videos are off by default');
  updateChannel(ch.id, { long_video: true });
  assert.strictEqual(getChannel(ch.id)!.long_video, true, 'the switch is saved');
  console.log('ok channel switch');

  // 3. Make-only result message
  const made = describeResult(
    {
      success: true, jobId: 'job_x', title: 'Treasure Time', hook: '#x', videoPath: 'x.mp4', durationSeconds: 60.2, qaPassed: true,
      tiktokStatus: 'off', tiktokVerified: false, youtubeStatus: 'off', youtubeVerified: false,
      postedEverywhere: false, postedAnywhere: false, postFailed: [], madeOnly: true, message: '',
    } as any,
    false
  );
  assert.ok(made.ok && /without posting/.test(made.message) && /60s/.test(made.message), `make-only reads as a success (${made.message})`);
  console.log('ok make-only message');

  // 4. Joining clips (needs ffmpeg)
  if (audioToolsAvailable()) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kindred-long-'));
    const clips: string[] = [];
    for (let i = 0; i < 4; i++) {
      const out = path.join(dir, `shot_${i + 1}.mp4`);
      // the last clip is a slightly different size, like a Grok clip that came back at another resolution
      const size = i === 3 ? '200x360' : '180x320';
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc=size=${size}:rate=24:duration=3`,
        '-f', 'lavfi', '-i', `sine=frequency=${220 + i * 110}:duration=3`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', out]);
      clips.push(out);
    }
    const joined = await concatClips(clips, path.join(dir, 'joined.mp4'));
    const d = await mediaDuration(joined);
    assert.ok(Math.abs(d - 12) < 0.5, `joined length is the sum of the scenes (${d}s)`);
    const streams = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height', '-of', 'csv=p=0', joined]).toString().trim().split('\n');
    assert.ok(streams.some((l) => l.startsWith('video,180,320')), `joined video keeps the first clip's size (${streams.join(' | ')})`);
    assert.ok(streams.some((l) => l.startsWith('audio')), 'joined video has sound');

    const silent = path.join(dir, 'silent.mp4');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=180x320:rate=24:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', silent]);
    await assert.rejects(() => concatClips([clips[0], silent], path.join(dir, 'bad.mp4')), /no sound/, 'a scene without sound stops the join');
    console.log('ok clips joined');

    // the last frame (it starts the next scene): red for 2 s, then blue for the last second → the frame must be blue
    const colors = path.join(dir, 'colors.mp4');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=180x320:d=2:r=24', '-f', 'lavfi', '-i', 'color=c=blue:s=180x320:d=1:r=24',
      '-filter_complex', '[0:v][1:v]concat=n=2:v=1[v]', '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', colors]);
    const frame = await lastFrame(colors, path.join(dir, 'last.jpg'));
    const px = execFileSync('ffmpeg', ['-v', 'error', '-i', frame, '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
    assert.ok(px[2] > 150 && px[0] < 80, `the last frame is the final (blue) frame, rgb=${[...px].join(',')}`);
    const dims = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', frame]).toString().trim();
    assert.strictEqual(dims, '180,320', 'the last frame keeps the video size');
    fs.rmSync(dir, { recursive: true, force: true });
    console.log('ok last frame');
  } else {
    console.log('skip clip joining (ffmpeg not installed)');
  }

  // 5. Several pictures on Grok's composer, each with its role (stand-in page; never a real Grok)
  {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(`<!doctype html><html><body>
        <form><div id="thumbs"></div><div contenteditable="true" role="textbox"></div>
          <input type="file" accept="image/*" style="display:none"><input id="multi" type="file" multiple accept="image/*" style="display:none"></form>
        <div id="menu" style="display:none"><div role="menuitem">First frame<br>Image starts the video</div><div role="menuitem">Intermediate frame</div><div role="menuitem">Last frame<br>Image ends the video</div><div role="menuitem">Reference<br>Image guides the video</div></div>
        <script>
          window.roles = {}; let current = -1;
          document.getElementById('multi').addEventListener('change', (e) => {
            for (const f of e.target.files) {
              const i = document.querySelectorAll('#thumbs img').length;
              document.getElementById('thumbs').insertAdjacentHTML('beforeend', '<span><img data-i="' + i + '" alt="' + f.name + '" style="width:40px;height:40px;display:inline-block;background:#ccc"><button aria-label="Remove image">x</button></span>');
              window.roles[i] = 'Reference';
            }
          });
          document.addEventListener('click', (e) => {
            const img = e.target.closest('#thumbs img');
            if (img) { current = Number(img.dataset.i); document.getElementById('menu').style.display = 'block'; return; }
            const item = e.target.closest('[role=menuitem]');
            if (item) { window.roles[current] = item.firstChild.textContent.trim(); document.getElementById('menu').style.display = 'none'; }
          });
        </script></body></html>`);
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kindred-pics-'));
      const pics = ['first.jpg', 'ref.png', 'cast.jpg', 'place.jpg'].map((n) => { const f = path.join(dir, n); fs.writeFileSync(f, 'x'); return f; });
      const agent = getAgent(ch.id);
      const n = await agent.attachGrokImages(page, sceneImages({ first: pics[0], character: pics[1], cast: pics[2], place: pics[3] }));
      assert.strictEqual(n, 4, 'all 4 pictures attached through the multiple file input');
      const roles = await page.evaluate(() => (window as any).roles);
      assert.deepStrictEqual(roles, { 0: 'First frame', 1: 'Reference', 2: 'Reference', 3: 'Reference' }, `roles set (${JSON.stringify(roles)})`);
      fs.rmSync(dir, { recursive: true, force: true });
      console.log('ok several pictures with roles');
    } finally {
      await browser.close();
    }
  }

  cleanup();
  console.log('--- ALL LONG VIDEO TESTS PASSED ---');
}

run().then(() => process.exit(0)).catch((err) => {
  console.error('LONG VIDEO TESTS FAILED:', err);
  cleanup();
  process.exit(1);
});
