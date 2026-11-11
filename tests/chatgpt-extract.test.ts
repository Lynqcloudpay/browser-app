import { cleanup } from './helpers/env';
import assert from 'assert';
import { chromium } from 'playwright';

import { initDatabase } from '../server/db/database';
import { getAgent } from '../server/engine/agentRegistry';

/**
 * The prompt reader against a stand-in for ChatGPT's page. Uses a throw-away headless browser, never the channel's
 * profile. Regression: prompts longer than 5,000 characters were rejected, so a finished reply looked empty and the
 * run stopped with "extracted 0 chars".
 */

const line = (n: number) => `LINE ${n}: The baby armadillo spins past the lens while Mr. Apple dances in a vertical 9:16 loop with sound. `.repeat(4);

/** Newer ChatGPT markup: no <article> or conversation-turn test ids, and the code block is not a <pre>. */
function pageWithoutTurns(promptLines: number): string {
  const prompt = Array.from({ length: promptLines }, (_, i) => `<div>${line(i + 1)}</div>`).join('');
  return `<!doctype html><html><body>
    <nav>${Array.from({ length: 30 }, (_, i) => `<a>Old chat ${i}</a>`).join('<br>')}</nav>
    <main><div><div class="markdown">
      <div><div>Plain text</div><div>${prompt}<div>10 seconds • Vertical 9:16 • 720p • Sound enabled</div></div></div>
      <h3>🍎 TikTok Title</h3>
      <div><div>Writing</div><p>This Baby Armadillo Just ROLLED Into Dance Legend Status!</p><p>#MrApple #BabyArmadillo #FunnyDance</p></div>
    </div></div></main></body></html>`;
}

function page(promptLines: number): string {
  const prompt = Array.from({ length: promptLines }, (_, i) => line(i + 1)).join('\n');
  return `<!doctype html><html><body>
    <nav id="history" style="height:200px;overflow:auto">${Array.from({ length: 80 }, (_, i) => `<a>Old chat ${i}</a>`).join('<br>')}</nav>
    <main>
      <section data-testid="conversation-turn-1"><div data-message-author-role="user">next</div></section>
      <section data-testid="conversation-turn-2">
        <div data-message-author-role="assistant">
          <h3>Grok video prompt</h3>
          <div class="contain-inline-size"><div>Plain text</div><pre>${prompt}\n10 seconds • Vertical 9:16 • 720p • Sound enabled</pre></div>
          <h3>🍎 TikTok Title</h3>
          <div><div>Writing</div><p>This Baby Armadillo Just ROLLED Into Dance Legend Status!</p><p>#MrApple #BabyArmadillo #FunnyDance</p></div>
          <button aria-label="Copy">copy</button>
        </div>
      </section>
    </main></body></html>`;
}

async function main(): Promise<void> {
  console.log('--- RUNNING CHATGPT EXTRACT TESTS ---');
  initDatabase();
  const browser = await chromium.launch({ headless: true });
  try {
    const agent = getAgent(1);
    // Same shim the app installs in launchPersistent: tsx injects a __name() helper into in-page functions.
    const context = await browser.newContext();
    await context.addInitScript('window.__name = window.__name || ((f) => f);');
    const p = await context.newPage();

    await p.setContent(page(3));
    const short = await agent.extractPromptAndTitleFromChatGpt(p);
    assert(short.grokPrompt.length > 60, 'a short prompt is read');
    console.log(`ok short prompt (${short.grokPrompt.length} chars)`);

    await p.setContent(page(14));
    const long = await agent.extractPromptAndTitleFromChatGpt(p);
    assert(long.grokPrompt.length > 5200, `a prompt over 5,000 characters is read (got ${long.grokPrompt.length})`);
    assert(long.grokPrompt.includes('Sound enabled'), 'the end of the prompt is kept');
    assert(!/^Plain text/i.test(long.grokPrompt), 'the code-block header is removed');
    assert(/Armadillo/.test(long.cleanTitle), `title is read (got "${long.cleanTitle}")`);
    assert(long.cleanHook.includes('#MrApple'), 'hashtags are read');
    console.log(`ok long prompt (${long.grokPrompt.length} chars), title and hashtags`);

    await p.setContent(pageWithoutTurns(14));
    const noTurns = await agent.extractPromptAndTitleFromChatGpt(p);
    assert(noTurns.grokPrompt.length > 5200, `a long prompt is read when the page has no turn containers (got ${noTurns.grokPrompt.length})`);
    assert(noTurns.grokPrompt.includes('Sound enabled'));
    console.log(`ok long prompt without turn containers (${noTurns.grokPrompt.length} chars)`);
    await p.close();
  } finally {
    await browser.close();
    cleanup();
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('CHATGPT EXTRACT TESTS FAILED:', err);
  cleanup();
  process.exit(1);
});
