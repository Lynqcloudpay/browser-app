# KindredStudio 🐲✨
### Autonomous AI Children's Media Studio & Discovery Engine

**KindredStudio** is an autonomous production studio and series discovery engine built for adult creators. Every video is strictly original children’s entertainment or education suitable for family co-viewing.

The core business objective is to discover and pilot kids’ series that generate measurable earnings after production costs. An adult operator connects their accounts, sets a daily budget and posting schedule, and turns the studio on. The studio originates fresh ideas, writes storyboards, renders vertical 9:16 videos, conducts automated child-safety inspections, publishes through authorized schedulers, tracks itemized P&L, and plans subsequent production batches based on empirical results.

---

## Install on any Mac with ONE line (no AI needed)

Open **Terminal**, paste this line, press Enter:

```bash
curl -fsSL https://raw.githubusercontent.com/Lynqcloudpay/browser-app/main/scripts/bootstrap.sh | bash
```

It checks for git and Node 20+ (installs Node with Homebrew if you have it), downloads the project to `~/browser-app`,
installs everything, downloads the browser, creates `.env`, runs the checks, and ends with **`SETUP OK`**.
Safe to paste again later: it updates the project and re-verifies.

To also start the app and open it in your browser when it finishes, use:

```bash
curl -fsSL https://raw.githubusercontent.com/Lynqcloudpay/browser-app/main/scripts/bootstrap.sh | bash -s -- --start
```

Then, in **Settings**, click **Make & Post a Video Now** and sign into ChatGPT, Grok and TikTok when the browser window asks.
Needs a Mac (macOS). You can read the installer first: [scripts/bootstrap.sh](scripts/bootstrap.sh).

### Backup: step by step (humans or AI agents)

If the one-liner can't be used, do it by hand:

```bash
git clone https://github.com/Lynqcloudpay/browser-app.git ~/browser-app
cd ~/browser-app
node scripts/setup.mjs     # installs everything and verifies it; must end with "SETUP OK"
npm run dev                # then open http://localhost:5173
```

`npm run doctor` re-checks the setup without changing anything.
**AI agents: read [AGENTS.md](AGENTS.md) first** — exact setup steps, what only a human can do, and the gotchas.

---

## System Architecture & Roles

```
┌────────────────────────────────────────────────────────────────────────┐
│                        ADULT CREATOR / OPERATOR                        │
│          Operator Dashboard • Automation Switch • Budget Caps          │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                        ┌───────────▼───────────┐
                        │   JEV DECISION LOOP   │
                        │ (TypeSafe AI Jev Mdl) │
                        └───────────┬───────────┘
                                    │
          ┌─────────────────────────┼─────────────────────────┐
          │                         │                         │
┌─────────▼───────────┐   ┌─────────▼───────────┐   ┌─────────▼───────────┐
│   OPENAI WRITER     │   │   GROK IMAGINE      │   │  BUFFER / TIKTOK    │
│ On-demand writing:  │   │ xAI Video Engine:   │   │ Authorized publisher│
│ hooks, scripts,     │   │ Distinct 9:16 shots │   │ isAiGenerated: true │
│ verifiable facts    │   │ downloaded locally  │   │ Scheduled slots     │
└─────────────────────┘   └─────────┬───────────┘   └─────────────────────┘
                                    │
                          ┌─────────▼─────────┐
                          │  FFMPEG PIPELINE  │
                          │ Voiceover speech, │
                          │ music bed, subs   │
                          └─────────┬─────────┘
                                    │
                          ┌─────────▼─────────┐
                          │  KIDS SAFETY QA   │
                          │ Frame inspection, │
                          │ COPPA, imitation  │
                          └───────────────────┘
```

