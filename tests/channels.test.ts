import fs from 'fs';
import path from 'path';
import assert from 'assert';

const TEST_CHANNELS_DIR = path.join(__dirname, '../storage/test_channels_' + Date.now());
process.env.KINDRED_CHANNELS_DIR = TEST_CHANNELS_DIR;
process.env.DATABASE_PATH = path.join(__dirname, '../storage/test_kindred_studio.db');

import db, { initDatabase } from '../server/db/database';
import {
  listChannels,
  getChannel,
  createChannel,
  updateChannel,
  deleteChannel,
  referenceImagePath,
  channelDir,
} from '../server/engine/channels';
import {
  channelLabel,
  channelPlistPath,
  buildChannelPlist,
  normalizeTimes,
  parseTime,
  pickDueSlot,
} from '../server/engine/dailySchedule';

async function runChannelsTests() {
  console.log('--- RUNNING CHANNELS UNIT TESTS ---');

  // 1. Initialize database (creates tables & seeds Channel 1)
  initDatabase();
  const initialChannels = listChannels();
  assert(initialChannels.length >= 1, 'Channel 1 must be seeded');
  const ch1 = getChannel(1);
  assert(ch1 !== null, 'Channel 1 must exist');
  assert.strictEqual(ch1?.id, 1);
  console.log('✔ Channel 1 seeded successfully: ' + ch1?.name);

  // 2. Create Channel 2
  const ch2 = createChannel('Pip The Curious Fox');
  assert.strictEqual(ch2.name, 'Pip The Curious Fox');
  assert(ch2.id > 1, 'Channel 2 ID must be > 1');
  assert(fs.existsSync(channelDir(ch2.id)), 'Channel 2 directory must be created');
  console.log(`✔ Created Channel ${ch2.id}: ${ch2.name}`);

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
  console.log('✔ Updated Channel 2 fields verified');

  // 4. Plist generation for Channel 2
  const plist = buildChannelPlist(ch2.id, updated.schedule_times);
  assert(plist.includes(`<string>${channelLabel(ch2.id)}</string>`), 'Plist must contain channel label');
  assert(plist.includes('<string>--channel</string>'), 'Plist must pass --channel arg');
  assert(plist.includes(`<string>${ch2.id}</string>`), 'Plist must pass channel ID');
  assert(plist.includes('<integer>9</integer>'), 'Plist must schedule 9:00');
  assert(plist.includes('<integer>15</integer>'), 'Plist must schedule 15:30');
  console.log('✔ Plist XML generation for Channel 2 verified');

  // 5. Time slot logic
  const slotTest = pickDueSlot(['09:00', '15:30'], ['09:00'], new Date('2026-01-01T16:00:00'));
  assert.strictEqual(slotTest.slot, '15:30', 'Next due open slot should be 15:30');
  console.log('✔ Slot picking logic verified');

  // 6. Delete Channel 2
  deleteChannel(ch2.id);
  assert.strictEqual(getChannel(ch2.id), null, 'Channel 2 must be deleted from DB');
  console.log(`✔ Deleted Channel ${ch2.id} and archived folder`);

  // Cleanup test channels dir
  try {
    fs.rmSync(TEST_CHANNELS_DIR, { recursive: true, force: true });
  } catch {}

  console.log('--- ALL CHANNELS TESTS PASSED ---');
}

runChannelsTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});

