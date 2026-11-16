import { cleanup } from './helpers/env';
import fs from 'fs';
import path from 'path';
import assert from 'assert';

import { channelDir, musicDir, musicTracks, pickMusicTrack } from '../server/engine/channels';

function run(): void {
  console.log('--- RUNNING MUSIC TRACK TESTS ---');
  const id = 9;
  const dir = musicDir(id);
  assert.strictEqual(dir, path.join(channelDir(id), 'music'), 'music folder lives under the channel');
  fs.mkdirSync(dir, { recursive: true });

  // Empty folder: no tracks, no pick
  assert.deepStrictEqual(musicTracks(id), [], 'empty folder has no tracks');
  assert.strictEqual(pickMusicTrack(id), null, 'empty folder picks nothing');

  // Two usable tracks and one non-audio file
  fs.writeFileSync(path.join(dir, 'a.mp3'), Buffer.alloc(100, 1));
  fs.writeFileSync(path.join(dir, 'b.mp3'), Buffer.alloc(100, 2));
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'credit: someone');
  const tracks = musicTracks(id).map((f) => path.basename(f));
  assert.deepStrictEqual(tracks, ['a.mp3', 'b.mp3'], 'only the audio files, sorted');

  // Rotation: never the same track twice in a row
  let prev: string | null = null;
  for (let i = 0; i < 6; i++) {
    const picked = pickMusicTrack(id);
    assert.ok(picked, 'a track is picked');
    const name = path.basename(picked as string);
    if (prev !== null) assert.notStrictEqual(name, prev, `pick ${i} differs from the previous pick`);
    prev = name;
  }
  console.log('ok music track folder and rotation');
  fs.rmSync(path.dirname(dir), { recursive: true, force: true });
  console.log('--- ALL MUSIC TRACK TESTS PASSED ---');
}

try {
  run();
  cleanup();
  process.exit(0);
} catch (err) {
  console.error(err);
  cleanup();
  process.exit(1);
}
