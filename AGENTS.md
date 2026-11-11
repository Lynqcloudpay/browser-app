# AGENTS.md — KindredStudio (read this first)

Instructions for any AI coding agent (Claude, Codex, etc.) working in this repo.

## What this app is
A Mac-local studio. Each **channel** (e.g. "Mr. Apple") makes one short video per run and posts it to **TikTok and
YouTube Shorts** by driving a **real browser** (Playwright Chromium): ChatGPT writes the prompt, Grok Imagine makes the
video from the channel's reference image, a keyword kids-safety check runs, then TikTok Studio and YouTube Studio post it.
React UI (Vite, `:5173`) + Express/SQLite API (`127.0.0.1:3000`). It needs **no** OpenAI/xAI/Buffer API keys.
User-facing docs: [README.md](README.md).

## Set it up
```bash
node scripts/setup.mjs     # installs deps + Chromium, creates .env, type-checks, tests, builds. Must end with SETUP OK
npm run dev                # http://localhost:5173
```
`npm run doctor` only reports problems. Needs macOS, Node 20+, git. One-line installer: `scripts/bootstrap.sh`.

## Verify any change
```bash
npm run check     # = type-check server + web page, all tests, vite build. Must pass before every commit
```
Tests (`tests/`) run each file in its own process against a throw-away storage folder (`tests/helpers/env.ts` sets
`KINDRED_STORAGE_DIR`, `DATABASE_PATH`, `KINDRED_NO_LAUNCHD`). **Import `./helpers/env` first in every test file.** Tests
never start a browser: do not add a test that calls a route that launches one (`/run`, `/open-browser`,
`/detect-chatgpt-url`, `/accounts/check`, `/accounts/*/switch`, a successful `/videos/:id/publish`).

## Steps only the human can do — STOP and tell them
Never ask for, type or store the owner's passwords or tokens.
1. **Sign into ChatGPT, Grok, TikTok, YouTube** in the channel's browser window (channel page → Logins → Check logins).
2. **Link the ChatGPT chat**: channel page → ChatGPT prompt chat → Auto-detect from sidebar (or paste the URL).
3. **Switching an account** is the "Switch account" button on the channel page; the human signs in.
4. **Daily schedule** (channel page): turn on for **one computer only**, or videos double up.
5. **GitHub push access** (owner `Lynqcloudpay`): the human adds a collaborator or types a token at the terminal.

## Real-world side effects — never trigger without being asked
A run **posts a public video** to the owner's accounts and uses Grok credits. Do not click "Make and post a video",
`POST /api/channels/:id/run`, `POST /api/videos/:id/publish`, `npm run daily -- --force`, or `npm run youtube:test` unless
the user explicitly asked for a live run. Test selectors with a throw-away browser (see gotchas).

## Architecture
```
client/src/            React app. api.ts (typed client), types.ts, pages/, components/, hooks/. Hash routing.
server/index.ts        createApp() (no listen, used by tests) + startServer(). Local-only: Host and Origin checks.
server/routes/api.ts   channels, runs, run control, reference image. helpers.ts, library.ts (videos), system.ts (overview,
                       system check, storage).
server/engine/         channels.ts (CRUD + paths), agentRegistry.ts (one ChannelBrowserAgent per channel),
                       jevBrowserAutomation.ts (ALL browser steps), dailyRunner.ts (run state machine, republish, stop),
                       runs.ts (persistent run history), qaInspector.ts (safety scan), accounts.ts / accountStatus.ts,
                       dailySchedule.ts (launchd), clipboardLock.ts, grokSemaphore.ts, videoFile.ts, types.ts
server/db/             SQLite. Tables: channels, jobs (= videos), qa_inspections, runs. Old databases keep legacy tables
                       (settings, series, ...) untouched; never DROP them.
server/paths.ts        STORAGE_ROOT and friends. Always use these, never `__dirname/../storage`.
scripts/               setup.mjs, bootstrap.sh, dailyRun.ts (launchd entry), youtubeTest.ts
```
- `jobs.state`: `rendering` → `ready_to_publish` | `held_for_review` → `published` | `scheduled` (Post clicked, platform has
  not confirmed) | `failed` | `rejected`. `tiktok_status` / `youtube_status`: `published`, `submitted`, `failed`, `skipped`,
  `held_for_review`, `off`.
- A video row is inserted as soon as Grok's file exists, so a later failure or a Stop never loses it. `POST /videos/:id/publish`
  posts the existing file (no new Grok credits) and re-runs the safety check first when none is on record.
- Run status is in memory per channel (`getRunStatus`); every run is also a row in `runs`. On start the server closes out
  runs whose process died. A run owned by another live process (the scheduled job) blocks starting one from the app.
- **Unattended recovery** (`dailyRunner.makeVideoUnattended`, `retryStep`, `server/engine/popups.ts`): pop-ups (cookie
  banners, promos, "verify your phone", surveys) are closed automatically before clicks and during long waits; dialogs the
  run needs are never touched. ChatGPT is retried once; Grok once only if the prompt was not yet submitted (credits); a
  TikTok/YouTube upload once only when Post/Publish was never clicked (`success: false`). A run that fails before a video
  exists starts over once with a fresh browser after 1 minute; a platform whose upload failed is posted again once after
  2 minutes; an attempt stuck for 25 minutes is stopped (browser closed). Sign-in problems, usage limits and Stop are never
  retried. Failures show a macOS notification. Rules: `isRetryableError`, `platformsToRepost`.
