import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { execFile, execSync } from 'child_process';
import { promisify } from 'util';
import { chromium, BrowserContext, Page, FileChooser, Locator } from 'playwright';

const execFileAsync = promisify(execFile);
import db from '../db/database';
import { inspectJob } from './qaInspector';
import { ScriptPackage, GrokResolution } from './types';
import { ACCOUNT_KEYS, AccountKey, recordAccountStatus } from './accountStatus';
import { withClipboard } from './clipboardLock';
import { withGrokSlot } from './grokSemaphore';
import { isValidVideoBuffer, isValidVideoFile } from './videoFile';
import { installPopupGuards, dismissPopups } from './popups';
import { findWithJev } from './jevAssist';
import { FRAMES_DIR, THUMBNAILS_DIR, VIDEOS_DIR } from '../paths';
import {
  getChannel,
  updateChannel,
  profileDir,
  cookiesFile,
  referenceImagePath,
} from './channels';

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

export interface PipelineOptions {
  targetDurationSec?: number;
  targetResolution?: GrokResolution;
  onProgress?: (step: string, kind?: 'running' | 'waiting_login') => void;
  /** Called once the video's row exists in the database, with its id. */
  onJob?: (jobId: string) => void;
}

export interface PipelineResult {
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
  /** True when at least one platform accepted the post (confirmed or not). */
  postedAnywhere: boolean;
  /** Platforms attempted in this pass that did not go through, e.g. ["YouTube"]. */
  postFailed: string[];
  message: string;
}

export class ChannelBrowserAgent {
  public readonly channelId: number;
  private userProfileDir: string;
  private cookiesFile: string;
  private activeInteractiveContext: BrowserContext | null = null;
  private isLaunching = false;
  private launchPromise: Promise<BrowserContext> | null = null;
  private tiktokDialogPages = new WeakSet<Page>();
  private pipelineRunning = false;
  private skipLogin = false;
  private accountCancel = false;
  private cancelRequested = false;
  private cancelReason: 'user' | 'timeout' = 'user';
  /** Set once the Grok prompt was submitted: from then on Grok may charge for the video. */
  private grokSubmitted = false;
  /** When the Grok composer was opened and set to Video ahead of time (0: not prepared). */
  private grokPreparedAt = 0;
  /** Set when the run stopped waiting for the preparation: it must then leave the Grok tab alone. */
  private grokPrepAbandoned = false;
  /** When each site last looked signed in, in the window that is open now. Cleared whenever the window closes. */
  private siteVerifiedAt = new Map<AccountKey, number>();

  constructor(channelId = 1) {
    this.channelId = channelId;
    this.userProfileDir = profileDir(channelId);
    this.cookiesFile = cookiesFile(channelId);
  }

  public isValidVideoBuffer(buf: Buffer | null | undefined): boolean {
    return ChannelBrowserAgent.isValidVideoBuffer(buf);
  }

  public isValidVideoFile(filePath: string): boolean {
    return ChannelBrowserAgent.isValidVideoFile(filePath);
  }

  public parseVideoSpec(prompt: string, fallbackSec = 10): GrokVideoSpec {
    return ChannelBrowserAgent.parseVideoSpec(prompt, fallbackSec);
  }

  private cleanupStaleLocks(dir: string): void {
    ChannelBrowserAgent.cleanupStaleLocks(dir);
  }

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
  private ensureProfileDir(): string {
    this.userProfileDir = profileDir(this.channelId);
    if (!fs.existsSync(this.userProfileDir)) {
      fs.mkdirSync(this.userProfileDir, { recursive: true });
    }
    return this.userProfileDir;
  }

  /**
   * Launch a persistent browser context so logins to ChatGPT and Grok persist.
   * If an interactive window is already open on the user's desktop, reuses it seamlessly.
   */

