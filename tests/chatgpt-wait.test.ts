import { cleanup } from './helpers/env';
import assert from 'assert';
import { chromium } from 'playwright';

import { initDatabase } from '../server/db/database';
import { getAgent } from '../server/engine/agentRegistry';
import { isOldPrompt, promptWasUsedBefore, normalizePromptText } from '../server/engine/jevBrowserAutomation';

/**
 * Regression: a run sent "next" and then pasted the PREVIOUS reply's prompt into Grok, because the app did not notice that
 * ChatGPT was still writing the new reply (its Stop button is labelled just "Stop") and took the only prompt on the page.
 * This test feeds the waiting code a stand-in ChatGPT page that already holds an OLD reply, then slowly "writes" a NEW one.
 */

const OLD_ANIMAL = 'alpaca';
const NEW_ANIMAL = 'octopus';
const SETTINGS = '6 seconds • Vertical 9:16 • 340p • Sound enabled';

const promptLines = (animal: string): string[] => [
  `CRITICAL: EXACTLY TWO ANIMATED CHARACTERS: ONE Mr. Apple and ONE adorable baby ${animal}. NO duplicate apples, extra animals, clones, or additional characters.`,
  `Mr. Apple starts dancing IMMEDIATELY FROM FRAME ONE inside a spectacular neon stage while the baby ${animal} bounces in from the side.`,
  `0-1 SECOND: An incredibly catchy original high-energy disco-funk beat explodes with powerful bouncing bass and playful synth melodies.`,
  `1-3 SECONDS: Both characters launch into HUGE exaggerated synchronized side-to-side dancing, shoulders bouncing, feet shuffling lightning-fast.`,
  `3-5 SECONDS: The camera sweeps around both dancers, dives toward their dancing feet, and rises into a dramatic hero shot of the ${animal}.`,
  `5-6 SECONDS: The colorful spiral reveals the identical opening camera angle with Mr. Apple already dancing for a perfect seamless loop.`,
  `AUDIO: Original ultra-catchy bouncy dance music with big bass, playful synths, and joyful cartoon sound effects. Sound enabled.`,
  `VISUAL QUALITY: Premium cinematic 3D animated-feature quality, adorable expressive faces, rich saturated colors, smooth motion.`,
  SETTINGS,
];

/** A page that already shows the OLD reply, then (startNext) streams a NEW reply the way ChatGPT does. */
function standInPage(): string {
  const old = promptLines(OLD_ANIMAL).map((l) => `<div>${l}</div>`).join('');
  return `<!doctype html><html><body>
  <nav>${Array.from({ length: 12 }, (_, i) => `<a>Older chat ${i}</a>`).join('<br>')}</nav>
  <main id="chat">
    <div>
      <h3>Mr. Apple vs. Baby ${OLD_ANIMAL} — The Fluffy Fiesta Shuffle!</h3>
      <h4>Grok Video Prompt</h4><div>${SETTINGS}</div>
      <div><div>Plain text</div><div>${old}</div></div>
      <h3>TikTok Title</h3><div><div>Writing</div><p>This Fluffy Baby ${OLD_ANIMAL} Just STOLE the Dance Floor!</p><p>#MrApple #Baby${OLD_ANIMAL} #FunnyDance</p></div>
    </div>
  </main>
  <form><div contenteditable="true"></div><div id="composer-actions"></div></form>
  <script>
    const NEW_LINES = ${JSON.stringify(promptLines(NEW_ANIMAL))};
    window.startNext = (withStopButton) => {
      setTimeout(() => {
        const chat = document.getElementById('chat');
        chat.insertAdjacentHTML('beforeend', '<div style="text-align:right">next</div>');
        chat.insertAdjacentHTML('beforeend',
          '<div id="newReply"><h3>Mr. Apple vs. Baby ${NEW_ANIMAL} — The Eight-Arm Disco Challenge!</h3><h4>Grok Video Prompt</h4>' +
          '<div>${SETTINGS}</div><div><div>Plain text</div><div id="newCode"></div></div></div>');
        if (withStopButton) document.getElementById('composer-actions').innerHTML = '<button aria-label="Stop" style="width:30px;height:30px">■</button>';
        let i = 0;
        const timer = setInterval(() => {
          document.getElementById('newCode').insertAdjacentHTML('beforeend', '<div>' + NEW_LINES[i] + '</div>');
          i++;
          if (i >= NEW_LINES.length) {
            clearInterval(timer);
            document.getElementById('newReply').insertAdjacentHTML('beforeend',
              '<h3>TikTok Title</h3><div><div>Writing</div><p>This Baby ${NEW_ANIMAL} Just DOMINATED the Disco Floor!</p><p>#MrApple #Baby${NEW_ANIMAL} #FunnyDance</p></div>');
            document.getElementById('composer-actions').innerHTML = '';
          }
        }, 900);
      }, 800);
    };
  </script></body></html>`;
}