- **Builder**: Claude (architects, writes, and hardens clean codebase).
- **Production Decision-Maker**: **TypeSafe Jev** (System One decision model evaluating structured application state against typed questions: `Choice`, `Score`, `Noul`). Jev chooses series formats, hooks, render approvals, slot allocations, QA dispositions, and weekly monetization experiments with zero silent fallback to another model.
- **On-Demand Writing Tool**: **OpenAI Responses API** (commissioned by Jev for creative options, scripts, and shot prompts; has zero scheduling, budget, or account permissions).
- **Video Generation Engine**: **xAI Grok Imagine** (`grok-imagine-video-1.5` / `1.5-lite`) producing distinct vertical 9:16 shots.
- **Media Assembly Pipeline**: **FFmpeg** assembling shots, synthesizing clear speech narration, mixing acoustic co-viewing music, generating subtitle tracks, and sampling frames for QA.
- **Publisher**: **Buffer GraphQL API** publishing to an adult-owned TikTok account for family co-viewing with mandatory AI-disclosure (`isAiGenerated: true`).

---

## Key Features

1. **Cold Start from Empty Content Catalog**
   - Starts with zero previous franchises, borrowed characters, or prompt history.
   - Originate original intellectual property across three distinct children's formats:
     - **Interactive Visual Puzzles** (e.g. *Which shadow belongs to the paper dragon?* with 4s thinking pause and rotating reveal).
     - **Simple Science Wonders** (e.g. *Why are bubbles always round?* demonstrating minimal surface area and surface tension).
     - **Character Kindness Stories** (e.g. *Pip & Friends: Tiny Garden Acts* teaching empathy and patience).
   - Generates and stores reusable series design sheets, color palettes, narrator styles, and continuity rules inside the project.

2. **Persistent Jev Decision Loop**
   - For every production step, the worker assembles the current state, candidate rubrics, and remaining budget.
   - Jev returns deterministic choices, confidence metrics, and probability distributions at low latency (~70–120ms).
   - Decisions are permanently logged in the SQLite `decisions_log`. If Jev is unreachable, unfinished jobs are held safely without silent fallback.

3. **Multi-Stage Kids Safety & COPPA Inspection**
   - Every video undergoes automated auditing before publication:
     - Detects dangerous instructions a child might imitate (fire, climbing heights, knives, swallowing small objects).
     - Detects horror, frightening elements, or jump scares.
     - Enforces child privacy (no collecting names, photos, voices, contacts) and COPPA rules (zero commercial calls to action or purchasing prompts).
     - Inspects sampled video frames and file bitrate for corruption or blank frames.
   - Questionable content is immediately placed on `held_for_review` with the exact timestamp and reason shown on the operator dashboard.

4. **Timezone-Aware Always-On Scheduler & Budget Guard**
   - Default 3 daily publishing slots (e.g. 10:00, 14:30, 18:30 in operator timezone).
   - Anti-flood protection: Missed slots during server outages or pauses are marked `missed` rather than bursting the account.
   - Minimum 3-hour spacing between posts.
   - Atomic spend reservation: Reserving spend before any paid API generation or render.

5. **Zero 3rd-Party API Option: Jev Browser Automation (ChatGPT → Grok)**
   - Operators do not need paid OpenAI or Grok API keys.
   - Built-in Playwright Chromium automation module with a persistent browser profile (`storage/browser_profile/`).
   - Log into ChatGPT and Grok once in a visible interactive window (`/api/browser/open`), and your session cookies and authentication persist on your machine.
   - Jev formulates the children's storyboard brief, navigates Chromium to ChatGPT to compose the prompt, extracts the script, and pastes the prompt into Grok to create the video.
   - Includes high-speed zero-cost local FFmpeg assembly with native speech narration and burned-in captions.

6. **Empirical Monetization & P&L Discovery**
   - Full series P&L table: Writing costs, Jev decision costs, rendering costs, retries, publishing/hosting allocation ($0.05/video), confirmed platform payouts, and confirmed licensing revenue.
   - **Strict Grounding Rule**: Missing revenue remains `unavailable`; revenue is never hallucinated or assigned to a view count.
   - Creator Rewards Experiment Mode: Enforces >60-second video duration and full upfront budget reservation.
   - Proposes 3 new kids-only monetization experiments each week (e.g. licensing original puzzle series to adult educational publishers).

---

## Quickstart & Installation

