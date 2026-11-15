import { cleanup } from './helpers/env';
import assert from 'assert';
import { chromium } from 'playwright';

import { tikTokVideoLink, pickInstagramReelLink, setInstagramCover } from '../server/engine/jevBrowserAutomation';
import { videoLink } from '../server/routes/library';

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

    // ── Instagram: the newest Reel on the account's Reels tab, never a pinned one or an earlier video's ──
    const grid = [
      { href: 'https://www.instagram.com/mr.marshmallow/reel/PINNED1/', pinned: true },
      { href: 'https://www.instagram.com/mr.marshmallow/reel/NEW123abc/?utm=1', pinned: false },
      { href: 'https://www.instagram.com/mr.marshmallow/reel/OLD456def/', pinned: false },
    ];
    assert.strictEqual(pickInstagramReelLink(grid, ['https://www.instagram.com/reel/OLD456def/']), 'https://www.instagram.com/reel/NEW123abc/', 'pinned skipped, newest taken, canonical form');
    assert.strictEqual(pickInstagramReelLink(grid.slice(0, 1).concat(grid.slice(2)), ['https://www.instagram.com/reel/OLD456def/']), null, 'newest is an earlier video: not listed yet, no link');
    assert.strictEqual(pickInstagramReelLink([{ href: 'https://www.instagram.com/explore/', pinned: false }]), null, 'no Reel links: no link');
    console.log('ok Instagram Reel link');

    assert.strictEqual(videoLink('https://www.instagram.com/'), null, 'the bare home page is not a video link');
    assert.strictEqual(videoLink('https://www.facebook.com'), null, 'nor is facebook.com');
    assert.strictEqual(videoLink('https://www.instagram.com/reel/ABC/'), 'https://www.instagram.com/reel/ABC/', 'a real Reel link is kept');
    console.log('ok home-page links are hidden');

    // ── Instagram cover: our frame goes to the cover picker, the video picker is restored afterwards ──
    const fs = await import('fs');
    const os = await import('os');
    const pathMod = await import('path');
    const dir = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'kindred-cover-'));
    const coverFile = pathMod.join(dir, 'cover.jpg');
    fs.writeFileSync(coverFile, Buffer.from('/9j/4AAQSkZJRgABAQ==', 'base64'));
    // a) the cover's image input is in the Edit dialog
    await page.setContent(`<div role="dialog"><span>Cover photo</span><input type="file" accept="image/jpeg,image/png"></div>`);
    const chooser = { file: '/the/video.mp4' };
    assert.strictEqual(await setInstagramCover(page, coverFile, chooser), true, 'image input: cover set');
    assert.strictEqual(await page.locator('input[type="file"]').evaluate((i: HTMLInputElement) => i.files?.[0]?.name), 'cover.jpg', 'the cover file reached the input');
    // b) only a "Select from computer" button that opens the native picker
    await page.setContent(`<div role="dialog"><input id="h" type="file" accept="image/*,video/*" style="display:none">
      <button onclick="document.getElementById('h').click()">Select from computer</button></div>`);
    let given = '';
    page.on('filechooser', async (fc) => { given = chooser.file; await fc.setFiles(chooser.file).catch(() => {}); });
    assert.strictEqual(await setInstagramCover(page, coverFile, chooser), true, 'button: cover set through the picker');
    assert.strictEqual(given, coverFile, 'the picker was handed the cover, not the video');
    assert.strictEqual(chooser.file, '/the/video.mp4', 'the picker gives the video again afterwards');
    // c) no cover controls: false, nothing clicked
    await page.setContent(`<div role="dialog"><button>Next</button></div>`);
    assert.strictEqual(await setInstagramCover(page, coverFile, chooser), false, 'no cover controls: not set');
    fs.rmSync(dir, { recursive: true, force: true });
    console.log('ok Instagram cover');
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