- **Speed:** TikTok and YouTube upload at the same time in separate tabs (Playwright keeps background tabs live); Grok
  is opened and set to Video in its own tab while ChatGPT writes (`prepareGrok`). Every run stores seconds per station in
  `runs.timings` and logs `[timing]` lines — measure before changing waits.
- **Jev backup** (`server/engine/jevAssist.ts`, key `TYPESAFE_API_KEY` in `.env`): only when a scripted lookup finds
  nothing (ChatGPT message box, Grok Video toggle, TikTok Post, YouTube Next / visibility), the visible controls are sent to
  Jev; code clicks only if Jev says a matching control exists (Noul >= 0.7) and favours one (>= 0.6). Tests never call the
  API unless `KINDRED_TEST_LIVE_JEV=1`.
- **Safety check** is advisory by default: flags are recorded and the video still posts. A channel with
  `hold_flagged_videos` on holds flagged videos instead. A missing or broken video file always blocks.
- Stop = `ChannelBrowserAgent.requestCancel()`: closes the browser; the step in flight fails and is reported as stopped.
  If Post was already clicked the platform may still publish.

## Gotchas (each cost real debugging time)
- **Never open a second browser on `storage/channels/*/browser_profile`** while the app's window may be open: it wiped the saved
  logins once. Inspect sites with a throw-away `chromium.launch()` and cookies from `storage/channels/<id>/browser_cookies.json`.
- **Ports:** the backend reads `SERVER_PORT` (default 3000), not `PORT` (launchers set `PORT=5173` for Vite).
- **Grok** shows resolution and length as dropdown buttons (`aria-label="Video resolution"` / `"Video duration"`, items are
  `menuitemradio`). If Grok's server fails the run stops; there is no automatic retry (it may use credits).
- **ChatGPT's layout has no message containers** (no `<article>`, no `data-message-author-role`, no conversation-turn test ids — only `data-testid="chatgpt-writing-block"` cards and "Plain text" code blocks), and its **Stop button is labelled just `Stop`** (no test id). So "is ChatGPT still writing?" is `chatGptIsWriting` (all Stop labels), and the new reply is recognised as a prompt that was NOT on the page before "next" was sent (`isOldPrompt`) — never by comparing against the last reply, and never by turn counts. A prompt this channel already used is refused (`promptWasUsedBefore`). Regression test: `tests/chatgpt-wait.test.ts` (old reply on the page, new one streams in; run with and without a Stop button).
- **Two ChatGPT answer formats.** Mr. Apple's chat puts the prompt in a **"Plain text" code block**; Mr Watermelon's puts it in a **writing card** (`[data-testid="chatgpt-writing-block"]` → `<header>` with the story title, then the prompt body, ending with the settings line). The code-block reader runs first and is unchanged; the writing-card reader (`writingPrompt` / `writingTitle`) is used only when there is no NEW code-block prompt. A writing card is accepted early only once it ends with its settings line. Both formats are covered by `tests/chatgpt-wait.test.ts`.
- **Under `tsx`**, functions passed to `page.evaluate` get an injected `__name()` helper; `window.__name` is shimmed in
  `launchPersistent` and `extractCoverFrame`. Keep that when adding in-page code.
- **No ffmpeg.** The raw Grok video goes straight to the platforms.
- **YouTube** goes through Studio's upload dialog: answers "made for kids" from the channel, always publishes Public, saves
  screenshots to `storage/frames/youtube_*.png`. YouTube sign-in is optional: after 4 minutes unsigned the run posts to TikTok only.
- **Pop-ups that are not dialogs:** Grok's "Shape your scene, start to finish … Try it now" promo is a plain floating `<div>` (no `role=dialog`) with an icon button labelled "Dismiss". `popups.ts` marks small boxes (≤ 600 chars) whose text is a known nag AND that have their own Dismiss/Close/Not now button, and closes them with that button — never "Try it now". Covered by `tests/popups.test.ts`.
- **File pickers:** TikTok's "Upload cover" opens a native Mac window unless a `filechooser` listener intercepts it. Keep them.
- **Multi-channel:** each channel has its own browser context, reference image, ChatGPT chat, Grok settings, destinations and
  LaunchAgent (`com.kindredstudio.channel.<id>` → `scripts/dailyRun.ts --channel <id>`). Grok generations are throttled by
  `withGrokSlot`; macOS clipboard use is serialized by `withClipboard`.
- **Schedule:** a slot is done only when ITS video was made (`storage/channels/<id>/schedule_state.json`); a missed slot is
  caught up once; log in `storage/logs/channel_<id>.log`.
- **`/media`** serves only `storage/videos`, `frames`, `thumbnails`. Channel folders hold saved logins and must never be served.
- The browser window closes by itself after every platform confirmed the post; the next run restores cookies.

## Git rules (standing instruction from the owner)
- **After every change: commit and push to `main`** (repo `Lynqcloudpay/browser-app`) once `npm run check` passes.
- **Never commit private files:** `.env`, `storage/channels/`, `storage/*.db*`, `storage/logs/`, anything in `storage/` except
  `.gitkeep`. They are git-ignored; scan the diff for keys/tokens before committing.
- Write a clear message explaining *why*. End it with the attribution line your tool requires.

## Troubleshooting
See the table in README.md. `Port 3000 is already in use` means the app is already running; do not start a second copy.
