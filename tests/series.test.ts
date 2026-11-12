import './helpers/env';
import assert from 'assert';

import {
  RANDOM_MAX_GAP,
  RANDOM_MIN_GAP,
  parseSeries,
  planEveryDay,
  planRandomDay,
  patternKey,
} from '../server/engine/seriesPlan';

const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};
const gapsOf = (times: string[]) => times.slice(1).map((t, i) => toMin(t) - toMin(times[i]));

// 1. Fixed steps
assert.deepStrictEqual(
  planEveryDay({ mode: 'every', everyMinutes: 120, start: '08:00', end: '22:00' }),
  ['08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00', '22:00'],
  'every 2 hours'
);
assert.deepStrictEqual(
  planEveryDay({ mode: 'every', everyMinutes: 60, start: '09:00', end: '11:30' }),
  ['09:00', '10:00', '11:00'],
  'every hour stops before the end when the next step is past it'
);
assert.strictEqual(
  planEveryDay({ mode: 'every', everyMinutes: 15, start: '07:00', end: '23:00' }).length,
  65,
  'every 15 minutes across a day'
);
console.log('ok fixed steps');

// 2. Input checks
assert.throws(() => parseSeries({ mode: 'every', everyMinutes: 30, start: '08:00', end: '20:00' }), /15 minutes, 1 hour or 2 hours/);
assert.throws(() => parseSeries({ mode: 'every', everyMinutes: 60, start: '20:00', end: '08:00' }), /after the start/);
assert.throws(() => parseSeries({ mode: 'random', start: '25:00', end: '26:00' }), /not a valid time/);
assert.deepStrictEqual(parseSeries({ mode: 'random', start: '8:05', end: '22:00' }), { mode: 'random', start: '08:05', end: '22:00' });
console.log('ok input checks');

// 3. Random chain with a fixed random source: gaps stay in range, never pass the end, times ascend
let seed = 7;
const rng = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
for (let i = 0; i < 50; i++) {
  const cfg = { mode: 'random' as const, start: '08:00', end: '22:00' };
  const { times } = planRandomDay(cfg, new Set(), rng);
  assert.strictEqual(times[0], '08:00', 'random day starts at the first video');
  assert.ok(toMin(times[times.length - 1]) <= toMin('22:00'), 'never past the end');
  for (const g of gapsOf(times)) {
    assert.ok(g >= RANDOM_MIN_GAP && g <= RANDOM_MAX_GAP, `gap ${g} out of range`);
  }
}
console.log('ok random gaps in range');

// 4. Never the same pattern: a used key is refused, and two equal gaps in a row are refused
{
  const cfg = { mode: 'random' as const, start: '08:00', end: '12:00' };
  const first = planRandomDay(cfg, new Set(), rng);
  const second = planRandomDay(cfg, new Set([first.key]), rng);
  assert.notStrictEqual(second.key, first.key, 'used pattern not returned again');
  const gaps = gapsOf(second.times);
  for (let i = 1; i < gaps.length; i++) assert.notStrictEqual(gaps[i], gaps[i - 1], 'no two equal gaps in a row');
}
console.log('ok no repeated pattern');

// 5. Many nights with real randomness and a growing history: every pattern is new
{
  const cfg = { mode: 'random' as const, start: '07:00', end: '23:00' };
  const used = new Set<string>();
  for (let night = 0; night < 400; night++) {
    const { times, key } = planRandomDay(cfg, used);
    assert.ok(!used.has(key), 'night pattern is new');
    assert.strictEqual(key, patternKey(times));
    used.add(key);
    for (const g of gapsOf(times)) assert.ok(g >= RANDOM_MIN_GAP && g <= RANDOM_MAX_GAP);
  }
  assert.strictEqual(used.size, 400);
}
console.log('ok 400 nights, all different');

// 6. A window too short to hold a second video cannot give a new pattern: say so, do not loop forever
assert.throws(
  () => planRandomDay({ mode: 'random', start: '08:00', end: '08:10' }, new Set(['08:00']), rng, 50),
  /Could not make a new random pattern/
);
console.log('ok short window refused');

// 7. launchd jobs never point launchd itself at the app folder (it may sit on an external drive launchd cannot
//    open: the job then dies with exit 78 and no log). Only node, inside the job, reads the app folder.
{
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { buildChannelPlist, buildPlanPlist } = require('../server/engine/dailySchedule');
  const { REPO_ROOT } = require('../server/paths');
  for (const xml of [buildChannelPlist(2, ['15:14']), buildPlanPlist(2)] as string[]) {
    const wd = /<key>WorkingDirectory<\/key><string>([^<]*)<\/string>/.exec(xml)![1];
    const out = /<key>StandardOutPath<\/key><string>([^<]*)<\/string>/.exec(xml)![1];
    assert.ok(!wd.startsWith(REPO_ROOT), 'working directory outside the app folder');
    assert.ok(!out.startsWith(REPO_ROOT) && out.includes('Library/Logs/KindredStudio'), 'log outside the app folder');
    assert.ok(xml.includes('<string>-e</string>'), 'inline launcher checks access first');
  }
}
console.log('ok launchd jobs keep their own files off the app drive');

console.log('--- ALL SERIES TESTS PASSED ---');
