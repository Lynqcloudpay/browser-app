/**
 * Claude films: runs the `claude` CLI (Claude Code, signed in with the owner's claude.ai login) headless inside the
 * lemo-opuscar library folder. Claude writes and renders a short film; the MP4 is copied into the Videos folder and
 * inserted as a normal job (state ready_to_publish, safety check run). Nothing is ever posted automatically.
 */
import { spawn, execFile, ChildProcess } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline';
import { promisify } from 'util';
import db from '../db/database';
import { VIDEOS_DIR, THUMBNAILS_DIR, LOGS_DIR } from '../paths';
import { getChannel } from './channels';
import { inspectJob } from './qaInspector';
import { mediaDuration } from './audioMix';

const execFileAsync = promisify(execFile);

export const OPUSCAR_HOME: string = process.env.KINDRED_OPUSCAR_HOME || path.join(os.homedir(), 'lemo-opuscar');

function findClaudeBin(): string {
  if (process.env.KINDRED_CLAUDE_BIN) return process.env.KINDRED_CLAUDE_BIN;
  const candidates = [
    path.join(os.homedir(), '.local', 'bin', 'claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
  ];
  return candidates.find((p) => fs.existsSync(p)) || 'claude';
}

export const CLAUDE_BIN: string = findClaudeBin();
export const FILM_TIME_LIMIT_MS = 120 * 60_000;
export const FILM_MODELS = ['sonnet', 'opus'] as const;
export type FilmModel = typeof FILM_MODELS[number];

export interface FilmStyle {
  slug: string;
  name: string;
  category: string;
  line: string;
  uses: string[];
  needsImages: boolean;
}

/** Lists the lemo-opuscar styles (styles/<slug>/style.json). Folders starting with '_' and bad JSON are skipped. */
export function listStyles(home: string = OPUSCAR_HOME): FilmStyle[] {
  const dir = path.join(home, 'styles');
  if (!fs.existsSync(dir)) return [];
  const styles: FilmStyle[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
    const file = path.join(dir, entry.name, 'style.json');
    if (!fs.existsSync(file)) continue;
    let json: any;
    try {
      json = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    if (!json || typeof json !== 'object') continue;
    styles.push({
      slug: entry.name,
      name: String(json.en || entry.name),
      category: String(json.category_en || ''),
      line: String(json.line || ''),
      uses: Array.isArray(json.uses) ? json.uses.map((u: unknown) => String(u)) : [],
      needsImages: Array.isArray(json.needs) && json.needs.length > 0,
    });
  }
  return styles.sort((a, b) => a.name.localeCompare(b.name));
}

export interface FilmRequest {
  channelId: number;
  style: string;
  topic: string;
  seconds: number;
  model: FilmModel;
}

/** Checks a film request body. Throws an Error with a plain-English message when it is not usable. */
export function validateFilmRequest(body: any, styles: FilmStyle[]): FilmRequest {
  const b: any = body && typeof body === 'object' ? body : {};

  const channelId = typeof b.channelId === 'number' || typeof b.channelId === 'string' ? Number(b.channelId) : NaN;
  if (!Number.isSafeInteger(channelId) || channelId <= 0) throw new Error('Pick a channel.');

  const style = styles.find((s) => s.slug === b.style);
  if (!style) throw new Error('Pick a film style.');
  if (style.needsImages) throw new Error('This style needs an image generator (ChatGPT/Codex), which is turned off.');

  const topic = typeof b.topic === 'string' ? b.topic.trim() : '';
  if (!topic) throw new Error('Describe what the film is about.');
  if (topic.length > 500) throw new Error('The topic is longer than 500 characters.');

  const seconds = typeof b.seconds === 'number' || typeof b.seconds === 'string' ? Number(b.seconds) : NaN;
  if (!Number.isInteger(seconds) || seconds < 10 || seconds > 90) throw new Error('Length must be a whole number of seconds from 10 to 90.');

  const rawModel = b.model === undefined || b.model === null || b.model === '' ? 'sonnet' : b.model;
  if (!(FILM_MODELS as readonly string[]).includes(rawModel)) throw new Error('Pick a model: sonnet or opus.');

  return { channelId, style: style.slug, topic, seconds, model: rawModel as FilmModel };
}

/** Project folder name inside films/ for one film: lowercase, only a-z, 0-9 and dashes. */
export function filmFolderName(jobId: string): string {
  return `kindred-${jobId}`.toLowerCase().replace(/[^a-z0-9-]/g, '');
}

/** The instruction given to Claude for one film. */
export function buildFilmPrompt(req: FilmRequest, style: FilmStyle, folder: string): string {
  return [
    'Use the Lemo-Opuscar library in the current folder. Read AGENTS.md and follow it, with DIRECTOR.md and TECHNIQUE.md.',
    `Make a film in the "${style.name}" style (styles/${style.slug}) about: ${req.topic}`,
    '',
    'The brief is complete and nobody is available to answer questions, so never ask any (do not use AskUserQuestion);',
    'decide every gap yourself and keep going.',
    '',
    'Settings:',
    '- Language: English.',
    `- Length: about ${req.seconds} seconds.`,
    '- Format: vertical 1080x1920 for TikTok and YouTube Shorts. Pass --size 1080x1920 to every render tool and lay the page out for portrait.',
    '- Compose for a phone screen, not a widescreen frame squeezed into portrait: the main characters are big (about a third of the frame height or more), the action sits in the middle of the frame, and no large empty bands at the top or bottom. Keep captions clear of the bottom 15% (the apps put their buttons there).',
    '- No storyboard review. No user material.',
    '- Default Kokoro narration voice.',
    '- The content must be safe and gentle for young children.',
    `- Project folder: films/${folder}/`,
    '',
    `When the final video is done, write films/${folder}/kindred.json as`,
    '{"video": "<absolute path of the final mp4>", "title": "<short catchy title, max 80 chars>", "hook": "<one-sentence caption>", "credits": "<third-party credit lines for music samples etc., may be empty>"}',
    'and end with a line `FINAL_VIDEO: <absolute path>`.',
  ].join('\n');
}

export const FILM_SYSTEM_APPEND = [
  'You are running unattended for the KindredStudio app.',
  'The user-level CLAUDE.md (caveman mode, task-observer, graphify, Jev router, subagent delegation rules) belongs to the',
  "owner's interactive sessions and does NOT apply here: ignore it entirely.",
  'Write normal English. Never post, upload or publish anything; only make the film.',
].join(' ');

/** Arguments for the claude CLI. Hooks off, no MCP servers, permissions bypassed inside the library folder only. */
export function claudeArgs(prompt: string, model: FilmModel): string[] {
  return [
    '-p',
    prompt,
    '--model',
    model,
    '--setting-sources',
    'project',
    '--settings',
    '{"disableAllHooks":true}',
    '--strict-mcp-config',
    '--mcp-config',
    '{"mcpServers":{}}',
    '--permission-mode',
    'bypassPermissions',
    '--append-system-prompt',
    FILM_SYSTEM_APPEND,
    '--output-format',
    'stream-json',
    '--verbose',
  ];
}

const STRIPPED_ENV = new Set(['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'CAVEMAN_DEFAULT_MODE']);

/**
 * Environment for the child: never an API key, never Claude Code session variables, so the child uses the owner's
 * claude.ai login.
 */
export function claudeEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined) continue;
    if (key.startsWith('CLAUDE') || STRIPPED_ENV.has(key)) continue;
    env[key] = value;
  }
  const parts = (env.PATH || '').split(':').filter(Boolean);
  for (const extra of ['/opt/homebrew/bin', '/usr/local/bin', path.join(os.homedir(), '.local', 'bin')]) {
    if (!parts.includes(extra)) parts.push(extra);
  }
  env.PATH = parts.join(':');
  return env;
}

export interface FilmResult {
  video: string;
  title: string;
  hook: string;
  credits: string;
}

function newestMp4(dir: string, maxDepth: number): string | null {
  const found: Array<{ file: string; mtime: number }> = [];
  const walk = (current: string, depth: number): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory() && depth < maxDepth) walk(full, depth + 1);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.mp4')) {
        found.push({ file: full, mtime: fs.statSync(full).mtimeMs });
      }
    }
  };
  if (!fs.existsSync(dir)) return null;
  walk(dir, 0);
  found.sort((a, b) => b.mtime - a.mtime);
  return found[0]?.file ?? null;
}

