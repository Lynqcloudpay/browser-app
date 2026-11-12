import { cleanup } from './helpers/env';
import assert from 'assert';
import { chromium } from 'playwright';

import { youTubeConfirmation, youTubeCloseButton } from '../server/engine/jevBrowserAutomation';

/**
 * YouTube's confirmation after Publish, against stand-in pages in a throw-away headless browser (never a channel
 * profile). YouTube Studio keeps unused dialogs in the page, hidden; the visible "Video processing" dialog must still
 * be recognised. Regression: .first() picked a hidden dialog and every run reported "YouTube did not confirm".
 */
async function main(): Promise<void> {
  console.log('--- RUNNING YOUTUBE CONFIRMATION TESTS ---');
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    await context.addInitScript('window.__name = window.__name || ((f) => f);');
    const page = await context.newPage();

    // A hidden share dialog comes first in the page; the visible "Video processing" dialog comes after it.
    await page.setContent(`<body>
      <ytcp-video-share-dialog style="display:none"><div>Video published</div><button id="close-button">Close</button></ytcp-video-share-dialog>
      <ytcp-uploads-still-processing-dialog><h1>Video processing</h1>
        <p>The standard definition (SD) version of your video needs to finish processing before your video is public on YouTube</p>
        <p>Checks complete. No issues found.</p>
        <button id="close-button" onclick="document.body.dataset.closed='yes'">Close</button>
      </ytcp-uploads-still-processing-dialog></body>`);
    const seen = await youTubeConfirmation(page).waitFor({ state: 'visible', timeout: 3000 }).then(() => true).catch(() => false);
    assert(seen, 'visible "Video processing" dialog is recognised despite a hidden dialog before it');
    const close = youTubeCloseButton(page);
    assert(await close.isVisible(), 'the visible Close button is found, not the hidden one');
    await close.click({ timeout: 2000 });
    assert.strictEqual(await page.evaluate(() => document.body.dataset.closed), 'yes', 'Close clicks the visible dialog');
    console.log('ok hidden dialog before the visible one');

    // Only the upload dialog (no confirmation yet): nothing must count as confirmed.
    await page.setContent(`<body>
      <ytcp-video-share-dialog style="display:none"><div>Video published</div><button id="close-button">Close</button></ytcp-video-share-dialog>
      <ytcp-uploads-dialog><div>Upload complete ... Processing will begin shortly</div><button id="done-button">Publish</button></ytcp-uploads-dialog></body>`);
    const early = await youTubeConfirmation(page).waitFor({ state: 'visible', timeout: 1000 }).then(() => true).catch(() => false);
    assert(!early, 'the upload dialog alone is not a confirmation');
    assert(!(await youTubeCloseButton(page).isVisible()), 'a hidden Close button does not count');
    console.log('ok no confirmation before Publish');

    // "Video published" share dialog.
    await page.setContent(`<body><ytcp-video-share-dialog><h1>Video published</h1><button id="close-button">Close</button></ytcp-video-share-dialog></body>`);
    assert(await youTubeConfirmation(page).waitFor({ state: 'visible', timeout: 3000 }).then(() => true).catch(() => false), 'Video published');
    console.log('ok video published');
  } finally {
    await browser.close();
  }
  cleanup();
  console.log('--- ALL YOUTUBE CONFIRMATION TESTS PASSED ---');
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('YOUTUBE CONFIRMATION TESTS FAILED:', err);
  cleanup();
  process.exit(1);
});
