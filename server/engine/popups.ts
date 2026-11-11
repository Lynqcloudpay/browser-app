import type { Page, Locator } from 'playwright';

/**
 * Unattended runs meet pop-ups nobody planned for: cookie banners, "what's new" promos, "verify your phone number",
 * survey prompts, notification requests. Any of them can sit on top of the page and swallow the next click, which used
 * to stop a run. This module clears them in two ways:
 *  - installPopupGuards: Playwright locator handlers, run automatically right before the app clicks or types.
 *  - dismissPopups: an explicit sweep, called inside the long waiting loops (ChatGPT writing, Grok rendering, posting),
 *    where no click happens for minutes.
 *
 * Only dialogs whose text matches a known nag are touched, and only with a button that backs out of them. Dialogs the
 * run depends on (YouTube's upload dialog, TikTok's "Post now?" confirmation, sign-in pages) never match.
 */

/** Text that identifies a dialog as a dismissible nag, promo or survey. */
export const NAG_TEXT =
  /unlock more on youtube|verify your phone number|what'?s new|try it now|shape your scene|introducing|new feature|turn on (desktop )?notifications|enable notifications|allow notifications|rate (your|this) experience|how (would|do) you rate|quick survey|take a survey|invite teammates|bring grok to your team|welcome to (youtube |tiktok )?studio|install (the )?app|download the app|get the app|set up (a )?passkey|create a passkey|save your password|turn on 2-step/i;

/** Buttons that back out of a nag, best first. */
export const SAFE_BUTTON = /^\s*(not now|maybe later|no,? thanks|dismiss|close|skip( for now)?|got it|cancel|continue|ok|okay|×|✕|x)\s*$/i;

/** Never press a button that does one of these, whatever dialog it is in. */
export const UNSAFE_BUTTON = /discard|delete|remove|post|publish|upload|verify|subscribe|buy|purchase|upgrade|pay|accept|agree|sign ?(in|up|out)|log ?(in|out)/i;

/** Cookie banners: always the most private choice. */
export const COOKIE_REJECT = /^\s*(reject all|reject optional cookies|decline( all| optional cookies)?|only (allow )?(essential|necessary) cookies|necessary cookies only|use necessary cookies only)\s*$/i;

const DIALOGS = '[role="dialog"], [role="alertdialog"], [aria-modal="true"], tp-yt-paper-dialog, ytcp-dialog';

/** Icon-only close buttons on promo cards (e.g. Grok's "Shape your scene" card has an × labelled "Dismiss"). */
const CLOSE_ICON = 'button[aria-label="Dismiss" i], button[aria-label="Close" i], button[aria-label="Not now" i]';

/**
 * Promo cards that are NOT marked as dialogs (a plain floating <div>, like Grok's "Shape your scene, start to finish …
 * Try it now"). Marks the innermost small box (≤ 600 characters) whose text is a known nag and that has its own
 * close/"not now" button, with data-kindred-nag. Returns how many were marked.
 */
async function markNagCards(page: Page): Promise<number> {
  return page
    .evaluate(
      ({ src, flags }) => {
        const nag = new RegExp(src, flags);
        const closeLabel = /^\s*(dismiss|close|not now|maybe later|no,? thanks|skip( for now)?|×|✕)\s*$/i;
        document.querySelectorAll('[data-kindred-nag]').forEach((e) => e.removeAttribute('data-kindred-nag'));
        const cards: Element[] = [];
        for (const el of Array.from(document.querySelectorAll('div, aside, section'))) {
          const r = el.getBoundingClientRect();
          if (r.width < 100 || r.height < 40) continue;
          const text = ((el as HTMLElement).innerText || '').trim();
          if (text.length < 10 || text.length > 600 || !nag.test(text)) continue;
          const hasClose = Array.from(el.querySelectorAll('button')).some((b) => {
          const br = b.getBoundingClientRect();
            if (br.width <= 0 || br.height <= 0) return false;
            const label = (b.getAttribute('aria-label') || '').trim() || ((b as HTMLElement).innerText || '').trim();
            return closeLabel.test(label);
          });
          if (hasClose) cards.push(el);
        }
        const innermost = cards.filter((c) => !cards.some((o) => o !== c && c.contains(o)));
        innermost.forEach((e) => e.setAttribute('data-kindred-nag', '1'));
        return innermost.length;
      },
      { src: NAG_TEXT.source, flags: NAG_TEXT.flags }
    )
    .catch(() => 0);
}