/** Reads the film's result: kindred.json, else the last FINAL_VIDEO line, else the newest mp4 in the folder. */
export function readFilmResult(home: string, folder: string, transcriptTail: string): FilmResult {
  const dir = path.resolve(home, 'films', folder);
  let video: string | null = null;
  let title = '';
  let hook = '';
  let credits = '';

  const kindredFile = path.join(dir, 'kindred.json');
  if (fs.existsSync(kindredFile)) {
    try {
      const json = JSON.parse(fs.readFileSync(kindredFile, 'utf8'));
      if (json && typeof json === 'object') {
        if (typeof json.video === 'string' && json.video.trim()) video = json.video.trim();
        if (typeof json.title === 'string') title = json.title;
        if (typeof json.hook === 'string') hook = json.hook;
        if (typeof json.credits === 'string') credits = json.credits;
      }
    } catch {
      // unparsable: fall through to the other ways of finding the file
    }
  }

  if (!video) {
    const finals = [...transcriptTail.matchAll(/FINAL_VIDEO:\s*(.+)$/gm)];
    if (finals.length) video = finals[finals.length - 1][1].trim();
  }
  if (!video) video = newestMp4(dir, 3);

  const resolved = video ? path.resolve(video) : '';
  const inside = resolved.startsWith(dir + path.sep);
  if (!video || !path.isAbsolute(video) || !resolved.endsWith('.mp4') || !inside || !fs.existsSync(resolved)) {
    throw new Error('Claude finished but no film file was found.');
  }

  return {
    video: resolved,
    title: (title.trim() || 'Claude film').slice(0, 80),
    hook: hook.trim(),
    credits: credits.trim(),
  };
}