async function main(): Promise<void> {
  console.log('--- RUNNING CHATGPT WAIT TESTS ---');
  initDatabase();
  const browser = await chromium.launch({ headless: true });
  try {
    // ── pure helpers ──────────────────────────────────────────────────────────
    const oldPrompt = promptLines(OLD_ANIMAL).join('\n');
    const newPrompt = promptLines(NEW_ANIMAL).join('\n');
    const before = normalizePromptText(`next chat text ${oldPrompt} more text`);
    assert(isOldPrompt(oldPrompt, before), 'a prompt already on the page is recognised as OLD');
    assert(isOldPrompt('  ' + oldPrompt.toUpperCase().replace(/\n/g, '   '), before), 'case and spacing do not hide an old prompt');
    assert(!isOldPrompt(newPrompt, before), 'a prompt that was not on the page is NEW');
    assert(!isOldPrompt('short', before), 'text too short to identify is never called old');
    assert(promptWasUsedBefore(oldPrompt, ['something else entirely that is long enough to count as a prompt text', oldPrompt]), 'a prompt used for an earlier video is refused');
    assert(!promptWasUsedBefore(newPrompt, [oldPrompt]), 'a prompt never used before is allowed');
    console.log('ok old/new prompt rules');

    const agent = getAgent(1);
    const context = await browser.newContext();
    await context.addInitScript('window.__name = window.__name || ((f) => f);'); // same shim the app installs
    const page = await context.newPage();

    // ── the Stop button is recognised ───────────────────────────────────────────
    const writingOn = async (html: string) => {
      await page.setContent(html);
      return agent.chatGptIsWriting(page);
    };
    assert(await writingOn('<button aria-label="Stop">■</button>'), 'the "Stop" button means ChatGPT is writing');
    assert(await writingOn('<button aria-label="Stop streaming">■</button>'), '"Stop streaming" too');
    assert(await writingOn('<button data-testid="stop-button">■</button>'), 'the stop-button test id too');
    assert(!(await writingOn('<button aria-label="Stop voice mode">x</button><button aria-label="Send">y</button>')), 'voice-mode and Send buttons are not the Stop button');
    assert(!(await writingOn('<button aria-label="Stop" style="display:none">■</button>')), 'a hidden Stop button does not count');
    assert(!(await writingOn('<div>idle</div>')), 'no button: ChatGPT is idle');
    console.log('ok Stop button detection');

    // ── the real bug, two ways ───────────────────────────────────────────────────
    for (const withStop of [true, false]) {
      await page.setContent(standInPage());
      const snapshot = await agent.chatGptPageText(page);
      assert(snapshot.includes(OLD_ANIMAL), 'the stand-in page starts with the OLD reply');
      // the old prompt is readable right now, exactly like the moment the buggy run grabbed it:
      const stale = await agent.extractPromptAndTitleFromChatGpt(page);
      assert(stale.grokPrompt.includes(OLD_ANIMAL), 'the OLD prompt is what the reader sees before the new reply exists');

      const sentAt = Date.now();
      await page.evaluate((w) => (window as any).startNext(w), withStop);
      const got = await agent.waitForNewChatGptReply(page, snapshot, sentAt);
      const secs = Math.round((Date.now() - sentAt) / 1000);

      assert(got.grokPrompt.includes(NEW_ANIMAL), `the NEW prompt is returned ${withStop ? 'with' : 'without'} a Stop button (got "${got.grokPrompt.slice(0, 80)}")`);
      assert(!got.grokPrompt.includes(OLD_ANIMAL), 'the OLD prompt is never returned');
      assert(got.grokPrompt.endsWith('Sound enabled'), 'the whole prompt was waited for, not a half-written one');
      assert(secs >= 8, `it waited for the reply to be written (${secs}s)`);
      assert(new RegExp(NEW_ANIMAL, 'i').test(got.cleanTitle), `the title belongs to the new reply (got "${got.cleanTitle}")`);
      console.log(`ok new prompt ${withStop ? 'with' : 'WITHOUT'} a Stop button (${secs}s, ${got.grokPrompt.length} chars)`);
    }
    await context.close();
  } finally {
    await browser.close();
    cleanup();
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('CHATGPT WAIT TESTS FAILED:', err);
  cleanup();
  process.exit(1);
});
