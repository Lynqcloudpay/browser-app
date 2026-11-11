import { TEST_STORAGE, cleanup } from './helpers/env';
import fs from 'fs';
import http from 'http';
import path from 'path';
import assert from 'assert';
import { AddressInfo } from 'net';

import { createApp } from '../server/index';
import { shutdownAllAgents } from '../server/engine/agentRegistry';

/** A minimal valid-looking PNG: the 8-byte signature followed by padding, over the 100-byte minimum. */
function tinyPng(): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, Buffer.alloc(200, 0)]);
}

/** Sends a request with an explicit Host header (fetch does not let us set Host). */
function rawGet(port: number, hostHeader: string, urlPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: urlPath, method: 'GET', headers: { Host: hostHeader } },
      (res) => {
        res.resume();
        resolve(res.statusCode || 0);
      }
    );
    req.on('error', reject);
    req.end();
  });
}

async function runApiTests(): Promise<void> {
  console.log('--- RUNNING API TESTS ---');
  const app = createApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;

  try {
    // System
    const health = await fetch(`${base}/api/health`);
    assert.strictEqual(health.status, 200);
    const healthBody: any = await health.json();
    assert.strictEqual(healthBody.ok, true);
    assert.strictEqual(healthBody.name, 'kindred-studio');
    console.log('ok /api/health');

    // Channels: list, create, patch, delete
    const list: any = await (await fetch(`${base}/api/channels`)).json();
    assert(list.channels.some((c: any) => c.id === 1), 'channel 1 must be listed');
    console.log('ok GET /api/channels lists channel 1');

    const created = await fetch(`${base}/api/channels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'API Test Channel' }),
    });
    assert.strictEqual(created.status, 201);
    const newChannel: any = await created.json();
    const newId = newChannel.id;
    console.log(`ok POST /api/channels created ${newId}`);

    const patched = await fetch(`${base}/api/channels/${newId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hashtag_hint: '#ApiTest' }),
    });
    assert.strictEqual(patched.status, 200);
    assert.strictEqual(((await patched.json()) as any).hashtag_hint, '#ApiTest');
    console.log('ok PATCH /api/channels/:id');

    const deleted = await fetch(`${base}/api/channels/${newId}`, { method: 'DELETE' });
    assert.strictEqual(deleted.status, 200);
    assert.deepStrictEqual(await deleted.json(), { success: true });
    console.log('ok DELETE /api/channels/:id');

    // Validation and 404s
    const notFound = await fetch(`${base}/api/channels/999`);
    assert.strictEqual(notFound.status, 404);
    assert.deepStrictEqual(await notFound.json(), { error: 'Channel not found' });
    console.log('ok unknown channel is 404');

    const badId = await fetch(`${base}/api/channels/abc`);
    assert.strictEqual(badId.status, 400);
    console.log('ok non-numeric channel id is 400');

    const unknownApi = await fetch(`${base}/api/nope`);
    assert.strictEqual(unknownApi.status, 404);
    const unknownBody: any = await unknownApi.json();
    assert(typeof unknownBody.error === 'string' && unknownBody.error.includes('/api/nope'));
    console.log('ok unknown /api path is JSON 404');

    // CORS and host guards
    const evil = await fetch(`${base}/api/health`, { headers: { Origin: 'https://evil.example' } });
    assert.strictEqual(evil.status, 403, 'cross-origin request must be refused');
    console.log('ok foreign Origin is refused');

    const local = await fetch(`${base}/api/health`, { headers: { Origin: 'http://localhost:5173' } });
    assert.strictEqual(local.status, 200);
    assert.strictEqual(local.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    console.log('ok local Origin is allowed');

    assert.strictEqual(await rawGet(port, 'evil.example', '/api/health'), 403, 'foreign Host must be refused');
    console.log('ok foreign Host is refused (DNS rebinding guard)');

    // Media: only generated outputs are served, never channel data
    fs.mkdirSync(path.join(TEST_STORAGE, 'channels', '1'), { recursive: true });
    fs.writeFileSync(path.join(TEST_STORAGE, 'channels', '1', 'browser_cookies.json'), '[{"name":"session"}]');
    const cookies = await fetch(`${base}/media/channels/1/browser_cookies.json`);
    assert(cookies.status !== 200, 'cookies must never be served');
    console.log(`ok /media/channels/... is refused (${cookies.status})`);

    fs.mkdirSync(path.join(TEST_STORAGE, 'videos'), { recursive: true });
    fs.writeFileSync(path.join(TEST_STORAGE, 'videos', 'clip.mp4'), 'video-bytes');
    const clip = await fetch(`${base}/media/videos/clip.mp4`);
    assert.strictEqual(clip.status, 200, 'videos must be served');
    console.log('ok /media/videos is served');

    // Reference image: magic bytes decide, not content-type
    const textUpload = await fetch(`${base}/api/channels/1/reference-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: 'this is plain text, not an image, and it is long enough to pass the size check',
    });
    assert.strictEqual(textUpload.status, 400);
    console.log('ok text body is rejected as a reference image');

    const pngUpload = await fetch(`${base}/api/channels/1/reference-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: new Uint8Array(tinyPng()),
    });
    assert.strictEqual(pngUpload.status, 200, 'a PNG must be accepted');
    console.log('ok PNG reference image is accepted');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await shutdownAllAgents();
  }

  console.log('--- ALL API TESTS PASSED ---');
}

runApiTests()
  .then(() => {
    cleanup();
    process.exit(0);
  })
  .catch((err) => {
    console.error('API test failed:', err);
    cleanup();
    process.exit(1);
  });
