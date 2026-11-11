import { cleanup } from './helpers/env';
import assert from 'assert';
import { chromium, Page } from 'playwright';

import { initDatabase } from '../server/db/database';
import { getAgent } from '../server/engine/agentRegistry';

/**
 * Regression: Mr Watermelon's runs sat on the Grok page for 6 minutes with the prompt typed and nothing generating.
 * Grok keeps its Submit arrow DISABLED while it processes the reference image (the watermelon is a 2.3 MB PNG; Mr. Apple's
 * is 52 KB), and a click or Enter on a disabled Submit is silently ignored. The app checked once, pressed Enter anyway,
 * and waited for a video that never started. This test feeds submitGrokPrompt a stand-in Grok page that behaves the same way.
 */

const PROMPT = 'MR. WATERMELON — a spectacular dance. '.repeat(10);

/** mode: what the stand-in does with a Submit click / Enter once it IS enabled. */
function grokPage(opts: { enableAfterMs: number; mode: 'accept' | 'ignore-click' | 'ignore-all' }): string {
  return `<!doctype html><html><body>
  <form id="f">
    <div id="chip"><span id="spinner">⟳ processing image</span></div>
    <div id="box" contenteditable="true">${PROMPT}</div>
    <button type="submit" aria-label="Submit" id="sub" disabled>↑</button>
  </form>
  <script>(() => {
    window.clicks = 0; window.enters = 0; window.enabledAt = 0;
    const sub = document.getElementById('sub'), box = document.getElementById('box');
    const MODE = ${JSON.stringify(opts.mode)};
    setTimeout(() => { sub.disabled = false; document.getElementById('spinner').remove(); window.enabledAt = Date.now(); }, ${opts.enableAfterMs});
    const takeIt = () => { history.pushState({}, '', '/imagine/post/abc'); document.body.insertAdjacentHTML('beforeend', '<p>5% rendering</p>'); box.innerText = ''; };
    sub.addEventListener('click', (e) => { e.preventDefault(); window.clicks++; if (MODE === 'accept') takeIt(); });
    box.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault(); window.enters++;
      if (!sub.disabled && MODE !== 'ignore-all') takeIt(); // a disabled Submit ignores Enter, like Grok
    });
  })();</script></body></html>`;
}

async function open(page: Page, html: string): Promise<void> {
  await page.route('https://grok.test/**', (route) => route.fulfill({ contentType: 'text/html', body: html }));
  await page.goto('https://grok.test/imagine');
}

async function main(): Promise<void> {
  console.log('--- RUNNING GROK SUBMIT TESTS ---');
  initDatabase();
  const browser = await chromium.launch({ headless: true });
  try {
    const agent = getAgent(1);
    const context = await browser.newContext();
    await context.addInitScript('window.__name = window.__name || ((f) => f);'); // same shim the app installs
    const textboxOf = (page: Page) => page.locator('#box');

    // 1. The bug itself: Enter while Submit is disabled does nothing at all.
    {
      const page = await context.newPage();
      await open(page, grokPage({ enableAfterMs: 4000, mode: 'accept' }));
      await textboxOf(page).click();
      await page.keyboard.press('Enter');
      await page.waitForTimeout(600);
      assert.strictEqual(await page.evaluate(() => location.pathname), '/imagine', 'Enter on a disabled Submit does not start anything (the old behaviour)');
      assert.strictEqual(await page.evaluate(() => (window as any).enters), 1);
      console.log('ok stand-in reproduces the bug (Enter while disabled is ignored)');
      await page.close();
    }

    // 2. The fix: wait until Submit is enabled, click once, and Grok takes it.
    {
      const page = await context.newPage();
      await open(page, grokPage({ enableAfterMs: 4000, mode: 'accept' }));
      const t0 = Date.now();
      await agent.submitGrokPrompt(page, textboxOf(page), PROMPT.length);
      const secs = (Date.now() - t0) / 1000;
      assert(secs >= 3.5, `it waited for Grok to finish processing the image (${secs.toFixed(1)}s)`);
      assert.strictEqual(await page.evaluate(() => (window as any).clicks), 1, 'clicked exactly once');
      assert.strictEqual(await page.evaluate(() => (window as any).enters), 0, 'no Enter was needed');
      assert((await page.evaluate(() => location.pathname)).includes('/imagine/post/'), 'Grok moved to the result page');
      console.log(`ok waits for the image to finish, then submits once (${secs.toFixed(1)}s)`);
      await page.close();
    }

    // 3. A click Grok ignores is retried once with Enter.
    {
      const page = await context.newPage();
      await open(page, grokPage({ enableAfterMs: 300, mode: 'ignore-click' }));
      await agent.submitGrokPrompt(page, textboxOf(page), PROMPT.length, { acceptTimeoutMs: 2000 });
      assert.strictEqual(await page.evaluate(() => (window as any).clicks), 1);
      assert.strictEqual(await page.evaluate(() => (window as any).enters), 1, 'Enter was pressed once after the ignored click');
      console.log('ok an ignored click falls back to Enter once');
      await page.close();
    }

    // 4. Submit never becomes enabled: a clear error, and nothing was submitted.
    {
      const page = await context.newPage();
      await open(page, grokPage({ enableAfterMs: 60_000, mode: 'accept' }));
      await assert.rejects(
        () => agent.submitGrokPrompt(page, textboxOf(page), PROMPT.length, { enableTimeoutMs: 1500 }),
        /stayed disabled.*Nothing was submitted/,
        'a Submit that never enables is reported, not waited on for 6 minutes'
      );
      assert.strictEqual(await page.evaluate(() => (window as any).clicks), 0, 'no click on a disabled button');
      assert.strictEqual(await page.evaluate(() => (window as any).enters), 0);
      console.log('ok Submit that never enables -> clear error, nothing pressed');
      await page.close();
    }

    // 5. Enabled, but Grok takes neither the click nor Enter: fail fast.
    {
      const page = await context.newPage();
      await open(page, grokPage({ enableAfterMs: 100, mode: 'ignore-all' }));
      const t0 = Date.now();
      await assert.rejects(
        () => agent.submitGrokPrompt(page, textboxOf(page), PROMPT.length, { acceptTimeoutMs: 1500 }),
        /did not accept the submit.*Nothing was submitted/
      );
      assert((Date.now() - t0) / 1000 < 10, 'fails within seconds, not after 6 minutes');
      console.log('ok a submit Grok never takes fails fast');
      await page.close();
    }

    await context.close();
  } finally {
    await browser.close();
    cleanup();
  }
  console.log('--- ALL GROK SUBMIT TESTS PASSED ---');
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('GROK SUBMIT TESTS FAILED:', err);
  cleanup();
  process.exit(1);
});