### Prerequisites
- **Node.js**: v20+ or v24+
- **FFmpeg & FFprobe**: Installed and available on system PATH (`brew install ffmpeg` on macOS)

### Setup
```bash
# 1. Clone repository and navigate to workspace
cd "browser app"

# 2. Install dependencies
npm install

# 3. Create .env configuration
cp .env.example .env

# 4. Build frontend client
npm run build
```

---

## Running the Application

### 1. Production Mode
```bash
npm start
```
Starts the KindredStudio server at `http://localhost:3000` with the embedded background worker loop.

### 2. Development Mode
```bash
npm run dev
```
Runs both the Vite hot-reloading client on `http://localhost:5173` and the backend server on `http://localhost:3000`.

---

## Verifying the System

### 1. Comprehensive Integration Test Suite
```bash
npm test
```
Executes 5 integration tests verifying:
- **Test 1**: Off-topic or unsafe concept cannot publish (flagged with timestamp and held for review).
- **Test 2**: Failed Jev call halts execution without silent fallback to another model.
- **Test 3**: Concurrency lock prevents concurrent workers from double-posting.
- **Test 4**: Missing revenue remains `unavailable` and is never derived from view counts.
- **Test 5**: Timezone-aware slot generation and over-budget pause protection.

### 2. End-to-End Demo (Empty Catalog to Confirmed Receipt)
```bash
npm run demo
```
Runs a complete automated walkthrough:
1. Empties catalog.
2. Jev originates 3 distinct original concepts.
3. Jev selects the inaugural pilot.
4. OpenAI on-demand writer drafts the script with a 4-second thinking pause and verifiable fact.
5. Budget Guard reserves spend.
6. Grok video engine renders shots & FFmpeg assembles vertical 9:16 MP4 with voiceover and captions.
7. Kids Safety QA audits media (100% pass).
8. Buffer publishes to TikTok with `isAiGenerated: true` and confirms publication receipt.
9. Jev evaluates measured revenue vs production cost ($0.22 vs $15.00) and decides to continue series!

### 3. One-Video Live Smoke Test
```bash
npm run smoke
```
Audits live credentials, checks operator budget caps, executes a single video production pipeline, and prints decision latency vs end-to-end render time.

---

## Inexpensive Deployment Guide

Because KindredStudio runs on an embedded SQLite database (`better-sqlite3` in WAL mode) and a single lightweight Node.js process with FFmpeg, it can be deployed for **$5 - $10 / month** on any standard Linux VPS or container platform.

### Option A: Fly.io / Render / Railway (Single Container)
1. Use a standard `Dockerfile` with Node 22/24 and `ffmpeg`:
```dockerfile
FROM node:22-bullseye-slim
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
```
2. Attach a persistent volume to `/app/storage` so SQLite database and rendered MP4s persist.
3. Add environment variables (`TYPESAFE_API_KEY`, `OPENAI_API_KEY`, `XAI_API_KEY`, `BUFFER_ACCESS_TOKEN`, `BUFFER_CHANNEL_ID`).

### Option B: Dedicated Mac Mini / Ubuntu VPS ($5/mo)
1. Install Node.js and FFmpeg.
2. Clone repository, run `npm install && npm run build`.
3. Use `pm2` or systemd service to keep the process running:
```bash
pm2 start npm --name "kindred-studio" -- start
```

---

## Primary References
- TypeSafe Jev Browser Agent: https://github.com/TypeSafeAI/typesafe-playground/blob/main/docs/jev-browser-agent.md
- OpenAI Responses API: https://platform.openai.com/docs/api-reference/responses
- xAI Grok Imagine Video API: https://docs.x.ai/developers/model-capabilities/video/overview
- Buffer Create Video Post: https://developers.buffer.com/examples/create-video-post.html
- Buffer TikTokPostMetadataInput: https://developers.buffer.com/types/TikTokPostMetadataInput.html
- TikTok Content Sharing Guidelines: https://developers.tiktok.com/docs/en/content-sharing-guidelines
- TikTok Creator Rewards Program: https://support.tiktok.com/en/business-and-creator/creator-rewards-program/creator-rewards-program

