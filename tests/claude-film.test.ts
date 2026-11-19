import { TEST_STORAGE, cleanup } from './helpers/env';
import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { AddressInfo } from 'net';

import { initDatabase, db } from '../server/db/database';
import { VIDEOS_DIR } from '../server/paths';
import { createChannel } from '../server/engine/channels';
import { shutdownAllAgents } from '../server/engine/agentRegistry';

/**
 * Claude films. The claude CLI is never started: startFilm gets a fake spawner (setSpawner). The film library folder
 * is a temp folder, set BEFORE claudeFilm is loaded (it reads KINDRED_OPUSCAR_HOME when it loads), so the owner's
 * ~/lemo-opuscar is never read.
 */

const OPUSCAR = fs.mkdtempSync(path.join(TEST_STORAGE, 'opuscar-'));
process.env.KINDRED_OPUSCAR_HOME = OPUSCAR;

// Loaded after the env line above, on purpose.
const film = require('../server/engine/claudeFilm') as typeof import('../server/engine/claudeFilm');
const { createApp } = require('../server/index') as typeof import('../server/index');

function fakeMp4(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const buf = Buffer.alloc(300_000);
  buf.write('ftyp', 4, 'ascii');
  fs.writeFileSync(file, buf);
}

function writeStyle(slug: string, json: string): void {
  const dir = path.join(OPUSCAR, 'styles', slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'style.json'), json);
}

/**
 * A fake child process: prints the given lines, runs beforeClose (writes files), then closes with the exit code once
 * its stdout has been read to the end, as a real child does. kill() closes it with a null code (a stop).
 */
function fakeChild(lines: string[], code: number, beforeClose?: (folder: string) => void, folder = ''): any {
  const ee: any = new EventEmitter();
  ee.stdout = new PassThrough();
  ee.stderr = new PassThrough();
  ee.pid = undefined; // no real process group: stopFilm signals this double only
  let closed = false;
  const finish = (exitCode: number | null) => {
    if (closed) return;
    closed = true;
    ee.emit('close', exitCode);
  };
  ee.kill = () => {
    setImmediate(() => {
      ee.stdout.end();
      ee.stderr.end();
      setTimeout(() => finish(null), 20);
    });
    return true;
  };
  setImmediate(() => {
    ee.stdout.once('end', () => setImmediate(() => finish(code)));
    for (const line of lines) ee.stdout.write(line + '\n');
    ee.stdout.end();
    ee.stderr.end();
    if (beforeClose) beforeClose(folder);
  });
  return ee;
}

function folderOf(args: string[]): string {
  const prompt = args[args.indexOf('-p') + 1];
  const match = /films\/(kindred-[a-z0-9-]+)\//.exec(prompt);
  return match ? match[1] : '';
}

async function waitUntilDone(timeoutMs = 5000): Promise<any> {
  const started = Date.now();
  for (;;) {
    const status = film.getFilmStatus();
    if (status.state !== 'running') return status;
    if (Date.now() - started > timeoutMs) throw new Error('film did not finish in time');
    await new Promise((r) => setTimeout(r, 25));
  }
}

