import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { chromium, BrowserContext, Page, FileChooser } from 'playwright';

const execFileAsync = promisify(execFile);
import JevEngine from './jevEngine';
import { ScriptPackage, ShotBrief } from './openaiWriter';
import db from '../db/database';
import GrokVideoGenerator from './xaiVideoGenerator';
import KidsSafetyQAInspector from './qaInspector';
import BufferTikTokPublisher from './bufferPublisher';
import { getPublishTargets, PublishTargets } from './publishTargets';

export interface BrowserJobResult {
  success: boolean;
  scriptPackage?: ScriptPackage;
  videoPath?: string;
  status: 'completed' | 'awaiting_login' | 'error';
  message: string;
  screenshotPath?: string;
}

/** Video options Grok Imagine offers in its composer. */
export interface GrokVideoSpec {
  durationSec: 6 | 10 | 15;
  resolution: '480p' | '720p';
  aspect: '9:16' | '16:9' | '1:1';
}
const GROK_DURATIONS: GrokVideoSpec['durationSec'][] = [6, 10, 15];

export class JevBrowserAgent {
  private static userProfileDir = path.join(__dirname, '../../storage/browser_profile');
  private static activeInteractiveContext: BrowserContext | null = null;
  private static isLaunching = false;

  /**
   * Remove stale Chromium lock files if a previous browser session crashed.
   */
  private static cleanupStaleLocks(dir: string): void {
    try {
      // SingletonLock is a symlink "<hostname>-<pid>". If that browser is still running, the lock is NOT stale:
      // removing it would let two browsers share one profile and overwrite each other's saved logins.
      const target = fs.readlinkSync(path.join(dir, 'SingletonLock'));
      const pid = Number(target.split('-').pop());
      if (pid > 0) {
        try {
          process.kill(pid, 0);
          throw new Error(
            'The app browser profile is already open in another window. Quit that browser (⌘Q) and try again.'
          );
        } catch (err: any) {
          if (err.code !== 'ESRCH') throw err.code === 'EPERM' ? new Error('Browser profile is in use by another process.') : err;
        }
      }
    } catch (err: any) {
      if (err?.message?.includes('already open') || err?.message?.includes('in use')) throw err;
      // no lock / unreadable lock → treat as stale
    }
    try {
      const lockFiles = ['SingletonLock', 'SingletonSocket', 'SingletonCookie'];
      for (const file of lockFiles) {
        const fullPath = path.join(dir, file);
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
        }
      }
    } catch {
      // Ignore errors if file is actively locked
    }
  }

  /**
   * Ensure browser profile directory exists for persistent session cookies.
   */
  private static ensureProfileDir(): string {
    if (!fs.existsSync(this.userProfileDir)) {
      fs.mkdirSync(this.userProfileDir, { recursive: true });
    }
    return this.userProfileDir;
  }

  /**
   * Launch a persistent browser context so logins to ChatGPT and Grok persist.
   * If an interactive window is already open on the user's desktop, reuses it seamlessly.
   */
  private static launchPromise: Promise<BrowserContext> | null = null;
  private static tiktokDialogPages = new WeakSet<Page>();

  public static async launchContext(headless = false): Promise<BrowserContext> {
    // Reuse the one open browser window for every step (ChatGPT -> Grok -> TikTok).
    if (this.activeInteractiveContext) {
      try {
        this.activeInteractiveContext.pages();
        return this.activeInteractiveContext;
      } catch {
        this.activeInteractiveContext = null;
      }
    }
    if (!this.launchPromise) {
      this.launchPromise = this.launchPersistent(headless)
        .then(async (context) => {
          await this.restoreCookies(context);
          this.activeInteractiveContext = context;
          context.on('close', () => {
            if (this.activeInteractiveContext === context) this.activeInteractiveContext = null;
          });
          return context;
        })
        .finally(() => {
          this.launchPromise = null;
        });
    }
    return this.launchPromise;
  }

  private static async launchPersistent(headless: boolean): Promise<BrowserContext> {
    const profileDir = this.ensureProfileDir();
    this.cleanupStaleLocks(profileDir);

    const context = await chromium.launchPersistentContext(profileDir, {
      headless,
      viewport: { width: 1280, height: 850 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      args: [
        '--no-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--disable-session-crashed-bubble',
        '--hide-crash-restore-bubble',
      ],
    });
    // tsx/esbuild injects a __name() helper into in-page functions; give every page a no-op version so evaluate() never breaks.
    await context.addInitScript('window.__name = window.__name || ((f) => f);');
    return context;
  }

  /**
   * Jev Ultrafast Autonomous Decision Step (Powered by browser-use/jev-ultrafast)
   * Takes a DOM snapshot using snapshot.js, feeds the indexed element table to TypeSafe Jev,
   * and executes the selected operation (CLICK or TYPE_TEXT) on the live DOM node.
   */
  public static async executeJevUltrafastStep(
    page: Page,
    goal: string,
    textToFill?: string
  ): Promise<{ success: boolean; operation?: string; targetLabel?: string; latencyMs: number }> {
    const startTime = Date.now();
    try {
      const snapshotPath = path.join(__dirname, '../../vendor/jev-ultrafast/jev_ultrafast/snapshot.js');
      if (!fs.existsSync(snapshotPath)) {
        return { success: false, latencyMs: Date.now() - startTime };
      }
      const snapshotCode = fs.readFileSync(snapshotPath, 'utf8');

      // 1. Evaluate snapshot.js inside page context to get indexed action table
      const snapshot = await page.evaluate((code) => {
        return eval(code);
      }, snapshotCode);

      if (!snapshot || !snapshot.actions || snapshot.actions.length === 0) {
        return { success: false, latencyMs: Date.now() - startTime };
      }

      // 2. Map actions to candidate choices for Jev
      const candidates: Record<string, string> = {};
      const actionMap = new Map<string, any>();

      snapshot.actions.slice(0, 30).forEach((a: any, idx: number) => {
        const key = `elem_${idx + 1}`;
        candidates[key] = `[${a.role}] ${a.label || a.kind}`;
        actionMap.set(key, a);
      });

      // 3. Ask TypeSafe Jev to pick the control that achieves the goal
      const jevDecision = await JevEngine.decide(
        `Jev Ultrafast Navigation: Goal is "${goal}". Page Title: "${await page.title()}". Available interactive controls:\n${Object.entries(candidates).map(([k, v]) => `${k}: ${v}`).join('\n')}`,
        {
          action_target: {
            type: 'choice',
            instructions: `Select the single element index that best advances the goal: "${goal}".`,
            criteria: candidates,
          },
        },
        { decisionType: 'jev_ultrafast_step' }
      );

      const chosenKey = jevDecision.chosenId;
      const targetAction = actionMap.get(chosenKey);

      if (!targetAction) {
        return { success: false, latencyMs: Date.now() - startTime };
      }

      console.log(`[JevUltrafast] Jev chose: ${chosenKey} (${candidates[chosenKey]}) with confidence ${jevDecision.confidence} in ${Date.now() - startTime}ms`);

      // 4. Dispatch the action directly to the cached DOM node via window.__jevFast
      if (targetAction.kind === 'fill' && textToFill) {
        await page.evaluate(({ nodeId, val }) => {
          const node = (window as any).__jevFast?.nodes?.get(nodeId);
          if (node) {
            node.focus();
            if ('value' in node) node.value = val;
            node.dispatchEvent(new Event('input', { bubbles: true }));
            node.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }, { nodeId: targetAction.node, val: textToFill });
      } else {
        await page.evaluate((nodeId) => {
          const node = (window as any).__jevFast?.nodes?.get(nodeId);
          if (node) {
            node.scrollIntoView({ block: 'center', inline: 'center' });
            node.click();
          }
        }, targetAction.node);
      }

      return {
        success: true,
        operation: targetAction.kind,
        targetLabel: targetAction.label,
        latencyMs: Date.now() - startTime,
      };
    } catch (err: any) {
      console.warn('[JevUltrafast] Step error:', err.message);
      return { success: false, latencyMs: Date.now() - startTime };
    }
  }

  /**
   * Get the active or configured ChatGPT conversation URL.
   */
  public static getConfiguredChatGptUrl(): string {
    try {
      const row = db.prepare('SELECT chatgpt_chat_url FROM settings WHERE id = 1').get() as any;
      let url = row?.chatgpt_chat_url?.trim() || process.env.CHATGPT_MR_APPLE_URL?.trim() || '';
      // If it's pointing to the old account's hardcoded conversation ID, discard it
      if (url.includes('6af2935e-bb8c-83ea-817b-3f4c6bfe7999')) {
        url = '';
      }
      return url;
    } catch {
      return '';
    }
  }

  /**
   * Save a newly resolved ChatGPT conversation URL to persistent settings.
   */
  public static saveChatGptUrl(url: string): void {
    if (!url || !url.startsWith('http')) return;
    try {
      db.prepare('UPDATE settings SET chatgpt_chat_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1').run(url);
      console.log(`[JevBrowserAgent] Persisted new ChatGPT Mr Apple URL to database: ${url}`);
    } catch (err: any) {
      console.warn('[JevBrowserAgent] Could not persist ChatGPT URL:', err.message);
    }
  }

  /**
   * Search ChatGPT sidebar or search dialog to locate the pinned "Create Mr Apple Videos" conversation.
   */
  public static async locateMrAppleConversation(
    page: Page
  ): Promise<{ url: string; title: string } | null> {
    try {
      console.log('[JevBrowserAgent] Searching ChatGPT for pinned "Create Mr Apple Videos" conversation...');

      // 1. Ensure sidebar is open
      const openSidebarBtn = await page.$(
        'button[data-testid="open-sidebar-button"], button[aria-label="Open sidebar"], button[aria-label*="sidebar" i]'
      );
      if (openSidebarBtn) {
        const isVisible = await openSidebarBtn.isVisible().catch(() => false);
        if (isVisible) {
          console.log('[JevBrowserAgent] Opening collapsed sidebar...');
          await openSidebarBtn.click().catch(() => {});
          await page.waitForTimeout(1000);
        }
      }

      // Wait a moment for conversations to hydrate
      await page.waitForSelector('nav a[href*="/c/"], [data-testid="conversation-sidebar"] a, a[href*="/c/"]', {
        timeout: 10000,
      }).catch(() => null);

      // 2. Scan links in DOM
      const match = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a[href*="/c/"]')) as HTMLAnchorElement[];

        const normalize = (str: string) => str.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();

        // Pass 1: Look for exact phrase "create mr apple videos" or "create mr apple"
        for (const a of links) {
          const text = normalize(a.innerText || a.getAttribute('aria-label') || a.title || '');
          if (text.includes('create mr apple videos') || (text.includes('mr apple') && text.includes('video'))) {
            return { url: a.href, title: (a.innerText || a.title || 'Create Mr Apple Videos').trim() };
          }
        }

        // Pass 2: Look for any "mr apple"
        for (const a of links) {
          const text = normalize(a.innerText || a.getAttribute('aria-label') || a.title || '');
          if (text.includes('mr apple') || text.includes('apple video')) {
            return { url: a.href, title: (a.innerText || a.title || 'Mr Apple').trim() };
          }
        }

        // Pass 3: Check pinned sections specifically (headers containing "pinned")
        const headers = Array.from(document.querySelectorAll('div, span, h2, h3, h4'))
          .filter(el => (el.textContent || '').trim().toLowerCase() === 'pinned');
        for (const header of headers) {
          const parent = header.closest('nav, section, div, ol, ul');
          if (parent) {
            const pinnedLinks = Array.from(parent.querySelectorAll('a[href*="/c/"]')) as HTMLAnchorElement[];
            for (const a of pinnedLinks) {
              const text = normalize(a.innerText || a.getAttribute('aria-label') || '');
              if (text.includes('apple') || text.includes('video')) {
                return { url: a.href, title: a.innerText.trim() };
              }
            }
          }
        }

        return null;
      });

      if (match) {
        console.log(`[JevBrowserAgent] Successfully found chat link in sidebar: "${match.title}" -> ${match.url}`);
        return match;
      }

      // 3. Fallback: Try ChatGPT Search Chats (Meta+K / Ctrl+K)
      console.log('[JevBrowserAgent] Not immediately visible in sidebar. Trying ChatGPT Search dialog (Meta+K)...');
      await page.keyboard.press('Meta+K');
      await page.waitForTimeout(1000);

      const searchInput = await page.$(
        'input[placeholder*="Search" i], input[type="search"], [role="combobox"], [data-testid="search-input"]'
      );
      if (searchInput) {
        await searchInput.fill('Create Mr Apple Videos');
        await page.waitForTimeout(1500);

        // Click first matching search result
        const searchResult = await page.$('a[href*="/c/"]:has-text("Apple"), [role="option"]:has-text("Apple"), div:has-text("Mr Apple")');
        if (searchResult) {
          await searchResult.click().catch(() => {});
          await page.waitForTimeout(2000);
          const currentUrl = page.url();
          if (currentUrl.includes('/c/')) {
            const currentTitle = await page.title().catch(() => 'Create Mr Apple Videos');
            return { url: currentUrl, title: currentTitle };
          }
        }
        await page.keyboard.press('Escape');
      }

      return null;
    } catch (err: any) {
      console.warn('[JevBrowserAgent] locateMrAppleConversation search note:', err.message);
      return null;
    }
  }

  /**
   * Resolves and navigates to the active "Create Mr Apple Videos" conversation page.
   * If a stored URL exists and is valid, navigates to it.
   * If invalid (e.g. from previous account) or not configured, auto-detects from sidebar.
   */
  public static async navigateToMrAppleConversation(
    page: Page,
    screenshotPath?: string
  ): Promise<string> {
    const configuredUrl = this.getConfiguredChatGptUrl();
    const framesDir = path.join(__dirname, '../../storage/frames');
    if (!fs.existsSync(framesDir)) fs.mkdirSync(framesDir, { recursive: true });
    const localScreenshotPath = screenshotPath || path.join(framesDir, `chatgpt_state_${Date.now()}.png`);

    // Helper to test if login is required
    const checkLogin = async (): Promise<boolean> => {
      const loginBtn = await page.$(
        'button[data-testid="login-button"], a[href*="/auth/login"], button:has-text("Log in")'
      );
      return !!loginBtn;
    };

    // Helper to test if conversation error is showing
    const checkConversationError = async (): Promise<boolean> => {
      return await page.evaluate(() => {
        const text = (document.body?.innerText || '').toLowerCase();
        return (
          text.includes('unable to load conversation') ||
          text.includes('conversation not found') ||
          text.includes('this conversation may have been deleted') ||
          text.includes('page not found')
        );
      }).catch(() => false);
    };

    // Helper to wait until the conversation content and prompt input have actually finished loading
    const waitForConversationReady = async () => {
      await page.waitForSelector(
        '#prompt-textarea, form [contenteditable="true"], form textarea, [data-placeholder*="Ask ChatGPT" i]',
        { timeout: 25000 }
      ).catch(() => null);

      // Wait until existing messages/code blocks render and loading spinners disappear
      const loadStart = Date.now();
      while (Date.now() - loadStart < 20000) {
        const ready = await page.evaluate(() => {
          const hasBlocks = document.querySelectorAll('pre, code, article, [data-message-author-role]').length > 0;
          const hasSpinner = !!document.querySelector('main svg.animate-spin, main [class*="spinner" i]');
          return hasBlocks && !hasSpinner;
        }).catch(() => false);
        if (ready) break;
        await page.waitForTimeout(500);
      }
      await page.waitForTimeout(1000);
    };

    // Strategy 1: If user already has a saved/configured URL that looks valid
    if (configuredUrl) {
      console.log(`[JevBrowserAgent] Attempting to navigate to configured conversation URL: ${configuredUrl}`);
      try {
        await page.goto(configuredUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await waitForConversationReady();

        if (await checkLogin()) {
          await page.screenshot({ path: localScreenshotPath });
          throw new Error('ChatGPT requires login. Please open the interactive browser to log in to your new ChatGPT account first.');
        }

        const isError = await checkConversationError();
        if (!isError && page.url().includes('/c/')) {
          console.log('[JevBrowserAgent] Successfully connected to configured conversation URL:', page.url());
          return page.url();
        }

        console.warn(`[JevBrowserAgent] Configured conversation URL returned error or redirected (likely from previous account). Resetting and auto-detecting...`);
      } catch (err: any) {
        if (err.message.includes('ChatGPT requires login')) throw err;
        console.warn('[JevBrowserAgent] Error loading configured URL:', err.message);
      }
    }

    // Strategy 2: Navigate to https://chatgpt.com/ and detect the pinned conversation
    console.log('[JevBrowserAgent] Navigating to https://chatgpt.com/ to detect pinned "Create Mr Apple Videos" conversation...');
    await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3500);

    if (await checkLogin()) {
      await page.screenshot({ path: localScreenshotPath });
      throw new Error('ChatGPT requires login. Please open the interactive browser via Settings ("Launch Browser Window to Log In") to log in to your new ChatGPT account first.');
    }

    const detected = await this.locateMrAppleConversation(page);
    if (detected && detected.url) {
      console.log(`[JevBrowserAgent] Detected pinned conversation: "${detected.title}". Navigating to ${detected.url}...`);
      await page.goto(detected.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await waitForConversationReady();

      // Verify we are on the conversation page
      if (page.url().includes('/c/')) {
        this.saveChatGptUrl(page.url());
        return page.url();
      }
    }

    // Strategy 3: Check if current page is already in a conversation with prompt input
    const inputSelector = '#prompt-textarea, form [contenteditable="true"], form textarea, [data-placeholder*="Ask ChatGPT" i]';
    const hasInput = await page.$(inputSelector);
    if (hasInput && page.url().includes('/c/')) {
      const pageTitle = await page.title().catch(() => '');
      console.log(`[JevBrowserAgent] Current page has active chat: "${pageTitle}" -> ${page.url()}`);
      this.saveChatGptUrl(page.url());
      return page.url();
    }

    // If still not found, capture screenshot and give user exact helpful action items
    await page.screenshot({ path: localScreenshotPath }).catch(() => {});
    throw new Error(
      `ChatGPT is logged in, but the pinned conversation "Create Mr Apple Videos" could not be detected in your sidebar. ` +
      `Please ensure the conversation is pinned in your new ChatGPT account, or copy its URL (e.g. https://chatgpt.com/c/...) and paste it into Kindred Studio Settings under "ChatGPT Conversation URL". Screenshot saved: ${localScreenshotPath}`
    );
  }

  /**
   * Actively inspect active browser or launch headless session to auto-detect and persist
   * the pinned "Create Mr Apple Videos" chat URL.
   */
  public static async detectAndSetChatGptUrl(): Promise<{ success: boolean; url?: string; title?: string; message: string }> {
    const context = await this.launchContext(false);
    const pages = context.pages();
    let chatPage = pages.find((p) => p.url().includes('chatgpt.com'));

    if (!chatPage) {
      chatPage = await context.newPage();
      await chatPage.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await chatPage.waitForTimeout(3000);
    }

    const loginBtn = await chatPage.$('button[data-testid="login-button"], a[href*="/auth/login"], button:has-text("Log in")');
    if (loginBtn) {
      return {
        success: false,
        message: 'ChatGPT is not logged in. Please click "Launch Browser Window to Log In" and sign into your new ChatGPT account first.',
      };
    }

    const detected = await this.locateMrAppleConversation(chatPage);
    if (detected && detected.url) {
      this.saveChatGptUrl(detected.url);
      return {
        success: true,
        url: detected.url,
        title: detected.title,
        message: `Successfully recognized and pinned conversation "${detected.title}" (${detected.url})!`,
      };
    }

    return {
      success: false,
      message: 'Could not find "Create Mr Apple Videos" in sidebar. Please ensure the conversation is created or pinned in your new ChatGPT account, or paste the URL manually.',
    };
  }

  /**
   * Focus, clear, and submit a prompt strictly into ChatGPT's bottom composer chat bar.
   * Explicitly avoids any Canvas, artifact, voice/microphone buttons, or inline message boxes.
   */
  public static async submitChatGptPrompt(page: Page, promptText: string): Promise<boolean> {
    console.log(`[JevBrowserAgent] Locating bottom chat composer to submit "${promptText}"...`);
    await page.bringToFront().catch(() => {});
    await page.waitForTimeout(300);

    // If voice mode was accidentally opened previously, close it cleanly
    const stopVoiceBtn = await page.$(
      'button[aria-label*="Stop voice" i], button[aria-label*="End voice" i], button[aria-label*="Exit voice" i], button[aria-label*="Close voice" i]'
    );
    if (stopVoiceBtn) {
      await stopVoiceBtn.click({ force: true }).catch(() => {});
      await page.waitForTimeout(400);
    }

    // Scroll to bottom purely via DOM without clicking any buttons
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
      const scrollables = Array.from(document.querySelectorAll('main, [class*="scroll" i], [role="presentation"]'));
      for (const s of scrollables) {
        if (s.scrollHeight > s.clientHeight) s.scrollTop = s.scrollHeight;
      }
    }).catch(() => {});
    await page.waitForTimeout(200);

    // Wait for the bottom chat composer to be ready
    await page.waitForSelector(
      '#prompt-textarea, form [contenteditable="true"], form textarea, [data-placeholder*="Ask ChatGPT" i], [data-placeholder*="Message" i]',
      { timeout: 20000 }
    ).catch(() => null);

    // Locate the exact bottom prompt input handle using DOM hierarchy inspection
    const inputHandle = await page.evaluateHandle(() => {
      // Priority 1: An element with id="prompt-textarea" that is NOT inside a canvas or message turn
      const byId = document.getElementById('prompt-textarea');
      if (byId && !byId.closest('[data-testid*="canvas"], [data-testid*="artifact"], article, [data-message-author-role]')) {
        return byId;
      }

      // Priority 2: Inside a <form> at the bottom of the page (the composer form)
      const forms = Array.from(document.querySelectorAll('form'));
      for (const form of forms) {
        const target = form.querySelector(
          '#prompt-textarea, [contenteditable="true"][role="textbox"], [contenteditable="true"], textarea'
        );
        if (target) return target;
      }

      // Priority 3: Element with placeholder matching "Ask ChatGPT" or "Message" or "Type"
      const withPlaceholder = Array.from(
        document.querySelectorAll('[data-placeholder], [placeholder]')
      );
      for (const el of withPlaceholder) {
        const ph = (el.getAttribute('data-placeholder') || el.getAttribute('placeholder') || '').toLowerCase();
        if (ph.includes('ask chatgpt') || ph.includes('message') || ph === 'type') {
          if (!el.closest('[data-testid*="canvas"], [data-testid*="artifact"], article, [data-message-author-role]')) {
            return el;
          }
        }
      }

      // Priority 4: Bottom-most contenteditable or textarea on the page
      const allInputs = Array.from(
        document.querySelectorAll('[contenteditable="true"], textarea')
      ).filter(el => !el.closest('[data-testid*="canvas"], [data-testid*="artifact"], article, [data-message-author-role]'));
      if (allInputs.length > 0) {
        return allInputs[allInputs.length - 1]; // Select the bottom-most input
      }

      return null;
    });

    const element = inputHandle.asElement();
    if (!element) {
      throw new Error('Could not find the bottom ChatGPT chat input box.');
    }

    // Scroll into view & click directly into the chat input
    await element.scrollIntoViewIfNeeded().catch(() => {});
    await element.click({ force: true });
    await page.waitForTimeout(200);

    // Clear any existing text in the chat input
    await page.keyboard.press('Meta+A');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(100);

    // Type the prompt natively into the focused input
    console.log(`[JevBrowserAgent] Typing "${promptText}" into bottom chat composer...`);
    await page.keyboard.type(promptText, { delay: 50 });
    await page.waitForTimeout(300);

    // Verify text was entered into the chat composer
    const enteredText = await element.evaluate((el: any) => {
      return (el.innerText || el.value || el.textContent || '').trim();
    });

    // If typing didn't populate the contenteditable node (e.g. React controlled component):
    if (!enteredText.toLowerCase().includes(promptText.toLowerCase())) {
      console.log('[JevBrowserAgent] Inserting text via keyboard.insertText to chat composer...');
      await element.click({ force: true });
      await page.keyboard.insertText(promptText);
      await page.waitForTimeout(300);
    }

    // Submit prompt: Press Enter natively
    console.log(`[JevBrowserAgent] Submitting prompt via Enter key...`);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(600);

    // Fallback: Click ONLY the explicit send button if it is still visible and enabled (never click voice/mic buttons!)
    const sendBtn = await page.$(
      'button[data-testid="send-button"], button[aria-label="Send prompt"], button[aria-label="Send message"]'
    );
    if (sendBtn) {
      const isDisabled = await sendBtn.getAttribute('disabled');
      if (isDisabled === null) {
        console.log('[JevBrowserAgent] Clicking bottom Send button...');
        await sendBtn.click({ force: true }).catch(() => {});
        await page.waitForTimeout(500);
      }
    }

    return true;
  }

  /**
   * Helper: Extract master prompt, video title, and hashtags from ChatGPT purely via DOM inspection.
   * Never clicks page buttons so microphone/voice mode or dialogs are never triggered.
   */
  public static async extractPromptAndTitleFromChatGpt(page: Page): Promise<{
    grokPrompt: string;
    cleanTitle: string;
    cleanHook: string;
    rawText: string;
    promptCount: number;
  }> {
    const domData = await page.evaluate(() => {
      // 1. Collect all Mr. Apple Grok prompts in chronological order
      const pres = Array.from(document.querySelectorAll('pre, code'));
      const matchingPrompts: string[] = [];
      for (const el of pres) {
        if (el.tagName === 'CODE' && el.parentElement?.tagName === 'PRE') continue;
        const t = ((el as HTMLElement).innerText || '').trim();
        if (
          t.includes('CRITICAL: EXACTLY TWO CHARACTERS') ||
          (t.includes('Mr. Apple') &&
            (t.includes('0-2 SECONDS') ||
              t.includes('0–2 SECONDS') ||
              t.includes('15 seconds') ||
              t.includes('10 seconds') ||
              t.includes('FINAL RULE')))
        ) {
          matchingPrompts.push(t);
        }
      }

      // Fallback if not in <pre>/<code>
      if (matchingPrompts.length === 0) {
        const containers = Array.from(document.querySelectorAll('[data-testid*="canvas"], article, [data-message-author-role="assistant"]'));
        for (const c of containers) {
          const t = ((c as HTMLElement).innerText || '').trim();
          if (t.includes('CRITICAL: EXACTLY TWO CHARACTERS') && (t.includes('0-2 SECONDS') || t.includes('0–2 SECONDS') || t.includes('FINAL RULE'))) {
            matchingPrompts.push(t);
          }
        }
      }

      // Preferred: the longest code block in the LATEST assistant reply (independent of prompt wording)
      const assistantTurns = document.querySelectorAll('[data-message-author-role="assistant"]');
      const assistantCount = assistantTurns.length;
      const lastTurn = assistantTurns[assistantCount - 1] as HTMLElement | undefined;
      let latestReplyPrompt = '';
      if (lastTurn) {
        for (const pre of Array.from(lastTurn.querySelectorAll('pre'))) {
          const t = ((pre as HTMLElement).innerText || '').trim();
          if (t.length > 200 && t.length > latestReplyPrompt.length) latestReplyPrompt = t;
        }
      }

      // Never mix sources: if the latest reply has no prompt yet, report none (so an OLD prompt is never reused).
      const fallbackPrompt = matchingPrompts.length > 0 ? matchingPrompts[matchingPrompts.length - 1] : '';
      const domPrompt = lastTurn ? latestReplyPrompt : fallbackPrompt;
      const promptCount = lastTurn ? assistantCount : matchingPrompts.length;

      // 2. Extract Title & Hashtags from the latest TikTok Title block at the bottom of the page
      let title = '';
      let hook = '';
      const allNodes = Array.from(document.querySelectorAll('pre, code, [contenteditable="true"], p, div, h1, h2, h3, h4'));

      // Look from bottom up for the latest TikTok Title + #MrApple hashtag box
      for (let i = allNodes.length - 1; i >= 0; i--) {
        const text = ((allNodes[i] as HTMLElement).innerText || '').trim();
        if (text.includes('#MrApple') && text.length < 500) {
          const lines = text
            .split('\n')
            .map((l) => l.trim())
            .filter(
              (l) =>
                l.length > 0 &&
                !/^writing$/i.test(l) &&
                !/^start writing$/i.test(l) &&
                !/^tiktok title$/i.test(l.replace(/[🍎🎬]/g, '').trim())
            );
          const hashLine = lines.find((l) => l.includes('#MrApple')) || '';
          const titleCandidate = lines.find((l) => !l.startsWith('#') && l.length > 5 && l.length < 140) || '';
          if (hashLine && !hook) hook = hashLine;
          if (titleCandidate && !title) {
            title = titleCandidate.replace(/^[🍎🎬"'#\s]+|["'\s]+$/g, '').trim();
          }
          if (title && hook) break;
        }
      }

      // Fallback for title if not inside the hashtag box: check headings with "Mr. Apple vs."
      if (!title) {
        for (let i = allNodes.length - 1; i >= 0; i--) {
          const text = ((allNodes[i] as HTMLElement).innerText || '').trim();
          if (text.includes('Mr. Apple vs.') && text.length < 200) {
            const firstLine = text.split('\n')[0].replace(/^[🍎🎬"'#\s]+|["'\s]+$/g, '').trim();
            if (firstLine.length > 5 && firstLine.length < 140) {
              title = firstLine;
              break;
            }
          }
        }
      }

      return { domPrompt, title, hook, promptCount };
    });

    let grokPrompt = domData.domPrompt || '';
    const codeMatch = grokPrompt.match(/```(?:[a-zA-Z]*\n)?([\s\S]*?)```/);
    if (codeMatch && codeMatch[1] && codeMatch[1].trim().length > 50) {
      grokPrompt = codeMatch[1].trim();
    } else {
      grokPrompt = grokPrompt.replace(/```/g, '').trim();
    }

    const cleanTitle = domData.title || 'Mr. Apple & Friends Dance Battle';
    const cleanHook = domData.hook || '#MrApple #FunnyDance #CuteAnimals #DanceChallenge';

    return {
      grokPrompt,
      cleanTitle,
      cleanHook,
      rawText: grokPrompt,
      promptCount: domData.promptCount,
    };
  }

  /**
   * Step 1: Browse into ChatGPT, type "next" in the chat, wait for the new prompt to finish generating, and extract it.
   */
  public static async generatePromptViaChatGPT(
    brief: {
      format: string;
      ageBand: string;
      seriesTitle: string;
      learningGoal: string;
      creativeTopic?: string;
      targetDurationSec: number;
    },
    headless = false
  ): Promise<{ scriptPackage: ScriptPackage; screenshotPath?: string }> {
    const context = await this.launchContext(headless);

    // Explicitly locate the ChatGPT page across all open tabs
    const pages = context.pages();
    let page = pages.find((p) => p.url().includes('chatgpt.com'));
    if (!page) {
      if (pages.length > 0 && !pages[0].url().includes('grok.com') && !pages[0].url().includes('tiktok.com')) {
        page = pages[0];
      } else {
        page = await context.newPage();
      }
    }
    await page.bringToFront().catch(() => {});
    await page.waitForTimeout(600);

    const framesDir = path.join(__dirname, '../../storage/frames');
    if (!fs.existsSync(framesDir)) fs.mkdirSync(framesDir, { recursive: true });

    const screenshotPath = path.join(framesDir, `chatgpt_state_${Date.now()}.png`);

    try {
      console.log('[JevBrowserAgent] Navigating to ChatGPT "Create Mr Apple Videos" master prompt chat...');
      const targetChatUrl = await this.navigateToMrAppleConversation(page, screenshotPath);
      console.log(`[JevBrowserAgent] Successfully connected to active master prompt chat: ${targetChatUrl}`);

      await page.bringToFront().catch(() => {});
      await page.waitForTimeout(1500);

      // Snapshot existing prompts on the page BEFORE submitting "next" so we never copy an old prompt!
      const priorData = await this.extractPromptAndTitleFromChatGpt(page);
      console.log(
        `[JevBrowserAgent] Snapshot before "next": ${priorData.promptCount} existing prompt(s) in chat (last title: "${priorData.cleanTitle}").`
      );

      // ALWAYS submit "next" to generate a brand new Mr. Apple video prompt!
      console.log('[JevBrowserAgent] Submitting "next" command strictly to bottom ChatGPT chat input...');
      await this.submitChatGptPrompt(page, 'next');

      // Wait for ChatGPT to begin and finish streaming the brand new response
      console.log('[JevBrowserAgent] Waiting for ChatGPT to generate the NEW Mr. Apple prompt...');
      const streamWaitStart = Date.now();
      let grokPrompt = '';
      let cleanTitle = '';
      let cleanHook = '';
      let rawCopiedText = '';
      let lastObservedPromptLen = 0;
      let stableTicks = 0;

      while (Date.now() - streamWaitStart < 120000) {
        await page.waitForTimeout(1500);

        // Keep chat scrolled to bottom while streaming
        await page.evaluate(() => {
          window.scrollTo(0, document.body.scrollHeight);
          const scrollables = Array.from(document.querySelectorAll('main, [class*="scroll" i], [role="presentation"]'));
          for (const s of scrollables) {
            if (s.scrollHeight > s.clientHeight) s.scrollTop = s.scrollHeight;
          }
        }).catch(() => {});

        const stopBtn = await page.$(
          'button[aria-label="Stop streaming"], button[data-testid="stop-button"], button[aria-label="Stop generating"], button[aria-label="Stop"]'
        );
        if (stopBtn) {
          stableTicks = 0;
          continue; // Still actively streaming
        }

        const currentData = await this.extractPromptAndTitleFromChatGpt(page);
        const isBrandNewPrompt =
          currentData.grokPrompt.length > 300 &&
          (currentData.promptCount > priorData.promptCount || currentData.grokPrompt !== priorData.grokPrompt);

        if (isBrandNewPrompt) {
          if (
            currentData.grokPrompt.length === lastObservedPromptLen &&
            (currentData.grokPrompt.includes('FINAL RULE') ||
              currentData.grokPrompt.includes('Sound enabled') ||
              currentData.grokPrompt.length > 800)
          ) {
            stableTicks++;
          } else {
            lastObservedPromptLen = currentData.grokPrompt.length;
            stableTicks = 0;
          }

          if (stableTicks >= 2) {
            // Wait an extra 3 seconds and scroll down so the "TikTok Title" box below the prompt finishes rendering
            await page.waitForTimeout(3000);
            await page.evaluate(() => {
              window.scrollTo(0, document.body.scrollHeight);
              const scrollables = Array.from(document.querySelectorAll('main, [class*="scroll" i], [role="presentation"]'));
              for (const s of scrollables) {
                if (s.scrollHeight > s.clientHeight) s.scrollTop = s.scrollHeight;
              }
            }).catch(() => {});
            await page.waitForTimeout(1000);

            const finalData = await this.extractPromptAndTitleFromChatGpt(page);
            grokPrompt = finalData.grokPrompt;
            cleanTitle = finalData.cleanTitle;
            cleanHook = finalData.cleanHook;
            rawCopiedText = finalData.rawText;
            console.log(
              `[JevBrowserAgent] Brand new ChatGPT prompt finished streaming (${grokPrompt.length} chars)! Title: "${cleanTitle}"`
            );
            break;
          }
        }
      }

      await page.screenshot({ path: screenshotPath }).catch(() => {});
      if (context !== this.activeInteractiveContext) {
        await context.close().catch(() => {});
      }

      // STRICT VALIDATION: Must be a brand new, non-empty prompt!
      if (!grokPrompt || grokPrompt.length < 100 || grokPrompt === priorData.grokPrompt) {
        throw new Error(
          `ChatGPT did not finish generating a new prompt after submitting "next" (extracted ${grokPrompt.length} chars). ` +
          `Aborting before Grok so an old or incomplete prompt is never used.`
        );
      }

      console.log(
        `[JevBrowserAgent] SUCCESS: Extracted brand new Grok Prompt (${grokPrompt.length} chars)! Title: "${cleanTitle}"`
      );

      const parsedHook = cleanHook;
      const parsedNarration = rawCopiedText ? rawCopiedText.slice(0, 200) : grokPrompt.slice(0, 200);

      const shotBriefs = [
        {
          shot_number: 1,
          duration_seconds: 15,
          scene_description: 'Scene 1: Mr. Apple Master Prompt Dance Battle',
          video_prompt: grokPrompt,
          visual_focus: 'Mr. Apple and supporting character dance battle',
          continuity_notes: 'Exact Mr. Apple character design from master prompt and reference image',
        },
      ];

      const captions = [
        { start_sec: 0.5, end_sec: 4.5, text: parsedHook },
        { start_sec: 5.0, end_sec: 9.5, text: "Can you spot the clue? Look closely!" },
        { start_sec: 10.0, end_sec: 14.8, text: "You solved it! Outstanding detective work!" },
      ];

      return {
        scriptPackage: {
          concept_title: cleanTitle,
          hook: parsedHook,
          hypothesis: 'Focused 15-second whimsical educational loop with Mr. Apple optimizes retention and pattern recognition.',
          script_text: parsedNarration,
          shot_briefs: shotBriefs,
          captions: captions,
          thinking_pause_seconds: 2.5,
          tokens_used: 0,
          cost_usd: 0.0,
        },
        screenshotPath,
      };
    } catch (err: any) {
      if (page && !page.isClosed()) {
        await page.screenshot({ path: screenshotPath }).catch(() => { });
      }
      if (context !== this.activeInteractiveContext) {
        await context.close().catch(() => { });
      }
      throw err;
    }
  }

  /**
   * Strictly validate that a buffer is a genuine MP4/WebM video (>= 250KB, valid container magic bytes, never JPEG/PNG/WebP).
   */
  public static isValidVideoBuffer(buf: Buffer | null | undefined): boolean {
    if (!buf || buf.length < 250000) return false;
    // Reject JPEG (FF D8 FF)
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return false;
    // Reject PNG (89 50 4E 47)
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return false;
    const headStr = buf.slice(0, 16).toString('ascii');
    if (headStr.startsWith('RIFF') && headStr.includes('WEBP')) return false;
    if (headStr.startsWith('GIF8')) return false;
    const isMp4 = buf.slice(4, 8).toString('ascii') === 'ftyp' || headStr.includes('ftyp') || headStr.includes('moov');
    const isWebm = buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3;
    return isMp4 || isWebm;
  }

  /**
   * Strictly validate that a file on disk is a genuine MP4/WebM video file.
   */
  public static isValidVideoFile(filePath: string): boolean {
    try {
      if (!filePath || !fs.existsSync(filePath)) return false;
      const stat = fs.statSync(filePath);
      if (stat.size < 250000) return false;
      const fd = fs.openSync(filePath, 'r');
      const header = Buffer.alloc(32);
      fs.readSync(fd, header, 0, 32, 0);
      fs.closeSync(fd);
      if (header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return false;
      if (header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47) return false;
      const headStr = header.slice(0, 16).toString('ascii');
      if (headStr.startsWith('RIFF') && headStr.includes('WEBP')) return false;
      const isMp4 = header.slice(4, 8).toString('ascii') === 'ftyp' || headStr.includes('ftyp') || headStr.includes('moov');
      const isWebm = header[0] === 0x1a && header[1] === 0x45 && header[2] === 0xdf && header[3] === 0xa3;
      return isMp4 || isWebm;
    } catch {
      return false;
    }
  }

  /**
   * Read the video settings ChatGPT wrote at the end of the prompt
   * (e.g. "10 seconds • Vertical 9:16 • 720p • Sound enabled") and map them
   * onto the options Grok Imagine actually offers (6s/10s/15s, 480p/720p, aspect ratio).
   */
  public static parseVideoSpec(prompt: string, fallbackSec = 10): GrokVideoSpec {
    const lines = prompt.split('\n').map((l) => l.trim()).filter(Boolean);
    const specLine =
      [...lines].reverse().find(
        (l) => /\b\d{1,2}\s*seconds?\b/i.test(l) && /(\d{3,4}p|\d+\s*:\s*\d+|sound|vertical)/i.test(l)
      ) || '';
    const requested = Number(specLine.match(/\b(\d{1,2})\s*seconds?\b/i)?.[1]) || fallbackSec;
    const durationSec = GROK_DURATIONS.reduce((best, d) =>
      Math.abs(d - requested) < Math.abs(best - requested) ? d : best
    );
    const resolution: GrokVideoSpec['resolution'] = /\b480p\b/i.test(specLine) ? '480p' : '720p';
    const aspect: GrokVideoSpec['aspect'] = /16\s*:\s*9|horizontal|landscape/i.test(specLine)
      ? '16:9'
      : /1\s*:\s*1|square/i.test(specLine)
        ? '1:1'
        : '9:16';
    return { durationSec, resolution, aspect };
  }

  /** Click a Grok composer radio (mode / resolution / duration) unless it is already selected. */
  private static async selectGrokRadio(
    page: Page,
    by: { label?: string; text?: string },
    waitMs = 3000
  ): Promise<boolean> {
    const btn = (
      by.label
        ? page.locator(`[role="radio"][aria-label="${by.label}"]`)
        : page.locator('[role="radio"], [role="menuitemradio"], [role="option"]').filter({ hasText: new RegExp(`(^|\\s|\\b)${by.text}(\\b|\\s|$)`) })
    ).filter({ visible: true }).first();
    if (!(await btn.waitFor({ state: 'visible', timeout: waitMs }).then(() => true).catch(() => false))) return false;
    if ((await btn.getAttribute('aria-checked')) !== 'true') {
      // Short timeout and no retries into whatever pops up (e.g. a sign-in dialog).
      await btn.click({ timeout: 5000 }).catch(() => {});
      for (let i = 0; i < 4 && (await btn.getAttribute('aria-checked').catch(() => null)) !== 'true'; i++) {
        await page.waitForTimeout(250);
      }
      const blocked = await page.locator('#dialog-portal').filter({ hasText: /continue with|sign in|log in|upgrade/i }).count().catch(() => 0);
      if (blocked > 0) {
        await page.keyboard.press('Escape').catch(() => {});
        throw new Error(`Grok blocked the "${by.label || by.text}" option behind a sign-in/upgrade dialog. Log into Grok in the app's browser window, then run again.`);
      }
    }
    const checked = (await btn.getAttribute('aria-checked')) === 'true' || (await btn.getAttribute('data-state')) === 'on';
    if (!checked && by.text) {
      const seen = await page.locator('[role="radio"]').evaluateAll((els) =>
        els.map((e) => `${(e.textContent || e.getAttribute('aria-label') || '').trim()}=${e.getAttribute('aria-checked')}${(e as HTMLButtonElement).disabled ? '(disabled)' : ''}`).join(', ')
      ).catch(() => '');
      console.warn(`[JevBrowserAgent] Could not select "${by.text}". Grok options seen: ${seen}`);
    }
    return checked;
  }

  /**
   * Signed-in Grok shows resolution and length as dropdown buttons ("Video resolution" = 480p, "Video duration" = 6s).
   * Open the dropdown, choose the option, then confirm the button now shows it.
   */
  private static async selectGrokDropdown(page: Page, buttonLabel: string, optionText: string): Promise<boolean> {
    const btn = page.locator(`button[aria-label="${buttonLabel}"]`).filter({ visible: true }).first();
    if (!(await btn.waitFor({ state: 'visible', timeout: 3000 }).then(() => true).catch(() => false))) return false;
    const current = async () => (await btn.innerText().catch(() => '')).trim();
    if ((await current()) === optionText) return true;

    await btn.click({ timeout: 5000 }).catch(() => {});
    const item = page
      .locator('[role="menuitemradio"], [role="menuitem"], [role="option"]')
      .filter({ hasText: new RegExp(`^\\s*${optionText}\\s*$`) })
      .filter({ visible: true })
      .first();
    if (!(await item.waitFor({ state: 'visible', timeout: 3000 }).then(() => true).catch(() => false))) {
      await page.keyboard.press('Escape').catch(() => {});
      return false;
    }
    await item.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(400);
    await page.keyboard.press('Escape').catch(() => {}); // close the menu if it is still open
    return (await current()) === optionText;
  }

  /**
   * Put Grok Imagine's composer into Video mode with the requested duration, resolution and aspect ratio.
   * Only touches the composer's own controls (Image/Video/Agent radios, 480p/720p, 6s/10s/15s, Aspect Ratio).
   */
  public static async configureGrokVideoMode(page: Page, spec: GrokVideoSpec): Promise<void> {
    if (!(await this.selectGrokRadio(page, { label: 'Video' }, 15000))) {
      const shot = path.join(__dirname, '../../storage/frames', `grok_no_video_toggle_${Date.now()}.png`);
      await page.screenshot({ path: shot }).catch(() => {});
      throw new Error(`Could not switch Grok Imagine to Video mode (the "Video" toggle beside the prompt box was not found). Screenshot: ${shot}`);
    }
    const resolutionOk =
      (await this.selectGrokDropdown(page, 'Video resolution', spec.resolution)) ||
      (await this.selectGrokRadio(page, { text: spec.resolution }, 1500));
    const durationOk =
      (await this.selectGrokDropdown(page, 'Video duration', `${spec.durationSec}s`)) ||
      (await this.selectGrokRadio(page, { text: `${spec.durationSec}s` }, 1500));
    if (!durationOk || !resolutionOk) {
      console.warn(
        `[JevBrowserAgent] Grok would not let us select ${!durationOk ? spec.durationSec + 's' : ''}${!durationOk && !resolutionOk ? ' / ' : ''}${!resolutionOk ? spec.resolution : ''}. ` +
        'Grok will use whatever length/quality it already has selected. Check the Grok tab if the video comes out short or low-resolution.'
      );
    }

    let aspectOk = false;
    const aspectBtn = page.locator('button[aria-label="Aspect Ratio"]').first();
    if (await aspectBtn.isVisible().catch(() => false)) {
      if ((await aspectBtn.innerText().catch(() => '')).trim() === spec.aspect) {
        aspectOk = true;
      } else {
        await aspectBtn.click();
        const item = page.locator('[role="menuitemradio"]').filter({ hasText: spec.aspect }).first();
        aspectOk = await item.waitFor({ state: 'visible', timeout: 2500 }).then(() => true).catch(() => false);
        if (aspectOk) await item.click();
        else await page.keyboard.press('Escape');
        await page.waitForTimeout(250);
      }
    }
    console.log(
      `[JevBrowserAgent] Grok set to Video • ${spec.durationSec}s${durationOk ? '' : ' (not found)'} • ${spec.resolution}${resolutionOk ? '' : ' (not found)'} • ${spec.aspect}${aspectOk ? '' : ' (not found)'}`
    );
  }

  /** The composer <form> on grok.com/imagine (the one holding the prompt textbox). */
  private static grokComposer(page: Page) {
    return page.locator('form').filter({ has: page.locator('[role="textbox"], [contenteditable="true"], textarea') }).first();
  }

  /**
   * Attach the Mr. Apple reference image to the composer's OWN file input.
   * (The page has other hidden file inputs that open the image editor — never use those.)
   */
  private static async attachGrokReferenceImage(page: Page, imagePath: string): Promise<void> {
    const composer = this.grokComposer(page);
    const countThumbs = () =>
      page.evaluate(() => {
        const form = Array.from(document.querySelectorAll('form')).find((f) => f.querySelector('[role="textbox"], [contenteditable="true"], textarea'));
        return (form ? form.querySelectorAll('img').length : 0) + document.querySelectorAll('img[src^="blob:"]').length;
      }).catch(() => 0);

    const before = await countThumbs();
    const fileInput = composer.locator('input[type="file"]').first();
    if ((await fileInput.count()) > 0) {
      await fileInput.setInputFiles(imagePath);
    } else {
      // Fallback (macOS): paste the image from the clipboard into the composer textbox.
      console.warn('[JevBrowserAgent] Composer file input not found; pasting reference image from clipboard instead.');
      await execFileAsync('osascript', ['-e', `set the clipboard to (read (POSIX file "${imagePath}") as JPEG picture)`]);
      await composer.locator('[role="textbox"], [contenteditable="true"], textarea').first().click();
      await page.keyboard.press('Meta+V');
    }

    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (!page.url().includes('/imagine') || page.url().includes('/imagine/post/')) {
        throw new Error(`Uploading the reference image navigated Grok away from the prompt composer (${page.url()}).`);
      }
      if ((await countThumbs()) > before) {
        console.log('[JevBrowserAgent] Mr. Apple reference image attached to Grok prompt.');
        await page.waitForTimeout(800); // let the upload finish before submitting
        return;
      }
      await page.waitForTimeout(400);
    }
    console.warn('[JevBrowserAgent] Could not visually confirm the reference image thumbnail; continuing.');
  }

  /**
   * Step 2: In Grok Imagine — Video mode + reference image + EXACT ChatGPT prompt → generate → download the MP4.
   */
  public static async createVideoViaGrok(
    grokPrompt: string,
    jobId: string,
    shotNumber = 1,
    headless = false,
    requestedDurationSec?: number
  ): Promise<{ videoPath: string; screenshotPath?: string; imagePath?: string; durationSec: number; width?: number; height?: number }> {
    if (!grokPrompt || grokPrompt.length < 50) {
      throw new Error(`Grok prompt is invalid or too short (${grokPrompt?.length || 0} chars). Aborting.`);
    }

    const context = await this.launchContext(headless);
    const page = context.pages().find((p) => p.url().includes('grok.com')) || (await context.newPage());
    await page.bringToFront().catch(() => {});

    const storageVideos = path.join(__dirname, '../../storage/videos');
    const framesDir = path.join(__dirname, '../../storage/frames');
    fs.mkdirSync(storageVideos, { recursive: true });
    fs.mkdirSync(framesDir, { recursive: true });

    const screenshotPath = path.join(framesDir, `grok_state_${jobId}_shot${shotNumber}_${Date.now()}.png`);
    const outputVideoPath = path.join(storageVideos, `shot_${jobId}_${shotNumber}.mp4`);
    const outputImagePath = path.join(framesDir, `shot_${jobId}_${shotNumber}.png`);
    // The operator's requested length (default 15s) wins over the length written in the ChatGPT prompt.
    const spec = this.parseVideoSpec(grokPrompt, requestedDurationSec || 15);
    spec.resolution = '720p'; // always 720p, whatever the ChatGPT prompt says
    if (requestedDurationSec) {
      spec.durationSec = GROK_DURATIONS.reduce((best, d) =>
        Math.abs(d - requestedDurationSec) < Math.abs(best - requestedDurationSec) ? d : best
      );
    }

    // Full (HTTP 200) video bodies seen after submit, keyed by URL. 206 range chunks are ignored — they are partial files.
    const fullVideoBodies = new Map<string, Buffer>();
    let listening = false;
    const onResponse = async (response: any) => {
      try {
        if (response.status() !== 200) return;
        const ct = (response.headers()['content-type'] || '').toLowerCase();
        const url: string = response.url();
        if (!ct.startsWith('video/') && !/\.(mp4|webm)(\?|$)/i.test(url)) return;
        const buf = await response.body().catch(() => null);
        if (buf && this.isValidVideoBuffer(buf)) fullVideoBodies.set(url, buf);
      } catch { }
    };

    const fail = async (message: string): Promise<never> => {
      await page.screenshot({ path: screenshotPath }).catch(() => {});
      throw new Error(`${message} Screenshot: ${screenshotPath}`);
    };

    try {
      // 1. Fresh Grok Imagine composer
      console.log('[JevBrowserAgent] Opening fresh Grok Imagine composer (https://grok.com/imagine)...');
      await page.goto('https://grok.com/imagine', { waitUntil: 'domcontentloaded', timeout: 30000 });
      const textbox = this.grokComposer(page).locator('[role="textbox"], [contenteditable="true"], textarea').first();
      const ready = await textbox.waitFor({ state: 'visible', timeout: 20000 }).then(() => true).catch(() => false);
      if (!ready) {
        const needsLogin = await page.$('a[href*="/sign-in"], a[href*="/login"], button:has-text("Sign in"), button:has-text("Log in")');
        await fail(needsLogin
          ? 'Grok requires login. Open the interactive browser and sign into Grok first.'
          : 'Grok Imagine prompt box did not load.');
      }

      // Logged-out Grok only allows basic videos and pops a sign-in dialog on 10s/720p — stop and ask for login instead.
      const signInVisible = await page
        .locator('a, button')
        .filter({ hasText: /^\s*Sign in\s*$/i })
        .filter({ visible: true })
        .count()
        .catch(() => 0);
      if (signInVisible > 0) {
        await fail('Grok is not signed in. Click "Launch Browser Window to Log In" in Settings and sign into Grok, then run again.');
      }

      // Decline non-essential cookies if the banner is up (it can cover the composer controls)
      const rejectCookies = page.locator('button:has-text("Reject All")').first();
      if (await rejectCookies.isVisible().catch(() => false)) await rejectCookies.click().catch(() => {});

      // 2. Video mode + settings from the ChatGPT prompt
      await this.configureGrokVideoMode(page, spec);

      // 3. Reference image (character lock)
      const refImagePath = path.resolve(__dirname, '../../storage/mr_apple_reference.jpg');
      if (fs.existsSync(refImagePath)) {
        await this.attachGrokReferenceImage(page, refImagePath);
        // Attaching an image can change the composer's options — re-assert Video settings.
        await this.configureGrokVideoMode(page, spec);
      } else {
        console.warn(`[JevBrowserAgent] Reference image missing at ${refImagePath}; generating without it.`);
      }

      // 4. Paste the EXACT ChatGPT prompt
      console.log(`[JevBrowserAgent] Pasting exact ChatGPT prompt into Grok (${grokPrompt.length} chars)...`);
      await textbox.click();
      await page.keyboard.press('Meta+A');
      await page.keyboard.press('Backspace');
      await textbox.fill(grokPrompt).catch(() => {});
      const typedLen = await textbox.evaluate((el: any) => (el.value ?? el.innerText ?? '').trim().length).catch(() => 0);
      if (typedLen < grokPrompt.length * 0.8) {
        await textbox.click();
        await page.keyboard.press('Meta+A');
        await page.keyboard.insertText(grokPrompt);
      }

      // Snapshot videos already on the page so we never download an old one
      const initialSrcs = await page.$$eval('video', (els) =>
        els.map((v) => (v as HTMLVideoElement).currentSrc || (v as HTMLVideoElement).src).filter(Boolean)
      ).catch(() => [] as string[]);

      page.on('response', onResponse);
      listening = true;

      // 5. Submit once
      const submitBtn = this.grokComposer(page).locator('button[aria-label="Submit"], button[type="submit"]').first();
      if (await submitBtn.isEnabled({ timeout: 5000 }).catch(() => false)) {
        await submitBtn.click();
      } else {
        await textbox.click();
        await page.keyboard.press('Enter');
      }
      console.log(`[JevBrowserAgent] Submitted Shot ${shotNumber} to Grok. Waiting for the video...`);

      // 6. Wait for the finished video (main/largest <video>, new src, expected length)
      // Grok may hide the duration options once an image is attached (it then picks its own length, e.g. 6s),
      // so accept any real clip; old videos are already excluded via initialSrcs.
      const minDuration = 4;
      const timeoutMs = 6 * 60 * 1000;
      const start = Date.now();
      let lastSrc = '';
      let stableTicks = 0;
      let lastLog = 0;
      let main: { src: string; duration: number; w?: number; h?: number } | null = null;

      while (Date.now() - start < timeoutMs) {
        await page.waitForTimeout(2000);
        const state = await page.evaluate(({ initial, minDur }) => {
          const text = document.body.innerText || '';
          const errorMatch = text.match(/content moderated|couldn['’]t generate|failed to generate|generation failed|rate limit|limit reached|try again later/i);
          const progress = text.match(/\b(\d{1,2})%/)?.[1] || null;
          const makeVideo = Array.from(document.querySelectorAll('button')).some((b) => /^\s*make video\s*$/i.test(b.textContent || ''));
          let best: HTMLVideoElement | null = null;
          let bestArea = 0;
          for (const v of Array.from(document.querySelectorAll('video'))) {
            const r = v.getBoundingClientRect();
            const area = r.width * r.height;
            if (area > bestArea) { best = v; bestArea = area; }
          }
          document.querySelectorAll('[data-kindred-main]').forEach((el) => el.removeAttribute('data-kindred-main'));
          let video: { src: string; duration: number; w?: number; h?: number } | null = null;
          if (best) {
            const src = best.currentSrc || best.src || '';
            if (src && !initial.includes(src) && best.readyState >= 1 && best.duration >= minDur) {
              best.setAttribute('data-kindred-main', '1');
              video = { src, duration: best.duration, w: best.videoWidth, h: best.videoHeight };
            }
          }
          return { url: location.href, error: errorMatch ? errorMatch[0] : null, progress, makeVideo, video };
        }, { initial: initialSrcs, minDur: minDuration }).catch(() => null);

        if (!state) continue;
        if (state.error) await fail(`Grok reported: "${state.error}".`);
        if (state.makeVideo && !state.video && !state.progress && Date.now() - start > 20000) {
          await fail('Grok produced an IMAGE instead of a video (Video mode was not active). Not posting anything.');
        }
        if (Date.now() - lastLog > 10000) {
          lastLog = Date.now();
          console.log(`[JevBrowserAgent] Shot ${shotNumber}: ${state.progress ? state.progress + '%' : 'rendering'} (${Math.round((Date.now() - start) / 1000)}s)`);
        }
        if (state.video && !state.progress) {
          stableTicks = state.video.src === lastSrc ? stableTicks + 1 : 0;
          lastSrc = state.video.src;
          if (stableTicks >= 1) { main = state.video; break; }
        } else {
          stableTicks = 0;
        }
      }

      if (!main) await fail(`Grok did not finish a ${spec.durationSec}s video for Shot ${shotNumber} within 6 minutes.`);
      const sizeNote = main!.w && main!.h ? `${main!.w}x${main!.h}` : 'size unknown';
      console.log(`[JevBrowserAgent] Grok video ready (${main!.duration.toFixed(1)}s, ${sizeNote}): ${main!.src.slice(0, 90)}`);
      if (main!.h && Math.min(main!.w || 0, main!.h) < 700) {
        console.warn(`[JevBrowserAgent] WARNING: this video is ${sizeNote} — lower than 720p. Grok did not apply the 720p setting.`);
      }

      // 7. Download the exact video that is on screen
      let saved: Buffer | null = null;
      if (main!.src.startsWith('http')) {
        const resp = await page.request.get(main!.src).catch(() => null);
        const buf = resp && resp.ok() ? await resp.body().catch(() => null) : null;
        if (this.isValidVideoBuffer(buf)) saved = buf;
      }
      if (!saved && fullVideoBodies.has(main!.src)) saved = fullVideoBodies.get(main!.src)!;
      if (!saved) {
        const b64 = await page.evaluate(async (src) => {
          try {
            const blob = await (await fetch(src)).blob();
            return await new Promise<string>((resolve) => {
              const r = new FileReader();
              r.onloadend = () => resolve(String(r.result));
              r.readAsDataURL(blob);
            });
          } catch { return null; }
        }, main!.src).catch(() => null);
        if (b64?.includes('base64,')) {
          const buf = Buffer.from(b64.split('base64,')[1], 'base64');
          if (this.isValidVideoBuffer(buf)) saved = buf;
        }
      }
      if (!saved) await fail('Grok finished the video but it could not be downloaded.');
      fs.writeFileSync(outputVideoPath, saved!);
      console.log(`[JevBrowserAgent] Shot ${shotNumber} saved (${saved!.length} bytes): ${outputVideoPath}`);

      // Thumbnail: a frame of the finished video
      await page.locator('video[data-kindred-main]').first().screenshot({ path: outputImagePath, timeout: 5000 }).catch(() => {});
      await page.screenshot({ path: screenshotPath }).catch(() => {});

      return {
        videoPath: outputVideoPath,
        imagePath: fs.existsSync(outputImagePath) ? outputImagePath : undefined,
        screenshotPath,
        durationSec: Math.round(main!.duration),
        width: main!.w,
        height: main!.h,
      };
    } finally {
      if (listening) page.off('response', onResponse);
    }
  }

  /**
   * Helper: Open interactive visible browser window so operator can log into ChatGPT and Grok once.
   */
  public static async openInteractiveSession(): Promise<{ success: boolean; message: string }> {
    if (this.isLaunching) {
      return { success: true, message: 'Browser session is already initializing...' };
    }

    if (this.activeInteractiveContext) {
      try {
        const pages = this.activeInteractiveContext.pages();
        if (pages.length > 0) {
          await pages[0].bringToFront();
          return { success: true, message: 'Browser window is already active on screen.' };
        }
      } catch {
        this.activeInteractiveContext = null;
      }
    }

    this.isLaunching = true;
    try {
      console.log('[JevBrowserAgent] Opening interactive browser for login session...');
      const context = await this.launchContext(false);

      // Use the default page for ChatGPT
      const pages = context.pages();
      const chatGptPage = pages.length > 0 ? pages[0] : await context.newPage();

      // Determine initial ChatGPT target: configured URL if valid, or clean chatgpt.com
      const configuredUrl = this.getConfiguredChatGptUrl();
      const targetChatUrl = configuredUrl || 'https://chatgpt.com/';

      console.log(`[JevBrowserAgent] Navigating Tab 1 to ${targetChatUrl} (Create Mr Apple Videos)...`);
      chatGptPage.goto(targetChatUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch((err) => {
        console.warn('[JevBrowserAgent] ChatGPT background navigation note:', err.message);
      });

      // Automatically capture new conversation URL if operator opens or clicks the pinned chat
      chatGptPage.on('framenavigated', async (frame) => {
        if (frame === chatGptPage.mainFrame()) {
          const currentUrl = frame.url();
          if (currentUrl.includes('chatgpt.com/c/')) {
            const pageTitle = (await chatGptPage.title().catch(() => '')).toLowerCase();
            if (pageTitle.includes('apple') || pageTitle.includes('video') || pageTitle.includes('create')) {
              console.log(`[JevBrowserAgent] Auto-learned Mr Apple chat URL from operator navigation: ${currentUrl}`);
              JevBrowserAgent.saveChatGptUrl(currentUrl);
            }
          }
        }
      });

      // Open a second tab for Grok Imagine (Media & Video Generation)
      console.log('[JevBrowserAgent] Opening Tab 2 for https://grok.com/imagine...');
      const grokPage = await context.newPage();
      grokPage.goto('https://grok.com/imagine', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch((err) => {
        console.warn('[JevBrowserAgent] Grok background navigation note:', err.message);
      });

      // Open a third tab for TikTok Studio
      console.log('[JevBrowserAgent] Opening Tab 3 for https://www.tiktok.com/tiktokstudio/upload...');
      const tiktokPage = await context.newPage();
      tiktokPage.goto('https://www.tiktok.com/tiktokstudio/upload', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch((err) => {
        console.warn('[JevBrowserAgent] TikTok background navigation note:', err.message);
      });

      // Explicitly bring Tab 1 (ChatGPT) to the front so operator immediately sees ChatGPT on launch
      console.log('[JevBrowserAgent] Focusing Tab 1 (ChatGPT) to front...');
      await chatGptPage.bringToFront().catch(() => {});
      await chatGptPage.waitForTimeout(500);

      return {
        success: true,
        message: 'Chromium launched with ChatGPT (Tab 1), Grok (Tab 2), and TikTok (Tab 3). ChatGPT is focused in front.',
      };
    } finally {
      this.isLaunching = false;
    }
  }

  /**
   * Diagnostic inspector: inspects open pages and key element selectors.
   */
  public static async inspectSession(): Promise<any> {
    const context = await this.launchContext(false);
    const pages = context.pages();
    const result: any = { pages: [] };

    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      const url = p.url();
      const title = await p.title().catch(() => '');
      const pageInfo: any = { index: i, url, title };

      if (url.includes('chatgpt.com')) {
        await p.bringToFront().catch(() => { });
        pageInfo.chatgpt = await p.evaluate(async () => {
          const copyCodeBtns = Array.from(document.querySelectorAll('button[aria-label="Copy"], button[data-testid*="copy" i]')) as HTMLButtonElement[];
          const copyMsgBtns = Array.from(document.querySelectorAll('button[aria-label="Copy message"]')) as HTMLButtonElement[];

          let lastCodeCopied = '';
          if (copyCodeBtns.length > 0) {
            const btn = copyCodeBtns[copyCodeBtns.length - 1];
            btn.click();
          }

          return {
            copyCodeBtnsCount: copyCodeBtns.length,
            copyMsgBtnsCount: copyMsgBtns.length,
          };
        }).catch((e: any) => ({ error: e.message }));

        // Now read clipboard from node via pbpaste!
        try {
          const { execSync } = require('child_process');
          const clipText = execSync('pbpaste', { encoding: 'utf8' });
          pageInfo.chatgpt.clipboardText = clipText.slice(0, 300);
          pageInfo.chatgpt.clipboardLen = clipText.length;
        } catch (pbErr: any) {
          pageInfo.chatgpt.pbErr = pbErr.message;
        }
      }

      if (url.includes('grok.com')) {
        await p.bringToFront().catch(() => { });
        pageInfo.grok = await p.evaluate(() => {
          const svgs = Array.from(document.querySelectorAll('svg')).map(s => {
            const p = s.closest('button, [role="button"], div');
            return {
              parentTag: p?.tagName,
              parentText: p?.textContent?.trim().slice(0, 20),
              aria: p?.getAttribute('aria-label') || s.getAttribute('aria-label'),
            };
          });
          const divs = Array.from(document.querySelectorAll('div[contenteditable="true"], textarea, input')).map(d => ({
            tag: d.tagName,
            type: (d as HTMLInputElement).type,
            placeholder: (d as HTMLInputElement).placeholder || d.getAttribute('aria-label'),
          }));
          return { svgs: svgs.slice(0, 15), inputs: divs };
        }).catch((e: any) => ({ error: e.message }));
      }

      result.pages.push(pageInfo);
    }

    return result;
  }

  // ───────────────────────── Logins: saved cookies + "sign in only if needed" ─────────────────────────

  private static cookiesFile = path.join(__dirname, '../../storage/browser_cookies.json');

  /**
   * Chromium drops "session" cookies (which most sites use for the login) when the browser closes.
   * We save every cookie after a successful login check / run and put the missing ones back on the next launch,
   * so unattended daily runs stay signed in. The file is private to this user (chmod 600) and git-ignored.
   */
  public static async saveCookies(context: BrowserContext): Promise<void> {
    try {
      const cookies = await context.cookies();
      if (cookies.length === 0) return;
      fs.writeFileSync(this.cookiesFile, JSON.stringify(cookies), { mode: 0o600 });
      fs.chmodSync(this.cookiesFile, 0o600);
    } catch (err: any) {
      console.warn('[JevBrowserAgent] Could not save login cookies:', err.message);
    }
  }

  private static async restoreCookies(context: BrowserContext): Promise<void> {
    try {
      if (!fs.existsSync(this.cookiesFile)) return;
      const saved: any[] = JSON.parse(fs.readFileSync(this.cookiesFile, 'utf8'));
      const have = new Set((await context.cookies()).map((c) => `${c.domain}|${c.path}|${c.name}`));
      const nowSec = Date.now() / 1000;
      const missing = saved.filter(
        (c) => !have.has(`${c.domain}|${c.path}|${c.name}`) && !(c.expires > 0 && c.expires < nowSec)
      );
      if (missing.length === 0) return;
      try {
        await context.addCookies(missing);
      } catch {
        for (const c of missing) await context.addCookies([c]).catch(() => {});
      }
      console.log(`[JevBrowserAgent] Restored ${missing.length} saved login cookies.`);
    } catch (err: any) {
      console.warn('[JevBrowserAgent] Could not restore login cookies:', err.message);
    }
  }

  /** Save logins and close the browser (used by the scheduled job, which should not leave a window behind). */
  public static async shutdown(): Promise<void> {
    const ctx = this.activeInteractiveContext;
    if (!ctx) return;
    await this.saveCookies(ctx);
    this.activeInteractiveContext = null;
    await ctx.close().catch(() => {});
  }

  /**
   * Decide whether a site is signed in. We only say "out" on an EXPLICIT signed-out signal (a Log in / Sign in button
   * with exactly that name, a login URL). "Not sure" never blocks the run — the steps themselves report a real login problem.
   */
  private static async siteLoginState(
    page: Page,
    site: 'chatgpt' | 'grok' | 'tiktok' | 'youtube'
  ): Promise<{ state: 'in' | 'out' | 'unknown'; why: string }> {
    try {
      const url = page.url();
      const visible = async (loc: ReturnType<Page['locator']>) => (await loc.filter({ visible: true }).count().catch(() => 0)) > 0;
      const named = (re: RegExp) => [page.getByRole('button', { name: re }), page.getByRole('link', { name: re })];
      const anyVisible = async (locs: ReturnType<Page['locator']>[]) => {
        for (const l of locs) if (await visible(l)) return true;
        return false;
      };
      const authHost = /auth\.openai\.com|auth0\.com|accounts\.google\.com|appleid\.apple\.com|login\.live\.com|accounts\.x\.ai|x\.com\/i\/flow|twitter\.com\/i\/flow/i;
      const host = { chatgpt: 'chatgpt.com', grok: 'grok.com', tiktok: 'tiktok.com', youtube: 'youtube.com' }[site];

      if (!url.includes(host)) return authHost.test(url) ? { state: 'out', why: `on a sign-in page (${new URL(url).host})` } : { state: 'unknown', why: `off-site (${url.slice(0, 60)})` };

      if (site === 'chatgpt') {
        if (/\/auth\/|\/log-?in/i.test(url)) return { state: 'out', why: 'login URL' };
        if (await visible(page.locator('[data-testid="login-button"], a[href*="/auth/login"]'))) return { state: 'out', why: 'login-button element' };
        if (await anyVisible(named(/^\s*(Log in|Sign up for free)\s*$/i))) return { state: 'out', why: '"Log in"/"Sign up for free" button' };
        if (await visible(page.locator('[data-testid="accounts-profile-button"], nav a[href*="/c/"], #prompt-textarea, form [contenteditable="true"]')))
          return { state: 'in', why: 'composer / history visible, no login button' };
        return { state: 'unknown', why: 'page not ready' };
      }

      if (site === 'grok') {
        if (/sign-?in|login/i.test(url)) return { state: 'out', why: 'login URL' };
        if (await anyVisible(named(/^\s*Sign in\s*$/i))) return { state: 'out', why: '"Sign in" button' };
        if (await visible(page.locator('[role="textbox"], [contenteditable="true"], textarea'))) return { state: 'in', why: 'prompt box visible, no Sign in button' };
        return { state: 'unknown', why: 'page not ready' };
      }

      if (site === 'youtube') {
        if (await anyVisible(named(/^\s*Sign in\s*$/i))) return { state: 'out', why: '"Sign in" button' };
        if (await visible(page.locator('#create-icon, #avatar-btn, ytcp-button#create-button, ytd-topbar-menu-button-renderer'))) {
          return { state: 'in', why: 'YouTube account menu visible' };
        }
        return { state: 'unknown', why: 'page not ready' };
      }

      if (/\/login/i.test(url)) return { state: 'out', why: 'login URL' };
      if (await anyVisible(named(/^\s*(Log in|Use QR code)\s*$/i))) return { state: 'out', why: '"Log in" button' };
      if ((await page.locator('input[type="file"]').count().catch(() => 0)) > 0) return { state: 'in', why: 'upload form present' };
      return { state: 'unknown', why: 'page not ready' };
    } catch (err: any) {
      return { state: 'unknown', why: err.message };
    }
  }

  private static skipLogin = false;

  /** Called by the "I'm already signed in — continue" button. */
  public static skipLoginWait(): void {
    this.skipLogin = true;
  }

  /**
   * Open ChatGPT, Grok and TikTok (all three tabs, right away) and make sure each is signed in. Only a site that is
   * clearly signed OUT makes us wait — the operator signs in and the run continues by itself.
   */
  public static async ensureLoggedIn(
    context: BrowserContext,
    say: (step: string, kind?: 'running' | 'waiting_login') => void,
    targets: PublishTargets,
    maxWaitMs = 10 * 60 * 1000
  ): Promise<{ skipped: Array<'youtube'> }> {
    type SiteKey = 'chatgpt' | 'grok' | 'tiktok' | 'youtube';
    const sites: Array<{ key: SiteKey; name: string; url: string; host: string; optional?: boolean }> = [
      { key: 'chatgpt', name: 'ChatGPT', url: this.getConfiguredChatGptUrl() || 'https://chatgpt.com/', host: 'chatgpt.com' },
      { key: 'grok', name: 'Grok', url: 'https://grok.com/imagine', host: 'grok.com' },
    ];
    if (targets.tiktok) sites.push({ key: 'tiktok', name: 'TikTok', url: 'https://www.tiktok.com/tiktokstudio/upload', host: 'tiktok.com' });
    // YouTube is optional: if nobody signs in, the run still makes the video and posts to TikTok.
    if (targets.youtube) sites.push({ key: 'youtube', name: 'YouTube', url: 'https://studio.youtube.com/', host: 'youtube.com', optional: true });
    const skipped: Array<'youtube'> = [];
    const framesDir = path.join(__dirname, '../../storage/frames');
    fs.mkdirSync(framesDir, { recursive: true });
    this.skipLogin = false;

    // 1. One tab per site, all loading at once so the operator sees them open immediately.
    say(`Opening ${sites.map((x) => x.name).join(', ')}…`);
    const pages: Page[] = [];
    for (const site of sites) {
      let page = context.pages().find((p) => !p.isClosed() && p.url().includes(site.host) && !pages.includes(p));
      if (!page) {
        page =
          context.pages().find((p) => !p.isClosed() && !pages.includes(p) && (p.url() === 'about:blank' || p.url().startsWith('chrome://'))) ||
          (await context.newPage());
      }
      pages.push(page);
    }
    await Promise.all(
      sites.map((site, i) => pages[i].goto(site.url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {}))
    );
    await pages[0].bringToFront().catch(() => {});
    await pages[0].waitForTimeout(4000);

    // 2. Check each one.
    for (let i = 0; i < sites.length; i++) {
      const site = sites[i];
      const page = pages[i];
      say(`Checking your ${site.name} login…`);

      let st = await this.siteLoginState(page, site.key);
      if (st.state === 'unknown') {
        await page.waitForTimeout(5000);
        st = await this.siteLoginState(page, site.key);
      }
      console.log(`[JevBrowserAgent] ${site.name} login check: ${st.state} (${st.why})`);
      if (st.state !== 'out') continue;

      await page.screenshot({ path: path.join(framesDir, `login_wait_${site.key}.png`) }).catch(() => {});
      await page.bringToFront().catch(() => {});
      say(`Sign into ${site.name} in the browser window — it looks signed out (${st.why}). The run continues by itself when you're done, or press the button if you're already signed in.`, 'waiting_login');

      const deadline = Date.now() + (site.optional ? Math.min(maxWaitMs, 4 * 60 * 1000) : maxWaitMs);
      let ok = false;
      let unknownStreak = 0;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 3000));
        if (page.isClosed()) throw new Error('The browser window was closed while waiting for you to sign in.');
        if (this.skipLogin) {
          this.skipLogin = false;
          console.log(`[JevBrowserAgent] Operator says ${site.name} is already signed in — continuing.`);
          ok = true;
          break;
        }
        const now = await this.siteLoginState(page, site.key);
        if (now.state === 'in') {
          ok = true;
          break;
        }
        // Signed-out signal gone and we're back on the site for ~30s → treat as signed in.
        unknownStreak = now.state === 'unknown' && page.url().includes(site.host) ? unknownStreak + 1 : 0;
        if (unknownStreak >= 10) {
          ok = true;
          break;
        }
      }
      if (!ok && site.optional) {
        say(`${site.name} was not signed in — skipping ${site.name} for this run.`);
        console.warn(`[JevBrowserAgent] ${site.name} sign-in timed out; continuing without it.`);
        skipped.push(site.key as 'youtube');
        continue;
      }
      if (!ok) throw new Error(`${site.name} is not signed in. Run again and sign into ${site.name} in the browser window.`);
      say(`${site.name} signed in.`);
      await page.waitForTimeout(1500);
      await this.saveCookies(context);
    }
    await this.saveCookies(context);
    return { skipped };
  }

  // ───────────────────────── Cover image: a different frame for every video ─────────────────────────

  /**
   * Grok's video starts on the reference image (Mr. Apple alone), so TikTok's automatic cover is identical every time.
   * Pick the frame (25%–75% into the video) that differs MOST from the first frame — that is where the guest animal and
   * the scene appear — and save it as a JPEG. Decoding happens in a blank browser tab; no ffmpeg involved.
   */
  public static async extractCoverFrame(
    page: Page,
    videoPath: string,
    outPath: string
  ): Promise<{ timeSec: number; durationSec: number }> {
    const b64 = fs.readFileSync(videoPath).toString('base64');
    await page.evaluate('window.__name = window.__name || ((f) => f);');
    const res = await page.evaluate(async ({ b64 }) => {
      const blob = await (await fetch('data:video/mp4;base64,' + b64)).blob();
      const url = URL.createObjectURL(blob);
      const v = document.createElement('video');
      v.muted = true;
      v.preload = 'auto';
      v.src = url;
      await new Promise<void>((resolve, reject) => {
        v.onloadeddata = () => resolve();
        v.onerror = () => reject(new Error('The browser could not decode this video.'));
      });
      const d = v.duration;
      if (!isFinite(d) || d < 2) throw new Error('Video is too short to pick a cover frame.');
      const seek = (t: number) =>
        new Promise<void>((resolve) => {
          v.onseeked = () => resolve();
          v.currentTime = t;
        });
      const small = () => {
        const c = document.createElement('canvas');
        c.width = 48;
        c.height = 84;
        const x = c.getContext('2d')!;
        x.drawImage(v, 0, 0, 48, 84);
        return x.getImageData(0, 0, 48, 84).data;
      };
      await seek(0.05);
      const first = small();
      let best = { t: d * 0.5, diff: -1 };
      for (const f of [0.25, 0.35, 0.45, 0.55, 0.65, 0.75]) {
        const t = d * f;
        await seek(t);
        const px = small();
        let diff = 0;
        for (let i = 0; i < px.length; i += 4) {
          diff += Math.abs(px[i] - first[i]) + Math.abs(px[i + 1] - first[i + 1]) + Math.abs(px[i + 2] - first[i + 2]);
        }
        if (diff > best.diff) best = { t, diff };
      }
      await seek(best.t);
      const c = document.createElement('canvas');
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      return { dataUrl: c.toDataURL('image/jpeg', 0.92), t: best.t, d };
    }, { b64 });

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, Buffer.from(res.dataUrl.split(',')[1], 'base64'));
    return { timeSec: res.t, durationSec: res.d };
  }

  private static async makeCoverImage(videoPath: string, jobId: string): Promise<string | null> {
    const outPath = path.join(__dirname, '../../storage/thumbnails', `thumb_${jobId}.jpg`);
    let page: Page | null = null;
    try {
      const context = await this.launchContext(false);
      page = await context.newPage();
      const r = await this.extractCoverFrame(page, videoPath, outPath);
      console.log(`[JevBrowserAgent] Cover frame chosen at ${r.timeSec.toFixed(1)}s of ${r.durationSec.toFixed(1)}s: ${outPath}`);
      return outPath;
    } catch (err: any) {
      console.warn('[JevBrowserAgent] Could not pick a cover frame (TikTok will use its automatic cover):', err.message);
      return null;
    } finally {
      await page?.close().catch(() => {});
    }
  }

  /**
   * On TikTok Studio's upload form: Edit cover → Upload cover → pick our JPEG → Confirm.
   * Best effort: if TikTok's layout differs, we save screenshots for debugging, back out, and post with the automatic cover.
   */
  private static async setTikTokCover(page: Page, coverPath: string): Promise<boolean> {
    const framesDir = path.join(__dirname, '../../storage/frames');
    const snap = (tag: string) => page.screenshot({ path: path.join(framesDir, `tiktok_cover_${tag}_${Date.now()}.png`) }).catch(() => {});
    let chooserHandled = false;
    const onChooser = async (chooser: FileChooser) => {
      chooserHandled = true;
      await chooser.setFiles(coverPath).catch(() => {});
    };
    page.on('filechooser', onChooser);
    try {
      const edit = page.getByText(/^\s*Edit cover\s*$/i).filter({ visible: true }).first();
      if (!(await edit.waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false))) {
        await snap('no_edit_button');
        console.warn('[JevBrowserAgent] TikTok "Edit cover" button not found; using the automatic cover.');
        return false;
      }
      await edit.click();

      const dialog = page.locator('[role="dialog"], [class*="modal" i]').filter({ hasText: /cover/i }).filter({ visible: true }).last();
      await dialog.waitFor({ state: 'visible', timeout: 10000 });

      // The "Upload cover" tab can be a <label> for a hidden file input, so merely clicking it asks Chrome to open the
      // Mac's file picker. A 'filechooser' listener (registered above) intercepts that picker and feeds it our JPEG instead.
      const uploadTab = dialog.getByText(/^\s*Upload cover\s*$/i).first();
      if (await uploadTab.isVisible().catch(() => false)) await uploadTab.click();
      await page.waitForTimeout(1200);

      if (!chooserHandled) {
        const input = dialog.locator('input[type="file"]').first();
        if ((await input.count()) > 0) {
          await input.setInputFiles(coverPath);
        } else {
          await dialog.getByText(/upload/i).filter({ visible: true }).last().click();
          for (let i = 0; i < 20 && !chooserHandled; i++) await page.waitForTimeout(400);
          if (!chooserHandled) throw new Error('TikTok did not offer a way to upload the cover image.');
        }
      }
      await page.waitForTimeout(2500);
      await snap('uploaded');

      const confirm = dialog.getByRole('button', { name: /^(Confirm|Save|Done|Apply)$/i }).first();
      await confirm.waitFor({ state: 'visible', timeout: 10000 });
      await confirm.click({ timeout: 5000 });
      await dialog.waitFor({ state: 'hidden', timeout: 15000 });
      console.log('[JevBrowserAgent] Custom cover image set on TikTok.');
      return true;
    } catch (err: any) {
      await snap('failed');
      console.warn('[JevBrowserAgent] Could not set a custom TikTok cover (continuing with the automatic one):', err.message);
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(500);
      return false;
    } finally {
      page.off('filechooser', onChooser);
    }
  }

  // ───────────────────────── YouTube (Shorts) upload ─────────────────────────

  /**
   * Upload the finished video to YouTube through YouTube Studio's upload dialog (same browser, same Google login).
   * A 9:16 video under 3 minutes is published as a YouTube Short automatically.
   *
   * Flow: open the upload dialog → choose the file → title / description → "made for kids" answer → (best effort) custom
   * thumbnail → Next ×3 → visibility → Publish → read the video link from the "Video published" dialog.
   * Screenshots of each stage go to storage/frames/youtube_*.png so a Studio layout change is easy to diagnose.
   */
  public static async uploadToYouTubeViaBrowser(
    videoPath: string,
    title: string,
    description: string,
    opts: { coverPath?: string; madeForKids: boolean; visibility: 'public' | 'unlisted' | 'private' }
  ): Promise<{ success: boolean; verified?: boolean; shareUrl?: string; message: string }> {
    const context = await this.launchContext(false);
    const page = context.pages().find((p) => !p.isClosed() && p.url().includes('youtube.com')) || (await context.newPage());
    await page.bringToFront().catch(() => {});

    const framesDir = path.join(__dirname, '../../storage/frames');
    fs.mkdirSync(framesDir, { recursive: true });
    const snap = (tag: string) => page.screenshot({ path: path.join(framesDir, `youtube_${tag}_${Date.now()}.png`) }).catch(() => {});
    const visible = async (loc: ReturnType<Page['locator']>, ms = 1500) =>
      loc.first().waitFor({ state: 'visible', timeout: ms }).then(() => true).catch(() => false);

    // YouTube Studio sometimes shows an "unsupported browser" page with a "Skip to YouTube Studio" link.
    const skipInterstitial = async () => {
      await page.waitForTimeout(2500);
      const skip = page.getByText(/skip to youtube studio/i).first();
      if (await skip.isVisible().catch(() => false)) {
        console.log('[JevBrowserAgent] YouTube showed its browser-support page — skipping it.');
        await skip.click().catch(() => {});
        await page.waitForTimeout(3000);
      }
    };

    // No native "choose a file" window may ever open: intercept pickers, and only feed the one we open on purpose.
    let chooserFile: string | null = null;
    const onChooser = async (chooser: FileChooser) => {
      if (chooserFile) await chooser.setFiles(chooserFile).catch(() => {});
    };
    page.on('filechooser', onChooser);

    try {
      if (!this.isValidVideoFile(videoPath)) return { success: false, message: 'Refusing to upload: the video file is missing or not a valid MP4.' };

      // 1. Open the upload dialog.
      console.log('[JevBrowserAgent] Opening YouTube Studio upload...');
      await page.evaluate('window.onbeforeunload = null;').catch(() => {});
      await page.goto('https://www.youtube.com/upload', { waitUntil: 'domcontentloaded', timeout: 45000 });
      await skipInterstitial();
      const fileInput = page.locator('input[type="file"]').first();
      let ready = await fileInput.waitFor({ state: 'attached', timeout: 20000 }).then(() => true).catch(() => false);
      if (!ready && !/accounts\.google\.com/.test(page.url())) {
        // Fallback: Studio → Create → Upload videos.
        await page.goto('https://studio.youtube.com/', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
        await skipInterstitial();
        await page.getByRole('button', { name: /^Create$/i }).first().click({ timeout: 15000 }).catch(() => {});
        await page.getByRole('menuitem', { name: /Upload videos/i }).first().click({ timeout: 8000 }).catch(() => {});
        ready = await fileInput.waitFor({ state: 'attached', timeout: 15000 }).then(() => true).catch(() => false);
      }
      if (!ready) {
        await snap('no_upload_dialog');
        const why = /accounts\.google\.com/.test(page.url())
          ? 'YouTube is not signed in.'
          : (await visible(page.getByText(/create a channel/i)))
            ? 'This Google account has no YouTube channel yet — create one at youtube.com first.'
            : "Could not open YouTube Studio's upload dialog.";
        return { success: false, message: `${why} Screenshot saved in storage/frames.` };
      }

      // 2. Choose the video file (this starts the upload).
      console.log('[JevBrowserAgent] Sending the video file to YouTube...');
      await fileInput.setInputFiles(videoPath);
      if (await visible(page.getByText(/daily upload limit|upload limit reached/i), 4000)) {
        await snap('limit');
        return { success: false, message: 'YouTube says the daily upload limit has been reached. Try again later.' };
      }

      // 3. Details: title, description, audience.
      const titleBox = page.locator('#title-textarea #textbox, [aria-label^="Add a title"]').first();
      await titleBox.waitFor({ state: 'visible', timeout: 90000 });
      await titleBox.click();
      await page.keyboard.press('ControlOrMeta+A');
      await page.keyboard.insertText(title.slice(0, 100));

      const descBox = page.locator('#description-textarea #textbox, [aria-label^="Tell viewers about your video"]').first();
      if (await visible(descBox, 3000)) {
        await descBox.click();
        await page.keyboard.press('ControlOrMeta+A');
        await page.keyboard.insertText(description.slice(0, 4900));
      }

      // YouTube forces an answer to "Is this video made for kids?" before it lets you continue.
      const kidsName = opts.madeForKids ? 'VIDEO_MADE_FOR_KIDS_MFK' : 'VIDEO_MADE_FOR_KIDS_NOT_MFK';
      const kidsRadio = page.locator(`[name="${kidsName}"]`).first();
      const kidsByRole = page.getByRole('radio', { name: opts.madeForKids ? /^Yes, it'?s made for kids/i : /^No, it'?s not made for kids/i }).first();
      if (await visible(kidsRadio, 5000)) await kidsRadio.click();
      else if (await visible(kidsByRole, 3000)) await kidsByRole.click();
      else console.warn('[JevBrowserAgent] YouTube: could not find the "made for kids" choice.');

      // "Altered content": cartoon characters are not realistic people/places, so the honest answer is "No" (best effort).
      const alteredNo = page.locator('[name="VIDEO_HAS_ALTERED_CONTENT_NO"]').first();
      if (await visible(alteredNo, 1500)) await alteredNo.click().catch(() => {});

      // Custom thumbnail (best effort; YouTube only allows it on verified channels).
      if (opts.coverPath && fs.existsSync(opts.coverPath)) {
        const thumbBtn = page.getByRole('button', { name: /upload (file|thumbnail)/i }).first();
        if (await visible(thumbBtn, 2500)) {
          chooserFile = opts.coverPath;
          await thumbBtn.click().catch(() => {});
          await page.waitForTimeout(3000);
          chooserFile = null;
        }
      }
      await snap('details');

      // 4. Next ×3 (Video elements → Checks → Visibility).
      for (let i = 0; i < 3; i++) {
        await page
          .waitForFunction(() => {
            const b = document.querySelector('#next-button');
            return !!b && b.getAttribute('aria-disabled') !== 'true';
          }, undefined, { timeout: 60000 })
          .catch(() => {});
        await page.locator('#next-button').first().click({ timeout: 15000 });
        await page.waitForTimeout(1500);
      }

      // 5. Visibility.
      const visName = { public: 'PUBLIC', unlisted: 'UNLISTED', private: 'PRIVATE' }[opts.visibility];
      const visRadio = page.locator(`[name="${visName}"]`).first();
      const visByRole = page.getByRole('radio', { name: new RegExp(`^${opts.visibility}`, 'i') }).first();
      if (await visible(visRadio, 8000)) await visRadio.click();
      else if (await visible(visByRole, 3000)) await visByRole.click();
      else throw new Error('Could not find the visibility choice (Public / Unlisted / Private).');
      await snap('visibility');

      // 6. Publish — the button stays disabled until the upload itself has finished.
      console.log('[JevBrowserAgent] Waiting for the YouTube upload to finish, then publishing...');
      await page
        .waitForFunction(() => {
          const b = document.querySelector('#done-button');
          return !!b && b.getAttribute('aria-disabled') !== 'true';
        }, undefined, { timeout: 10 * 60 * 1000 })
        .catch(() => {
          throw new Error('YouTube did not finish processing the upload within 10 minutes.');
        });
      await page.locator('#done-button').first().click({ timeout: 15000 });

      // 7. Confirmation dialog with the video link.
      const link = page.locator('ytcp-video-share-dialog a[href], a[href*="/shorts/"], a[href*="youtu.be/"], a[href*="watch?v="]').first();
      const published = await link.waitFor({ state: 'visible', timeout: 90000 }).then(() => true).catch(() => false);
      const shareUrl = published ? await link.getAttribute('href').catch(() => null) : null;
      await snap(published ? 'published' : 'unconfirmed');
      await page.getByRole('button', { name: /^Close$/i }).first().click({ timeout: 4000 }).catch(() => {});

      if (published) {
        console.log(`[JevBrowserAgent] Video published on YouTube: ${shareUrl}`);
        return { success: true, verified: true, shareUrl: shareUrl || undefined, message: 'Video published on YouTube.' };
      }
      return { success: true, verified: false, message: 'Publish was clicked, but YouTube did not show its confirmation (check YouTube Studio).' };
    } catch (err: any) {
      await snap('failed');
      console.warn('[JevBrowserAgent] YouTube upload error:', err.message);
      return { success: false, message: err.message };
    } finally {
      page.off('filechooser', onChooser);
    }
  }

  /**
   * Step 3: Browse into TikTok Upload, upload the video, set caption & AIGC disclosure, and stage/publish.
   */
  public static async uploadToTikTokViaBrowser(
    videoPath: string,
    title: string,
    hook: string,
    coverPath?: string
  ): Promise<{ success: boolean; verified?: boolean; shareUrl?: string; message: string }> {
    const context = await this.launchContext(false);
    const pages = context.pages();
    let page = pages.find((p) => p.url().includes('tiktok.com'));
    if (!page) {
      page = await context.newPage();
    }
    await page.bringToFront().catch(() => { });

    try {
      // Helper: dismiss any unexpected "Are you sure you want to exit?" modal
      const dismissExitModal = async () => {
        try {
          const exitCancelBtn = await page.$(
            'div:has-text("Are you sure you want to exit") button:has-text("Cancel"), div[role="dialog"] button:has-text("Cancel"), button:text-is("Cancel")'
          );
          if (exitCancelBtn) {
            console.log('[JevBrowserAgent] Auto-dismissing TikTok exit modal with Cancel to stay on upload page...');
            await exitCancelBtn.click({ force: true }).catch(() => { });
            await page.waitForTimeout(500);
          }
        } catch { }
      };

      await dismissExitModal();

      // Always load a fresh TikTok Studio upload form so any previous staged file is cleared
      console.log('[JevBrowserAgent] Navigating to fresh TikTok Studio Upload...');
      await page.evaluate(() => {
        window.onbeforeunload = null;
      }).catch(() => {});
      await page.goto('https://www.tiktok.com/tiktokstudio/upload', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3500);

      await dismissExitModal();

      // Check for login requirement
      const loginRequired = await page.$('a[href*="/login"], button:has-text("Log in"), button:has-text("Use QR code")');
      if (loginRequired) {
        console.warn('[JevBrowserAgent] TikTok requires sign-in in browser tab.');
        return {
          success: false,
          message: 'TikTok upload awaiting sign-in in Tab 3.',
        };
      }

      // Strict Guard: Refuse upload if video is missing or not a valid MP4/WebM file (>= 250KB, valid header)
      if (!this.isValidVideoFile(videoPath)) {
        console.warn('[JevBrowserAgent] Invalid or non-MP4 video file on disk. Refusing to upload to TikTok:', videoPath);
        return {
          success: false,
          message: 'Refusing to upload: Video file is missing or not a valid MP4 video.',
        };
      }

      // Wait for file input to appear on the fresh upload page
      await page.waitForSelector('input[type="file"], input[accept*="video"]', { state: 'attached', timeout: 15000 }).catch(() => null);
      const fileInput = await page.$('input[type="file"], input[accept*="video"]');
      if (fileInput) {
        console.log('[JevBrowserAgent] Uploading genuine MP4 video file to TikTok Studio:', videoPath);
        await fileInput.setInputFiles(videoPath);
        await page.waitForTimeout(3500);

        // 1. Disable beforeunload dialog so Chromium never halts with "Leave site?"
        await page.evaluate(() => {
          window.onbeforeunload = null;
        });
        if (!this.tiktokDialogPages.has(page)) {
          this.tiktokDialogPages.add(page);
          // Having ANY 'filechooser' listener stops Chrome from opening the Mac's native "choose a file" window on this tab.
          page.on('filechooser', () => {});
          page.on('dialog', async (dialog) => {
            console.log('[JevBrowserAgent] Handling TikTok browser dialog:', dialog.message());
            await dialog.accept().catch(() => { });
          });
        }

        // 2. Fill caption / description with clean title and hashtags (without corrupting Draft.js DOM spans)
        const cleanTitle = title.replace(/\s*\(ChatGPT Browser\)\s*/gi, '').replace(/^["']|["']$/g, '').trim();
        const captionSelector = 'div[contenteditable="true"], textarea, div[role="combobox"]';
        const captionEl = await page.$(captionSelector);
        if (captionEl) {
          await captionEl.click({ force: true });
          await page.waitForTimeout(300);

          // Select all and delete natively using keyboard so Draft.js/Lexical state stays intact
          await page.keyboard.press('Meta+A');
          await page.waitForTimeout(100);
          await page.keyboard.press('Backspace');
          await page.waitForTimeout(100);
          await page.keyboard.press('Control+A');
          await page.keyboard.press('Backspace');
          await page.waitForTimeout(200);

          const cleanCaption = `${cleanTitle} ${hook}`.trim();
          await page.keyboard.insertText(cleanCaption);
          await page.waitForTimeout(300);
          // Press Escape in case hashtag autocomplete dropdown opened
          await page.keyboard.press('Escape').catch(() => {});
          await page.waitForTimeout(200);
        }

        // 3. Toggle AI-generated content disclosure if visible
        try {
          const aiToggle = await page.$('input[type="checkbox"][aria-label*="AI"], button:has-text("AI-generated content"), [data-testid*="ai-disclosure"]');
          if (aiToggle) {
            await aiToggle.click({ force: true }).catch(() => { });
          }
        } catch { }

        // 4. Wait for video upload & processing status to be 100% complete
        console.log('[JevBrowserAgent] Waiting for TikTok video upload to show Uploaded (100%)...');
        await page.getByText(/^\s*Uploaded\b/i).first().waitFor({ state: 'visible', timeout: 120000 }).catch(() => null);
        await page.waitForTimeout(2000);

        // 4b. Unique cover image (a mid-video frame instead of the identical first frame)
        if (coverPath && fs.existsSync(coverPath)) {
          await this.setTikTokCover(page, coverPath);
          await dismissExitModal();
        }

        // 5. Ensure any exit modal is dismissed before scrolling
        await dismissExitModal();

        // 6. Scroll down to expose the Post button
        console.log('[JevBrowserAgent] Scrolling to bottom and checking TikTok Post button status...');
        await page.evaluate(() => {
          window.scrollTo(0, document.body.scrollHeight);
          const scrollables = document.querySelectorAll('div, main, section');
          scrollables.forEach(s => {
            if (s.scrollHeight > s.clientHeight) s.scrollTop = s.scrollHeight;
          });
        });
        await page.waitForTimeout(1500);
        await dismissExitModal();

        // 7. Locate genuine Post button using Playwright locator & frames
        let targetPostBtn: any = null;
        const candidateLocators = [
          page.getByRole('button', { name: /^Post$/i }),
          page.locator('button:text-is("Post")'),
          page.locator('button').filter({ hasText: /^Post$/i }),
          page.locator('button[class*="post" i]'),
        ];

        for (const loc of candidateLocators) {
          if (await loc.count().catch(() => 0) > 0) {
            targetPostBtn = loc.first();
            break;
          }
        }

        if (!targetPostBtn) {
          for (const frame of page.frames()) {
            const fLoc = frame.getByRole('button', { name: /^Post$/i });
            if (await fLoc.count().catch(() => 0) > 0) {
              targetPostBtn = fLoc.first();
              break;
            }
          }
        }

        if (targetPostBtn) {
          await targetPostBtn.scrollIntoViewIfNeeded().catch(() => { });
          await page.waitForTimeout(1000);

          // Wait for TikTok Post button to become enabled (checks finishing)
          const waitPostStart = Date.now();
          while (Date.now() - waitPostStart < 120000) {
            const isDisabled = await targetPostBtn.evaluate((el: HTMLButtonElement) => el.disabled || el.getAttribute('aria-disabled') === 'true').catch(() => false);
            if (!isDisabled) {
              console.log('[JevBrowserAgent] TikTok Post button is ready and enabled!');
              break;
            }
            console.log('[JevBrowserAgent] Waiting for TikTok copyright & content checks to complete before clicking Post...');
            await page.waitForTimeout(2000);
          }

          console.log('[JevBrowserAgent] Clicking genuine red TikTok Post button now...');
          await targetPostBtn.click({ force: true });
          // Native event fallback
          await targetPostBtn.evaluate((el: HTMLElement) => el.click()).catch(() => { });
          await page.waitForTimeout(3000);

          // Handle any confirmation popup (e.g. "Post now", "Confirm", or "Manage your posts")
          const confirmBtn = await page.$(
            'div[role="dialog"] button:has-text("Post now"), div[role="dialog"] button:has-text("Post"), div[role="dialog"] button:has-text("Confirm"), button:text-is("Post now")'
          );
          if (confirmBtn) {
            console.log('[JevBrowserAgent] Confirming TikTok publication popup dialog...');
            await confirmBtn.click({ force: true }).catch(() => { });
            await page.waitForTimeout(3000);
          }
        } else {
          console.warn('[JevBrowserAgent] Could not find bottom Post button.');
        }

        // 8. Monitor TikTok for publication confirmation
        console.log('[JevBrowserAgent] Monitoring TikTok for publication confirmation...');
        let isPublished = false;
        const confirmStart = Date.now();

        while (Date.now() - confirmStart < 40000) {
          await page.waitForTimeout(1500);

          if (page.url().includes('/content') || page.url().includes('/manage')) {
            isPublished = true;
            break;
          }

          const hasPublishedMessage = await page.evaluate(() => {
            const text = document.body.innerText || '';
            return (
              text.includes('Your video has been published') ||
              text.includes('Manage your posts') ||
              text.includes('Upload another video') ||
              text.includes('View video') ||
              text.includes('Your video is uploaded')
            );
          }).catch(() => false);

          if (hasPublishedMessage) {
            isPublished = true;
            break;
          }

          // If exit modal popped up, dismiss it
          await dismissExitModal();
        }

        if (isPublished) {
          console.log('[JevBrowserAgent] Video successfully posted to TikTok!');
          return {
            success: true,
            verified: true,
            message: 'Video successfully uploaded and published to TikTok!',
            shareUrl: 'https://www.tiktok.com/tiktokstudio/content',
          };
        } else {
          const framesDir = path.join(__dirname, '../../storage/frames');
          const errSnap = path.join(framesDir, `tiktok_post_state_${Date.now()}.png`);
          await page.screenshot({ path: errSnap }).catch(() => { });
          console.warn('[JevBrowserAgent] TikTok post pending confirmation. Screenshot saved:', errSnap);
          return {
            success: true, // Post was clicked, but TikTok never showed a confirmation
            verified: false,
            message: 'Video staged and submitted on TikTok Studio (processing receipt in progress).',
            shareUrl: 'https://www.tiktok.com/tiktokstudio/content',
          };
        }
      }

      return {
        success: false,
        message: 'TikTok file upload element staged; awaiting operator confirmation.',
      };
    } catch (err: any) {
      console.warn('[JevBrowserAgent] TikTok browser upload note:', err.message);
      return { success: false, message: err.message };
    }
  }

  /**
   * FULL AUTONOMOUS SEQUENCE (ChatGPT -> Grok -> Video Assembly -> QA -> TikTok)
   * Controls the browser automatically through all three steps continuously without manual intervention.
   */
  private static pipelineRunning = false;

  public static async runFullAutonomousPipeline(
    options: Parameters<typeof JevBrowserAgent.runPipelineOnce>[0]
  ): ReturnType<typeof JevBrowserAgent.runPipelineOnce> {
    if (this.pipelineRunning) {
      throw new Error('A video is already being produced. Wait for it to finish before starting another.');
    }
    this.pipelineRunning = true;
    try {
      const result = await this.runPipelineOnce(options);
      if (result.postedEverywhere) {
        // Every place we posted to confirmed it: close the window so the next video starts from a clean browser.
        options.onProgress?.('Posted. Closing the browser so it is fresh for the next video…');
        console.log('[JevBrowserAgent] All posts verified — closing the browser window.');
        await new Promise((r) => setTimeout(r, 3000));
        await this.shutdown();
      }
      return result;
    } finally {
      this.pipelineRunning = false;
      if (this.activeInteractiveContext) await this.saveCookies(this.activeInteractiveContext);
    }
  }

  private static async runPipelineOnce(options: {
    format: string;
    ageBand: string;
    seriesTitle: string;
    learningGoal: string;
    creativeTopic?: string;
    targetDurationSec?: number;
    onProgress?: (step: string, kind?: 'running' | 'waiting_login') => void;
  }): Promise<{
    success: boolean;
    jobId: string;
    title: string;
    hook: string;
    videoPath: string;
    thumbnailPath?: string;
    durationSeconds: number;
    qaPassed: boolean;
    tiktokStatus: string;
    tiktokVerified: boolean;
    tiktokUrl?: string;
    youtubeStatus: string;
    youtubeVerified: boolean;
    youtubeUrl?: string;
    postedEverywhere: boolean;
    message: string;
  }> {
    const jobId = 'job_' + crypto.randomUUID().slice(0, 10);
    console.log(`[JevBrowserAgent] Starting full autonomous pipeline for Job ${jobId}...`);
    const say = (step: string, kind: 'running' | 'waiting_login' = 'running') => options.onProgress?.(step, kind);

    // 0. Open the browser (once) and make sure ChatGPT, Grok and TikTok are signed in — waits for the operator if not.
    const browser = await this.launchContext(false);
    const targets = getPublishTargets();
    const login = await this.ensureLoggedIn(browser, say, targets);
    const youtubeOn = targets.youtube && !login.skipped.includes('youtube');


    // 1. ChatGPT: Generate prompt & script
    console.log('[JevBrowserAgent] SEQUENCE STEP 1: Creating prompt and script in ChatGPT...');
    say('Writing a new Mr. Apple prompt in ChatGPT…');
    const chatGptResult = await this.generatePromptViaChatGPT({
      format: options.format,
      ageBand: options.ageBand,
      seriesTitle: options.seriesTitle,
      creativeTopic: options.creativeTopic,
      learningGoal: options.learningGoal,
      targetDurationSec: options.targetDurationSec || 15,
    }, false);

    const scriptPkg = chatGptResult.scriptPackage;
    const grokPrompt = scriptPkg.shot_briefs[0]?.video_prompt;
    if (!grokPrompt || grokPrompt.length < 50) {
      throw new Error(`Master prompt from ChatGPT is empty or too short (${grokPrompt?.length || 0} chars). Aborting.`);
    }
    console.log(`[JevBrowserAgent] SEQUENCE STEP 1 SUCCESS: "${scriptPkg.concept_title}". Copied Grok prompt (${grokPrompt.length} chars).`);

    // 2. Grok: one video from the exact ChatGPT prompt + Mr. Apple reference image
    console.log('[JevBrowserAgent] SEQUENCE STEP 2: Generating the video in Grok Imagine...');
    say('Generating the video in Grok (about 1–3 minutes)…');
    const series = db.prepare("SELECT * FROM series WHERE status IN ('pilot', 'active') LIMIT 1").get() as any;
    const grokRes = await this.createVideoViaGrok(grokPrompt, jobId, 1, false, options.targetDurationSec || 15);
    if (!this.isValidVideoFile(grokRes.videoPath)) {
      throw new Error('Grok Imagine did not produce a valid video. Pipeline halted; nothing was uploaded to TikTok.');
    }

    const captions = scriptPkg.captions || [];
    const safeSlug = scriptPkg.concept_title.replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 30) || 'Episode';
    const finalVideoPath = path.join(path.dirname(grokRes.videoPath), `${safeSlug}_${jobId}.mp4`);

    // Raw Grok video with its original audio — no FFmpeg processing.
    fs.renameSync(grokRes.videoPath, finalVideoPath);
    console.log(`[JevBrowserAgent] Video ready (${grokRes.durationSec}s, original Grok audio): ${finalVideoPath}`);

    const videoDuration = grokRes.durationSec;
    const framesDir = path.join(__dirname, '../../storage/frames');
    say('Picking a cover frame…');
    const existingSnap = path.join(framesDir, `shot_${jobId}_1.png`);
    const coverPath = await this.makeCoverImage(finalVideoPath, jobId);
    const thumbnailPath = coverPath || (fs.existsSync(existingSnap) ? existingSnap : null);

    // 4. BIND TO OPEN PUBLISHING SLOT & INSERT JOB FIRST (Satisfies FOREIGN KEY constraint for qa_inspections)
    const openSlot = db.prepare("SELECT * FROM publishing_slots WHERE status = 'unassigned' LIMIT 1").get() as any;
    const slotId = openSlot ? openSlot.id : null;

    console.log('[JevBrowserAgent] Registering job in database before QA audit...');
    db.prepare(`
      INSERT INTO jobs (
        id, series_id, slot_id, concept_title, format, age_band,
        hook, hypothesis, script_text, shot_briefs_json, captions_json,
        state, video_path, thumbnail_path, duration_seconds, actual_cost_usd,
        is_ai_generated, tiktok_share_url, is_demo_job, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'rendering', ?, ?, ?, 0.05, 1, NULL, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(
      jobId,
      series?.id || null,
      slotId,
      scriptPkg.concept_title,
      options.format,
      options.ageBand,
      scriptPkg.hook,
      scriptPkg.hypothesis,
      scriptPkg.script_text,
      JSON.stringify(scriptPkg.shot_briefs),
      JSON.stringify(scriptPkg.captions),
      finalVideoPath,
      thumbnailPath,
      videoDuration
    );

    // 5. Kids Safety QA Inspection (FOREIGN KEY constraint satisfied!)
    console.log('[JevBrowserAgent] Running multi-stage Kids Safety & COPPA QA Inspection...');
    say('Running the kids-safety check…');
    const qaResult = await KidsSafetyQAInspector.inspectJob(
      jobId,
      scriptPkg.script_text,
      captions.map((c: any) => c.text).join(' '),
      videoDuration,
      finalVideoPath,
      []
    );

    // 6. Post — ONLY when QA passed. TikTok first (browser; Buffer only as a fallback, never both), then YouTube.
    let tiktokStatus = targets.tiktok ? 'held_for_review' : 'off';
    let tiktokUrl: string | undefined;
    let browserPosted = false; // Post was clicked in the browser — never also send through Buffer
    let tiktokVerified = false; // TikTok showed its "published" confirmation
    let youtubeStatus = youtubeOn ? 'held_for_review' : targets.youtube ? 'skipped' : 'off';
    let youtubeUrl: string | undefined;
    let youtubeVerified = false;

    if (qaResult.passed) {
      if (targets.tiktok) {
        console.log('[JevBrowserAgent] SEQUENCE STEP 3: Uploading finished video to TikTok...');
        say('Uploading to TikTok and posting…');
        tiktokStatus = 'ready_to_publish';
        try {
          const uploadRes = await this.uploadToTikTokViaBrowser(finalVideoPath, scriptPkg.concept_title, scriptPkg.hook, coverPath || undefined);
          if (uploadRes.success) {
            browserPosted = true;
            tiktokVerified = !!uploadRes.verified;
            tiktokStatus = tiktokVerified ? 'published' : 'scheduled'; // 'scheduled' = Post clicked, awaiting TikTok's receipt
            tiktokUrl = uploadRes.shareUrl;
          } else {
            console.warn('[JevBrowserAgent] TikTok browser upload did not complete:', uploadRes.message);
          }
        } catch (ttErr: any) {
          console.warn('[JevBrowserAgent] TikTok browser upload error:', ttErr.message);
        }

        if (!browserPosted) {
          try {
            const pubRes = await BufferTikTokPublisher.publishVideoPost(
              jobId, scriptPkg.concept_title, scriptPkg.hook, finalVideoPath, thumbnailPath || undefined
            );
            if (pubRes.status === 'published' || pubRes.status === 'scheduled') {
              tiktokStatus = pubRes.status;
              tiktokUrl = pubRes.shareUrl || tiktokUrl;
            }
          } catch { }
        }
      }

      if (youtubeOn) {
        console.log('[JevBrowserAgent] SEQUENCE STEP 4: Uploading finished video to YouTube...');
        say('Uploading to YouTube…');
        youtubeStatus = 'failed';
        try {
          const cleanTitle = scriptPkg.concept_title.replace(/\s*#\w+/g, '').trim();
          const yt = await this.uploadToYouTubeViaBrowser(
            finalVideoPath,
            cleanTitle,
            `${scriptPkg.hook}\n\n#Shorts`,
            { coverPath: coverPath || undefined, madeForKids: targets.youtubeMadeForKids, visibility: targets.youtubeVisibility }
          );
          if (yt.success) {
            youtubeVerified = !!yt.verified;
            youtubeStatus = youtubeVerified ? 'published' : 'submitted';
            youtubeUrl = yt.shareUrl;
          } else {
            console.warn('[JevBrowserAgent] YouTube upload did not complete:', yt.message);
            say(`YouTube upload failed: ${yt.message}`);
          }
        } catch (ytErr: any) {
          console.warn('[JevBrowserAgent] YouTube upload error:', ytErr.message);
        }
      }
    } else {
      console.warn('[JevBrowserAgent] QA did not pass — video held for review and NOT uploaded anywhere.');
    }

    // The browser window may close only when every place we meant to post to confirmed the post.
    const postedEverywhere =
      qaResult.passed && (tiktokVerified || youtubeVerified) && (!targets.tiktok || tiktokVerified) && (!youtubeOn || youtubeVerified);

    // 7. Update Job and Slot final states in database
    const anyPublished = tiktokStatus === 'published' || youtubeStatus === 'published';
    const anySubmitted = tiktokStatus === 'scheduled' || youtubeStatus === 'submitted';
    const finalState = !qaResult.passed
      ? 'held_for_review'
      : anyPublished ? 'published' : anySubmitted ? 'scheduled' : 'ready_to_publish';
    db.prepare(`
      UPDATE jobs
      SET state = ?,
          tiktok_share_url = ?,
          youtube_share_url = ?,
          video_path = ?,
          thumbnail_path = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      finalState,
      tiktokUrl || null,
      youtubeUrl || null,
      finalVideoPath,
      thumbnailPath,
      jobId
    );

    if (slotId) {
      db.prepare("UPDATE publishing_slots SET status = 'ready', assigned_job_id = ? WHERE id = ?").run(jobId, slotId);
    }

    return {
      success: true,
      jobId,
      title: scriptPkg.concept_title,
      hook: scriptPkg.hook,
      videoPath: finalVideoPath,
      thumbnailPath: thumbnailPath || undefined,
      durationSeconds: videoDuration,
      qaPassed: qaResult.passed,
      tiktokStatus,
      tiktokVerified,
      tiktokUrl,
      youtubeStatus,
      youtubeVerified,
      youtubeUrl,
      postedEverywhere,
      message: `ChatGPT prompt -> Grok video (${videoDuration}s${grokRes.width && grokRes.height ? ', ' + grokRes.width + 'x' + grokRes.height : ''}, original sound) -> QA ${qaResult.passed ? 'passed' : 'held'} -> TikTok: ${tiktokStatus} -> YouTube: ${youtubeStatus}`,
    };
  }
}

export default JevBrowserAgent;

