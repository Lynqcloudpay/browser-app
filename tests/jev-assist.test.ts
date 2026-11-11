import { cleanup } from './helpers/env';
import assert from 'assert';
import { chromium } from 'playwright';

import { decide, controlKey, findWithJev, EXISTS_THRESHOLD, PICK_THRESHOLD } from '../server/engine/jevAssist';

/**
 * The Jev backup navigator. The decision rules run offline every time. The live part (a real Jev call against a
 * stand-in page whose buttons were renamed) runs only with KINDRED_TEST_LIVE_JEV=1 and a TYPESAFE_API_KEY.
 */
async function main(): Promise<void> {
  console.log('--- RUNNING JEV ASSIST TESTS ---');

  // Code decides: act only on a clear "a control exists" AND a clear favourite.
  assert.deepStrictEqual(decide(0.95, { video_mode_1: 0.9, image_mode_0: 0.1 }).key, 'video_mode_1');
  assert.strictEqual(decide(0.4, { video_mode_1: 0.9 }).key, null, 'Jev doubts any control fits: click nothing');
  assert.strictEqual(decide(0.95, { a_1: 0.5, b_2: 0.5 }).key, null, 'no clear favourite: click nothing');
  assert.strictEqual(decide(0.95, {}).key, null);
  assert(EXISTS_THRESHOLD >= 0.7 && PICK_THRESHOLD >= 0.6);
  assert.strictEqual(controlKey(3, 'button', 'Post'), 'button_post_3', 'option names describe the control');
  assert.strictEqual(controlKey(0, 'radio', ''), 'radio_0');
  console.log('ok decision rules');

  if (process.env.KINDRED_TEST_LIVE_JEV !== '1' || !process.env.TYPESAFE_API_KEY) {
    console.log('skip live Jev check (set KINDRED_TEST_LIVE_JEV=1 to run it)');
  } else {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext();
      await context.addInitScript('window.__name = window.__name || ((f) => f);');
      const page = await context.newPage();
      // A composer whose buttons no longer match the scripted labels ("Video" became an icon button "Motion clip").
      await page.setContent(`<!doctype html><body>
        <div role="textbox" contenteditable="true" aria-label="Type to imagine"></div>
        <button aria-label="Still image" aria-pressed="true">🖼</button>
        <button aria-label="Motion clip" aria-pressed="false" onclick="document.body.dataset.mode='video'">🎬</button>
        <button aria-label="Agent">🤖</button>
        <button aria-label="Upload">+</button>
        <button aria-label="Submit">↑</button></body>`);
      const t = Date.now();
      const pick = await findWithJev(page, 'switch the prompt composer to Video mode so it makes a video instead of an image', 'Grok Imagine');
      assert(pick, 'Jev found the renamed video toggle');
      await pick!.click();
      assert.strictEqual(await page.evaluate(() => document.body.dataset.mode), 'video', 'the click hit the right control');
      console.log(`ok live: Jev picked the renamed Video toggle in ${Date.now() - t} ms`);

      await page.setContent('<!doctype html><body><button>Save draft</button><button>Discard</button></body>');
      const none = await findWithJev(page, 'publish the uploaded video now (the final Post button, not Save draft or Discard)', 'TikTok Studio upload');
      assert.strictEqual(none, null, 'when no control fits, Jev backs off instead of clicking something else');
      console.log('ok live: no Post button on screen, nothing clicked');
    } finally {
      await browser.close();
    }
  }
  cleanup();
  console.log('--- ALL JEV ASSIST TESTS PASSED ---');
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('JEV ASSIST TESTS FAILED:', err);
  cleanup();
  process.exit(1);
});
