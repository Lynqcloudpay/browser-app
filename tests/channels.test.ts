import { cleanup } from './helpers/env';
import fs from 'fs';
import assert from 'assert';

import { initDatabase } from '../server/db/database';
import {
  listChannels,
  getChannel,
  createChannel,
  updateChannel,
  deleteChannel,
  channelDir,
} from '../server/engine/channels';
import {
  channelLabel,
  buildChannelPlist,
  pickDueSlot,
} from '../server/engine/dailySchedule';

function runChannelsTests(): void {
  console.log('--- RUNNING CHANNELS UNIT TESTS ---');

  // 1. Initialize database (creates tables & seeds Channel 1)
  initDatabase();
  const initialChannels = listChannels();
  assert(initialChannels.length >= 1, 'Channel 1 must be seeded');
  const ch1 = getChannel(1);
  assert(ch1 !== null, 'Channel 1 must exist');
  assert.strictEqual(ch1?.id, 1);
  console.log('ok Channel 1 seeded successfully: ' + ch1?.name);

  // 2. Create Channel 2
  const ch2 = createChannel('Pip The Curious Fox');
  assert.strictEqual(ch2.name, 'Pip The Curious Fox');
  assert(ch2.id > 1, 'Channel 2 ID must be > 1');
  assert(fs.existsSync(channelDir(ch2.id)), 'Channel 2 directory must be created');
  console.log(`ok Created Channel ${ch2.id}: ${ch2.name}`);

  // 3. Update Channel 2
  const updated = updateChannel(ch2.id, {
    chatgpt_chat_url: 'https://chatgpt.com/c/test-pip',
    grok_resolution: '480p',
    grok_duration: 10,
    hashtag_hint: '#PipTheFox',
    schedule_enabled: true,
    schedule_times: ['09:00', '15:30'],
  });
  assert.strictEqual(updated.chatgpt_chat_url, 'https://chatgpt.com/c/test-pip');
  assert.strictEqual(updated.grok_resolution, '480p');
  assert.strictEqual(updated.grok_duration, 10);
  assert.strictEqual(updated.hashtag_hint, '#PipTheFox');
  assert.strictEqual(updated.schedule_enabled, true);
  assert.deepStrictEqual(updated.schedule_times, ['09:00', '15:30']);
  console.log('ok Updated Channel 2 fields verified');

  // 4. Plist generation for Channel 2
  const plist = buildChannelPlist(ch2.id, updated.schedule_times);
  assert(plist.includes(`<string>${channelLabel(ch2.id)}</string>`), 'Plist must contain channel label');
  assert(plist.includes('<string>--channel</string>'), 'Plist must pass --channel arg');
  assert(plist.includes(`<string>${ch2.id}</string>`), 'Plist must pass channel ID');
  assert(plist.includes('<integer>9</integer>'), 'Plist must schedule 9:00');
  assert(plist.includes('<integer>15</integer>'), 'Plist must schedule 15:30');
  console.log('ok Plist XML generation for Channel 2 verified');

  // 5. Time slot logic
  const slotTest = pickDueSlot(['09:00', '15:30'], ['09:00'], new Date('2026-01-01T16:00:00'));
  assert.strictEqual(slotTest.slot, '15:30', 'Next due open slot should be 15:30');
  console.log('ok Slot picking logic verified');

  // 6. Delete Channel 2
  deleteChannel(ch2.id);
  assert.strictEqual(getChannel(ch2.id), null, 'Channel 2 must be deleted from DB');
  console.log(`ok Deleted Channel ${ch2.id} and archived folder`);

  console.log('--- ALL CHANNELS TESTS PASSED ---');
}

try {
  runChannelsTests();
  cleanup();
  process.exit(0);
} catch (err) {
  console.error('Channels test failed:', err);
  cleanup();
  process.exit(1);
}
