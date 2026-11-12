import { cleanup } from './helpers/env';
import assert from 'assert';
import { chromium } from 'playwright';

import { tikTokVideoLink } from '../server/engine/jevBrowserAutomation';

/**
 * The TikTok share link is the video's own address when TikTok's confirmation page links to it, and null otherwise
 * (the caller then keeps the Studio page). Stand-in pages in a throw-away headless browser, never a channel profile.
 */
async function main(): Promise<void> {
  console.log('--- RUNNING TIKTOK SHARE LINK TESTS ---');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await (await browser.newContext()).newPage();

    await page.setContent(`<body>
      <a href="https://www.tiktok.com/tiktokstudio/content">Manage your posts</a>
      <a href="https://www.tiktok.com/@mr.apple/video/7412345678901234567?lang=en&is_from_webapp=1">View video</a>
      </body>`);
    assert.strictEqual(await tikTokVideoLink(page), 'https://www.tiktok.com/@mr.apple/video/7412345678901234567', 'video link found, query string stripped');
    console.log('ok video link found');

    await page.setContent(`<body><a href="https://www.tiktok.com/tiktokstudio/content">Manage your posts</a></body>`);
    assert.strictEqual(await tikTokVideoLink(page), null, 'Studio page only: no video link, caller keeps Studio');
    console.log('ok falls back when no video link');

    await page.setContent(`<body><a href="https://www.tiktok.com/@mr.apple">Profile</a><a href="https://example.com/@x/video/1">other</a></body>`);
    assert.strictEqual(await tikTokVideoLink(page), null, 'profile and foreign links are not video links');
    console.log('ok ignores profile and foreign links');
  } finally {
    await browser.close();
  }
  cleanup();
  console.log('--- ALL TIKTOK SHARE LINK TESTS PASSED ---');
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('TIKTOK SHARE LINK TESTS FAILED:', err);
  cleanup();
  process.exit(1);
});
