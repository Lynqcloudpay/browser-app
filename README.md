# KindredStudio

A studio that runs on your Mac. For each channel (for example "Mr. Apple") one click makes a short video and
posts it:

1. **Sign-in check**: opens the channel's own browser window and checks ChatGPT, Grok, TikTok and YouTube.
2. **Prompt**: opens your pinned ChatGPT chat, sends `next`, and reads the new video prompt.
3. **Video**: gives Grok Imagine that prompt plus the channel's reference picture and downloads the result.
4. **Safety check**: scans the title, caption and prompt for words that should not be in a kids' video. A hit
   holds the video for you to review; nothing is posted.
5. **Post**: uploads to TikTok Studio and YouTube Studio (Shorts), each one optional per channel.

It drives a real Chromium window, so it uses the accounts you sign into yourself. It needs no API keys.
Channels can also post on a daily schedule, even while the app is closed.

> A run posts a **public** video to the signed-in TikTok and YouTube accounts and uses Grok credits.

## Install

Needs a Mac, Node.js 20 or newer, and git.

One line in Terminal:

```bash
curl -fsSL https://raw.githubusercontent.com/Lynqcloudpay/browser-app/main/scripts/bootstrap.sh | bash
```

It downloads the project to `~/browser-app`, installs everything, downloads the browser, runs the checks and
ends with `SETUP OK`. Pasting it again later updates the project. Add `-s -- --start` after `bash` to start
the app when it finishes. You can read the installer first: [scripts/bootstrap.sh](scripts/bootstrap.sh).

By hand:

```bash
git clone https://github.com/Lynqcloudpay/browser-app.git ~/browser-app
cd ~/browser-app
node scripts/setup.mjs     # must end with "SETUP OK"
npm run dev                # then open http://localhost:5173
```

`npm run doctor` re-checks the setup without changing anything.

## First video

1. Open http://localhost:5173 and open your channel.
2. **Character reference picture**: upload the picture Grok should copy.
3. **Logins**: click *Check logins*. A browser window opens; sign in to ChatGPT, Grok, TikTok and YouTube.
   The window remembers them. Each channel has its own window and its own logins.
4. **ChatGPT prompt chat**: click *Auto-detect from sidebar*, or paste the chat's URL. This is the chat that
   answers `next` with a new video prompt.
5. **Where to post**: turn TikTok and YouTube Shorts on or off.
6. Click **Make and post a video** and watch the production line. If a site needs a sign-in, the run waits
   for you.

## What is in the app

| Page | What it is for |
|---|---|
| Studio | Every channel at a glance: logins, schedule, what is running, the last result. |
| Channel | The production line, recent videos and runs, and all of that channel's settings. |
| Videos | Every video made. Review held videos, post a video that did not go out, delete files. |
| Activity | Every run, including failed and stopped ones, with the reason. |
| Settings | System check, disk use and cleanup. |

**Post now** on the Videos page uploads a video that already exists. Use it when Grok made the video but
TikTok or YouTube failed, so you do not spend Grok credits twice.

**Daily schedule** uses a macOS LaunchAgent per channel (`com.kindredstudio.channel.<id>`). Each time you pick
makes one video. A missed time is caught up once. Turn schedules on from one computer only, or videos double up.

## Commands

```bash
npm run dev          # API on 127.0.0.1:3000 + web page on localhost:5173
npm run check        # type-check, tests and build: run before every commit
npm test             # tests only (they use a throw-away database and folder)
npm run doctor       # report setup problems, change nothing
npm run daily -- --channel 1          # what the schedule runs (posts a real video)
npm run youtube:test                  # uploads an existing video to YouTube as PRIVATE
```

## How it is built

```
client/            React + Vite + Tailwind. Talks only to /api and /media.
server/index.ts    Express app. Listens on 127.0.0.1 only and refuses requests from other websites.
server/routes/     REST API.
server/engine/     The browser automation, one agent per channel, plus schedule, accounts and safety check.
server/db/         SQLite (better-sqlite3): channels, videos (table "jobs"), safety checks, runs.
scripts/           setup, the scheduled run, the one-line installer.
storage/           Your data. Git-ignored. Videos, covers, the database, and one folder per channel
                   holding its browser profile (your saved logins) and reference picture.
```

Your logins never leave `storage/channels/<id>/`. The API serves only `storage/videos`, `storage/frames`
and `storage/thumbnails` over `/media`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Port 3000 is already in use" | The app is already running. Close the other copy. |
| `Executable doesn't exist` / browser not found | `npx playwright install chromium` |
| `better-sqlite3` fails to build | `xcode-select --install`, then `node scripts/setup.mjs` |
| "profile already open in another window" | Quit the app's browser window (⌘Q) and retry. |
| A site "looks signed out" but is not | Click *I'm already signed in — continue*. |
| Grok: "Server failed to respond" | Grok's side or your usage limit. Nothing was posted. Try later. |
| Video made, but posting failed | Videos page → *Post now*. |

AI coding agents: read [AGENTS.md](AGENTS.md) first.

## License

MIT