  public async launchContext(headless = false): Promise<BrowserContext> {
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
            this.siteVerifiedAt.clear();
          });
          return context;
        })
        .finally(() => {
          this.launchPromise = null;
        });
    }
    return this.launchPromise;
  }

  private async launchPersistent(headless: boolean): Promise<BrowserContext> {
    const profileDir = this.ensureProfileDir();
    this.cleanupStaleLocks(profileDir);

    const xOffset = ((this.channelId - 1) % 5) * 60;
    const yOffset = ((this.channelId - 1) % 5) * 40;
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
        `--window-name=Channel ${this.channelId}`,
        `--window-position=${xOffset},${yOffset}`,
      ],
    });
    // tsx/esbuild injects a __name() helper into in-page functions; give every page a no-op version so evaluate() never breaks.
    await context.addInitScript('window.__name = window.__name || ((f) => f);');
    // Every tab, now and later, gets the pop-up guards (cookie banners, promos, "verify your phone"...).
    for (const p of context.pages()) void installPopupGuards(p);
    context.on('page', (p) => void installPopupGuards(p));
    return context;
  }

  /**
   * Get the active or configured ChatGPT conversation URL for this channel.
   */
  public getConfiguredChatGptUrl(): string {
    try {
      const ch = getChannel(this.channelId);
      if (ch?.chatgpt_chat_url?.trim()) {
        const u = ch.chatgpt_chat_url.trim();
        if (this.channelId === 1 && u.includes('6af2935e-bb8c-83ea-817b-3f4c6bfe7999')) {
          return '';
        }
        return u;
      }
      if (this.channelId === 1) {
        // Legacy single-row settings table: absent on fresh databases, so a failure here means "no legacy URL".
        let legacyUrl = '';
        try {
          const row = db.prepare('SELECT chatgpt_chat_url FROM settings WHERE id = 1').get() as any;
          legacyUrl = row?.chatgpt_chat_url?.trim() || '';
        } catch {
          legacyUrl = '';
        }
        const legacy = legacyUrl || process.env.CHATGPT_MR_APPLE_URL?.trim() || '';
        if (legacy && !legacy.includes('6af2935e-bb8c-83ea-817b-3f4c6bfe7999')) {
          return legacy;
        }
      }
      return '';
    } catch {
      return '';
    }
  }

  /**
   * Save a newly resolved ChatGPT conversation URL to persistent channel settings.
   */
  public saveChatGptUrl(url: string): void {
    if (!url || !url.startsWith('http')) return;
    try {
      updateChannel(this.channelId, { chatgpt_chat_url: url.trim() });
      if (this.channelId === 1) {
        try {
          db.prepare('UPDATE settings SET chatgpt_chat_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1').run(url.trim());
        } catch {
          // legacy settings table is absent on fresh databases; the channel row is the source of truth
        }
      }
      console.log(`[ChannelBrowserAgent-${this.channelId}] Persisted new ChatGPT URL for channel ${this.channelId}: ${url.trim()}`);
    } catch (err: any) {
      console.warn(`[ChannelBrowserAgent-${this.channelId}] Could not persist ChatGPT URL:`, err.message);
    }
  }

  /**
   * Search ChatGPT sidebar or search dialog to locate the channel's master prompt conversation.
   */
  public async locateMrAppleConversation(
    page: Page
  ): Promise<{ url: string; title: string } | null> {
    try {
      const ch = getChannel(this.channelId);
      const targetChatName = (ch?.chatgpt_chat_name || (this.channelId === 1 ? 'Create Mr Apple Videos' : (ch?.name || ''))).trim();
      if (!targetChatName) {
        console.log(`[ChannelBrowserAgent-${this.channelId}] No chat name configured for channel ${this.channelId}; skipping sidebar search.`);
        return null;
      }
      console.log(`[ChannelBrowserAgent-${this.channelId}] Searching ChatGPT for chat: "${targetChatName}"...`);

      // 1. Ensure sidebar is open
      const openSidebarBtn = await page.$(
        'button[data-testid="open-sidebar-button"], button[aria-label="Open sidebar"], button[aria-label*="sidebar" i]'
      );
      if (openSidebarBtn) {
        const isVisible = await openSidebarBtn.isVisible().catch(() => false);
        if (isVisible) {
          console.log(`[ChannelBrowserAgent-${this.channelId}] Opening collapsed sidebar...`);
          await openSidebarBtn.click().catch(() => {});
          await page.waitForTimeout(1000);
        }
      }

      // Wait a moment for conversations to hydrate
      await page.waitForSelector('nav a[href*="/c/"], [data-testid="conversation-sidebar"] a, a[href*="/c/"]', {
        timeout: 10000,
      }).catch(() => null);

      // 2. Scan links in DOM
      const match = await page.evaluate((target: string) => {
        const links = Array.from(document.querySelectorAll('a[href*="/c/"]')) as HTMLAnchorElement[];
        const normalize = (str: string) => str.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
        const normTarget = normalize(target);
        const targetWords = normTarget.split(' ').filter((w) => w.length > 2);

        // Pass 1: Look for exact phrase match
        for (const a of links) {
          const text = normalize(a.innerText || a.getAttribute('aria-label') || a.title || '');
          if (text.includes(normTarget)) {
            return { url: a.href, title: (a.innerText || a.title || target).trim() };
          }
        }

        // Pass 2: Look for all words matching
        if (targetWords.length > 0) {
          for (const a of links) {
            const text = normalize(a.innerText || a.getAttribute('aria-label') || a.title || '');
            if (targetWords.every((w) => text.includes(w))) {
              return { url: a.href, title: (a.innerText || a.title || target).trim() };
            }
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
              if (text.includes(normTarget) || (targetWords.length > 0 && targetWords.some((w) => text.includes(w)))) {
                return { url: a.href, title: a.innerText.trim() };
              }
            }
          }
        }

        return null;
      }, targetChatName);

      if (match) {
        console.log(`[ChannelBrowserAgent-${this.channelId}] Successfully found chat link in sidebar: "${match.title}" -> ${match.url}`);
        return match;
      }

      // 3. Fallback: Try ChatGPT Search Chats (Meta+K / Ctrl+K)
      console.log(`[ChannelBrowserAgent-${this.channelId}] Not immediately visible in sidebar. Trying ChatGPT Search dialog (Meta+K)...`);
      await page.keyboard.press('Meta+K');
      await page.waitForTimeout(1000);

      const searchInput = await page.$(
        'input[placeholder*="Search" i], input[type="search"], [role="combobox"], [data-testid="search-input"]'
      );
      if (searchInput) {
        await searchInput.fill(targetChatName);
        await page.waitForTimeout(1500);

        const firstWord = targetChatName.split(' ')[0] || targetChatName;
        const searchResult = await page.$(`a[href*="/c/"]:has-text("${firstWord}"), [role="option"]:has-text("${firstWord}")`);
        if (searchResult) {
          await searchResult.click().catch(() => {});
          await page.waitForTimeout(2000);
          const currentUrl = page.url();
          if (currentUrl.includes('/c/')) {
            const currentTitle = await page.title().catch(() => targetChatName);
            return { url: currentUrl, title: currentTitle };
          }
        }
        await page.keyboard.press('Escape');
      }

      return null;
    } catch (err: any) {
      console.warn(`[ChannelBrowserAgent-${this.channelId}] locateMrAppleConversation search note:`, err.message);
      return null;
    }
  }

  /**
   * Resolves and navigates to the active "Create Mr Apple Videos" conversation page.
   * If a stored URL exists and is valid, navigates to it.
   * If invalid (e.g. from previous account) or not configured, auto-detects from sidebar.
   */
  public async navigateToMrAppleConversation(
    page: Page,
    screenshotPath?: string
  ): Promise<string> {
    const configuredUrl = this.getConfiguredChatGptUrl();
    const framesDir = FRAMES_DIR;
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
      console.log(`[ChannelBrowserAgent-${this.channelId}] Attempting to navigate to configured conversation URL: ${configuredUrl}`);
      try {
        await page.goto(configuredUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await waitForConversationReady();

        if (await checkLogin()) {
          await page.screenshot({ path: localScreenshotPath });
          throw new Error('ChatGPT requires login. Please open the interactive browser to log in to your ChatGPT account first.');
        }

        const isError = await checkConversationError();
        if (!isError && page.url().includes('/c/')) {
          console.log(`[ChannelBrowserAgent-${this.channelId}] Successfully connected to configured conversation URL: ${page.url()}`);
          return page.url();
        }

        console.warn(`[ChannelBrowserAgent-${this.channelId}] Configured conversation URL returned error or redirected (${page.url()}). Checking alternatives...`);
      } catch (err: any) {
        if (err.message.includes('ChatGPT requires login')) throw err;
        console.warn(`[ChannelBrowserAgent-${this.channelId}] Error loading configured URL:`, err.message);
      }
    }

    const ch = getChannel(this.channelId);
    const targetChatName = ch?.chatgpt_chat_name || (this.channelId === 1 ? 'Create Mr Apple Videos' : (ch?.name || ''));

    // Strategy 2: Navigate to https://chatgpt.com/ and detect the conversation
    console.log(`[ChannelBrowserAgent-${this.channelId}] Navigating to https://chatgpt.com/ to detect chat "${targetChatName}"...`);
    await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3500);

    if (await checkLogin()) {
      await page.screenshot({ path: localScreenshotPath });
      throw new Error('ChatGPT requires login. Please open the browser window and sign into ChatGPT first.');
    }

    const detected = await this.locateMrAppleConversation(page);
    if (detected && detected.url) {
      console.log(`[ChannelBrowserAgent-${this.channelId}] Detected conversation: "${detected.title}". Navigating to ${detected.url}...`);
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
      console.log(`[ChannelBrowserAgent-${this.channelId}] Current page has active chat: "${pageTitle}" -> ${page.url()}`);
      this.saveChatGptUrl(page.url());
      return page.url();
    }

    // If still not found, capture screenshot and give user exact helpful action items
    await page.screenshot({ path: localScreenshotPath }).catch(() => {});
    throw new Error(
      `ChatGPT is logged in, but the conversation "${targetChatName}" could not be detected. ` +
      `Please copy its URL (e.g. https://chatgpt.com/c/...) and paste it in the channel settings under "ChatGPT Chat URL". Screenshot saved: ${localScreenshotPath}`
    );
  }

  /**
   * Actively inspect active browser or launch headless session to auto-detect and persist
   * the pinned "Create Mr Apple Videos" chat URL.
   */
  public async detectAndSetChatGptUrl(): Promise<{ success: boolean; url?: string; title?: string; message: string }> {
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
  public async submitChatGptPrompt(page: Page, promptText: string): Promise<boolean> {
    console.log(`[ChannelBrowserAgent] Locating bottom chat composer to submit "${promptText}"...`);
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

    let element: any = inputHandle.asElement();
    if (!element) {
      // Backup: ChatGPT changed its layout. Ask Jev which box on screen is the message box.
      const byJev = await findWithJev(page, 'type a new message to ChatGPT (the message box at the bottom of the chat)', 'ChatGPT');
      element = byJev ? await byJev.elementHandle({ timeout: 2000 }).catch(() => null) : null;
    }
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
    console.log(`[ChannelBrowserAgent] Typing "${promptText}" into bottom chat composer...`);
    await page.keyboard.type(promptText, { delay: 50 });
    await page.waitForTimeout(300);

    // Verify text was entered into the chat composer
    const enteredText = await element.evaluate((el: any) => {
      return (el.innerText || el.value || el.textContent || '').trim();
    });

    // If typing didn't populate the contenteditable node (e.g. React controlled component):
    if (!enteredText.toLowerCase().includes(promptText.toLowerCase())) {
      console.log('[ChannelBrowserAgent] Inserting text via keyboard.insertText to chat composer...');
      await element.click({ force: true });
      await page.keyboard.insertText(promptText);
      await page.waitForTimeout(300);
    }

    // Submit prompt: Press Enter natively
    console.log(`[ChannelBrowserAgent] Submitting prompt via Enter key...`);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(600);

    // Fallback: Click ONLY the explicit send button if it is still visible and enabled (never click voice/mic buttons!)
    const sendBtn = await page.$(
      'button[data-testid="send-button"], button[aria-label="Send prompt"], button[aria-label="Send message"]'
    );
    if (sendBtn) {
      const isDisabled = await sendBtn.getAttribute('disabled');
      if (isDisabled === null) {
        console.log('[ChannelBrowserAgent] Clicking bottom Send button...');
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
  public async extractPromptAndTitleFromChatGpt(page: Page): Promise<{
    grokPrompt: string;
    cleanTitle: string;
    cleanHook: string;
    rawText: string;
    promptCount: number;
    /** The newest prompt found in a ChatGPT "writing" card (writing-card format), with that card's title. */
    writingPrompt: string;
    writingTitle: string;
  }> {
    const ch = getChannel(this.channelId);
    const hashtagHint = ch?.hashtag_hint?.trim() || '#';

    const domData = await page.evaluate((hint: string) => {
      // Helper to check whether text looks like a Grok video generation prompt
      function isVideoPromptText(text: string): boolean {
        // Real prompts run past 5,000 characters (one reached 5,382), so the ceiling is only a guard against matching the whole page.
        if (!text || text.length < 60 || text.length > 20000) return false;
        const lower = text.toLowerCase();
        const hasAspectOrDuration =
          lower.includes('9:16') ||
          lower.includes('vertical') ||
          lower.includes('seconds') ||
          lower.includes('second') ||
          lower.includes('720p') ||
          lower.includes('480p') ||
          lower.includes('1080p') ||
          lower.includes('sound enabled') ||
          lower.includes('audio');
        const hasPromptContent =
          lower.includes('character') ||
          lower.includes('duplicate') ||
          lower.includes('dance') ||
          lower.includes('animation') ||
          lower.includes('choreography') ||
          lower.includes('rule') ||
          lower.includes('grok') ||
          lower.includes('video') ||
          lower.includes('scene') ||
          lower.includes('snow leopard') ||
          lower.includes('squirrel') ||
          lower.includes('limbs') ||
          lower.includes('shadows');
        return hasAspectOrDuration && hasPromptContent;
      }

      // Helper to clean UI noise from extracted prompt container text
      function cleanPromptText(raw: string): string {
        if (!raw) return '';
        let cleaned = raw
          .replace(/^(Writing|Start Writing|Plain text|Code|Copy code)\s+/i, '')
          .replace(/^ChatGPT said:\s*/i, '')
          .replace(/↳.*$/m, '')
          .replace(/Files, images, and data analysis are unavailable.*$/s, '')
          .replace(/Upgrade to Plus.*$/s, '')
          .trim();
        return cleaned;
      }

      // 1. Locate all conversation turns:
      const turnNodes = Array.from(document.querySelectorAll('article, [data-testid*="conversation-turn"]'));
      const assistantTurns = turnNodes.filter((el) => {
        const role = el.getAttribute('data-message-author-role');
        if (role === 'assistant') return true;
        if (role === 'user') return false;
        const hasFeedback = el.querySelector(
          'button[aria-label*="copy" i], button[data-testid*="copy" i], button[aria-label*="read aloud" i], button[aria-label*="good response" i], [data-testid*="assistant"]'
        );
        return Boolean(hasFeedback);
      });

      const lastTurn = assistantTurns.length > 0 ? assistantTurns[assistantTurns.length - 1] : (turnNodes.length > 0 ? turnNodes[turnNodes.length - 1] : null);

      let latestReplyPrompt = '';

      // Priority 1: Check inside the latest turn for writing / canvas cards or code blocks
      if (lastTurn) {
        // Look for cards, inline canvases, or code blocks
        const cardContainers = Array.from(
          lastTurn.querySelectorAll('[data-testid*="canvas"], [data-testid*="code-block"], [class*="contain-inline-size"], pre, div, section')
        );
        for (const c of cardContainers) {
          const t = cleanPromptText((c as HTMLElement).innerText || '');
          if (isVideoPromptText(t)) {
            // Pick the tightest container that contains the prompt
            if (!latestReplyPrompt || t.length < latestReplyPrompt.length) {
              latestReplyPrompt = t;
            }
          }
        }

        // If not found in card containers, check pre blocks
        if (!latestReplyPrompt) {
          for (const pre of Array.from(lastTurn.querySelectorAll('pre'))) {
            const t = cleanPromptText((pre as HTMLElement).innerText || '');
            if (t.length > 50 && (!latestReplyPrompt || t.length > latestReplyPrompt.length)) {
              latestReplyPrompt = t;
            }
          }
        }

        // If not found, inspect full cleaned text of the last turn
        if (!latestReplyPrompt) {
          const full = cleanPromptText((lastTurn as HTMLElement).innerText || '');
          if (isVideoPromptText(full)) {
            latestReplyPrompt = full;
          }
        }
      }

      // Priority 2: the page's markup was not recognised, so read the page as plain text instead. A prompt is the
      // text between the last code-block label ("Plain text") and the last settings line ("10 seconds • Vertical 9:16 …").
      // This never returns a fragment: it either finds the whole block or nothing.
      if (!latestReplyPrompt) {
        const bodyText = document.body.innerText || '';
        const settingsLine = /\d{1,2}\s*seconds?\s*[•·|][^\n]*/gi;
        let lastEnd = -1;
        let lastStart = -1;
        for (const m of bodyText.matchAll(settingsLine)) {
          if (/vertical|9:16|\d{3,4}p/i.test(m[0])) {
            lastStart = m.index as number;
            lastEnd = lastStart + m[0].length;
          }
        }
        if (lastEnd > 0) {
          const before = bodyText.slice(0, lastStart);
          const label = Math.max(before.lastIndexOf('Plain text'), before.lastIndexOf('Copy code'));
          if (label >= 0) {
            const t = cleanPromptText(bodyText.slice(label, lastEnd));
            if (isVideoPromptText(t)) latestReplyPrompt = t;
          }
        }
      }

      // Writing-card format (e.g. Mr Watermelon): no "Plain text" code block; the prompt is the body of a ChatGPT
      // "writing" card — a <header> with the story title (or just "Writing"), then the prompt text. The newest card
      // that reads as a video prompt wins. Read separately so the code-block path above is unchanged.
      let writingPrompt = '';
      let writingTitle = '';
      for (const card of Array.from(document.querySelectorAll('[data-testid="chatgpt-writing-block"]'))) {
        const full = ((card as HTMLElement).innerText || '').trim();
        const header = card.querySelector('header');
        const headText = header ? ((header as HTMLElement).innerText || '').trim() : '';
        const body = headText && full.startsWith(headText) ? full.slice(headText.length).trim() : full;
        if (!isVideoPromptText(body)) continue; // e.g. a title + hashtags card
        writingPrompt = body;
        writingTitle = headText && !/^(writing|start writing)$/i.test(headText) ? headText : '';
        if (!writingTitle) {
          const first = body.split('\n')[0].trim();
          if (first.length > 5 && first.length < 120 && /—|–|:/.test(first)) writingTitle = first;
        }
      }

      const promptCount = assistantTurns.length > 0 ? assistantTurns.length : (latestReplyPrompt ? 1 : 0);

      // 2. Extract Title & Hashtags from the page
      let title = '';
      let hook = '';
      const allNodes = Array.from(document.querySelectorAll('pre, code, [contenteditable="true"], p, div, h1, h2, h3, h4'));

      // Look from bottom up for hashtag box
      const cleanHint = hint && hint !== '#' ? hint.toLowerCase() : '#';
      for (let i = allNodes.length - 1; i >= 0; i--) {
        const text = ((allNodes[i] as HTMLElement).innerText || '').trim();
        if (text.includes('#') && (cleanHint === '#' || text.toLowerCase().includes(cleanHint)) && text.length < 500) {
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
          const hashLine = lines.find((l) => l.includes('#')) || '';
          const titleCandidate = lines.find((l) => !l.startsWith('#') && l.length > 5 && l.length < 140) || '';
          if (hashLine && !hook) hook = hashLine;
          if (titleCandidate && !title) {
            title = titleCandidate.replace(/^[🍎🎬"'#\s]+|["'\s]+$/g, '').trim();
          }
          if (title && hook) break;
        }
      }

      // Fallback for title: check prompt first line or headings with "—" or "vs."
      if (!title && latestReplyPrompt) {
        const firstLine = latestReplyPrompt.split('\n')[0].replace(/^[🍎🎬"'#\s]+|["'\s]+$/g, '').trim();
        if (
          firstLine.length > 5 &&
          firstLine.length < 100 &&
          !firstLine.toLowerCase().startsWith('never ') &&
          !firstLine.toLowerCase().startsWith('strict ') &&
          (firstLine.includes('—') || firstLine.includes(':') || firstLine.includes('vs.') || firstLine.includes('Dance'))
        ) {
          title = firstLine;
        }
      }

      if (!title) {
        for (let i = allNodes.length - 1; i >= 0; i--) {
          const text = ((allNodes[i] as HTMLElement).innerText || '').trim();
          if ((text.includes('vs.') || text.includes('Challenge') || text.includes('Battle') || text.includes('—')) && text.length < 200) {
            const firstLine = text.split('\n')[0].replace(/^[🍎🎬"'#\s]+|["'\s]+$/g, '').trim();
            if (
              firstLine.length > 5 &&
              firstLine.length < 140 &&
              !firstLine.startsWith('#') &&
              !firstLine.toLowerCase().startsWith('never ') &&
              !firstLine.toLowerCase().startsWith('strict ')
            ) {
              title = firstLine;
              break;
            }
          }
        }
      }

      return { domPrompt: latestReplyPrompt, title, hook, promptCount, writingPrompt, writingTitle };
    }, hashtagHint);

    let grokPrompt = domData.domPrompt || '';
    const codeMatch = grokPrompt.match(/```(?:[a-zA-Z]*\n)?([\s\S]*?)```/);
    if (codeMatch && codeMatch[1] && codeMatch[1].trim().length > 50) {
      grokPrompt = codeMatch[1].trim();
    } else {
      grokPrompt = grokPrompt.replace(/```/g, '').trim();
    }

    const channelName = ch?.name || 'Dance Video';
    const cleanTitle = domData.title || (this.channelId === 1 ? 'Mr. Apple & Friends Dance Battle' : `${channelName} Video`);
    const cleanHook = domData.hook || (hashtagHint !== '#' ? hashtagHint : `#${channelName.replace(/\s+/g, '')} #DanceChallenge #Viral`);

    return {
      grokPrompt,
      cleanTitle,
      cleanHook,
      rawText: grokPrompt,
      promptCount: domData.promptCount,
      writingPrompt: (domData.writingPrompt || '').trim(),
      writingTitle: (domData.writingTitle || '').replace(/^[🍎🎬"'#\s]+|["'\s]+$/g, '').trim(),
    };
  }

  /**
   * True while ChatGPT is still writing a reply. Its Stop button is labelled just "Stop" (no test id), which an earlier
   * version of this check did not know, so the app never noticed ChatGPT was still writing.
   */
  public async chatGptIsWriting(page: Page): Promise<boolean> {
    return page
      .evaluate(() => {
        return Array.from(document.querySelectorAll('button')).some((b) => {
          const r = b.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) return false;
          if (b.getAttribute('data-testid') === 'stop-button') return true;
          const label = (b.getAttribute('aria-label') || '').trim().toLowerCase();
          return /^stop( generating| streaming| response| answering)?$/.test(label); // not "Stop voice mode", "Stop dictation"...
        });
      })
      .catch(() => false);
  }

  /** The whole page's text, lower-cased with whitespace collapsed, so two readings of the same text compare equal. */
  public async chatGptPageText(page: Page): Promise<string> {
    const text = await page.evaluate(() => document.body.innerText || '').catch(() => '');
    return normalizePromptText(text);
  }

  /**
   * After "next" is sent: wait until ChatGPT has FINISHED writing a reply whose prompt was not on the page before.
   * Nothing is decided while ChatGPT shows its Stop button, in the first seconds after sending, or while the only prompt
   * visible is an old one. The prompt must then read the same three times in a row.
   */
  public async waitForNewChatGptReply(
    page: Page,
    pageTextBefore: string,
    sentAt: number,
    screenshotPath?: string,
    timeoutMs = 120000
  ): Promise<{ grokPrompt: string; cleanTitle: string; cleanHook: string; stillWriting: boolean }> {
    let grokPrompt = '';
    let cleanTitle = '';
    let cleanHook = '';
    let lastObservedPromptLen = 0;
    let stableTicks = 0;
    let stillWriting = false;
    let sawWriting = false;

    while (Date.now() - sentAt < timeoutMs) {
      await page.waitForTimeout(1500);
      await dismissPopups(page);

      // Keep the conversation scrolled to the newest reply. Only the scroller that holds the replies is moved:
      // scrolling every element with "scroll" in its class also scrolled the chat-history sidebar to the bottom.
      await page.evaluate(() => {
        const turns = Array.from(document.querySelectorAll('article, [data-testid*="conversation-turn"]'));
        let node: HTMLElement | null = (turns[turns.length - 1] as HTMLElement | undefined) || null;
        while (node) {
          const overflowY = getComputedStyle(node).overflowY;
          if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
            node.scrollTop = node.scrollHeight;
            return;
          }
          node = node.parentElement;
        }
        window.scrollTo(0, document.body.scrollHeight);
      }).catch(() => {});

      stillWriting = await this.chatGptIsWriting(page);
      if (stillWriting) {
        sawWriting = true;
        stableTicks = 0;
        lastObservedPromptLen = 0;
        continue; // ChatGPT is still writing
      }
      if (Date.now() - sentAt < 6000) continue; // ChatGPT needs a moment to start; never decide in the first seconds

      const currentData = await this.extractPromptAndTitleFromChatGpt(page);
      let candidate = currentData.grokPrompt;
      let fromWritingCard = false;
      // Channels whose ChatGPT answers in a writing card instead of a "Plain text" code block (Mr Watermelon).
      if (
        (candidate.length < 60 || isOldPrompt(candidate, pageTextBefore)) &&
        currentData.writingPrompt.length >= 60 &&
        !isOldPrompt(currentData.writingPrompt, pageTextBefore)
      ) {
        candidate = currentData.writingPrompt;
        fromWritingCard = true;
      }
      if (candidate.length < 60 || isOldPrompt(candidate, pageTextBefore)) {
        stableTicks = 0; // nothing new yet: the only prompt on the page is one that was already there
        lastObservedPromptLen = 0;
        continue;
      }

      if (candidate.length === lastObservedPromptLen) stableTicks++;
      else {
        lastObservedPromptLen = candidate.length;
        stableTicks = 0;
      }

      // If the Stop button was never seen (ChatGPT may have changed it again), be extra patient. A writing card is only
      // taken early once it ends with its settings line ("10 seconds • Vertical 9:16 • …"); otherwise wait longer.
      const needTicks = (sawWriting ? 2 : 3) + (fromWritingCard && !endsWithSettingsLine(candidate) ? 3 : 0);
      if (stableTicks >= needTicks) {
        // Optional: try copying via the card's native copy button to get 100% exact formatting. The clipboard text is only
        // used if it is the SAME prompt (a stale clipboard from an earlier run must never replace it).
        let chosen = candidate;
        try {
          const copyBtn = page
            .locator('article, [data-testid*="conversation-turn"]')
            .last()
            .locator('button[aria-label*="copy" i], button[data-testid*="copy" i]')
            .first();
          if (await copyBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
            await copyBtn.click({ force: true }).catch(() => {});
            await page.waitForTimeout(400);
            const clipText = execSync('pbpaste', { encoding: 'utf8' }).trim();
            if (
              clipText.length >= 60 &&
              normalizePromptText(clipText).slice(0, 200) === normalizePromptText(candidate).slice(0, 200)
            ) {
              chosen = clipText;
            }
          }
        } catch (_) {}

        await page.waitForTimeout(800);
        const finalData = await this.extractPromptAndTitleFromChatGpt(page);
        grokPrompt = chosen || finalData.grokPrompt;
        cleanTitle = (fromWritingCard && finalData.writingTitle) || finalData.cleanTitle;
        cleanHook = finalData.cleanHook;
        console.log(
          `[ChannelBrowserAgent-${this.channelId}] Brand new ChatGPT prompt finished writing (${grokPrompt.length} chars)! Title: "${cleanTitle}"`
        );
        break;
      }
    }

    void screenshotPath;
    return { grokPrompt, cleanTitle, cleanHook, stillWriting };
  }

  /** Refuse a prompt this channel has already made a video from (it would post the same video twice). */
  private assertPromptNotUsedBefore(prompt: string): void {
    let previous: string[] = [];
    try {
      const rows = db
        .prepare('SELECT shot_briefs_json FROM jobs WHERE channel_id = ? ORDER BY created_at DESC LIMIT 80')
        .all(this.channelId) as any[];
      previous = rows
        .map((r) => {
          try {
            return String(JSON.parse(r.shot_briefs_json)?.[0]?.video_prompt || '');
          } catch {
            return '';
          }
        })
        .filter(Boolean);
    } catch {
      return; // history unavailable: the page-text check above still protects
    }
    if (promptWasUsedBefore(prompt, previous)) {
      throw new Error('ChatGPT returned a prompt this channel already used for an earlier video. Not using it again.');
    }
  }

  /**
   * Step 1: Browse into ChatGPT, type "next" in the chat, wait for the new prompt to finish generating, and extract it.
   */
  public async generatePromptViaChatGPT(
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

    const framesDir = FRAMES_DIR;
    if (!fs.existsSync(framesDir)) fs.mkdirSync(framesDir, { recursive: true });

    const screenshotPath = path.join(framesDir, `chatgpt_state_${Date.now()}.png`);

    try {
      console.log('[ChannelBrowserAgent] Navigating to ChatGPT "Create Mr Apple Videos" master prompt chat...');
      const targetChatUrl = await this.navigateToMrAppleConversation(page, screenshotPath);
      console.log(`[ChannelBrowserAgent] Successfully connected to active master prompt chat: ${targetChatUrl}`);

      await page.bringToFront().catch(() => {});
      await page.waitForTimeout(1500);

      // If ChatGPT is still writing an earlier reply, let it finish first. Otherwise the next reply could be mistaken for it.
      for (let i = 0; i < 60 && (await this.chatGptIsWriting(page)); i++) await page.waitForTimeout(1500);

      // Everything on the page BEFORE "next" is sent counts as OLD. ChatGPT's layout has no message containers that mark
      // the newest reply (no <article>, no author-role attributes), so the new reply is recognised as text that was NOT
      // on the page before. (The earlier replies must have rendered first, or "old" would be empty.)
      let pageTextBefore = '';
      for (let i = 0; i < 8; i++) {
        pageTextBefore = await this.chatGptPageText(page);
        if (pageTextBefore.includes('plain text')) break;
        await page.waitForTimeout(1000);
      }
      console.log(`[ChannelBrowserAgent] Snapshot before "next": ${pageTextBefore.length} characters of earlier chat on the page.`);

      // ALWAYS submit "next" to generate a brand new video prompt!
      console.log('[ChannelBrowserAgent] Submitting "next" command strictly to bottom ChatGPT chat input...');
      await this.submitChatGptPrompt(page, 'next');
      const sentAt = Date.now();

      // Wait for ChatGPT to begin and finish writing the brand new reply
      console.log('[ChannelBrowserAgent] Waiting for ChatGPT to generate the NEW prompt...');
      const reply = await this.waitForNewChatGptReply(page, pageTextBefore, sentAt, screenshotPath);
      const grokPrompt = reply.grokPrompt;
      const cleanTitle = reply.cleanTitle;
      const cleanHook = reply.cleanHook;
      const lastStreaming = reply.stillWriting;

      await page.screenshot({ path: screenshotPath }).catch(() => {});
      if (context !== this.activeInteractiveContext) {
        await context.close().catch(() => {});
      }

      // STRICT VALIDATION: Must be a brand new, non-empty prompt! Never one that was already on the page before "next".
      if (!grokPrompt || grokPrompt.length < 60 || isOldPrompt(grokPrompt, pageTextBefore)) {
        // Keep the page markup next to the screenshot so a change in ChatGPT's layout can be diagnosed from the files.
        await page.content().then((html) => fs.writeFileSync(screenshotPath.replace(/\.png$/, '.html'), html.slice(0, 2_000_000))).catch(() => {});
        throw new Error(
          `ChatGPT did not finish generating a new prompt after submitting "next" (extracted ${grokPrompt.length} chars; ` +
          `${lastStreaming ? 'ChatGPT still showed its Stop button' : 'the reply looked finished but no new video prompt was found in it'}). ` +
          `Aborting before Grok so an old or incomplete prompt is never used.`
        );
      }
      // Second safety net: never reuse a prompt this channel has already made a video from.
      this.assertPromptNotUsedBefore(grokPrompt);

      console.log(
        `[ChannelBrowserAgent] SUCCESS: Extracted brand new Grok Prompt (${grokPrompt.length} chars)! Title: "${cleanTitle}"`
      );

      const shotBriefs = [
        {
          shot_number: 1,
          duration_seconds: 15,
          scene_description: 'Single shot from the ChatGPT prompt',
          video_prompt: grokPrompt,
          visual_focus: 'Single shot from the ChatGPT prompt',
          continuity_notes: 'Use the ChatGPT prompt exactly as written, with the channel reference image',
        },
      ];

      return {
        scriptPackage: {
          concept_title: cleanTitle,
          hook: cleanHook,
          script_text: grokPrompt,
          shot_briefs: shotBriefs,
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
   * Strictly validate that a buffer is a genuine MP4/WebM video. Implemented in videoFile.ts.
   */
  public static isValidVideoBuffer(buf: Buffer | null | undefined): boolean {
    return isValidVideoBuffer(buf);
  }

  /**
   * Strictly validate that a file on disk is a genuine MP4/WebM video file. Implemented in videoFile.ts.
   */
  public static isValidVideoFile(filePath: string): boolean {
    return isValidVideoFile(filePath);
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
  private async selectGrokRadio(
    page: Page,
    by: { label?: string; text?: string },
    waitMs = 3000
  ): Promise<boolean> {
    // Grok has shipped these controls two ways: role="radio" buttons, and plain buttons with aria-pressed (current).
    const btn = (
      by.label
        ? page.locator(`[role="radio"][aria-label="${by.label}"], button[aria-label="${by.label}"][aria-pressed]`)
        : page.locator('[role="radio"], [role="menuitemradio"], [role="option"]').filter({ hasText: new RegExp(`(^|\\s|\\b)${by.text}(\\b|\\s|$)`) })
    ).filter({ visible: true }).first();
    if (!(await btn.waitFor({ state: 'visible', timeout: waitMs }).then(() => true).catch(() => false))) return false;
    const isOn = async () =>
      (await btn.getAttribute('aria-checked').catch(() => null)) === 'true' ||
      (await btn.getAttribute('aria-pressed').catch(() => null)) === 'true' ||
      (await btn.getAttribute('data-state').catch(() => null)) === 'on';
    if (!(await isOn())) {
      // Short timeout and no retries into whatever pops up (e.g. a sign-in dialog).
      await btn.click({ timeout: 5000 }).catch(() => {});
      for (let i = 0; i < 8 && !(await isOn()); i++) {
        await page.waitForTimeout(250);
      }
      const blocked = await page.locator('#dialog-portal').filter({ hasText: /continue with|sign in|log in|upgrade/i }).count().catch(() => 0);
      if (blocked > 0) {
        await page.keyboard.press('Escape').catch(() => {});
        throw new Error(`Grok blocked the "${by.label || by.text}" option behind a sign-in/upgrade dialog. Log into Grok in the app's browser window, then run again.`);
      }
    }
    const checked = await isOn();
    if (!checked && by.text) {
      const seen = await page.locator('[role="radio"]').evaluateAll((els) =>
        els.map((e) => `${(e.textContent || e.getAttribute('aria-label') || '').trim()}=${e.getAttribute('aria-checked')}${(e as HTMLButtonElement).disabled ? '(disabled)' : ''}`).join(', ')
      ).catch(() => '');
      console.warn(`[ChannelBrowserAgent] Could not select "${by.text}". Grok options seen: ${seen}`);
    }
    return checked;
  }

  /**
   * Signed-in Grok shows resolution and length as dropdown buttons ("Video resolution" = 480p, "Video duration" = 6s).
   * Open the dropdown, choose the option, then confirm the button now shows it.
   */
  private async selectGrokDropdown(page: Page, buttonLabel: string, optionText: string): Promise<boolean> {
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
  public async configureGrokVideoMode(page: Page, spec: GrokVideoSpec): Promise<void> {
    let videoOn = await this.selectGrokRadio(page, { label: 'Video' }, 15000);
    if (!videoOn) {
      // Backup: Grok renamed or restyled the toggle. Ask Jev which control switches the composer to video.
      const byJev = await findWithJev(page, 'switch the prompt composer to Video mode so it makes a video instead of an image', 'Grok Imagine');
      if (byJev) {
        await byJev.click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(800);
        videoOn = (await page.locator('button[aria-label="Video resolution"], button[aria-label="Video duration"]').count().catch(() => 0)) > 0;
      }
    }
    if (!videoOn) {
      const shot = path.join(FRAMES_DIR, `grok_no_video_toggle_${Date.now()}.png`);
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
        `[ChannelBrowserAgent] Grok would not let us select ${!durationOk ? spec.durationSec + 's' : ''}${!durationOk && !resolutionOk ? ' / ' : ''}${!resolutionOk ? spec.resolution : ''}. ` +
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
      `[ChannelBrowserAgent] Grok set to Video • ${spec.durationSec}s${durationOk ? '' : ' (not found)'} • ${spec.resolution}${resolutionOk ? '' : ' (not found)'} • ${spec.aspect}${aspectOk ? '' : ' (not found)'}`
    );
  }

  /** The composer <form> on grok.com/imagine (the one holding the prompt textbox). */
  private grokComposer(page: Page) {
    return page.locator('form').filter({ has: page.locator('[role="textbox"], [contenteditable="true"], textarea') }).first();
  }

  /**
   * Press Grok's Submit arrow — only when Grok is ready — and confirm Grok took it.
   *
   * While Grok is still processing the reference image (a spinner on its thumbnail; a big PNG can take tens of seconds)
   * the Submit arrow is DISABLED, and a click or Enter is silently ignored. The old code checked once, pressed Enter
   * anyway, and then waited 6 minutes for a video that had never started (Mr Watermelon's 2.3 MB image). So: wait until
   * Submit is enabled, click, then require proof that Grok accepted it (the page moves to the result, a progress % shows,
   * or the prompt box empties). If not, press Enter once. Throws, with nothing submitted, if Grok never takes it.
   */
  public async submitGrokPrompt(
    page: Page,
    textbox: Locator,
    promptLength: number,
    opts: { enableTimeoutMs?: number; acceptTimeoutMs?: number } = {}
  ): Promise<void> {
    const enableTimeoutMs = opts.enableTimeoutMs ?? 120_000;
    const acceptTimeoutMs = opts.acceptTimeoutMs ?? 25_000;
    const submitBtn = this.grokComposer(page).locator('button[aria-label="Submit"], button[type="submit"]').first();

    const ready = await page
      .waitForFunction(
        () => {
          const b = document.querySelector('form button[aria-label="Submit"]') as HTMLButtonElement | null;
          return !!b && !b.disabled && b.getAttribute('aria-disabled') !== 'true';
        },
        undefined,
        { timeout: enableTimeoutMs, polling: 250 }
      )
      .then(() => true)
      .catch(() => false);
    if (!ready) {
      throw new Error(
        `Grok's Submit button stayed disabled for ${Math.round(enableTimeoutMs / 1000)} seconds (it is still processing the reference image, or the prompt box is empty). Nothing was submitted.`
      );
    }

    const accepted = async (): Promise<boolean> =>
      page
        .evaluate((len) => {
          const text = document.body.innerText || '';
          const box = document.querySelector('form [role="textbox"], form [contenteditable="true"], form textarea') as HTMLElement | null;
          const boxLen = box ? (((box as any).value ?? box.innerText) || '').trim().length : 0;
          return {
            moved: location.pathname.includes('/imagine/post/'),
            progress: /\b\d{1,2}%/.test(text),
            emptied: boxLen < len * 0.3,
          };
        }, promptLength)
        .then((r) => r.moved || r.progress || r.emptied)
        .catch(() => false);
    const waitAccepted = async (ms: number): Promise<boolean> => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        if (await accepted()) return true;
        await page.waitForTimeout(500);
      }
      return false;
    };

    await submitBtn.click({ timeout: 15_000 });
    if (await waitAccepted(acceptTimeoutMs)) return;

    // Not taken: Grok may have been mid-update. Try the keyboard once.
    console.warn(`[ChannelBrowserAgent-${this.channelId}] Grok did not react to the Submit click; pressing Enter once.`);
    await textbox.click({ timeout: 5000 }).catch(() => {});
    await page.keyboard.press('Enter');
    if (await waitAccepted(acceptTimeoutMs)) return;

    throw new Error(`Grok did not accept the submit within ${Math.round((acceptTimeoutMs * 2) / 1000)} seconds (the page never started the video). Nothing was submitted.`);
  }

  /**
   * Attach the Mr. Apple reference image to the composer's OWN file input.
   * (The page has other hidden file inputs that open the image editor — never use those.)
   */
  private async attachGrokReferenceImage(page: Page, imagePath: string): Promise<void> {
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
      console.warn(`[ChannelBrowserAgent-${this.channelId}] Composer file input not found; pasting reference image from clipboard instead.`);
      await withClipboard(async () => {
        await page.bringToFront().catch(() => {});
        await execFileAsync('osascript', ['-e', `set the clipboard to (read (POSIX file "${imagePath}") as JPEG picture)`]);
        await composer.locator('[role="textbox"], [contenteditable="true"], textarea').first().click();
        await page.keyboard.press('Meta+V');
      });
    }

    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (!page.url().includes('/imagine') || page.url().includes('/imagine/post/')) {
        throw new Error(`Uploading the reference image navigated Grok away from the prompt composer (${page.url()}).`);
      }
      if ((await countThumbs()) > before) {
        console.log('[ChannelBrowserAgent] Mr. Apple reference image attached to Grok prompt.');
        await page.waitForTimeout(800); // let the upload finish before submitting
        return;
      }
      await page.waitForTimeout(400);
    }
    console.warn('[ChannelBrowserAgent] Could not visually confirm the reference image thumbnail; continuing.');
  }

  /**
   * Step 2: In Grok Imagine — Video mode + reference image + EXACT ChatGPT prompt → generate → download the MP4.
   */
  public async createVideoViaGrok(
    grokPrompt: string,
    jobId: string,
    shotNumber = 1,
    headless = false,
    requestedDurationSec?: number,
    resolutionOverride?: '480p' | '720p'
  ): Promise<{ videoPath: string; screenshotPath?: string; imagePath?: string; durationSec: number; width?: number; height?: number }> {
    if (!grokPrompt || grokPrompt.length < 50) {
      throw new Error(`Grok prompt is invalid or too short (${grokPrompt?.length || 0} chars). Aborting.`);
    }

    const context = await this.launchContext(headless);
    const page = context.pages().find((p) => p.url().includes('grok.com')) || (await context.newPage());
    await page.bringToFront().catch(() => {});

    const storageVideos = VIDEOS_DIR;
    const framesDir = FRAMES_DIR;
    fs.mkdirSync(storageVideos, { recursive: true });
    fs.mkdirSync(framesDir, { recursive: true });

    const screenshotPath = path.join(framesDir, `grok_state_${jobId}_shot${shotNumber}_${Date.now()}.png`);
    const outputVideoPath = path.join(storageVideos, `shot_${jobId}_${shotNumber}.mp4`);
    const outputImagePath = path.join(framesDir, `shot_${jobId}_${shotNumber}.png`);
    // The operator's requested length & quality win over what was written in the ChatGPT prompt.
    const chInfo = getChannel(this.channelId);
    const targetDur = requestedDurationSec || chInfo?.grok_duration || 15;
    const targetRes = resolutionOverride || chInfo?.grok_resolution || '720p';

    const spec = this.parseVideoSpec(grokPrompt, targetDur);
    spec.resolution = targetRes;
    spec.durationSec = GROK_DURATIONS.reduce((best, d) =>
      Math.abs(d - targetDur) < Math.abs(best - targetDur) ? d : best
    );

    // If ChatGPT included a spec line at the end, align it with the operator's settings
    const promptLines = grokPrompt.split('\n');
    const specIdx = [...promptLines].map((l, i) => ({ l: l.trim(), i })).reverse().find(
      (item) => /\b\d{1,2}\s*seconds?\b/i.test(item.l) && /(\d{3,4}p|\d+\s*:\s*\d+|sound|vertical)/i.test(item.l)
    )?.i;
    if (specIdx !== undefined) {
      promptLines[specIdx] = `${spec.durationSec} seconds • Vertical ${spec.aspect} • ${spec.resolution} • Sound enabled`;
      grokPrompt = promptLines.join('\n');
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

    /** Grok's usage meter ("92% of weekly limit used — resets Thu 5:37 AM"), read from the credits button's popover. */
    const grokUsageNote = async (): Promise<string> => {
      try {
        const btn = page.locator('button[aria-label*="credits" i]').first();
        if (!(await btn.isVisible().catch(() => false))) return '';
        const label = (await btn.getAttribute('aria-label')) || '';
        await btn.click({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(800);
        const text: string = await page
          .evaluate(() =>
            Array.from(document.querySelectorAll('[role="dialog"], [role="menu"], [data-radix-popper-content-wrapper]'))
              .map((e) => ((e as HTMLElement).innerText || '').replace(/\s+/g, ' '))
              .find((t) => /weekly limit/i.test(t)) || ''
          )
          .catch(() => '');
        await page.keyboard.press('Escape').catch(() => {});
        const m = text.match(/\d+% of weekly limit used.*?Resets [^.]*?(AM|PM)/i);
        return (m ? m[0] : label).trim();
      } catch {
        return '';
      }
    };

    return withGrokSlot(async () => {
    try {
      // 1. Fresh Grok Imagine composer
      console.log(`[ChannelBrowserAgent-${this.channelId}] Opening fresh Grok Imagine composer (https://grok.com/imagine)...`);
      this.grokSubmitted = false;
      // The composer was opened and set to Video while ChatGPT was writing: use it as it is instead of reloading.
      const prepared =
        this.grokPreparedAt > 0 &&
        Date.now() - this.grokPreparedAt < 10 * 60 * 1000 &&
        /^https:\/\/grok\.com\/imagine\/?(\?.*)?$/.test(page.url());
      this.grokPreparedAt = 0;
      console.log(`[ChannelBrowserAgent-${this.channelId}] Grok composer ${prepared ? 'already prepared — no reload' : `not prepared (${page.url()}) — loading it`}.`);
      if (!prepared) {
        await page.goto('https://grok.com/imagine', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(400); // the composer itself is awaited just below
      }
      await dismissPopups(page);
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
      const refImagePath = referenceImagePath(this.channelId);
      if (refImagePath && fs.existsSync(refImagePath)) {
        await this.attachGrokReferenceImage(page, refImagePath);
        // Attaching an image can change the composer's options — re-assert Video settings.
        await this.configureGrokVideoMode(page, spec);
      } else {
        console.warn(`[ChannelBrowserAgent-${this.channelId}] Reference image missing for channel ${this.channelId}; generating without it.`);
      }

      // 4. Paste the EXACT ChatGPT prompt
      console.log(`[ChannelBrowserAgent] Pasting exact ChatGPT prompt into Grok (${grokPrompt.length} chars)...`);
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

      // 5. Submit once — only when Grok is ready, and only counted as submitted once Grok has taken it.
      try {
        await this.submitGrokPrompt(page, textbox, grokPrompt.length);
      } catch (err: any) {
        await fail(err?.message || 'Grok did not accept the submit. Nothing was submitted.');
      }
      // From here on Grok may charge for the video, so a failure must not be retried automatically.
      this.grokSubmitted = true;
      console.log(`[ChannelBrowserAgent] Submitted Shot ${shotNumber} to Grok. Waiting for the video...`);

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
      let sawProgress = false;
      let lastProgress = '';

      while (Date.now() - start < timeoutMs) {
        await page.waitForTimeout(2000);
        await dismissPopups(page);
        const state = await page.evaluate(({ initial, minDur }) => {
          const text = document.body.innerText || '';
          const errorMatch = text.match(/server failed to respond|failed to respond|something went wrong|content moderated|couldn['’]t generate|failed to generate|generation failed|rate limit|limit reached|try again later/i);
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
          const notice = Array.from(document.querySelectorAll('[role="alert"], [role="status"], [data-sonner-toast], #dialog-portal'))
            .map((e) => ((e as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim())
            .filter(Boolean)
            .join(' | ')
            .slice(0, 300);
          return { url: location.href, error: errorMatch ? errorMatch[0] : null, progress, makeVideo, video, notice };
        }, { initial: initialSrcs, minDur: minDuration }).catch(() => null);

        if (!state) continue;
        if (state.progress) {
          sawProgress = true;
          lastProgress = state.progress;
        }
        const serverFailure = /failed to respond|something went wrong/i.test(`${state.error || ''} ${state.notice || ''}`);
        if (serverFailure && !state.video) {
          await page.screenshot({ path: screenshotPath }).catch(() => {});
          const err: any = new Error(
            `Grok's server failed while making the ${spec.resolution} video ("Server failed to respond"${sawProgress ? ` after reaching ${lastProgress}%` : ''}). Screenshot: ${screenshotPath}`
          );
          err.code = 'GROK_SERVER_FAILED';
          throw err;
        }
        if (state.error) await fail(`Grok reported: "${state.error}".`);
        if (state.notice && /limit|credit|upgrade|quota|usage|unable|moderat/i.test(state.notice) && !state.progress && !state.video) {
          const usage = await grokUsageNote();
          await fail(`Grok did not start the video and said: "${state.notice}".${usage ? ` Grok usage: ${usage}.` : ''} Nothing was posted.`);
        }
        // 720p / 15s jobs can take a while to start, so give Grok a full minute before deciding it never began.
        if (!sawProgress && state.makeVideo && !state.video && !state.progress && Date.now() - start > 60000) {
          const usage = await grokUsageNote();
          await fail(
            'Grok never started the video — it only shows the still image page (no progress after 60 seconds).' +
              (usage ? ` Grok usage: ${usage}. A used-up weekly limit is the most likely cause.` : ' Check your Grok usage limit and that Video mode is on.') +
              ' Nothing was posted.'
          );
        }
        if (Date.now() - lastLog > 10000) {
          lastLog = Date.now();
          console.log(`[ChannelBrowserAgent] Shot ${shotNumber}: ${state.progress ? state.progress + '%' : 'rendering'} (${Math.round((Date.now() - start) / 1000)}s)`);
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
      console.log(`[ChannelBrowserAgent] Grok video ready (${main!.duration.toFixed(1)}s, ${sizeNote}): ${main!.src.slice(0, 90)}`);
      if (spec.resolution === '720p' && main!.h && Math.min(main!.w || 0, main!.h) < 700) {
        console.warn(`[ChannelBrowserAgent] WARNING: this video is ${sizeNote} — lower than 720p. Grok did not apply the 720p setting.`);
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
      console.log(`[ChannelBrowserAgent] Shot ${shotNumber} saved (${saved!.length} bytes): ${outputVideoPath}`);

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
    });
  }

  /**
   * Helper: Open interactive visible browser window so operator can log into ChatGPT and Grok once.
   */
  public async openInteractiveSession(): Promise<{ success: boolean; message: string }> {
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
      console.log(`[ChannelBrowserAgent-${this.channelId}] Opening interactive browser for login session...`);
      const context = await this.launchContext(false);

      // Use the default page for ChatGPT
      const pages = context.pages();
      const chatGptPage = pages.length > 0 ? pages[0] : await context.newPage();

      // Determine initial ChatGPT target: configured URL if valid, or clean chatgpt.com
      const configuredUrl = this.getConfiguredChatGptUrl();
      const targetChatUrl = configuredUrl || 'https://chatgpt.com/';

      console.log(`[ChannelBrowserAgent-${this.channelId}] Navigating Tab 1 to ${targetChatUrl}...`);
      chatGptPage.goto(targetChatUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch((err) => {
        console.warn(`[ChannelBrowserAgent-${this.channelId}] ChatGPT background navigation note:`, err.message);
      });

      // Automatically capture new conversation URL if operator opens or clicks the pinned chat
      chatGptPage.on('framenavigated', async (frame) => {
        if (frame === chatGptPage.mainFrame()) {
          const currentUrl = frame.url();
          if (currentUrl.includes('chatgpt.com/c/')) {
            const pageTitle = (await chatGptPage.title().catch(() => '')).toLowerCase();
            const ch = getChannel(this.channelId);
            const targetName = (ch?.chatgpt_chat_name || ch?.name || '').toLowerCase();
            if (!targetName || pageTitle.includes(targetName) || (this.channelId === 1 && (pageTitle.includes('apple') || pageTitle.includes('create')))) {
              console.log(`[ChannelBrowserAgent-${this.channelId}] Auto-learned chat URL from operator navigation: ${currentUrl}`);
              this.saveChatGptUrl(currentUrl);
            }
          }
        }
      });

      // Open a second tab for Grok Imagine (Media & Video Generation)
      console.log('[ChannelBrowserAgent] Opening Tab 2 for https://grok.com/imagine...');
      const grokPage = await context.newPage();
      grokPage.goto('https://grok.com/imagine', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch((err) => {
        console.warn('[ChannelBrowserAgent] Grok background navigation note:', err.message);
      });

      // Open a third tab for TikTok Studio
      console.log('[ChannelBrowserAgent] Opening Tab 3 for https://www.tiktok.com/tiktokstudio/upload...');
      const tiktokPage = await context.newPage();
      tiktokPage.goto('https://www.tiktok.com/tiktokstudio/upload', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch((err) => {
        console.warn('[ChannelBrowserAgent] TikTok background navigation note:', err.message);
      });

      // Explicitly bring Tab 1 (ChatGPT) to the front so operator immediately sees ChatGPT on launch
      console.log('[ChannelBrowserAgent] Focusing Tab 1 (ChatGPT) to front...');
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
  public async inspectSession(): Promise<any> {
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


  /**
   * Chromium drops "session" cookies (which most sites use for the login) when the browser closes.
   * We save every cookie after a successful login check / run and put the missing ones back on the next launch,
   * so unattended daily runs stay signed in. The file is private to this user (chmod 600) and git-ignored.
   */
  public async saveCookies(context: BrowserContext, allowEmpty = false): Promise<void> {
    try {
      const cookies = await context.cookies();
      if (cookies.length === 0 && !allowEmpty) return;
      fs.writeFileSync(this.cookiesFile, JSON.stringify(cookies), { mode: 0o600 });
      fs.chmodSync(this.cookiesFile, 0o600);
    } catch (err: any) {
      console.warn('[ChannelBrowserAgent] Could not save login cookies:', err.message);
    }
  }

  private async restoreCookies(context: BrowserContext): Promise<void> {
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
      console.log(`[ChannelBrowserAgent] Restored ${missing.length} saved login cookies.`);
    } catch (err: any) {
      console.warn('[ChannelBrowserAgent] Could not restore login cookies:', err.message);
    }
  }

  /** Save logins and close the browser (used by the scheduled job, which should not leave a window behind). */
  public async shutdown(): Promise<void> {
    const ctx = this.activeInteractiveContext;
    this.siteVerifiedAt.clear();
    if (!ctx) return;
    await this.saveCookies(ctx);
    this.activeInteractiveContext = null;
    await ctx.close().catch(() => {});
  }

  /** Whether this channel's browser window is open right now. */
  public isBrowserOpen(): boolean {
    return Boolean(this.activeInteractiveContext);
  }

  /** The channel's "keep the browser open between videos" setting (on unless switched off). */
  private keepBrowserOpen(): boolean {
    const ch = getChannel(this.channelId);
    return ch ? ch.keep_browser_open !== false : true;
  }

  /**
   * Frees the memory held by finished tabs (TikTok Studio, YouTube Studio) while the window stays open. The upload
   * steps open a fresh tab the next time they need one. The last tab is blanked instead of closed, so the window stays.
   */
  private async releaseTabs(hosts: string[]): Promise<void> {
    const ctx = this.activeInteractiveContext;
    if (!ctx) return;
    for (const page of ctx.pages()) {
      if (page.isClosed() || !hosts.some((h) => page.url().includes(h))) continue;
      const open = ctx.pages().filter((p) => !p.isClosed());
      if (open.length > 1) await page.close({ runBeforeUnload: false }).catch(() => {});
      else await page.goto('about:blank').catch(() => {});
    }
  }

  /**
   * Decide whether a site is signed in. We only say "out" on an EXPLICIT signed-out signal (a Log in / Sign in button
   * with exactly that name, a login URL). "Not sure" never blocks the run — the steps themselves report a real login problem.
   */
  private async siteLoginState(
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

      // Check if ANY page or popup in this context is currently on an OAuth auth host
      try {
        const ctxPages = page.context().pages();
        const authPopup = ctxPages.find(p => !p.isClosed() && authHost.test(p.url()));
        if (authPopup) {
          return { state: 'out', why: `OAuth sign-in window in progress (${new URL(authPopup.url()).host})` };
        }
      } catch {}

      if (!url.includes(host)) return authHost.test(url) ? { state: 'out', why: `on a sign-in page (${new URL(url).host})` } : { state: 'unknown', why: `off-site (${url.slice(0, 60)})` };

      if (site === 'chatgpt') {
        if (/\/auth\/|\/log-?in/i.test(url)) return { state: 'out', why: 'login URL' };
        if (await visible(page.locator('[data-testid="login-button"], a[href*="/auth/login"]'))) return { state: 'out', why: 'login-button element' };
        if (await anyVisible(named(/^\s*(Log in|Sign up for free|Sign in)\s*$/i))) return { state: 'out', why: '"Log in" button' };
        if (await visible(page.locator('[data-testid="accounts-profile-button"], nav a[href*="/c/"], #prompt-textarea, form [contenteditable="true"]')))
          return { state: 'in', why: 'composer / history visible, no login button' };
        return { state: 'unknown', why: 'page not ready' };
      }

      if (site === 'grok') {
        if (/sign-?in|login|auth/i.test(url)) return { state: 'out', why: 'login URL' };

        // 1. Explicit sign in / log in buttons or links
        const signInBtn = await page.locator('button, a, [role="button"]')
          .filter({ hasText: /^\s*(Sign\s*in|Log\s*in|Sign\s*up|Continue with Google|Sign in with Google|Sign in with X)\s*$/i })
          .filter({ visible: true })
          .count()
          .catch(() => 0);
        if (signInBtn > 0) return { state: 'out', why: 'Sign in / Log in button visible' };

        // 2. Auth dialogs / modals
        const authDialog = await page.locator('[role="dialog"], [aria-modal="true"]')
          .filter({ hasText: /sign\s*in|log\s*in|google|x\.ai|register/i })
          .filter({ visible: true })
          .count()
          .catch(() => 0);
        if (authDialog > 0) return { state: 'out', why: 'Sign-in modal dialog visible' };

        // 3. User profile avatar button (visible when logged in)
        const profileBtn = await page.locator(
          'button[aria-label*="profile" i], button[aria-label*="account" i], [data-testid*="user-nav"], [data-testid*="profile"], button:has(img[alt*="avatar" i]), [data-testid*="user-avatar"]'
        ).filter({ visible: true }).count().catch(() => 0);
        if (profileBtn > 0) return { state: 'in', why: 'user profile avatar visible' };

        // 4. In-page DOM inspection for user session
        const hasUserSession = await page.evaluate(() => {
          const navImgs = document.querySelectorAll('nav img, aside img, [role="navigation"] img');
          if (navImgs.length > 0) return true;
          const buttons = Array.from(document.querySelectorAll('button, a'));
          return buttons.some((b) => {
            const aria = (b.getAttribute('aria-label') || '').toLowerCase();
            return (aria.includes('profile') || aria.includes('account') || aria.includes('user')) && !b.textContent?.toLowerCase().includes('sign in');
          });
        }).catch(() => false);

        if (hasUserSession) return { state: 'in', why: 'user session elements visible' };

        // Never return 'in' simply because the textbox is visible
        return { state: 'unknown', why: 'Grok session not verified yet' };
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


  /** Called by the "I'm already signed in — continue" button. */
  public skipLoginWait(): void {
    this.skipLogin = true;
  }

  /**
   * Open ChatGPT, Grok and TikTok (all three tabs, right away) and make sure each is signed in. Only a site that is
   * clearly signed OUT makes us wait — the operator signs in and the run continues by itself.
   */
  public async ensureLoggedIn(
    context: BrowserContext,
    say: (step: string, kind?: 'running' | 'waiting_login') => void,
    targets: { tiktok: boolean; youtube: boolean },
    maxWaitMs = 10 * 60 * 1000,
    /** False when only posting an existing video: ChatGPT and Grok are not needed then. */
    needCreationSites = true
  ): Promise<{ skipped: Array<'youtube'> }> {
    type SiteKey = 'chatgpt' | 'grok' | 'tiktok' | 'youtube';
    const sites: Array<{ key: SiteKey; name: string; url: string; host: string; optional?: boolean }> = needCreationSites
      ? [
          { key: 'chatgpt', name: 'ChatGPT', url: this.getConfiguredChatGptUrl() || 'https://chatgpt.com/', host: 'chatgpt.com' },
          { key: 'grok', name: 'Grok', url: 'https://grok.com/imagine', host: 'grok.com' },
        ]
      : [];
    if (targets.tiktok) sites.push({ key: 'tiktok', name: 'TikTok', url: 'https://www.tiktok.com/tiktokstudio/upload', host: 'tiktok.com' });
    // YouTube is optional: if nobody signs in, the run still makes the video and posts to TikTok.
    if (targets.youtube) sites.push({ key: 'youtube', name: 'YouTube', url: 'https://studio.youtube.com/', host: 'youtube.com', optional: true });
    const skipped: Array<'youtube'> = [];
    const framesDir = FRAMES_DIR;
    fs.mkdirSync(framesDir, { recursive: true });
    this.skipLogin = false;

    // A warm window that already confirmed a site recently does not need to load and check it again: that check
    // loaded all four sites at once and was the slowest part of every run. A step that lands on a sign-in page
    // still fails clearly, and any failed run clears these marks so the next run checks everything.
    const WARM_LOGIN_MS = 6 * 60 * 60 * 1000;
    const recentlyVerified = (key: SiteKey) => {
      const at = this.siteVerifiedAt.get(key);
      return at !== undefined && Date.now() - at < WARM_LOGIN_MS;
    };
    const alreadyFine = sites.filter((site) => recentlyVerified(site.key));
    if (alreadyFine.length === sites.length) {
      say('Browser is already open and signed in. Skipping the login check.');
      return { skipped };
    }
    if (alreadyFine.length > 0) {
      sites.splice(0, sites.length, ...sites.filter((site) => !recentlyVerified(site.key)));
    }

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
    const loadStarted = Date.now();
    await Promise.all(
      sites.map((site, i) =>
        pages[i]
          .goto(site.url, { waitUntil: 'domcontentloaded', timeout: 30000 })
          .then(() => console.log(`[timing] ${site.name} page loaded in ${Math.round((Date.now() - loadStarted) / 1000)}s`))
          .catch((err) => console.warn(`[timing] ${site.name} page did not finish loading in 30s: ${String(err?.message || err).split('\n')[0]}`))
      )
    );
    await pages[0].bringToFront().catch(() => {});
    await pages[0].waitForTimeout(4000);
    for (const p of pages) await dismissPopups(p);

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
      console.log(`[ChannelBrowserAgent-${this.channelId}] ${site.name} login check: ${st.state} (${st.why})`);
      recordAccountStatus(site.key, st.state, this.channelId);
      if (st.state !== 'out') {
        this.siteVerifiedAt.set(site.key, Date.now());
        continue;
      }

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
          console.log(`[ChannelBrowserAgent-${this.channelId}] Operator says ${site.name} is already signed in — continuing.`);
          ok = true;
          break;
        }

        // Do not advance while user is actively inside an OAuth popup
        const inOAuth = context.pages().some(
          (p) => !p.isClosed() && /auth\.openai\.com|auth0\.com|accounts\.google\.com|appleid\.apple\.com|accounts\.x\.ai|x\.com\/i\/flow|twitter\.com\/i\/flow/i.test(p.url())
        );
        if (inOAuth) {
          continue;
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
        console.warn(`[ChannelBrowserAgent-${this.channelId}] ${site.name} sign-in timed out; continuing without it.`);
        skipped.push(site.key as 'youtube');
        continue;
      }
      if (!ok) throw new Error(`${site.name} is not signed in. Run again and sign into ${site.name} in the browser window.`);
      say(`${site.name} signed in.`);
      recordAccountStatus(site.key, 'in', this.channelId);
      this.siteVerifiedAt.set(site.key, Date.now());
      await page.waitForTimeout(1500);
      await this.saveCookies(context);
    }
    await this.saveCookies(context);
    return { skipped };
  }

  // ───────────────────────── Accounts: check / switch ─────────────────────────

  /** Each platform: where to look, and which cookie domains hold its login (these are wiped when switching). */
  public static readonly ACCOUNT_SITES: Record<AccountKey, { name: string; url: string; host: string; cookieDomains: RegExp }> = {
    chatgpt: {
      name: 'ChatGPT',
      url: 'https://chatgpt.com/',
      host: 'chatgpt.com',
      cookieDomains: /(^|\.)(chatgpt\.com|openai\.com)$/i,
    },
    grok: {
      name: 'Grok',
      url: 'https://grok.com/imagine',
      host: 'grok.com',
      cookieDomains: /(^|\.)(grok\.com|x\.ai|grokusercontent\.com|x\.com|twitter\.com)$/i,
    },
    tiktok: {
      name: 'TikTok',
      url: 'https://www.tiktok.com/tiktokstudio/upload',
      host: 'tiktok.com',
      cookieDomains: /(^|\.)(tiktok\.com|tiktokw\.us|tiktokv\.com|tiktokcdn\.com|byteoversea\.com)$/i,
    },
    // YouTube signs in with a Google account, so switching it signs the browser out of Google.
    youtube: {
      name: 'YouTube',
      url: 'https://studio.youtube.com/',
      host: 'youtube.com',
      cookieDomains: /(^|\.)(youtube\.com|google\.com|googleusercontent\.com|ggpht\.com)$/i,
    },
  };
  public readonly ACCOUNT_SITES = ChannelBrowserAgent.ACCOUNT_SITES;

  public isPipelineRunning(): boolean {
    return this.pipelineRunning;
  }


  /** "Cancel" while waiting for a new sign-in. */
  public cancelAccountWait(): void {
    this.accountCancel = true;
  }

  private async pageForSite(context: BrowserContext, key: AccountKey): Promise<Page> {
    const host = this.ACCOUNT_SITES[key].host;
    return (
      context.pages().find((p) => !p.isClosed() && p.url().includes(host)) ||
      context.pages().find((p) => !p.isClosed() && (p.url() === 'about:blank' || p.url().startsWith('chrome://'))) ||
      (await context.newPage())
    );
  }

  /** Read-only: open each platform, record whether it is signed in, then close the browser window. */
  public async checkAccounts(say: (step: string) => void): Promise<void> {
    if (this.pipelineRunning) throw new Error('A video is being made right now. Wait for it to finish first.');
    const context = await this.launchContext(false);
    for (const key of ACCOUNT_KEYS) {
      const cfg = this.ACCOUNT_SITES[key];
      say(`Checking ${cfg.name}…`);
      const page = await this.pageForSite(context, key);
      await page.goto(cfg.url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(4500);
      let st = await this.siteLoginState(page, key);
      if (st.state === 'unknown') {
        await page.waitForTimeout(5000);
        st = await this.siteLoginState(page, key);
      }
      console.log(`[ChannelBrowserAgent-${this.channelId}] ${cfg.name} account check: ${st.state} (${st.why})`);
      recordAccountStatus(key, st.state, this.channelId);
      if (st.state === 'out') this.siteVerifiedAt.delete(key);
      else this.siteVerifiedAt.set(key, Date.now());
    }
    if (this.keepBrowserOpen()) await this.releaseTabs(['tiktok.com', 'youtube.com']);
    else await this.shutdown();
  }

  /**
   * Sign ONE platform out and wait for the operator to sign in with a different account.
   * 1. wipe that platform's cookies + site storage (and the saved copy, so the old login cannot come back)
   * 2. show its sign-in page and wait until the new account is signed in
   * 3. save the new login and close the browser window
   */
  public async switchAccount(key: AccountKey, say: (step: string, kind?: 'running' | 'waiting_login') => void): Promise<string> {
    if (this.pipelineRunning) throw new Error('A video is being made right now. Wait for it to finish, then switch accounts.');
    const cfg = this.ACCOUNT_SITES[key];
    this.accountCancel = false;
    const context = await this.launchContext(false);
    const page = await this.pageForSite(context, key);
    await page.bringToFront().catch(() => {});

    // 1. Sign out.
    say(`Signing out of ${cfg.name}…`);
    await page.goto(cfg.url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await page
      .evaluate(`(async () => {
        try { localStorage.clear(); sessionStorage.clear(); } catch (e) {}
        try { const dbs = (await indexedDB.databases?.()) || []; for (const d of dbs) if (d.name) indexedDB.deleteDatabase(d.name); } catch (e) {}
      })()`)
      .catch(() => {});
    await context.clearCookies({ domain: cfg.cookieDomains });
    await this.saveCookies(context, true);
    recordAccountStatus(key, 'out', this.channelId);
    if (key === 'chatgpt') {
      updateChannel(this.channelId, { chatgpt_chat_url: '' });
      if (this.channelId === 1) {
        db.prepare("UPDATE settings SET chatgpt_chat_url = '', updated_at = CURRENT_TIMESTAMP WHERE id = 1").run();
      }
    }

    // 2. Wait for the new sign-in.
    await page.goto(cfg.url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(3000);
    await page.bringToFront().catch(() => {});
    say(`Sign into the account you want to use for ${cfg.name} in the browser window. It closes by itself when you're done.`, 'waiting_login');
    console.log(`[ChannelBrowserAgent-${this.channelId}] Waiting for a new ${cfg.name} sign-in...`);

    const deadline = Date.now() + 10 * 60 * 1000;
    let signedIn = false;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 3000));
      if (this.accountCancel) throw new Error(`Cancelled. ${cfg.name} is signed out — sign in again before the next run.`);
      if (page.isClosed()) throw new Error(`The browser window was closed before ${cfg.name} was signed in.`);

      // Never finish while user is still in an OAuth popup (Google, Apple, X)
      const inOAuth = context.pages().some(
        (p) => !p.isClosed() && /auth\.openai\.com|auth0\.com|accounts\.google\.com|appleid\.apple\.com|accounts\.x\.ai|x\.com\/i\/flow|twitter\.com\/i\/flow/i.test(p.url())
      );
      if (inOAuth) {
        continue;
      }

      const st = await this.siteLoginState(page, key);
      if (st.state === 'in') {
        // Double check after 2 seconds to ensure it wasn't a transient navigation state
        await page.waitForTimeout(2000);
        const doubleCheck = await this.siteLoginState(page, key);
        if (doubleCheck.state === 'in') {
          signedIn = true;
          break;
        }
      }
    }
    if (!signedIn) throw new Error(`Timed out waiting for the ${cfg.name} sign-in. ${cfg.name} is signed out — try again.`);

    // 3. Save the new login.
    await page.waitForTimeout(2500);
    await this.saveCookies(context);
    recordAccountStatus(key, 'in', this.channelId);

    let note = '';
    if (key === 'chatgpt') {
      say('Looking for your "Create Mr Apple Videos" chat in this account…');
      await page.waitForTimeout(3000);
      const found = await this.locateMrAppleConversation(page).catch(() => null);
      if (found?.url) {
        this.saveChatGptUrl(found.url);
        note = ` Linked your chat "${found.title}".`;
      } else {
        note = ' I could not find a pinned "Create Mr Apple Videos" chat in this account — create it (or pin it), then use Settings → Auto-Detect from Sidebar.';
      }
    }
    await this.shutdown();
    return `${cfg.name} now uses the new account.${note}`;
  }

  // ───────────────────────── Cover image: a different frame for every video ─────────────────────────

  /**
   * Grok's video starts on the reference image (Mr. Apple alone), so TikTok's automatic cover is identical every time.
   * Pick the frame (25%–75% into the video) that differs MOST from the first frame — that is where the guest animal and
   * the scene appear — and save it as a JPEG. Decoding happens in a blank browser tab; no ffmpeg involved.
   */
  public async extractCoverFrame(
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

  private async makeCoverImage(videoPath: string, jobId: string): Promise<string | null> {
    const outPath = path.join(THUMBNAILS_DIR, `thumb_${jobId}.jpg`);
    let page: Page | null = null;
    try {
      const context = await this.launchContext(false);
      page = await context.newPage();
      const r = await this.extractCoverFrame(page, videoPath, outPath);
      console.log(`[ChannelBrowserAgent] Cover frame chosen at ${r.timeSec.toFixed(1)}s of ${r.durationSec.toFixed(1)}s: ${outPath}`);
      return outPath;
    } catch (err: any) {
      console.warn('[ChannelBrowserAgent] Could not pick a cover frame (TikTok will use its automatic cover):', err.message);
      return null;
    } finally {
      await page?.close().catch(() => {});
    }
  }

  /**
   * On TikTok Studio's upload form: Edit cover → Upload cover → pick our JPEG → Confirm.
   * Best effort: if TikTok's layout differs, we save screenshots for debugging, back out, and post with the automatic cover.
   */
  private async setTikTokCover(page: Page, coverPath: string): Promise<boolean> {
    const framesDir = FRAMES_DIR;
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
        console.warn('[ChannelBrowserAgent] TikTok "Edit cover" button not found; using the automatic cover.');
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
      console.log('[ChannelBrowserAgent] Custom cover image set on TikTok.');
      return true;
    } catch (err: any) {
      await snap('failed');
      console.warn('[ChannelBrowserAgent] Could not set a custom TikTok cover (continuing with the automatic one):', err.message);
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
  public async uploadToYouTubeViaBrowser(
    videoPath: string,
    title: string,
    description: string,
    opts: { coverPath?: string; madeForKids: boolean; visibility?: 'public' | 'private' } // public unless a test says otherwise
  ): Promise<{ success: boolean; verified?: boolean; shareUrl?: string; message: string }> {
    const context = await this.launchContext(false);
    const page = context.pages().find((p) => !p.isClosed() && p.url().includes('youtube.com')) || (await context.newPage());

    const framesDir = FRAMES_DIR;
    fs.mkdirSync(framesDir, { recursive: true });
    const snap = (tag: string) => page.screenshot({ path: path.join(framesDir, `youtube_${tag}_${Date.now()}.png`) }).catch(() => {});
    const visible = async (loc: ReturnType<Page['locator']>, ms = 1500) =>
      loc.first().waitFor({ state: 'visible', timeout: ms }).then(() => true).catch(() => false);

    // YouTube Studio sometimes shows an "unsupported browser" page with a "Skip to YouTube Studio" link.
    const skipInterstitial = async () => {
      // Wait for whichever comes first: the upload form or the "unsupported browser" page, not a fixed pause.
      const skip = page.getByText(/skip to youtube studio/i).first();
      const form = page.locator('input[type="file"]').first();
      await Promise.race([
        skip.waitFor({ state: 'visible', timeout: 6000 }),
        form.waitFor({ state: 'attached', timeout: 6000 }),
      ]).catch(() => {});
      if (await skip.isVisible().catch(() => false)) {
        console.log('[ChannelBrowserAgent] YouTube showed its browser-support page — skipping it.');
        await skip.click().catch(() => {});
        await form.waitFor({ state: 'attached', timeout: 8000 }).catch(() => {});
      }
    };

    // YouTube sometimes stops the upload dialog with a modal ("Unlock more on YouTube": custom thumbnails need a
    // verified phone number). Its backdrop blocks every click behind it, so cancel it whenever it shows up.
    const dismissYouTubeNag = async () => {
      if (!(await page.getByText(/unlock more on youtube|verify your phone number/i).first().isVisible().catch(() => false))) return false;
      console.log('[ChannelBrowserAgent] YouTube showed a "verify your phone number" prompt — dismissing it.');
      const cancel = page.getByRole('button', { name: /^Cancel$/i }).last();
      if (await cancel.isVisible().catch(() => false)) await cancel.click({ timeout: 4000 }).catch(() => {});
      else await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(600);
      return true;
    };

    // No native "choose a file" window may ever open: intercept pickers, and only feed the one we open on purpose.
    const chooserFile: string | null = null; // no file is ever offered to a picker; any picker that opens is cancelled
    const onChooser = async (chooser: FileChooser) => {
      if (chooserFile) await chooser.setFiles(chooserFile).catch(() => {});
    };
    page.on('filechooser', onChooser);

    try {
      if (!this.isValidVideoFile(videoPath)) return { success: false, message: 'Refusing to upload: the video file is missing or not a valid MP4.' };

      // 1. Open the upload dialog.
      console.log('[ChannelBrowserAgent] Opening YouTube Studio upload...');
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
      console.log('[ChannelBrowserAgent] Sending the video file to YouTube...');
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
      else console.warn('[ChannelBrowserAgent] YouTube: could not find the "made for kids" choice.');

      // "Altered content": cartoon characters are not realistic people/places, so the honest answer is "No" (best effort).
      const alteredNo = page.locator('[name="VIDEO_HAS_ALTERED_CONTENT_NO"]').first();
      if (await visible(alteredNo, 1500)) await alteredNo.click().catch(() => {});

      // No custom thumbnail: YouTube only allows one on phone-verified channels and otherwise opens a modal that blocks
      // the whole dialog (this stopped every upload). A Short gets an automatic frame as its thumbnail.
      await snap('details');

      // 4. Next ×3 (Video elements → Checks → Visibility).
      for (let i = 0; i < 3; i++) {
        await page
          .waitForFunction(() => {
            const b = document.querySelector('#next-button');
            return !!b && b.getAttribute('aria-disabled') !== 'true';
          }, undefined, { timeout: 60000 })
          .catch(() => {});
        await dismissYouTubeNag();
        await dismissPopups(page);
        const nextBtn = page.locator('#next-button').first();
        const clicked = await nextBtn.click({ timeout: 15000 }).then(() => true).catch(() => false);
        if (!clicked) {
          // Backup: something covers or renamed the Next button. Ask Jev which control moves the upload forward.
          const byJev = await findWithJev(page, 'go to the next step of the upload (the Next button)', 'YouTube Studio upload');
          if (!byJev) throw new Error('YouTube\'s Next button could not be clicked.');
          await byJev.click({ timeout: 5000 });
        }
        await page.waitForTimeout(700);
      }

      // 5. Visibility.
      const visibility = opts.visibility ?? 'public';
      const visName = { public: 'PUBLIC', private: 'PRIVATE' }[visibility];
      const visRadio = page.locator(`[name="${visName}"]`).first();
      const visByRole = page.getByRole('radio', { name: new RegExp(`^${visibility}`, 'i') }).first();
      if (await visible(visRadio, 8000)) await visRadio.click();
      else if (await visible(visByRole, 3000)) await visByRole.click();
      else {
        const byJev = await findWithJev(page, `make the video ${visibility} (the "${visibility === 'public' ? 'Public' : 'Private'}" visibility choice)`, 'YouTube Studio upload');
        if (!byJev) throw new Error('Could not find the visibility choice (Public / Private).');
        await byJev.click({ timeout: 5000 });
      }
      await snap('visibility');

      // 6. Wait for the upload itself to finish. The Publish button is ENABLED while the file is still uploading
      // ("Uploading 78% … 9 seconds left"), so the button is not a finished signal: clicking it then, and closing the
      // dialog afterwards, cancelled the upload and nothing reached YouTube. The progress text in the dialog footer is.
      console.log('[ChannelBrowserAgent] Waiting for the YouTube upload to finish, then publishing...');
      const uploadDone = () =>
        page.waitForFunction(() => {
          const dialog = document.querySelector('ytcp-uploads-dialog');
          const text = ((dialog as HTMLElement | null)?.innerText || '');
          if (!dialog) return false; // the dialog is gone: not a finished upload
          if (/uploading\s*\d+\s*%/i.test(text) || /uploading\s*\.\.\./i.test(text)) return false;
          const b = document.querySelector('#done-button');
          return !!b && b.getAttribute('aria-disabled') !== 'true';
        }, undefined, { timeout: 10 * 60 * 1000, polling: 1000 });
      await uploadDone().catch(() => {
        throw new Error('YouTube did not finish uploading the video within 10 minutes.');
      });
      await snap('upload_finished');
      // The video's address is shown in the dialog from the moment the file is uploaded.
      const dialogLink = await page
        .locator('ytcp-uploads-dialog a[href*="/shorts/"], ytcp-uploads-dialog a[href*="youtu.be/"], ytcp-uploads-dialog a[href*="watch?v="]')
        .first()
        .getAttribute('href', { timeout: 3000 })
        .catch(() => null);
      await page.locator('#done-button').first().click({ timeout: 15000 });

      // 7. Only YouTube's own confirmation dialog counts: "Video published", or "Video processing" (a Short is public once its
      // SD version has processed; checks already passed). A link elsewhere on the page does not count: the upload dialog
      // itself carries the video's link before anything is published.
      const confirmation = page.getByText(/^\s*Video (published|processing)\s*$/i).first();
      const published = await confirmation.waitFor({ state: 'visible', timeout: 120000 }).then(() => true).catch(() => false);
      let shareUrl: string | null = null;
      if (published) {
        shareUrl =
          (await page.locator('ytcp-video-share-dialog').locator('a[href*="/shorts/"], a[href*="youtu.be/"], a[href*="watch?v="]').first().getAttribute('href', { timeout: 1500 }).catch(() => null)) ||
          dialogLink;
      }
      await snap(published ? 'published' : 'unconfirmed');
      if (published) await page.getByRole('button', { name: /^Close$/i }).first().click({ timeout: 4000 }).catch(() => {});

      if (published) {
        console.log(`[ChannelBrowserAgent] Video published on YouTube: ${shareUrl}`);
        return { success: true, verified: true, shareUrl: shareUrl || undefined, message: 'Video published on YouTube.' };
      }
      return { success: true, verified: false, message: 'Publish was clicked, but YouTube did not show its confirmation (check YouTube Studio).' };
    } catch (err: any) {
      await snap('failed');
      console.warn('[ChannelBrowserAgent] YouTube upload error:', err.message);
      return { success: false, message: err.message };
    } finally {
      page.off('filechooser', onChooser);
    }
  }

  /**
   * Step 3: Browse into TikTok Upload, upload the video, set caption & AIGC disclosure, and stage/publish.
   */
  public async uploadToTikTokViaBrowser(
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

    let postClicked = false;
    try {
      // Helper: dismiss any unexpected "Are you sure you want to exit?" modal
      const dismissExitModal = async () => {
        try {
          const exitCancelBtn = await page.$(
            'div:has-text("Are you sure you want to exit") button:has-text("Cancel"), div[role="dialog"] button:has-text("Cancel"), button:text-is("Cancel")'
          );
          if (exitCancelBtn) {
            console.log('[ChannelBrowserAgent] Auto-dismissing TikTok exit modal with Cancel to stay on upload page...');
            await exitCancelBtn.click({ force: true }).catch(() => { });
            await page.waitForTimeout(500);
          }
        } catch { }
      };

      await dismissExitModal();

      // Always load a fresh TikTok Studio upload form so any previous staged file is cleared
      console.log('[ChannelBrowserAgent] Navigating to fresh TikTok Studio Upload...');
      await page.evaluate(() => {
        window.onbeforeunload = null;
      }).catch(() => {});
      await page.goto('https://www.tiktok.com/tiktokstudio/upload', { waitUntil: 'domcontentloaded', timeout: 30000 });
      // Wait for the upload form (or a sign-in page) instead of a fixed pause.
      await page
        .locator('input[type="file"], a[href*="/login"], button:has-text("Log in")')
        .first()
        .waitFor({ state: 'attached', timeout: 15000 })
        .catch(() => {});
      await page.waitForTimeout(500);
      await dismissPopups(page);

      await dismissExitModal();

      // Check for login requirement
      const loginRequired = await page.$('a[href*="/login"], button:has-text("Log in"), button:has-text("Use QR code")');
      if (loginRequired) {
        console.warn('[ChannelBrowserAgent] TikTok requires sign-in in browser tab.');
        return {
          success: false,
          message: 'TikTok upload awaiting sign-in in Tab 3.',
        };
      }

      // Strict Guard: Refuse upload if video is missing or not a valid MP4/WebM file (>= 250KB, valid header)
      if (!this.isValidVideoFile(videoPath)) {
        console.warn('[ChannelBrowserAgent] Invalid or non-MP4 video file on disk. Refusing to upload to TikTok:', videoPath);
        return {
          success: false,
          message: 'Refusing to upload: Video file is missing or not a valid MP4 video.',
        };
      }

      // Wait for file input to appear on the fresh upload page
      await page.waitForSelector('input[type="file"], input[accept*="video"]', { state: 'attached', timeout: 15000 }).catch(() => null);
      const fileInput = await page.$('input[type="file"], input[accept*="video"]');
      if (fileInput) {
        console.log('[ChannelBrowserAgent] Uploading genuine MP4 video file to TikTok Studio:', videoPath);
        await fileInput.setInputFiles(videoPath);
        await page.waitForTimeout(1000);

        // 1. Disable beforeunload dialog so Chromium never halts with "Leave site?"
        await page.evaluate(() => {
          window.onbeforeunload = null;
        });
        if (!this.tiktokDialogPages.has(page)) {
          this.tiktokDialogPages.add(page);
          // Having ANY 'filechooser' listener stops Chrome from opening the Mac's native "choose a file" window on this tab.
          page.on('filechooser', () => {});
          page.on('dialog', async (dialog) => {
            console.log('[ChannelBrowserAgent] Handling TikTok browser dialog:', dialog.message());
            await dialog.accept().catch(() => { });
          });
        }

        // 2. Fill caption / description with clean title and hashtags (without corrupting Draft.js DOM spans).
        // TikTok pre-fills the caption with the file name a moment after the upload starts and overwrites anything
        // typed before that, so: wait for its pre-fill, type, then check the caption really holds the title.
        const cleanTitle = title.replace(/\s*\(ChatGPT Browser\)\s*/gi, '').replace(/^["']|["']$/g, '').trim();
        const cleanCaption = `${cleanTitle} ${hook}`.trim();
        const captionSelector = 'div[contenteditable="true"], textarea, div[role="combobox"]';
        const captionText = async () =>
          ((await page.locator(captionSelector).first().innerText({ timeout: 2000 }).catch(() => '')) || '').trim();
        const titleStart = cleanTitle.slice(0, 20);
        const captionOk = async () => (await captionText()).includes(titleStart);
        const fillCaption = async (): Promise<boolean> => {
          const captionEl = await page.$(captionSelector);
          if (!captionEl) return false;
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
          await page.keyboard.insertText(cleanCaption);
          await page.waitForTimeout(300);
          // Press Escape in case hashtag autocomplete dropdown opened
          await page.keyboard.press('Escape').catch(() => {});
          await page.waitForTimeout(400);
          return captionOk();
        };
        // Wait (up to 20 s) for TikTok's own pre-fill: the caption box exists and is no longer empty.
        const prefillDeadline = Date.now() + 20000;
        while (Date.now() < prefillDeadline && !(await captionText())) await page.waitForTimeout(500);
        let captionFilled = await fillCaption();
        if (!captionFilled) {
          await page.waitForTimeout(2000);
          captionFilled = await fillCaption();
        }
        console.log(`[ChannelBrowserAgent] TikTok caption ${captionFilled ? 'set' : 'NOT confirmed'}: "${(await captionText()).slice(0, 80)}"`);

        // 3. Toggle AI-generated content disclosure if visible
        try {
          const aiToggle = await page.$('input[type="checkbox"][aria-label*="AI"], button:has-text("AI-generated content"), [data-testid*="ai-disclosure"]');
          if (aiToggle) {
            await aiToggle.click({ force: true }).catch(() => { });
          }
        } catch { }

        // 4. Wait for video upload & processing status to be 100% complete
        console.log('[ChannelBrowserAgent] Waiting for TikTok video upload to show Uploaded (100%)...');
        await page.getByText(/^\s*Uploaded\b/i).first().waitFor({ state: 'visible', timeout: 120000 }).catch(() => null);
        await page.waitForTimeout(800);

        // 4b. Unique cover image (a mid-video frame instead of the identical first frame)
        if (coverPath && fs.existsSync(coverPath)) {
          await this.setTikTokCover(page, coverPath);
          await dismissExitModal();
        }

        // 5. Ensure any exit modal is dismissed before scrolling
        await dismissExitModal();

        // 6. Scroll down to expose the Post button
        console.log('[ChannelBrowserAgent] Scrolling to bottom and checking TikTok Post button status...');
        await page.evaluate(() => {
          window.scrollTo(0, document.body.scrollHeight);
          const scrollables = document.querySelectorAll('div, main, section');
          scrollables.forEach(s => {
            if (s.scrollHeight > s.clientHeight) s.scrollTop = s.scrollHeight;
          });
        });
        await page.waitForTimeout(1500);
        await dismissExitModal();
        await dismissPopups(page);

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

        if (!targetPostBtn) {
          // Backup: TikTok renamed or restyled its Post button. Ask Jev which control publishes the video.
          targetPostBtn = await findWithJev(page, 'publish the uploaded video now (the final Post button, not Save draft or Discard)', 'TikTok Studio upload');
        }

        if (targetPostBtn) {
          await targetPostBtn.scrollIntoViewIfNeeded().catch(() => { });
          await page.waitForTimeout(1000);

          // Wait for TikTok Post button to become enabled (checks finishing)
          const waitPostStart = Date.now();
          while (Date.now() - waitPostStart < 120000) {
            const isDisabled = await targetPostBtn.evaluate((el: HTMLButtonElement) => el.disabled || el.getAttribute('aria-disabled') === 'true').catch(() => false);
            if (!isDisabled) {
              console.log('[ChannelBrowserAgent] TikTok Post button is ready and enabled!');
              break;
            }
            console.log('[ChannelBrowserAgent] Waiting for TikTok copyright & content checks to complete before clicking Post...');
            await page.waitForTimeout(2000);
          }

          // Last check before posting: the caption must hold the title, not the file name TikTok filled in.
          if (!(await captionOk())) {
            console.warn('[ChannelBrowserAgent] TikTok caption was replaced before posting — typing it again.');
            await fillCaption();
          }
          console.log('[ChannelBrowserAgent] Clicking genuine red TikTok Post button now...');
          postClicked = true;
          await targetPostBtn.click({ force: true });
          // Native event fallback
          await targetPostBtn.evaluate((el: HTMLElement) => el.click()).catch(() => { });
          await page.waitForTimeout(3000);

          // Handle any confirmation popup (e.g. "Post now", "Confirm", or "Manage your posts")
          const confirmBtn = await page.$(
            'div[role="dialog"] button:has-text("Post now"), div[role="dialog"] button:has-text("Post"), div[role="dialog"] button:has-text("Confirm"), button:text-is("Post now")'
          );
          if (confirmBtn) {
            console.log('[ChannelBrowserAgent] Confirming TikTok publication popup dialog...');
            await confirmBtn.click({ force: true }).catch(() => { });
            await page.waitForTimeout(3000);
          }
        } else {
          console.warn('[ChannelBrowserAgent] Could not find bottom Post button.');
          // Nothing was posted: say so, so the run can safely try again instead of reporting "submitted".
          const snap = path.join(FRAMES_DIR, `tiktok_no_post_button_${Date.now()}.png`);
          await page.screenshot({ path: snap }).catch(() => {});
          return { success: false, message: `TikTok's Post button was not found, so nothing was posted. Screenshot: ${snap}` };
        }

        // 8. Monitor TikTok for publication confirmation
        console.log('[ChannelBrowserAgent] Monitoring TikTok for publication confirmation...');
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
          await dismissPopups(page);
        }

        if (isPublished) {
          console.log('[ChannelBrowserAgent] Video successfully posted to TikTok!');
          return {
            success: true,
            verified: true,
            message: 'Video successfully uploaded and published to TikTok!',
            shareUrl: 'https://www.tiktok.com/tiktokstudio/content',
          };
        } else {
          const framesDir = FRAMES_DIR;
          const errSnap = path.join(framesDir, `tiktok_post_state_${Date.now()}.png`);
          await page.screenshot({ path: errSnap }).catch(() => { });
          console.warn('[ChannelBrowserAgent] TikTok post pending confirmation. Screenshot saved:', errSnap);
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
      console.warn('[ChannelBrowserAgent] TikTok browser upload note:', err.message);
      // After Post was clicked TikTok may still publish it: report "submitted", never "failed", so it is not posted twice.
      if (postClicked) return { success: true, verified: false, message: `Post was clicked, then: ${err.message}` };
      return { success: false, message: err.message };
    }
  }

  // ───────────────────────── Pipeline ─────────────────────────

  /** Thrown out of a run that the operator stopped. */
  private cancelledError(): Error {
    if (this.cancelReason === 'timeout') {
      const err: any = new Error('The step took too long and the run was stopped (browser closed).');
      err.code = 'RUN_TIMEOUT';
      return err;
    }
    const err: any = new Error('Run stopped.');
    err.code = 'RUN_CANCELLED';
    return err;
  }

  private throwIfCancelled(): void {
    if (this.cancelRequested) throw this.cancelledError();
  }

  /**
   * "Stop": closes the browser window, which makes whatever step is in flight fail, and marks the run as stopped.
   * If the Post button was already clicked, the platform may still publish the video.
   */
  public async requestCancel(reason: 'user' | 'timeout' = 'user'): Promise<boolean> {
    if (!this.pipelineRunning) return false;
    this.cancelRequested = true;
    this.cancelReason = reason;
    await this.shutdown().catch(() => {});
    return true;
  }

  /** Runs one pipeline function with the single-run lock, cancel handling and cookie saving around it. */
  private async withPipelineLock<T extends { postedEverywhere: boolean }>(
    onProgress: PipelineOptions['onProgress'],
    fn: () => Promise<T>
  ): Promise<T> {
    if (this.pipelineRunning) {
      throw new Error('A video is already being produced. Wait for it to finish before starting another.');
    }
    this.pipelineRunning = true;
    this.cancelRequested = false;
    this.cancelReason = 'user';
    try {
      const result = await fn();
      if (result.postedEverywhere && !this.keepBrowserOpen()) {
        // The channel asked for a closed window between videos.
        onProgress?.('Posted. Closing the browser window…');
        await new Promise((r) => setTimeout(r, 3000));
        await this.shutdown();
      }
      return result;
    } catch (err) {
      // Something went wrong: check every login again next time rather than trusting the warm window.
      this.siteVerifiedAt.clear();
      // A stop closes the browser under the running step, so that step fails with some Playwright error: report the stop.
      if (this.cancelRequested) throw this.cancelledError();
      throw err;
    } finally {
      this.pipelineRunning = false;
      this.cancelRequested = false;
      if (this.activeInteractiveContext) await this.saveCookies(this.activeInteractiveContext);
    }
  }

  /** Full sequence: sign-in check → ChatGPT prompt → Grok video → safety check → post. */
  public async runFullAutonomousPipeline(options: PipelineOptions): Promise<PipelineResult> {
    return this.withPipelineLock(options.onProgress, () => this.runPipelineOnce(options));
  }

  /**
   * Posts a video that already exists on disk (made earlier, but held, failed or never confirmed).
   * Only platforms that are switched on for the channel and have no confirmed post yet are attempted.
   */
  public async publishExistingVideo(jobId: string, options: Pick<PipelineOptions, 'onProgress' | 'onJob'> = {}): Promise<PipelineResult> {
    return this.withPipelineLock(options.onProgress, async () => {
      const say = (step: string, kind: 'running' | 'waiting_login' = 'running') => options.onProgress?.(step, kind);
      const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as any;
      if (!job) throw new Error('That video no longer exists.');
      if (!isValidVideoFile(job.video_path)) throw new Error('The video file is missing from disk, so it cannot be posted.');
      options.onJob?.(jobId);

      const ch = getChannel(this.channelId);
      const wantTikTok = (ch ? !!ch.post_tiktok : true) && job.tiktok_status !== 'published';
      const wantYouTube = (ch ? !!ch.post_youtube : true) && job.youtube_status !== 'published';
      if (!wantTikTok && !wantYouTube) {
        throw new Error('Nothing to post: every platform switched on for this channel already has this video.');
      }

      const browser = await this.launchContext(false);
      const login = await this.ensureLoggedIn(browser, say, { tiktok: wantTikTok, youtube: wantYouTube }, 10 * 60 * 1000, false);
      this.throwIfCancelled();

      const coverPath = job.thumbnail_path && fs.existsSync(job.thumbnail_path) ? job.thumbnail_path : null;
      const posted = await this.postVideo({
        jobId,
        videoPath: job.video_path,
        title: job.concept_title,
        hook: job.hook || '',
        coverPath,
        tiktok: wantTikTok,
        youtube: wantYouTube && !login.skipped.includes('youtube'),
        youtubeMadeForKids: ch ? !!ch.youtube_made_for_kids : true,
        previous: { tiktokStatus: job.tiktok_status, tiktokUrl: job.tiktok_share_url, youtubeStatus: job.youtube_status, youtubeUrl: job.youtube_share_url },
        say,
      });

      return {
        success: true,
        jobId,
        title: job.concept_title,
        hook: job.hook || '',
        videoPath: job.video_path,
        thumbnailPath: coverPath || undefined,
        durationSeconds: Number(job.duration_seconds) || 0,
        qaPassed: true,
        ...posted,
        message: `Existing video -> TikTok: ${posted.tiktokStatus} -> YouTube: ${posted.youtubeStatus}`,
      };
    });
  }

  /**
   * Uploads one finished video to the requested platforms and writes the outcome to its job row.
   * A platform that is not attempted keeps whatever status it already had.
   */
  private async postVideo(input: {
    jobId: string;
    videoPath: string;
    title: string;
    hook: string;
    coverPath: string | null;
    tiktok: boolean;
    youtube: boolean;
    youtubeMadeForKids: boolean;
    previous?: { tiktokStatus?: string | null; tiktokUrl?: string | null; youtubeStatus?: string | null; youtubeUrl?: string | null };
    say: (step: string, kind?: 'running' | 'waiting_login') => void;
  }): Promise<Pick<PipelineResult, 'tiktokStatus' | 'tiktokVerified' | 'tiktokUrl' | 'youtubeStatus' | 'youtubeVerified' | 'youtubeUrl' | 'postedEverywhere' | 'postedAnywhere' | 'postFailed'>> {
    const { say } = input;
    let tiktokStatus = input.previous?.tiktokStatus || 'off';
    let tiktokUrl: string | undefined = input.previous?.tiktokUrl || undefined;
    let tiktokVerified = tiktokStatus === 'published';
    let youtubeStatus = input.previous?.youtubeStatus || 'off';
    let youtubeUrl: string | undefined = input.previous?.youtubeUrl || undefined;
    let youtubeVerified = youtubeStatus === 'published';

    const tiktokTask = async () => {
      if (!input.tiktok) return;
      this.throwIfCancelled();
      console.log(`[ChannelBrowserAgent-${this.channelId}] Uploading the video to TikTok...`);
      tiktokStatus = 'failed';
      try {
        let uploadRes = await this.uploadToTikTokViaBrowser(input.videoPath, input.title, input.hook, input.coverPath || undefined);
        if (!uploadRes.success && !this.cancelRequested) {
          // success=false means Post was never clicked, so a second try cannot post the video twice.
          say(`TikTok upload failed (${uploadRes.message.slice(0, 120)}). Trying once more…`);
          await this.releaseTabs(['tiktok.com']);
          uploadRes = await this.uploadToTikTokViaBrowser(input.videoPath, input.title, input.hook, input.coverPath || undefined);
        }
        if (uploadRes.success) {
          tiktokVerified = !!uploadRes.verified;
          tiktokStatus = tiktokVerified ? 'published' : 'submitted'; // 'submitted' = Post clicked, TikTok has not confirmed
          tiktokUrl = uploadRes.shareUrl || tiktokUrl;
        } else {
          console.warn('[ChannelBrowserAgent] TikTok browser upload did not complete:', uploadRes.message);
          say(`TikTok upload failed: ${uploadRes.message}`);
        }
      } catch (ttErr: any) {
        console.warn('[ChannelBrowserAgent] TikTok browser upload error:', ttErr.message);
      }
    };

    const youtubeTask = async () => {
      if (!input.youtube) return;
      this.throwIfCancelled();
      console.log(`[ChannelBrowserAgent-${this.channelId}] Uploading the video to YouTube...`);
      youtubeStatus = 'failed';
      try {
        const cleanTitle = input.title.replace(/\s*#\w+/g, '').trim();
        const ytOptions = { coverPath: input.coverPath || undefined, madeForKids: input.youtubeMadeForKids };
        let yt = await this.uploadToYouTubeViaBrowser(input.videoPath, cleanTitle, `${input.hook}\n\n#Shorts`, ytOptions);
        if (!yt.success && !this.cancelRequested && !/daily upload limit|not signed in|no YouTube channel/i.test(yt.message)) {
          // success=false means Publish was never clicked (at most a private draft exists), so a retry cannot double-post.
          say(`YouTube upload failed (${yt.message.slice(0, 120)}). Trying once more…`);
          await this.releaseTabs(['youtube.com']);
          yt = await this.uploadToYouTubeViaBrowser(input.videoPath, cleanTitle, `${input.hook}\n\n#Shorts`, ytOptions);
        }
        if (yt.success) {
          youtubeVerified = !!yt.verified;
          youtubeStatus = youtubeVerified ? 'published' : 'submitted';
          youtubeUrl = yt.shareUrl || youtubeUrl;
        } else {
          console.warn('[ChannelBrowserAgent] YouTube upload did not complete:', yt.message);
          say(`YouTube upload failed: ${yt.message}`);
        }
      } catch (ytErr: any) {
        console.warn('[ChannelBrowserAgent] YouTube upload error:', ytErr.message);
      }
    };

    // TikTok and YouTube upload at the same time, each in its own tab: the uploads are the slowest part of a run,
    // and Playwright keeps background tabs fully live. Each platform keeps its own retry and its own status.
    say(input.tiktok && input.youtube ? 'Uploading to TikTok and YouTube at the same time…' : input.tiktok ? 'Uploading to TikTok and posting…' : 'Uploading to YouTube…');
    await Promise.all([tiktokTask(), youtubeTask()]);

    this.throwIfCancelled();

    // Posting tabs are the heaviest pages and are not needed until the next video: free them once the platform
    // confirmed the post. A tab whose post failed stays open so the problem can be seen.
    if (this.keepBrowserOpen()) {
      const done = [input.tiktok && tiktokVerified ? 'tiktok.com' : '', input.youtube && youtubeVerified ? 'youtube.com' : ''].filter(Boolean);
      if (done.length) await this.releaseTabs(done);
    }

    const attempted = [input.tiktok ? tiktokVerified : null, input.youtube ? youtubeVerified : null].filter((v) => v !== null);
    // The browser window may close only when every place we posted to in this pass confirmed the post.
    const postedEverywhere = attempted.length > 0 && attempted.every(Boolean);
    const anyPublished = tiktokStatus === 'published' || youtubeStatus === 'published';
    const anySubmitted = tiktokStatus === 'submitted' || youtubeStatus === 'submitted';
    // What THIS pass did. A platform posted by an earlier run must not make a failed retry look like a success.
    const accepted = (status: string) => status === 'published' || status === 'submitted';
    const postedNow = (input.tiktok && accepted(tiktokStatus)) || (input.youtube && accepted(youtubeStatus));
    const postFailed = [input.tiktok && !accepted(tiktokStatus) ? 'TikTok' : '', input.youtube && !accepted(youtubeStatus) ? 'YouTube' : ''].filter(Boolean);
    // 'scheduled' = Post was clicked somewhere but no platform confirmed; 'failed' = the video exists and nothing went out.
    const finalState = anyPublished ? 'published' : anySubmitted ? 'scheduled' : 'failed';

    db.prepare(`
      UPDATE jobs
      SET state = ?, tiktok_status = ?, youtube_status = ?, tiktok_share_url = ?, youtube_share_url = ?,
          hold_reason = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      finalState,
      tiktokStatus,
      youtubeStatus,
      tiktokUrl || null,
      youtubeUrl || null,
      finalState === 'failed' ? 'The video was made, but posting did not go through. Use "Post now" to try again.' : null,
      input.jobId
    );

    return {
      tiktokStatus,
      tiktokVerified,
      tiktokUrl,
      youtubeStatus,
      youtubeVerified,
      youtubeUrl,
      postedEverywhere,
      postedAnywhere: postedNow,
      postFailed,
    };
  }

  /**
   * Opens Grok Imagine and switches it to Video with the channel's length and quality while ChatGPT is still writing,
   * so the Grok step starts straight away. Best effort: any problem is left for the Grok step, which reloads.
   */
  private async prepareGrok(durationSec: number, resolution: GrokResolution): Promise<void> {
    try {
      const started = Date.now();
      console.log(`[ChannelBrowserAgent-${this.channelId}] Preparing Grok while ChatGPT writes…`);
      const context = await this.launchContext(false);
      const page = context.pages().find((p) => !p.isClosed() && p.url().includes('grok.com')) || (await context.newPage());
      const textbox = this.grokComposer(page).locator('[role="textbox"], [contenteditable="true"], textarea').first();
      // The login check usually just opened Grok's composer in this tab: reuse it instead of loading it again.
      const alreadyThere =
        /^https:\/\/grok\.com\/imagine\/?(\?.*)?$/.test(page.url()) &&
        (await textbox.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false));
      if (!alreadyThere) await page.goto('https://grok.com/imagine', { waitUntil: 'domcontentloaded', timeout: 30000 });
      // A cold window can show a banner or promo over Grok first: clear pop-ups while waiting (up to 35 s).
      let composerShown = false;
      for (let i = 0; i < 9 && !composerShown && !this.grokPrepAbandoned; i++) {
        await dismissPopups(page);
        composerShown = await textbox.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false);
      }
      if (!composerShown) {
        await page.screenshot({ path: path.join(FRAMES_DIR, `grok_prepare_no_composer_${Date.now()}.png`) }).catch(() => {});
        console.warn(`[ChannelBrowserAgent-${this.channelId}] Grok composer did not appear while preparing (${page.url()}); the Grok step will load it.`);
        return;
      }
      await dismissPopups(page);
      const spec: GrokVideoSpec = {
        durationSec: ([6, 10, 15] as const).includes(durationSec as 6 | 10 | 15) ? (durationSec as 6 | 10 | 15) : 15,
        resolution,
        aspect: '9:16',
      };
      if (this.grokPrepAbandoned) return; // the Grok step has taken over the tab
      await this.configureGrokVideoMode(page, spec);
      if (this.grokPrepAbandoned) return;
      this.grokPreparedAt = Date.now();
      console.log(`[ChannelBrowserAgent-${this.channelId}] Grok composer ready ahead of time (Video, ${spec.durationSec}s, ${spec.resolution}) in ${Math.round((Date.now() - started) / 1000)}s.`);
    } catch (err: any) {
      console.warn(`[ChannelBrowserAgent-${this.channelId}] Could not prepare Grok ahead of time (the Grok step will): ${err?.message}`);
    }
  }

  /**
   * Runs one step and, if it fails for a reason a second try can fix (a slow page, a pop-up, a changed layout that
   * reloads fine), runs it once more after reloading. Never retried: a stop, a sign-in problem, a usage limit.
   */
  private async retryStep<T>(name: string, say: (step: string) => void, attempt: (n: number) => Promise<T>, canRetry: (err: any) => boolean = () => true): Promise<T> {
    try {
      return await attempt(1);
    } catch (err: any) {
      this.throwIfCancelled();
      if (!isRetryableError(err) || !canRetry(err)) throw err;
      console.warn(`[ChannelBrowserAgent-${this.channelId}] ${name} failed, trying once more: ${err?.message}`);
      say(`${name} hit a problem (${shortReason(err)}). Trying once more…`);
      await new Promise((r) => setTimeout(r, 5000));
      this.throwIfCancelled();
      return attempt(2);
    }
  }

  private async runPipelineOnce(options: PipelineOptions): Promise<PipelineResult> {
    const jobId = 'job_' + crypto.randomUUID().slice(0, 10);
    console.log(`[ChannelBrowserAgent-${this.channelId}] Starting full autonomous pipeline for Job ${jobId}...`);
    const say = (step: string, kind: 'running' | 'waiting_login' = 'running') => options.onProgress?.(step, kind);

    // 0. Open the browser (once) and make sure ChatGPT, Grok and TikTok are signed in — waits for the operator if not.
    const browser = await this.launchContext(false);
    const ch = getChannel(this.channelId);
    const targets = {
      tiktok: ch ? !!ch.post_tiktok : true,
      youtube: ch ? !!ch.post_youtube : true,
      youtubeMadeForKids: ch ? !!ch.youtube_made_for_kids : true,
    };
    const login = await this.ensureLoggedIn(browser, say, { tiktok: targets.tiktok, youtube: targets.youtube });
    const youtubeOn = targets.youtube && !login.skipped.includes('youtube');
    this.throwIfCancelled();

    // 1. ChatGPT: Generate prompt & script
    console.log('[ChannelBrowserAgent] SEQUENCE STEP 1: Creating prompt and script in ChatGPT...');
    say('Writing a new prompt in ChatGPT…');
    // Grok is prepared in its own tab while ChatGPT writes (both are waiting on remote servers).
    const prepDuration = options.targetDurationSec || ch?.grok_duration || 15;
    const prepResolution: GrokResolution = options.targetResolution || ch?.grok_resolution || '720p';
    this.grokPreparedAt = 0;
    this.grokPrepAbandoned = false;
    const grokReady = this.prepareGrok(prepDuration, prepResolution);
    // A retry sends "next" again, which only asks ChatGPT for another prompt: nothing is spent or posted.
    const chatGptResult = await this.retryStep('Writing the prompt in ChatGPT', say, async (n) => {
      if (n > 1) say('Writing a new prompt in ChatGPT (second try)…');
      return this.generatePromptViaChatGPT(false);
    });

    const scriptPkg = chatGptResult.scriptPackage;
    const grokPrompt = scriptPkg.shot_briefs[0]?.video_prompt;
    if (!grokPrompt || grokPrompt.length < 50) {
      throw new Error(`Master prompt from ChatGPT is empty or too short (${grokPrompt?.length || 0} chars). Aborting.`);
    }
    console.log(`[ChannelBrowserAgent] SEQUENCE STEP 1 SUCCESS: "${scriptPkg.concept_title}". Copied Grok prompt (${grokPrompt.length} chars).`);
    // Give the preparation a few more seconds if ChatGPT was quicker, but never hold the run up for it.
    await Promise.race([grokReady, new Promise((r) => setTimeout(r, 8000))]);
    if (!this.grokPreparedAt) {
      this.grokPrepAbandoned = true;
      console.log(`[ChannelBrowserAgent-${this.channelId}] Grok preparation not finished; the Grok step will load Grok itself.`);
    }
    this.throwIfCancelled();

    // 2. Grok: one video from the exact ChatGPT prompt + the channel's reference image
    console.log('[ChannelBrowserAgent] SEQUENCE STEP 2: Generating the video in Grok Imagine...');
    say('Generating the video in Grok (about 1–3 minutes)…');
    // If Grok's server fails ("Server failed to respond"), stop and say so. No automatic retry: it fails the same way at
    // 480p and 720p, and every attempt may use Grok credits.
    const effDuration = options.targetDurationSec || ch?.grok_duration || 15;
    const effResolution: GrokResolution = options.targetResolution || ch?.grok_resolution || '720p';

    let grokRes: Awaited<ReturnType<typeof ChannelBrowserAgent.prototype.createVideoViaGrok>>;
    try {
      // Retried only when the failure came before the prompt was submitted: after that Grok may already charge for it.
      grokRes = await this.retryStep(
        'Setting up Grok',
        say,
        async (n) => {
          if (n > 1) say('Generating the video in Grok (second try)…');
          return this.createVideoViaGrok(grokPrompt, jobId, 1, false, effDuration, effResolution);
        },
        () => !this.grokSubmitted
      );
    } catch (err: any) {
      if (err?.code === 'GROK_SERVER_FAILED') {
        throw new Error(
          `${err.message} Grok rendered the video but its server failed to deliver it. Nothing was posted. ` +
            'Try making one video by hand in Grok: if that fails too, the problem is on Grok\'s side (or your Grok usage limit) and it should clear up later.'
        );
      }
      throw err;
    }
    if (!isValidVideoFile(grokRes.videoPath)) {
      throw new Error('Grok Imagine did not produce a valid video. Pipeline halted; nothing was uploaded.');
    }

    const safeSlug = scriptPkg.concept_title.replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 30) || 'Episode';
    const finalVideoPath = path.join(path.dirname(grokRes.videoPath), `${safeSlug}_${jobId}.mp4`);

    // Raw Grok video with its original audio — no FFmpeg processing.
    fs.renameSync(grokRes.videoPath, finalVideoPath);
    console.log(`[ChannelBrowserAgent] Video ready (${grokRes.durationSec}s, original Grok audio): ${finalVideoPath}`);

    const videoDuration = grokRes.durationSec;
    const existingSnap = path.join(FRAMES_DIR, `shot_${jobId}_1.png`);

    // 3. Register the video as soon as it exists, so it is never lost if a later step fails or the run is stopped.
    db.prepare(`
      INSERT INTO jobs (
        id, channel_id, series_id, slot_id, concept_title, format, age_band,
        hook, hypothesis, script_text, shot_briefs_json, captions_json,
        state, video_path, thumbnail_path, duration_seconds,
        is_ai_generated, is_demo_job, created_at, updated_at
      ) VALUES (?, ?, NULL, NULL, ?, 'short', 'all', ?, '', ?, ?, '[]', 'rendering', ?, ?, ?, 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(
      jobId,
      this.channelId,
      scriptPkg.concept_title,
      scriptPkg.hook,
      scriptPkg.script_text,
      JSON.stringify(scriptPkg.shot_briefs),
      finalVideoPath,
      fs.existsSync(existingSnap) ? existingSnap : null,
      videoDuration
    );
    options.onJob?.(jobId);

    say('Picking a cover frame…');
    const coverPath = await this.makeCoverImage(finalVideoPath, jobId);
    const thumbnailPath = coverPath || (fs.existsSync(existingSnap) ? existingSnap : null);
    db.prepare('UPDATE jobs SET thumbnail_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(thumbnailPath, jobId);

    // 4. Kids Safety QA Inspection
    console.log('[ChannelBrowserAgent] Running kids-safety QA inspection...');
    say('Running the kids-safety check…');
    const qaResult = await inspectJob(jobId, {
      title: scriptPkg.concept_title,
      hook: scriptPkg.hook,
      prompt: grokPrompt,
      videoPath: finalVideoPath,
      coverPath: thumbnailPath,
      holdOnFlags: ch ? ch.hold_flagged_videos : false,
    });
    this.throwIfCancelled();

    // 5. Post — ONLY when QA passed. TikTok first, then YouTube.
    let posted: Awaited<ReturnType<typeof ChannelBrowserAgent.prototype.postVideo>>;
    if (qaResult.passed) {
      posted = await this.postVideo({
        jobId,
        videoPath: finalVideoPath,
        title: scriptPkg.concept_title,
        hook: scriptPkg.hook,
        coverPath,
        tiktok: targets.tiktok,
        youtube: youtubeOn,
        youtubeMadeForKids: targets.youtubeMadeForKids,
        previous: { youtubeStatus: targets.youtube && !youtubeOn ? 'skipped' : 'off' },
        say,
      });
    } else {
      console.warn('[ChannelBrowserAgent] QA did not pass — video held for review and NOT uploaded anywhere.');
      posted = {
        tiktokStatus: targets.tiktok ? 'held_for_review' : 'off',
        tiktokVerified: false,
        tiktokUrl: undefined,
        youtubeStatus: targets.youtube ? 'held_for_review' : 'off',
        youtubeVerified: false,
        youtubeUrl: undefined,
        postedEverywhere: false,
        postedAnywhere: false,
        postFailed: [],
      };
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
      ...posted,
      message: `ChatGPT prompt -> Grok video (${videoDuration}s${grokRes.width && grokRes.height ? ', ' + grokRes.width + 'x' + grokRes.height : ''}, original sound) -> QA ${qaResult.passed ? 'passed' : 'held'} -> TikTok: ${posted.tiktokStatus} -> YouTube: ${posted.youtubeStatus}`,
    };
  }
}

/** Errors a second attempt cannot fix: a stop, a sign-in that needs a person, a usage or upload limit. */
const NOT_RETRYABLE = /not signed in|requires login|sign into|signed out|usage limit|weekly limit|credits?|quota|upgrade|daily upload limit|already being produced|server failed|no longer exists|missing from disk|nothing to post/i;

/** Lower-case, collapse whitespace: lets two readings of the same prompt compare equal. */
export function normalizePromptText(text: string): string {
  return (text || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** How much of a prompt's beginning identifies it. (Prompts differ in the very first sentence: the guest animal.) */
const PROMPT_KEY_CHARS = 300;

/** True if the prompt's last line is a settings line such as "10 seconds • Vertical 9:16 • 720p • …" (the reply is complete). */
export function endsWithSettingsLine(prompt: string): boolean {
  const lines = (prompt || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const last = lines[lines.length - 1] || '';
  return /\d{1,2}\s*seconds?\s*[•·|]/i.test(last) && /vertical|9:16|\d{3,4}p/i.test(last);
}

/** True if this prompt was already on the page before "next" was sent, i.e. it belongs to an OLD reply. */
export function isOldPrompt(candidate: string, pageTextBeforeNormalized: string): boolean {
  const key = normalizePromptText(candidate).slice(0, PROMPT_KEY_CHARS);
  return key.length >= 60 && pageTextBeforeNormalized.includes(key);
}

/** True if a prompt with the same beginning was already used for one of these earlier videos. */
export function promptWasUsedBefore(candidate: string, previousPrompts: string[]): boolean {
  const key = normalizePromptText(candidate).slice(0, PROMPT_KEY_CHARS);
  if (key.length < 60) return false;
  return previousPrompts.some((p) => normalizePromptText(p).slice(0, PROMPT_KEY_CHARS) === key);
}

export function isRetryableError(err: any): boolean {
  if (!err) return false;
  if (err.code === 'RUN_CANCELLED' || err.code === 'GROK_SERVER_FAILED') return false;
  if (err.code === 'RUN_TIMEOUT') return true;
  return !NOT_RETRYABLE.test(String(err.message || err));
}

/** First sentence of an error, without screenshot paths, for progress messages. */
export function shortReason(err: any): string {
  const text = String(err?.message || err || 'unknown error').replace(/\s*Screenshot:.*$/s, '').trim();
  const first = text.split(/(?<=\.)\s/)[0];
  return first.length > 140 ? first.slice(0, 137) + '…' : first;
}