async function main(): Promise<void> {
  console.log('--- RUNNING CLAUDE FILM TESTS ---');
  initDatabase();

  // 1. listStyles
  writeStyle('alpha-style', JSON.stringify({ en: 'Alpha', category_en: 'Calm', line: 'A calm one', uses: ['x'] }));
  writeStyle('beta-style', JSON.stringify({ en: 'Beta', category_en: 'Loud', line: 'Needs pictures', needs: ['image'] }));
  writeStyle('_template', JSON.stringify({ en: 'Template' }));
  writeStyle('broken', '{ not json');
  const styles = film.listStyles(OPUSCAR);
  assert.deepStrictEqual(
    styles.map((s) => [s.slug, s.name, s.category, s.needsImages]),
    [
      ['alpha-style', 'Alpha', 'Calm', false],
      ['beta-style', 'Beta', 'Loud', true],
    ],
    'only usable styles, sorted by name'
  );
  assert.deepStrictEqual(film.listStyles(path.join(OPUSCAR, 'missing')), [], 'missing styles folder gives []');
  console.log('ok listStyles');

  // 2. validateFilmRequest
  const channel = createChannel('Film Test Channel');
  const good = { channelId: channel.id, style: 'alpha-style', topic: '  a bunny learns to share  ', seconds: 30 };
  const valid = film.validateFilmRequest(good, styles);
  assert.deepStrictEqual(valid, { channelId: channel.id, style: 'alpha-style', topic: 'a bunny learns to share', seconds: 30, model: 'sonnet' }, 'valid request, default sonnet');
  assert.strictEqual(film.validateFilmRequest({ ...good, model: 'opus' }, styles).model, 'opus');
  const refusals: Array<[any, RegExp]> = [
    [{ ...good, channelId: 0 }, /channel/i],
    [{ ...good, channelId: 'abc' }, /channel/i],
    [{ ...good, style: 'nope' }, /style/i],
    [{ ...good, style: 'beta-style' }, /image generator/],
    [{ ...good, topic: '   ' }, /about/i],
    [{ ...good, topic: 'x'.repeat(501) }, /500/],
    [{ ...good, seconds: 9 }, /10 to 90/],
    [{ ...good, seconds: 91 }, /10 to 90/],
    [{ ...good, seconds: 30.5 }, /10 to 90/],
    [{ ...good, model: 'gpt' }, /sonnet or opus/],
  ];
  for (const [body, pattern] of refusals) {
    assert.throws(() => film.validateFilmRequest(body, styles), pattern, JSON.stringify(body).slice(0, 80));
  }
  console.log('ok validateFilmRequest');

  // 3. buildFilmPrompt
  const folder = film.filmFolderName('film_123');
  assert.strictEqual(folder, 'kindred-film123', 'folder name keeps only a-z, 0-9, dash');
  const prompt = film.buildFilmPrompt(valid, styles[0], folder);
  for (const must of ['1080x1920', folder, 'AskUserQuestion', 'kindred.json', 'a bunny learns to share', 'FINAL_VIDEO']) {
    assert.ok(prompt.includes(must), `prompt contains ${must}`);
  }
  console.log('ok buildFilmPrompt');

  // 4. claudeArgs
  const args = film.claudeArgs('hello', 'sonnet');
  for (const must of ['--setting-sources', 'project', 'bypassPermissions']) {
    assert.ok(args.includes(must), `args contain ${must}`);
  }
  assert.ok(args.some((a) => a.includes('disableAllHooks')), 'hooks switched off in --settings');
  assert.ok(!args.includes('--dangerously-skip-permissions'), 'never the dangerous flag');
  assert.strictEqual(args[args.indexOf('--model') + 1], 'sonnet');
  console.log('ok claudeArgs');

  // 5. claudeEnv
  const env = film.claudeEnv({
    HOME: '/Users/x',
    PATH: '/usr/bin',
    CLAUDECODE: '1',
    CLAUDE_CODE_ENTRYPOINT: 'cli',
    ANTHROPIC_API_KEY: 'k',
    ANTHROPIC_BASE_URL: 'u',
    CAVEMAN_DEFAULT_MODE: 'ultra',
  } as NodeJS.ProcessEnv);
  for (const gone of ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'CAVEMAN_DEFAULT_MODE']) {
    assert.strictEqual(env[gone], undefined, `${gone} stripped`);
  }
  assert.strictEqual(env.HOME, '/Users/x', 'HOME kept');
  assert.ok(String(env.PATH).includes('/opt/homebrew/bin'), 'PATH gets homebrew');
  console.log('ok claudeEnv');

  // 6. readFilmResult
  const filmsDir = path.join(OPUSCAR, 'films');
  const f1 = 'kindred-one';
  fakeMp4(path.join(filmsDir, f1, 'out', 'final.mp4'));
  fs.writeFileSync(
    path.join(filmsDir, f1, 'kindred.json'),
    JSON.stringify({ video: path.join(filmsDir, f1, 'out', 'final.mp4'), title: 'A'.repeat(90), hook: 'Hi', credits: 'Song by X' })
  );
  const r1 = film.readFilmResult(OPUSCAR, f1, '');
  assert.strictEqual(r1.title.length, 80, 'title trimmed to 80');
  assert.strictEqual(r1.hook, 'Hi');
  assert.strictEqual(r1.credits, 'Song by X');

  const f2 = 'kindred-two';
  fakeMp4(path.join(filmsDir, f2, 'render.mp4'));
  const r2 = film.readFilmResult(OPUSCAR, f2, `working...\nFINAL_VIDEO: ${path.join(filmsDir, f2, 'render.mp4')}\n`);
  assert.strictEqual(r2.video, path.join(filmsDir, f2, 'render.mp4'), 'from FINAL_VIDEO line');
  assert.strictEqual(r2.title, 'Claude film', 'default title');

  const f3 = 'kindred-three';
  fakeMp4(path.join(filmsDir, f3, 'deep', 'old.mp4'));
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(path.join(filmsDir, f3, 'deep', 'old.mp4'), old, old);
  fakeMp4(path.join(filmsDir, f3, 'deep', 'newest.mp4'));
  assert.ok(film.readFilmResult(OPUSCAR, f3, '').video.endsWith('newest.mp4'), 'newest mp4 fallback');

  const f4 = 'kindred-four';
  fakeMp4(path.join(OPUSCAR, 'films', 'elsewhere.mp4'));
  fs.mkdirSync(path.join(filmsDir, f4), { recursive: true });
  fs.writeFileSync(path.join(filmsDir, f4, 'kindred.json'), JSON.stringify({ video: path.join(filmsDir, 'elsewhere.mp4') }));
  assert.throws(() => film.readFilmResult(OPUSCAR, f4, ''), /no film file was found/, 'outside the folder is refused');
  assert.throws(() => film.readFilmResult(OPUSCAR, 'kindred-none', ''), /no film file was found/, 'nothing found');
  console.log('ok readFilmResult');

  // 6b. Progress stages follow the tools Claude runs and the files it writes, and never move backwards.
  const tool = (name: string, input: object) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] } });
  let st = 0;
  st = film.filmStageFromLine(tool('Read', { file_path: '/x/lemo-opuscar/DIRECTOR.md' }), st);
  assert.strictEqual(st, 1);
  st = film.filmStageFromLine(tool('Write', { file_path: '/x/lemo-opuscar/films/f/TREATMENT.md' }), st);
  assert.strictEqual(st, 2);
  st = film.filmStageFromLine(tool('Write', { file_path: '/x/lemo-opuscar/films/f/mix.py' }), st);
  assert.strictEqual(st, 3, 'writing mix.py is still writing code, not music');
  st = film.filmStageFromLine(tool('Bash', { command: '.venv/bin/python core/tts/tts.py films/f/lines.json out' }), st);
  assert.strictEqual(st, 5);
  st = film.filmStageFromLine(tool('Bash', { command: 'node core/render/still.mjs films/f 1 2' }), st);
  assert.strictEqual(st, 5, 'going back to stills does not move the bar backwards');
  st = film.filmStageFromLine(tool('Bash', { command: 'node core/render/video.mjs films/f --size 1080x1920' }), st);
  assert.strictEqual(st, 7);
  st = film.filmStageFromLine(tool('Bash', { command: 'sh core/render/mux.sh v.mp4 mix.wav out.mp4' }), st);
  assert.strictEqual(st, 8);
  st = film.filmStageFromLine(tool('Write', { file_path: '/x/lemo-opuscar/films/f/kindred.json' }), st);
  assert.strictEqual(st, 9);
  assert.strictEqual(film.filmStageFromLine('not json', 4), 4);
  assert.strictEqual(film.FILM_STAGES[st].label, 'Saving the film');

  // 7. describeClaudeLine and isUsageLimitMessage
  assert.strictEqual(film.describeClaudeLine('{"type":"assistant","message":{"content":[{"type":"text","text":"Writing scene one."}]}}'), 'Writing scene one.');
  assert.strictEqual(
    film.describeClaudeLine('{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"node render.js --size 1080x1920"}}]}}'),
    'Bash: node render.js --size 1080x1920'
  );
  assert.strictEqual(
    film.describeClaudeLine('{"type":"result","is_error":true,"result":"API Error: Rate limit reached"}'),
    'Error: API Error: Rate limit reached'
  );
  assert.strictEqual(film.describeClaudeLine('{"type":"system","subtype":"init"}'), null);
  assert.strictEqual(film.describeClaudeLine('not json at all'), null);
  assert.ok(film.describeClaudeLine('{"type":"assistant","message":{"content":[{"type":"text","text":"' + 'w'.repeat(500) + '"}]}}')!.length <= 200);
  assert.ok(film.isUsageLimitMessage('Claude AI usage limit reached|123'));
  assert.ok(film.isUsageLimitMessage('You are out of extra usage'));
  assert.ok(!film.isUsageLimitMessage('The film is ready.'));
  console.log('ok describeClaudeLine and isUsageLimitMessage');

  // Library installed for the spawner tests
  fs.mkdirSync(path.join(OPUSCAR, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(OPUSCAR, 'node_modules', '.lemo-ok'), '');
  assert.strictEqual(film.libraryInstalled(OPUSCAR), true, 'library detected');

  // 8. startFilm with a fake spawner: a good run makes a job
  const seen: Array<{ cmd: string; args: string[]; cwd: string }> = [];
  film.setSpawner((cmd, args, opts) => {
    seen.push({ cmd, args, cwd: opts.cwd });
    const f = folderOf(args);
    return fakeChild(
      ['{"type":"system","subtype":"init"}', '{"type":"assistant","message":{"content":[{"type":"text","text":"Planning the film."}]}}'],
      0,
      () => {
        fakeMp4(path.join(OPUSCAR, 'films', f, 'final.mp4'));
        fs.writeFileSync(
          path.join(OPUSCAR, 'films', f, 'kindred.json'),
          JSON.stringify({ video: path.join(OPUSCAR, 'films', f, 'final.mp4'), title: 'Bunny Shares', hook: 'A bunny shares a carrot.', credits: '' })
        );
      },
      f
    );
  });
  const started = film.startFilm(valid);
  assert.deepStrictEqual(started, { started: true }, 'first film starts');
  assert.strictEqual(seen[0].cwd, OPUSCAR, 'runs inside the library folder');
  assert.strictEqual(seen[0].cmd, film.CLAUDE_BIN);
  const done = await waitUntilDone();
  assert.strictEqual(done.state, 'done', `state done (${done.message})`);
  assert.strictEqual(done.percent, 100, 'a finished film shows 100%');
  assert.strictEqual(done.message, 'Film ready: Bunny Shares');
  assert.ok(done.jobId, 'job id set');
  const job = db.prepare('SELECT format, state, video_path, channel_id FROM jobs WHERE id = ?').get(done.jobId) as any;
  assert.strictEqual(job.format, 'claude_film');
  assert.ok(['ready_to_publish', 'held_for_review'].includes(job.state), `state ${job.state}`);
  assert.ok(String(job.video_path).startsWith(VIDEOS_DIR), 'video copied into the Videos folder');
  assert.ok(fs.existsSync(job.video_path), 'copied file exists');
  assert.strictEqual(job.channel_id, channel.id);
  console.log('ok startFilm good run');

  // 9. usage limit run: an error state with a plain message
  film.setSpawner(() =>
    fakeChild(['{"type":"result","is_error":true,"result":"API Error: Rate limit reached"}'], 1)
  );
  assert.deepStrictEqual(film.startFilm(valid), { started: true }, 'second film starts');
  const limited = await waitUntilDone();
  assert.strictEqual(limited.state, 'error');
  assert.ok(/usage limit/i.test(limited.message), `usage limit message (${limited.message})`);
  console.log('ok startFilm usage limit');

  // 10. one at a time, and Stop cancels
  // a child that stays open until Stop (no lines, no exit)
  film.setSpawner(() => {
    const ee: any = new EventEmitter();
    ee.stdout = new PassThrough();
    ee.stderr = new PassThrough();
    ee.pid = undefined;
    ee.kill = () => {
      setImmediate(() => {
        ee.stdout.end();
        ee.stderr.end();
        setTimeout(() => ee.emit('close', null), 20);
      });
      return true;
    };
    return ee;
  });
  assert.deepStrictEqual(film.startFilm(valid), { started: true }, 'third film starts');
  const refused = film.startFilm(valid);
  assert.strictEqual(refused.started, false);
  assert.ok(/already/.test(refused.reason || ''), 'second start refused while running');
  assert.strictEqual(film.stopFilm().success, true, 'stop accepted');
  const stopped = await waitUntilDone();
  assert.strictEqual(stopped.state, 'cancelled', 'stop gives cancelled');
  assert.strictEqual(film.stopFilm().success, false, 'nothing to stop now');
  console.log('ok one at a time and stop');

  // 11. routes (no valid POST: the film never starts from here)
  film.setSpawner(null);
  const app = createApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const status = await fetch(`${base}/api/films/status`);
    assert.strictEqual(status.status, 200);
    const body: any = await status.json();
    assert.strictEqual(body.installed, true);
    assert.deepStrictEqual(body.models, ['sonnet', 'opus']);
    assert.ok(Array.isArray(body.styles) && body.styles.length === 2);
    assert.strictEqual(body.status.state, 'cancelled');
    const bad = await fetch(`${base}/api/films`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelId: 1, style: 'nope', topic: '', seconds: 5 }),
    });
    assert.strictEqual(bad.status, 400, 'bad body is 400');
    console.log('ok films routes');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await shutdownAllAgents();
  }

  console.log('--- ALL CLAUDE FILM TESTS PASSED ---');
}

main()
  .then(() => {
    cleanup();
    process.exit(0);
  })
  .catch((err) => {
    console.error('CLAUDE FILM TESTS FAILED:', err);
    cleanup();
    process.exit(1);
  });
