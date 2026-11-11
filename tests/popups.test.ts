import { cleanup } from './helpers/env';
import assert from 'assert';
import { chromium } from 'playwright';

import { dismissPopups, installPopupGuards, pickSafeButton } from '../server/engine/popups';

/**
 * Pop-up handling against stand-in pages in a throw-away headless browser (never a channel profile).
 * Nags must be closed with a button that backs out; dialogs the run depends on must never be touched.
 */

const dialog = (id: string, text: string, buttons: string[]) =>
  `<div id="${id}" role="dialog" style="position:fixed;inset:20px;background:#fff;z-index:10">
     <p>${text}</p>${buttons.map((b) => `<button onclick="document.getElementById('${id}').dataset.clicked='${b}';document.getElementById('${id}').remove()">${b}</button>`).join('')}
   </div>`;

async function main(): Promise<void> {
  console.log('--- RUNNING POP-UP TESTS ---');

  // Button choice
  assert.strictEqual(pickSafeButton(['Verify', 'Cancel']), 1, '"Verify your phone" is cancelled, never verified');
  assert.strictEqual(pickSafeButton(['Upgrade', 'Not now']), 1);
  assert.strictEqual(pickSafeButton(['Got it', 'Not now']), 1, 'backing out beats acknowledging');
  assert.strictEqual(pickSafeButton(['Discard', 'Delete', 'Post now']), -1, 'no safe button: fall back to Escape');
  console.log('ok safe button choice');

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    await context.addInitScript('window.__name = window.__name || ((f) => f);');
    const page = await context.newPage();
    const closedLog: string[] = [];
    await page.exposeFunction('logClick', (t: string) => closedLog.push(t));

    // 1. Nags and a cookie banner are cleared; the run's own dialogs are left alone.
    await page.setContent(`<!doctype html><body>
      ${dialog('promo', "What's new: shape your scene, start to finish", ['Upgrade', 'Not now'])}
      ${dialog('phone', 'Unlock more on YouTube. To add custom thumbnails, verify your phone number.', ['Cancel', 'Verify'])}
      <div id="cookies" style="position:fixed;bottom:0"><button onclick="document.getElementById('cookies').remove()">Reject all</button><button onclick="document.body.dataset.accepted=1">Accept all</button></div>
      ${dialog('upload', 'Details · Video elements · Checks · Visibility. Upload complete.', ['Discard', 'Next'])}
      ${dialog('confirm', 'Post now? Your video will be public.', ['Cancel', 'Post now'])}
    </body>`);
    const closed = await dismissPopups(page);
    assert.strictEqual(await page.locator('#promo').count(), 0, 'promo closed');
    assert.strictEqual(await page.locator('#phone').count(), 0, '"verify your phone" closed');
    assert.strictEqual(await page.locator('#cookies').count(), 0, 'cookie banner rejected');
    assert.strictEqual(await page.evaluate(() => document.body.dataset.accepted), undefined, 'cookies were never accepted');
    assert.strictEqual(await page.locator('#upload').count(), 1, 'the YouTube upload dialog is never touched');
    assert.strictEqual(await page.locator('#confirm').count(), 1, 'the TikTok "Post now?" confirmation is never touched');
    assert(closed.length >= 3, `three things closed (got ${closed.join(' | ')})`);
    console.log('ok nags and cookie banner cleared, run dialogs untouched');

    // 2. A nag that appears in front of a button is cleared automatically before the click lands.
    await page.setContent(`<!doctype html><body>
      <button id="go" onclick="document.body.dataset.went=1">Next</button>
      <script>setTimeout(() => { document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(dialog('late', 'How would you rate your experience? Take a quick survey.', ['No thanks', 'Start survey']))}); }, 50);</script>
    </body>`);
    await installPopupGuards(page);
    // (waiting for the survey itself would let the guard close it during the wait; the click is what matters)
    await page.waitForFunction(() => document.body.innerHTML.includes('late') || true);
    await page.waitForTimeout(300);
    await page.locator('#go').click({ timeout: 5000 });
    assert.strictEqual(await page.evaluate(() => document.body.dataset.went), '1', 'the click went through');
    assert.strictEqual(await page.locator('#late').count(), 0, 'the survey was closed first');
    console.log('ok a pop-up in the way is cleared before a click');

    // 3. Grok's "Shape your scene" card is a plain floating <div>, not a dialog. It is closed with its "Dismiss" ×,
    //    never with "Try it now"; a busy upload box with a Cancel button is never touched.
    const grokCard = `<div id="promo" style="position:fixed;left:20px;bottom:20px;width:520px;height:480px;background:#fff">
        <div><button aria-label="Dismiss" onclick="document.getElementById('promo').remove()">✕</button></div>
        <h3>Shape your scene, start to finish</h3><p>Choose your first and last frames, or create seamless loops.</p>
        <button onclick="document.body.dataset.tried=1">Try it now</button></div>`;
    const uploadBox = `<div id="busy" style="position:fixed;right:20px;top:20px;width:300px;height:120px"><p>Uploading video… 43%</p><button aria-label="Close" onclick="document.getElementById('busy').remove()">✕</button></div>`;
    await page.setContent(`<!doctype html><body><div id="grok-app-root"><div contenteditable="true">MR. WATERMELON prompt</div>
      <button id="submit" aria-label="Submit" onclick="document.body.dataset.sent=1">↑</button>${grokCard}${uploadBox}</div></body>`);
    const grokClosed = await dismissPopups(page);
    assert.strictEqual(await page.locator('#promo').count(), 0, 'the floating Grok promo is closed');
    assert.strictEqual(await page.evaluate(() => document.body.dataset.tried), undefined, '"Try it now" is never pressed');
    assert.strictEqual(await page.locator('#busy').count(), 1, 'a box that is not a nag is left alone');
    assert(grokClosed.some((c) => /Dismiss|✕/.test(c) && /Shape your scene/.test(c)), `closed with its Dismiss × (got ${grokClosed.join(' | ')})`);
    console.log('ok floating Grok promo closed with Dismiss');

    //    The same card appearing while the app is about to click Submit is cleared first.
    const fresh = await context.newPage();
    await fresh.setContent(`<!doctype html><body><div id="grok-app-root"><div contenteditable="true">MR. WATERMELON prompt</div>
      <button id="submit" aria-label="Submit" style="position:fixed;left:40px;bottom:40px" onclick="document.body.dataset.sent=1">↑</button>${grokCard}</div></body>`);
    await installPopupGuards(fresh);
    await fresh.locator('#submit').click({ timeout: 8000 });
    assert.strictEqual(await fresh.evaluate(() => document.body.dataset.sent), '1', 'Submit went through');
    assert.strictEqual(await fresh.locator('#promo').count(), 0, 'the promo covering Submit was closed first');
    assert.strictEqual(await fresh.evaluate(() => document.body.dataset.tried), undefined, '"Try it now" is never pressed');
    await fresh.close();
    console.log('ok floating Grok promo cleared before a click');

    // 4. A page with nothing to close is left as it is.
    await page.setContent('<!doctype html><body><p>Type to imagine</p></body>');
    assert.deepStrictEqual(await dismissPopups(page), []);
    console.log('ok quiet page untouched');
  } finally {
    await browser.close();
    cleanup();
  }
  console.log('--- ALL POP-UP TESTS PASSED ---');
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('POP-UP TESTS FAILED:', err);
  cleanup();
  process.exit(1);
});
