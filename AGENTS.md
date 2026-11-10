# AGENTS.md — KindredStudio (read this first)

Instructions for any AI coding agent (Claude, Codex, etc.) working in this repo.

## What this app is
Makes one "Mr. Apple" video and posts it to TikTok by driving a **real browser** (Playwright Chromium):
ChatGPT writes the prompt → Grok Imagine makes the video from the reference image → TikTok Studio posts it.
React UI (Vite, `:5173`) + Express/SQLite API (`:3000`). It runs on the owner's **Mac**. It needs no OpenAI/xAI/Buffer API keys.

## Set it up (do exactly this, in order)
```bash
git clone https://github.com/Lynqcloudpay/browser-app.git
cd browser-app
node scripts/setup.mjs
```
- Setup installs dependencies, downloads Playwright's Chromium, creates `.env`, then type-checks, tests and builds.
- **It must end with the line `SETUP OK`.** If it ends with `SETUP FAILED: <step>`, read the "How to fix" above it, fix that, and rerun. It is safe to rerun any number of times.
- `node scripts/setup.mjs --check` (or `npm run doctor`) only reports problems and changes nothing.
- Needs: macOS, Node 20 or newer, git, internet. (The scheduler and some browser shortcuts are macOS-only.)
- Start the app: `npm run dev` → open http://localhost:5173 (API on :3000).

## Steps only the human can do — STOP and tell them
Never ask for, type or store the owner's passwords. Never ask them to paste tokens or keys into chat.
1. **Sign into ChatGPT, Grok and TikTok** in the app's browser window: Settings → "Make & Post a Video Now" opens the three tabs and waits for sign-in.
2. **Link the ChatGPT chat** named "Create Mr Apple Videos": Settings → ChatGPT Master Prompt Chat → "Auto-Detect from Sidebar" (or paste its URL).
3. **Optional daily schedule:** Settings → "Post automatically every day" (videos per day + each time). Turn it on for **one computer only**, or videos double up.
4. **GitHub push access** (owner account `Lynqcloudpay`): the human must add a collaborator or type a token at the terminal prompt themselves.

## Real-world side effects — don't trigger without being asked
A run **posts a public video to the owner's TikTok** and uses their Grok credits.
Do not click "Make & Post a Video Now", `POST /api/browser/run`, or `npm run daily -- --force` unless the user explicitly asked for a live run.
Test selectors/pages with a throw-away browser instead (see gotchas).

## Verify any change
```bash
npx tsc --noEmit -p .      # must print nothing
npm test                   # must say ALL 5 INTEGRATION TESTS PASSED (uses its own database)
npm run build              # builds the web page
```

## Gotchas (each of these cost real debugging time)
- **Never open a second browser on `storage/browser_profile`** while the app's window may be open — it wiped the saved logins once. To inspect a site, use a throw-away `chromium.launch()` context and load cookies from `storage/browser_cookies.json`.
- **Ports:** the backend reads `SERVER_PORT` (default 3000), *not* `PORT` (launchers set `PORT=5173` for Vite → 502 errors).
- **Grok (signed in)** shows resolution and length as dropdown buttons (`aria-label="Video resolution"` / `"Video duration"`, items are `menuitemradio`), not radio toggles. The app forces 720p and 15s. The first video frame is the reference image, so covers are picked from a mid-video frame.
- **Under `tsx`**, functions passed to `page.evaluate` get an injected `__name()` helper; `window.__name` is shimmed in `launchPersistent` and `extractCoverFrame`. Keep that when adding in-page code.
- **Tests** run against their own database (`npm test` sets `DATABASE_PATH`). Never point tests at `storage/kindred_studio.db`.
- **No ffmpeg.** The raw Grok video (with its original audio) goes straight to TikTok.
- **File pickers:** TikTok's "Upload cover" opens a native Mac file window unless a `filechooser` listener intercepts it. Keep the listeners.
- **Schedule** = macOS LaunchAgent `com.kindredstudio.daily` → `scripts/dailyRun.ts`. Only scheduled runs use up slots (`storage/schedule_state.json`); log in `storage/logs/daily.log`.
- The browser window closes by itself after TikTok confirms a post; the next run reopens it and restores saved login cookies.

## Where things are
| File | Purpose |
|---|---|
| `server/engine/jevBrowserAutomation.ts` | All browser steps: login check, ChatGPT, Grok, cover frame, TikTok, cookies |
| `server/engine/dailyRunner.ts` | One-button run + live status |
| `server/engine/dailySchedule.ts`, `scripts/dailyRun.ts` | Daily schedule (launchd) and its job |
| `server/routes/api.ts` | REST API (`/api/browser/run`, `/run-status`, `/skip-login`, `/schedule`) |
| `client/src/components/SettingsTab.tsx` | The Settings page (one button, schedule card) |
| `scripts/setup.mjs` | One-command setup / check |

## Git rules (standing instruction from the owner)
- **After every change: commit and push to `main`** (repo `Lynqcloudpay/browser-app`) in the same turn, once verification passes.
- **Never commit private files:** `.env`, `storage/browser_profile/`, `storage/browser_cookies.json` (saved logins), `storage/*.db*`, `storage/schedule*.json`, `storage/logs/`, `.claude/settings.local.json`. They are git-ignored — keep it that way, and scan the diff for keys/tokens before committing.
- Write a clear message explaining *why*. End it with the attribution line your tool requires.

## Troubleshooting
| Symptom | Fix |
|---|---|
| `Executable doesn't exist` / browser not found | `npx playwright install chromium` |
| `better-sqlite3` fails to build | `xcode-select --install`, then `node scripts/setup.mjs` |
| 502 Bad Gateway on `/api/...` | Backend is on the wrong port — make sure `SERVER_PORT` isn't overridden; restart `npm run dev` |
| "profile already open in another window" | Quit the app's browser window (⌘Q) and retry |
| Run says a site "looks signed out" but it isn't | Click "I'm already signed in — continue" in Settings |
| Run stuck waiting for sign-in | The human must sign in in the browser window (agents can't) |
| Build prints "ESM syntax in a file loaded as CommonJS (vite.config.ts)" | Harmless warning — the build still succeeds. Ignore it. |
| Port 3000/5173 busy | The app is already running — don't start a second copy |
