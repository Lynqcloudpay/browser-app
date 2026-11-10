# AGENTS.md — KindredStudio (read this first)

Instructions for any AI coding agent (Claude, Codex, etc.) working in this repo.

## What this app is
Makes one "Mr. Apple" video and posts it to **TikTok and YouTube Shorts** by driving a **real browser** (Playwright Chromium):
ChatGPT writes the prompt → Grok Imagine makes the video from the reference image → TikTok Studio and YouTube Studio post it.
Where it posts is configurable in Settings → "Where to post each video" (`storage/publish_targets.json`).
React UI (Vite, `:5173`) + Express/SQLite API (`:3000`). It runs on the owner's **Mac**. It needs no OpenAI/xAI/Buffer API keys.

## Fastest: the owner can paste ONE line (no agent needed)
```bash
curl -fsSL https://raw.githubusercontent.com/Lynqcloudpay/browser-app/main/scripts/bootstrap.sh | bash
```
It installs git/Node checks, downloads the repo to `~/browser-app`, and runs the same `scripts/setup.mjs` below. If you are an agent, you may run it too
(`KINDRED_DIR=<folder>` changes the install folder). The manual steps below are the backup.

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
3. **Changing which account a platform uses:** Settings → **Accounts** → "Switch account" for that platform (signs it out, waits for the human to sign in with the other account, then closes the window). "Check logins" refreshes the signed-in/out status. Never sign in for them.
4. **Optional daily schedule:** Settings → "Post automatically every day" (videos per day + each time). Turn it on for **one computer only**, or videos double up.
5. **GitHub push access** (owner account `Lynqcloudpay`): the human must add a collaborator or type a token at the terminal prompt themselves.

