import type { Page, Locator } from 'playwright';

/**
 * Jev as a backup navigator. The scripted steps find buttons by their exact labels, which is fast but breaks when a
 * site renames or restyles a control (Grok's Video toggle did). When a scripted lookup fails, the step can ask Jev to
 * pick the control from what is on screen instead of failing the run.
 *
 * Jev makes the judgment (which control matches the goal, and whether any does); this code decides whether to act:
 * only when Jev says a matching control exists AND puts most of its probability on one control.
 */

const ENDPOINT = process.env.TYPESAFE_API_URL || 'https://api.typesafe.ai/v1/systemone';
/** "Some control does this" must be at least this likely before anything is clicked. */
export const EXISTS_THRESHOLD = 0.7;
/** The chosen control must carry at least this much of the probability. */
export const PICK_THRESHOLD = 0.6;
const MAX_CONTROLS = 60;

export interface Control {
  key: string;
  description: string;
}

export interface JevPick {
  key: string | null;
  exists: number;
  probability: number;
  reason: string;
}

export function jevAvailable(): boolean {
  return Boolean(process.env.TYPESAFE_API_KEY) && process.env.KINDRED_NO_JEV !== '1';
}

/** Option names are read by the model, so each one says what the control is ("button_post", "radio_public"). */
export function controlKey(index: number, role: string, label: string): string {
  const slug = `${role}_${label}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return `${slug || 'control'}_${index}`;
}

/** The decision, in code: act only on a clear yes and a clear favourite. */
export function decide(exists: number, probabilities: Record<string, number>): { key: string | null; probability: number } {
  const [key, probability] = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0] || [null, 0];
  if (!key || exists < EXISTS_THRESHOLD || probability < PICK_THRESHOLD) return { key: null, probability: probability || 0 };
  return { key, probability };
}

/** Lists the visible controls on the page and tags each one so the chosen one can be clicked afterwards. */
async function snapshotControls(page: Page): Promise<Control[]> {
  const raw: Array<{ i: number; role: string; label: string; state: string }> = await page.evaluate((max) => {
    const sel =
      'button, a[href], input:not([type="hidden"]), textarea, select, [contenteditable="true"], [role="button"], [role="radio"], [role="menuitemradio"], [role="menuitem"], [role="tab"], [role="switch"], [role="checkbox"], [role="option"], [role="textbox"]';
    const out: Array<{ i: number; role: string; label: string; state: string }> = [];
    document.querySelectorAll('[data-kindred-jev]').forEach((el) => el.removeAttribute('data-kindred-jev'));
    const els = Array.from(document.querySelectorAll(sel)) as HTMLElement[];
    for (const el of els) {
      if (out.length >= max) break;
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (r.width < 4 || r.height < 4 || style.visibility === 'hidden' || style.display === 'none') continue;
      const role = el.getAttribute('role') || (el.tagName === 'A' ? 'link' : el.tagName === 'INPUT' ? `input-${(el as HTMLInputElement).type}` : el.tagName.toLowerCase());
      const label = (
        el.getAttribute('aria-label') ||
        (el as HTMLElement).innerText ||
        el.getAttribute('placeholder') ||
        el.getAttribute('title') ||
        el.getAttribute('name') ||
        ''
      )
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 60);
      if (!label) continue;
      const flags = [
        el.getAttribute('aria-pressed') === 'true' ? 'pressed' : '',
        el.getAttribute('aria-checked') === 'true' ? 'selected' : '',
        el.getAttribute('aria-disabled') === 'true' || (el as HTMLButtonElement).disabled ? 'disabled' : '',
      ].filter(Boolean);
      el.setAttribute('data-kindred-jev', String(out.length));
      out.push({ i: out.length, role, label, state: flags.join(', ') });
    }
    return out;
  }, MAX_CONTROLS);
  return raw.map((c) => ({
    key: controlKey(c.i, c.role, c.label),
    description: `${c.role} "${c.label}"${c.state ? ` (${c.state})` : ''}`,
  }));
}

/** Asks Jev which control achieves the goal, and whether any does. Throws only on a programming error, never on the API. */
export async function askJev(goal: string, site: string, controls: Control[], timeoutMs = 8000): Promise<JevPick> {
  if (!jevAvailable()) return { key: null, exists: 0, probability: 0, reason: 'no TypeSafe key' };
  if (controls.length === 0) return { key: null, exists: 0, probability: 0, reason: 'no visible controls' };
  const criteria: Record<string, string> = {};
  const state: Record<string, string> = {};
  for (const c of controls) {
    criteria[c.key] = c.description;
    state[c.key] = c.description;
  }
  const body = {
    model: 'jev-latest',
    state: { site, goal, controls_on_screen: state },
    questions: {
      pick: { type: 'choice', instructions: `Which control on the ${site} page should be clicked to: ${goal}?`, criteria },
      exists: { type: 'noul', instructions: `One of \`controls_on_screen\` can be clicked to: ${goal}` },
    },
  };
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.TYPESAFE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { key: null, exists: 0, probability: 0, reason: `Jev API returned ${res.status}` };
    const data: any = await res.json();
    const exists = Number(data?.answers?.exists?.noul) || 0;
    const probabilities: Record<string, number> = data?.answers?.pick?.probabilities || {};
    const { key, probability } = decide(exists, probabilities);
    return { key, exists, probability, reason: key ? 'picked' : `not sure enough (exists ${exists.toFixed(2)}, best ${probability.toFixed(2)})` };
  } catch (err: any) {
    return { key: null, exists: 0, probability: 0, reason: `Jev API error: ${err?.message || err}` };
  }
}

/**
 * Backup lookup: when the scripted locator for a control finds nothing, ask Jev which control on screen does `goal`.
 * Returns a locator for it, or null when Jev is unavailable, unsure, or picks nothing. Never throws.
 */
export async function findWithJev(page: Page, goal: string, site: string): Promise<Locator | null> {
  if (!jevAvailable() || page.isClosed()) return null;
  const started = Date.now();
  try {
    const controls = await snapshotControls(page);
    const pick = await askJev(goal, site, controls);
    const ms = Date.now() - started;
    if (!pick.key) {
      console.warn(`[jev] ${site}: could not find "${goal}" (${pick.reason}, ${ms} ms)`);
      return null;
    }
    const index = Number(pick.key.split('_').pop());
    console.log(`[jev] ${site}: "${goal}" -> ${controls[index]?.description} (p=${pick.probability.toFixed(2)}, ${ms} ms)`);
    return page.locator(`[data-kindred-jev="${index}"]`).first();
  } catch (err: any) {
    console.warn(`[jev] ${site}: lookup failed for "${goal}": ${err?.message || err}`);
    return null;
  }
}