/** Index of the button that safely closes a nag dialog, or -1 when it has none (then Escape is pressed). */
export function pickSafeButton(labels: string[]): number {
  const usable = labels.map((label, i) => ({ label: label.trim(), i })).filter((b) => b.label && !UNSAFE_BUTTON.test(b.label));
  const order = [/not now|maybe later|no,? thanks/i, /dismiss|close|skip|×|✕|^x$/i, /cancel/i, /got it|ok|okay|continue/i];
  for (const rank of order) {
    const hit = usable.find((b) => SAFE_BUTTON.test(b.label) && rank.test(b.label));
    if (hit) return hit.i;
  }
  return -1;
}

async function closeNag(page: Page, dialog: Locator): Promise<string | null> {
  const text = ((await dialog.innerText({ timeout: 1000 }).catch(() => '')) || '').replace(/\s+/g, ' ').slice(0, 80);
  const buttons = dialog.locator('button, [role="button"], a[role="button"]');
  const count = Math.min(await buttons.count().catch(() => 0), 12);
  const labels: string[] = [];
  for (let i = 0; i < count; i++) {
    const b = buttons.nth(i);
    const visible = await b.isVisible().catch(() => false);
    const label = visible ? ((await b.innerText().catch(() => '')) || (await b.getAttribute('aria-label').catch(() => '')) || '') : '';
    labels.push(label);
  }
  const pick = pickSafeButton(labels);
  if (pick >= 0) {
    const button = buttons.nth(pick);
    // Another overlay can sit on top and swallow a real click; then press the button directly.
    const clicked = await button.click({ timeout: 2000 }).then(() => true).catch(() => false);
    if (!clicked) await button.evaluate((el) => (el as HTMLElement).click()).catch(() => {});
  } else {
    await page.keyboard.press('Escape').catch(() => {});
  }
  await page.waitForTimeout(400);
  return `${pick >= 0 ? `"${labels[pick].trim()}"` : 'Escape'} on "${text}"`;
}

/**
 * Closes every visible nag dialog and cookie banner on the page. Safe to call often; returns what it closed.
 * Never throws.
 */
export async function dismissPopups(page: Page): Promise<string[]> {
  const closed: string[] = [];
  if (page.isClosed()) return closed;
  try {
    for (let round = 0; round < 3; round++) {
      let acted = false;
      const cookie = page.getByRole('button', { name: COOKIE_REJECT }).filter({ visible: true }).first();
      if ((await cookie.count().catch(() => 0)) > 0) {
        const clicked = await cookie.click({ timeout: 2000 }).then(() => true).catch(() => false);
        if (!clicked) await cookie.evaluate((el) => (el as HTMLElement).click()).catch(() => {});
        closed.push('cookie banner');
        acted = true;
      }
      const nags = page.locator(DIALOGS).filter({ hasText: NAG_TEXT }).filter({ visible: true });
      if ((await nags.count().catch(() => 0)) > 0) {
        const what = await closeNag(page, nags.first());
        if (what) closed.push(what);
        acted = true;
      } else if ((await markNagCards(page)) > 0) {
        const what = await closeNag(page, page.locator('[data-kindred-nag]').first());
        if (what) closed.push(what);
        acted = true;
      }
      if (!acted) break;
    }
  } catch {
    // a page that navigates or closes mid-sweep is fine
  }
  if (closed.length) console.log(`[popups] Closed: ${closed.join('; ')}`);
  return closed;
}

/**
 * Registers handlers that Playwright runs right before any click or type on this page whenever a nag is in the way.
 * Installed once per page.
 */
export async function installPopupGuards(page: Page): Promise<void> {
  const marked = page as Page & { __kindredGuards?: boolean };
  if (marked.__kindredGuards) return;
  marked.__kindredGuards = true;
  const nag = page.locator(DIALOGS).filter({ hasText: NAG_TEXT }).first();
  await page
    .addLocatorHandler(nag, async (dialog) => {
      const what = await closeNag(page, dialog);
      if (what) console.log(`[popups] Cleared before an action: ${what}`);
    }, { noWaitAfter: true, times: 20 })
    .catch(() => {});
  // Promo cards that are not dialogs: present while some box holds nag text AND an icon close button.
  const card = page.locator('div, aside, section').filter({ hasText: NAG_TEXT }).filter({ has: page.locator(CLOSE_ICON) }).first();
  await page
    .addLocatorHandler(card, async () => {
      if ((await markNagCards(page)) === 0) return;
      const what = await closeNag(page, page.locator('[data-kindred-nag]').first());
      if (what) console.log(`[popups] Cleared before an action: ${what}`);
    }, { noWaitAfter: true, times: 20 })
    .catch(() => {});
  const cookie = page.getByRole('button', { name: COOKIE_REJECT }).first();
  await page
    .addLocatorHandler(cookie, async (button) => {
      await button.click({ timeout: 3000 }).catch(() => {});
    }, { noWaitAfter: true, times: 5 })
    .catch(() => {});
}