## Real-world side effects — don't trigger without being asked
A run **posts a public video to the owner's TikTok and YouTube** (per Settings) and uses their Grok credits.
Do not click "Make & Post a Video Now", `POST /api/browser/run`, or `npm run daily -- --force` unless the user explicitly asked for a live run.
Test selectors/pages with a throw-away browser instead (see gotchas). To test only the YouTube upload, `npm run youtube:test` uploads an existing video as **private** (close the app's browser window first; ask the owner first — it creates a private video on their channel).

## Verify any change
```bash
npx tsc --noEmit -p .      # must print nothing
npm test                   # must say ALL 5 INTEGRATION TESTS PASSED (uses its own database)
npm run build              # builds the web page
```

## Gotchas (each of these cost real debugging time)
- **Never open a second browser on `storage/browser_profile` or any `storage/channels/*/browser_profile`** while the app's window may be open — it wiped the saved logins once. To inspect a site, use a throw-away `chromium.launch()` context and load cookies from `storage/browser_cookies.json` or channel cookies.
- **Ports:** the backend reads `SERVER_PORT` (default 3000), *not* `PORT` (launchers set `PORT=5173` for Vite → 502 errors).
- **Grok (signed in)** shows resolution and length as dropdown buttons (`aria-label="Video resolution"` / `"Video duration"`, items are `menuitemradio`), not radio toggles. The app asks for 720p and 15s (or channel settings). If Grok's server fails ("Server failed to respond" toast, back to the still image) the run stops with that message; there is no automatic retry because it happened at 480p and 720p alike and attempts may use credits. Never treat "progress shown, then no video" as "never started". The first video frame is the reference image, so covers are picked from a mid-video frame.
- **Under `tsx`**, functions passed to `page.evaluate` get an injected `__name()` helper; `window.__name` is shimmed in `launchPersistent` and `extractCoverFrame`. Keep that when adding in-page code.
- **Tests** run against their own database (`npm test` sets `DATABASE_PATH`). Never point tests at `storage/kindred_studio.db`.
- **No ffmpeg.** The raw Grok video (with its original audio) goes straight to TikTok.
- **YouTube** is driven through YouTube Studio's upload dialog (`uploadToYouTubeViaBrowser`): it must answer "made for kids" (Settings/Channel; default yes — these are kids' videos), always publishes **Public**, and saves screenshots to `storage/frames/youtube_*.png`. Studio can show an "unsupported browser" page with a "Skip to YouTube Studio" link (handled). YouTube sign-in is optional: if nobody signs in within 4 minutes the run still posts to TikTok. The browser only closes when every enabled place confirmed the post.
- **Switching accounts** (`switchAccount` in `jevBrowserAutomation.ts`, orchestrated by `server/engine/accounts.ts`): wipes only that platform's cookies via `context.clearCookies({domain})` (YouTube also clears Google; Grok also clears X) plus site storage, and rewrites cookies file so the old login can't be restored. ChatGPT's saved chat URL is cleared and re-detected for the new account. It refuses while a video run is in progress, and runs refuse while an account change is in progress.
- **File pickers:** TikTok's "Upload cover" opens a native Mac file window unless a `filechooser` listener intercepts it. Keep the listeners.
- **Multi-channel Studio:** Each channel has its own independent browser context, character reference picture, ChatGPT conversation, Grok settings, where-to-post destinations, and LaunchAgent daily schedule (`com.kindredstudio.channel.<id>`). Parallel channels run in their own staggered Chrome windows without overlapping state. Grok generations are throttled via `withGrokSlot` to prevent rate limit collisions on shared accounts. macOS clipboard operations are synchronized via `withClipboard`.
- **Schedule** = macOS LaunchAgent `com.kindredstudio.channel.<id>` → `scripts/dailyRun.ts --channel <id>`. Each scheduled time is a slot, and a slot is done only when ITS video was made (`storage/channels/<id>/schedule_state.json` → `doneSlots`; manual runs don't count; a missed slot is caught up once). Skips are logged and shown as a notification; log in `storage/logs/channel_<id>.log`.
- The browser window closes by itself after TikTok/YouTube confirms a post; the next run reopens it and restores saved login cookies.

## Where things are
| File | Purpose |
|---|---|
| `server/engine/channels.ts` | Multi-channel CRUD, channel directory paths, DB operations |
| `server/engine/agentRegistry.ts` | Channel browser agent registry, lifecycle management & concurrency checks |
| `server/engine/clipboardLock.ts` | Async mutex serializing macOS system clipboard access across parallel channels |
| `server/engine/grokSemaphore.ts` | Concurrency limiter throttling Grok generations (max 2 parallel) |
| `server/engine/jevBrowserAutomation.ts` | Instance-based `ChannelBrowserAgent` handling browser steps for each channel |
| `server/engine/dailyRunner.ts` | One-button run + live per-channel status |
| `server/engine/accounts.ts`, `accountStatus.ts` | Accounts overview: check logins / switch a platform's account per channel |
| `server/engine/publishTargets.ts` | Where to post: TikTok / YouTube, YouTube made-for-kids setting |
| `server/engine/grokSettings.ts` | Grok video quality (480p/720p) and duration (6s/10s/15s) settings |
| `server/engine/dailySchedule.ts`, `scripts/dailyRun.ts` | Per-channel daily schedule (launchd plists) and runner job |
| `server/routes/api.ts` | REST API (`/api/channels`, `/api/channels/:id/*`, plus legacy routes) |
| `client/src/components/StudioTab.tsx` | Studio overview: channel cards grid, '+' new channel, channel deletion |
| `client/src/components/ChannelPage.tsx` | Dedicated channel management: character image upload, accounts, Grok, schedule |
| `client/src/components/SettingsTab.tsx` | Global operator settings & connections |
| `scripts/setup.mjs` | One-command setup / check |

## Git rules (standing instruction from the owner)
- **After every change: commit and push to `main`** (repo `Lynqcloudpay/browser-app`) in the same turn, once verification passes.
- **Never commit private files:** `.env`, `storage/browser_profile/`, `storage/channels/`, `storage/browser_cookies.json` (saved logins), `storage/*.db*`, `storage/schedule*.json`, `storage/publish_targets.json`, `storage/grok_settings.json`, `storage/account_status.json`, `storage/logs/`, `.claude/settings.local.json`. They are git-ignored — keep it that way, and scan the diff for keys/tokens before committing.
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