function oneLine(text: string, max: number): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Turns one stream-json line from the claude CLI into a short status, or null when there is nothing to show. */
export function describeClaudeLine(line: string): string | null {
  let obj: any;
  try {
    obj = JSON.parse(line);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;

  if (obj.type === 'assistant' && Array.isArray(obj.message?.content)) {
    const content: any[] = obj.message.content;
    const tool = content.find((c) => c && c.type === 'tool_use');
    if (tool) {
      const input = tool.input || {};
      const short = oneLine(String(input.command || input.file_path || input.description || ''), 120);
      return `${tool.name}: ${short}`;
    }
    const text = content.find((c) => c && c.type === 'text' && typeof c.text === 'string');
    if (text) {
      const short = oneLine(text.text, 200);
      return short || null;
    }
    return null;
  }

  if (obj.type === 'result' && obj.is_error === true) {
    return `Error: ${oneLine(String(obj.result ?? ''), 200)}`;
  }
  return null;
}

/**
 * Production steps of a lemo-opuscar film, in order, with the share of the work done once each starts. Claude spends
 * most of the time planning, writing code and reviewing stills; the frame render itself takes seconds.
 */
export const FILM_STAGES = [
  { label: 'Starting Claude', percent: 0 },
  { label: 'Reading the style guides', percent: 5 },
  { label: 'Planning the story', percent: 15 },
  { label: 'Writing the animation', percent: 30 },
  { label: 'Checking still frames', percent: 50 },
  { label: 'Recording the narration', percent: 65 },
  { label: 'Writing the music', percent: 75 },
  { label: 'Rendering the video', percent: 85 },
  { label: 'Mixing the final video', percent: 95 },
  { label: 'Saving the film', percent: 99 },
] as const;

// Steps shown by a Bash command Claude runs (a library tool), checked from the last step back.
const RUN_RULES: Array<[number, RegExp]> = [
  [9, /kindred\.json/],
  [8, /mux\.sh/],
  [7, /render\/video\.mjs/],
  [6, /mix\.py|sampler\.py|pluck\.py/],
  [5, /tts(_zh)?\.py|asr_check\.py/],
  [4, /still\.mjs|readcheck\.mjs/],
];

// Steps shown by a file Claude reads or writes.
function fileStage(tool: string, file: string): number {
  if (!file) return 0;
  if (/kindred\.json$/.test(file) && tool === 'Write') return 9;
  if (/TREATMENT\.md$/.test(file)) return tool === 'Read' ? 0 : 2;
  if (/\/films\//.test(file) && (tool === 'Write' || tool === 'Edit' || tool === 'MultiEdit')) return 3;
  if (/(AGENTS|DIRECTOR|TECHNIQUE|STYLE)\.md$/.test(file)) return 1;
  return 0;
}

/**
 * The production step one stream-json line shows (a library tool Claude runs, or a file it writes), never earlier than
 * `current`: Claude goes back to fix things, but the bar only moves forward.
 */
export function filmStageFromLine(line: string, current: number): number {
  let obj: any;
  try {
    obj = JSON.parse(line);
  } catch {
    return current;
  }
  if (obj?.type !== 'assistant' || !Array.isArray(obj.message?.content)) return current;
  let stage = current;
  for (const c of obj.message.content) {
    if (!c || c.type !== 'tool_use') continue;
    const input = c.input || {};
    if (c.name === 'Bash') {
      const cmd = String(input.command || '');
      const hit = RUN_RULES.find(([, re]) => re.test(cmd));
      if (hit) stage = Math.max(stage, hit[0]);
    } else {
      stage = Math.max(stage, fileStage(String(c.name), String(input.file_path || '')));
    }
  }
  return stage;
}

/** True when the CLI output says the Claude plan's usage or rate limit was hit. */
export function isUsageLimitMessage(text: string): boolean {
  return /rate limit|usage limit|limit reached|credit balance|out of (extra )?usage/i.test(text);
}

// Process runner. Tests replace it with setSpawner so claude is never started.
export type Spawner = (cmd: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }) => ChildProcess;

let spawner: Spawner | null = null;

export function setSpawner(fn: Spawner | null): void {
  spawner = fn;
}

const realSpawner: Spawner = (cmd, args, opts) =>
  spawn(cmd, args, { cwd: opts.cwd, env: opts.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });

export interface FilmStatus {
  state: 'idle' | 'running' | 'done' | 'error' | 'cancelled';
  channelId: number | null;
  style: string;
  topic: string;
  model: FilmModel | null;
  startedAt: string | null;
  finishedAt: string | null;
  /** Latest describeClaudeLine output, or the final message. */
  message: string;
  /** The last 200 status lines. */
  log: string[];
  /** Set when the video row exists. */
  jobId: string | null;
  /** Index into FILM_STAGES; only moves forward. */
  stage: number;
  stageLabel: string;
  /** 0-100, from the stage reached (100 when done). */
  percent: number;
}

function idleStatus(): FilmStatus {
  return {
    state: 'idle',
    channelId: null,
    style: '',
    topic: '',
    model: null,
    startedAt: null,
    finishedAt: null,
    message: '',
    log: [],
    jobId: null,
    stage: 0,
    stageLabel: FILM_STAGES[0].label,
    percent: 0,
  };
}

let status: FilmStatus = idleStatus();
let child: ChildProcess | null = null;
let cancelRequested = false;

export function getFilmStatus(): FilmStatus {
  return { ...status, log: [...status.log] };
}

/** True when the lemo-opuscar styles folder exists and the library's dependencies were installed. */
export function libraryInstalled(home: string = OPUSCAR_HOME): boolean {
  return (
    fs.existsSync(path.join(home, 'styles')) &&
    (fs.existsSync(path.join(home, 'node_modules', '.lemo-ok')) || fs.existsSync(path.join(home, '.venv', 'bin', 'python')))
  );
}

function pushLog(line: string): void {
  status.log = [...status.log, line].slice(-200);
}

function killGroup(proc: ChildProcess, signal: NodeJS.Signals): void {
  if (!proc.pid) {
    // No process group (a test double): signal the child itself, never a group id.
    try {
      proc.kill(signal);
    } catch {
      // already gone
    }
    return;
  }
  try {
    process.kill(-proc.pid, signal);
  } catch {
    try {
      proc.kill(signal);
    } catch {
      // already gone
    }
  }
}

function findFfmpeg(): string {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  return ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'].find((p) => fs.existsSync(p)) || 'ffmpeg';
}

async function makeCover(videoPath: string, jobId: string): Promise<string | null> {
  const out = path.join(THUMBNAILS_DIR, `${jobId}.jpg`);
  try {
    await execFileAsync(findFfmpeg(), ['-y', '-ss', '1', '-i', videoPath, '-frames:v', '1', '-q:v', '3', out]);
    return fs.existsSync(out) ? out : null;
  } catch {
    return null;
  }
}

/** Copies the finished film into the Videos folder and adds it as a job for the Videos page. */
export async function finishFilm(jobId: string, req: FilmRequest, result: FilmResult): Promise<void> {
  const channel = getChannel(req.channelId);
  if (!channel) throw new Error('The channel for this film no longer exists.');

  fs.mkdirSync(VIDEOS_DIR, { recursive: true });
  fs.mkdirSync(THUMBNAILS_DIR, { recursive: true });
  const videoPath = path.join(VIDEOS_DIR, `${jobId}.mp4`);
  fs.copyFileSync(result.video, videoPath);

  const thumb = await makeCover(videoPath, jobId);
  const duration = await mediaDuration(videoPath).catch(() => null);
  const hook = result.hook + (result.credits ? `\n\n${result.credits}` : '');

  db.prepare(
    `INSERT INTO jobs (id, channel_id, concept_title, format, age_band, hook, hypothesis, script_text, shot_briefs_json,
       captions_json, state, video_path, thumbnail_path, duration_seconds, is_ai_generated, is_demo_job, created_at, updated_at)
     VALUES (?, ?, ?, 'claude_film', 'all', ?, '', ?, '[]', '[]', 'ready_to_publish', ?, ?, ?, 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
  ).run(
    jobId,
    req.channelId,
    result.title,
    hook,
    `Claude film (${req.style}): ${req.topic}`,
    videoPath,
    thumb,
    duration,
  );

  // inspectJob sets held_for_review itself when it must; its result is not overridden here.
  await inspectJob(jobId, {
    title: result.title,
    hook: result.hook,
    prompt: req.topic,
    videoPath,
    coverPath: thumb,
    holdOnFlags: Boolean(channel.hold_flagged_videos),
  });

  status.jobId = jobId;
}

/** Starts one film. Refused while another runs, when the library is not installed, or when the channel is unknown. */
export function startFilm(req: FilmRequest): { started: boolean; reason?: string } {
  if (status.state === 'running' || child) return { started: false, reason: 'A film is already being made.' };
  if (!libraryInstalled()) return { started: false, reason: 'The lemo-opuscar library is not installed yet.' };
  if (!getChannel(req.channelId)) return { started: false, reason: 'That channel does not exist.' };

  const style = listStyles().find((s) => s.slug === req.style);
  if (!style) return { started: false, reason: 'That film style does not exist.' };

  const jobId = `film_${Date.now()}`;
  const folder = filmFolderName(jobId);
  const prompt = buildFilmPrompt(req, style, folder);

  status = {
    ...idleStatus(),
    state: 'running',
    channelId: req.channelId,
    style: req.style,
    topic: req.topic,
    model: req.model,
    startedAt: new Date().toISOString(),
    message: 'Starting Claude...',
  };
  cancelRequested = false;

  fs.mkdirSync(LOGS_DIR, { recursive: true });
  const logFile = path.join(LOGS_DIR, `claude_film_${jobId}.log`);
  const appendRaw = (line: string) => {
    try {
      fs.appendFileSync(logFile, line + '\n');
    } catch {
      // logging must never break the film
    }
  };

  const proc = (spawner ?? realSpawner)(CLAUDE_BIN, claudeArgs(prompt, req.model), { cwd: OPUSCAR_HOME, env: claudeEnv() });
  child = proc;

  let tail = '';
  let timedOut = false;
  let settled = false;

  const fail = (message: string) => {
    if (settled) return;
    settled = true;
    status.state = 'error';
    status.message = message;
    status.finishedAt = new Date().toISOString();
  };

  const timer = setTimeout(() => {
    timedOut = true;
    fail('Stopped: the film took longer than 2 hours.');
    killGroup(proc, 'SIGTERM');
  }, FILM_TIME_LIMIT_MS);

  if (proc.stdout) {
    readline.createInterface({ input: proc.stdout }).on('line', (line) => {
      appendRaw(line);
      tail = (tail + line + '\n').slice(-65536);
      const stage = filmStageFromLine(line, status.stage);
      if (stage !== status.stage) {
        status.stage = stage;
        status.stageLabel = FILM_STAGES[stage].label;
        status.percent = FILM_STAGES[stage].percent;
      }
      const described = describeClaudeLine(line);
      if (described) {
        pushLog(described);
        status.message = described;
      }
    });
  }
  if (proc.stderr) {
    readline.createInterface({ input: proc.stderr }).on('line', (line) => {
      appendRaw(`stderr: ${line}`);
      pushLog(`stderr: ${oneLine(line, 200)}`);
    });
  }

  proc.on('error', (err) => {
    clearTimeout(timer);
    child = null;
    appendRaw(`spawn error: ${err.message}`);
    fail(`Could not start Claude: ${err.message}`);
  });

  proc.on('close', (code) => {
    clearTimeout(timer);
    child = null;
    if (timedOut || settled) return;
    if (cancelRequested) {
      settled = true;
      status.state = 'cancelled';
      status.message = 'Film stopped.';
      status.finishedAt = new Date().toISOString();
      return;
    }
    if (code !== 0) {
      const message = isUsageLimitMessage(tail)
        ? 'Claude usage limit reached. Try again later or switch the model.'
        : status.log[status.log.length - 1] || `Claude stopped with exit code ${code}.`;
      fail(message);
      return;
    }
    void (async () => {
      try {
        const result = readFilmResult(OPUSCAR_HOME, folder, tail);
        await finishFilm(jobId, req, result);
        if (settled) return;
        settled = true;
        status.state = 'done';
        status.percent = 100;
        status.stageLabel = 'Finished';
        status.message = `Film ready: ${result.title}`;
        status.finishedAt = new Date().toISOString();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        fail(isUsageLimitMessage(tail) ? 'Claude usage limit reached. Try again later or switch the model.' : message);
      }
    })();
  });

  return { started: true };
}

/** Stops the film: SIGTERM to the whole process group, SIGKILL after 5 s if it is still alive. */
export function stopFilm(): { success: boolean; message: string } {
  const proc = child;
  if (!proc || status.state !== 'running') return { success: false, message: 'No film is being made.' };
  cancelRequested = true;
  status.message = 'Stopping the film...';
  killGroup(proc, 'SIGTERM');
  const killer = setTimeout(() => {
    if (child === proc) killGroup(proc, 'SIGKILL');
  }, 5000);
  killer.unref();
  return { success: true, message: 'Stopping the film.' };
}
