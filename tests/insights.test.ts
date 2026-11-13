import { cleanup } from './helpers/env';
import assert from 'assert';
import { AddressInfo } from 'net';

import { createApp } from '../server/index';
import { shutdownAllAgents } from '../server/engine/agentRegistry';
import db from '../server/db/database';
import {
  buildNextMessage,
  collectDue,
  computeHourWeights,
  isUsable,
  matchJob,
  nextInRotation,
  nextMessage,
  nextMessageForRun,
  weightedIndex,
  pickTrendForRun,
  trendScores,
  winnerTitles,
  parseCount,
  parseSmart,
  parseTikTokStudioPosts,
  parseTikTokTopics,
  parseTrendList,
  parseYouTubeStudioShorts,
  pickBestDay,
  researchQuestion,
  saveStats,
  saveTrends,
  tikTokSoundForRun,
  commentForRun,
  topVideos,
  writeInsightsState,
  DEFAULT_COMMENTS,
  realVideoUrl,
  repeatsEarlierIdea,
  retryMessage,
} from '../server/engine/insights';
import { pickTikTokLink } from '../server/engine/jevBrowserAutomation';

// Page text as Playwright's innerText reads it (copied from the real pages, shortened).
const TIKTOK_POSTS = [
  'Posts (Created on)', 'Privacy', 'Views', 'Likes', 'Comments', 'Actions',
  "This Baby Tapir's SNOOT DANCE Is Too Funny! 🍎🐾😂🔥 #MrApple #BabyTapir", 'Failed to publish', 'Retry', 'Everyone', '0', '0', '0', '00:06',
  'This Baby Donkey Just Went FULL YEEHAW MODE! 🍎🫏🤠😂🔥 #MrApple #BabyDonkey', 'Nov 12, 6:04 PM', 'Everyone', '1', '0', '0', '00:06',
  "This Baby Tapir's SNOOT DANCE Is Too Funny! 🍎🐾😂🔥 #MrApple #BabyTapir", 'Nov 12, 4:56 PM', 'Everyone', '1.2K', '35', '4', '00:06',
  'This Tiny Chinchilla Just Went LIGHTNING FAST! 🍎🐭⚡😂🔥 #MrApple', 'Nov 11, 2025, 8:35 PM', 'Only me', '2', '0', '0',
].join('\n');

const YOUTUBE_SHORTS = [
  'Channel content', 'Visibility', 'Date', 'Views', 'Comments',
  '0:07', 'This Smiling Baby Quokka Has CRAZY Dance Moves! 🍎🐾😂🔥', 'Add description', 'Comments disabled', 'Notifications disabled',
  'Public', 'Nov 12, 2026', 'Published', '4', '0',
  '0:16', 'Mr. Apple Got DESTROYED by a Dancing Platypus! 🍎🦆😂🔥', '#MrApple #BabyPlatypus #Shorts', 'Comments disabled', 'Notifications disabled',
  'Public', 'Nov 10, 2026', 'Published', '1,024', '0',
  '0:16', 'Mr. Apple Got DESTROYED by a Dancing Platypus! 🍎🦆😂🔥', '#MrApple #Shorts', 'Comments disabled', 'Notifications disabled', 'Draft', 'Edit draft',
].join('\n');

const TIKTOK_TOPICS = [
  'Trending', 'Recommended', 'Topics', 'Posts', 'Creators', 'All categories', 'Nature',
  'Topics', 'Views', 'Trend', 'Related posts',
  '1', 'Baby Capybara Spa Day', '227M', '9.3M', 'so relaxing #capybara', '7.8M',
  '2', 'LEGO Unveils 70cm Godzilla Set', '12M', '5.5M', 'the king of the monsters #lego', '1.8M',
  '3', 'Penguin Slide Challenge', '8.1M', '1.3M',
].join('\n');

async function run(): Promise<void> {
  console.log('--- RUNNING INSIGHTS TESTS ---');

  // 1. Counts and page parsers
  assert.strictEqual(parseCount('1.2K'), 1200);
  assert.strictEqual(parseCount('1,024'), 1024);
  assert.strictEqual(parseCount('12M'), 12_000_000);
  assert.ok(Number.isNaN(parseCount('Everyone')));

  const tt = parseTikTokStudioPosts(TIKTOK_POSTS);
  assert.strictEqual(tt.length, 3, 'failed post skipped, three posted rows');
  assert.deepStrictEqual(
    { title: tt[1].title.slice(0, 15), views: tt[1].views, likes: tt[1].likes, comments: tt[1].comments, hour: tt[1].hour },
    { title: "This Baby Tapir", views: 1200, likes: 35, comments: 4, hour: 16 }
  );
  assert.strictEqual(tt[0].hour, 18, '6:04 PM is hour 18');
  assert.strictEqual(tt[2].hour, 20, 'date with a year still parses');

  const yt = parseYouTubeStudioShorts(YOUTUBE_SHORTS);
  assert.strictEqual(yt.length, 2, 'draft skipped');
  assert.deepStrictEqual([yt[0].title.slice(0, 16), yt[0].views, yt[1].views], ['This Smiling Bab', 4, 1024]);

  const topics = parseTikTokTopics(TIKTOK_TOPICS);
  assert.deepStrictEqual(topics.map((t) => t.name), ['Baby Capybara Spa Day', 'LEGO Unveils 70cm Godzilla Set', 'Penguin Slide Challenge']);
  assert.strictEqual(topics[0].views, 227_000_000);
  console.log('ok page parsers');

  // Most viewed links: only real video links; TikTok Studio's page (stored by older runs) is never used
  assert.strictEqual(realVideoUrl('https://www.tiktok.com/@mel.j.rodriguez/video/7707407028305612046', 'tiktok'), 'https://www.tiktok.com/@mel.j.rodriguez/video/7707407028305612046');
  assert.strictEqual(realVideoUrl('https://www.tiktok.com/tiktokstudio/content', 'tiktok'), null);
  assert.strictEqual(realVideoUrl('https://youtube.com/shorts/xRHj2NWyds8?feature=share', 'youtube'), 'https://youtube.com/shorts/xRHj2NWyds8?feature=share');
  assert.strictEqual(realVideoUrl('https://youtu.be/pmihTFLE0qs', 'youtube'), 'https://youtu.be/pmihTFLE0qs');
  assert.strictEqual(realVideoUrl(null, 'youtube'), null);

  // Repeated ideas: the anteater video copied the tapir video's "SNOOT DANCE" (the real titles)
  const history = [
    "This Baby Tapir's SNOOT DANCE Is Too Funny! 🍎🐾😂🔥",
    'This Smiling Baby Quokka Has CRAZY Dance Moves! 🍎🐾😂🔥',
    'This Pink Baby Axolotl Just OUTDANCED Mr. Apple! 🍎🩷🫧😂',
    'This Chubby Baby Panda Just OUTDANCED Mr. Apple! 🍎🐼😂🔥',
    "This Tiny Hamster's CHEEK DANCE Is Absolutely INSANE! 🍎🐹😂🔥",
  ];
  assert.strictEqual(repeatsEarlierIdea("This Baby Anteater's SNOOT DANCE Is HILARIOUS! 🍎🐾😂🔥", history), history[0]);
  assert.strictEqual(repeatsEarlierIdea('This Tiny Pufferfish Just OUTDANCED Mr. Apple! 🍎🐡', history), null, 'the channel style (in 2+ titles) is allowed');
  assert.strictEqual(repeatsEarlierIdea('This Baby Penguin Slides Into a SNOWBALL FIGHT! 🍎🐧', history), null);
  assert.strictEqual(repeatsEarlierIdea('Mr. Apple & Friends Dance Battle', ['Mr. Apple & Friends Dance Battle']), 'Mr. Apple & Friends Dance Battle');
  assert.ok(retryMessage('A', 'B').startsWith('next.') && retryMessage('A', 'B').includes('"B"'));

  // TikTok link: the row of THIS post, never a failed row or another video's row
  const rows = [
    { href: 'https://www.tiktok.com/@me/video/111?x=1', text: "This Baby Tapir's SNOOT DANCE Is Too Funny! #MrApple\nFailed to publish\nRetry" },
    { href: 'https://www.tiktok.com/@me/video/222', text: "This Baby Anteater's SNOOT DANCE Is HILARIOUS! #MrApple\nNov 12, 8:37 PM" },
    { href: 'https://www.tiktok.com/@me/video/333', text: "This Baby Tapir's SNOOT DANCE Is Too Funny! #MrApple\nNov 12, 4:57 PM" },
  ];
  assert.strictEqual(pickTikTokLink(rows, "This Baby Anteater's SNOOT DANCE Is HILARIOUS!"), 'https://www.tiktok.com/@me/video/222');
  assert.strictEqual(pickTikTokLink(rows, "This Baby Tapir's SNOOT DANCE Is Too Funny!"), 'https://www.tiktok.com/@me/video/333', 'failed row skipped');
  assert.strictEqual(pickTikTokLink(rows, 'A video TikTok does not list yet'), null, 'never another video\'s link');
  assert.strictEqual(pickTikTokLink([{ href: 'https://www.tiktok.com/@me/video/9', text: '' }], 'Anything'), 'https://www.tiktok.com/@me/video/9', 'confirmation page link');
  console.log('ok repeated ideas and TikTok link');

  // 2. ChatGPT research answer
  const q = researchQuestion('Mr. Apple', ['This Baby Tapir Dances']);
  assert.ok(q.includes('TRENDLIST') && q.includes('Mr. Apple'));
  const answer = `${q}\nTRENDLIST\n- Capybara spa: calm, cute animal trend\n- **Penguin slide challenge** — kids copy it\n2. Holiday sweater dance: seasonal\nENDLIST\nSources`;
  assert.deepStrictEqual(parseTrendList(answer).map((t) => t.name), ['Capybara spa', 'Penguin slide challenge', 'Holiday sweater dance']);
  assert.deepStrictEqual(parseTrendList(q), [], 'the question alone is not an answer');
  // As the page text really reads: no bullets, a source tag under each line.
  const rendered = `${q}\nTRENDLIST\n\nFunny Animal Reactions: Animal comedy Shorts are attracting millions of daily views.\nVeedio\n\n` +
    `Deck the Halls Christmas Dance: Trending holiday choreography for a dancing reindeer.\nPostdom\n+1\n\n` +
    `Can I Ride Dance Challenge: Rapidly rising TikTok dance format.\nViralRemix\n\nENDLIST\n\nChatGPT can make mistakes.`;
  assert.deepStrictEqual(parseTrendList(rendered).map((t) => t.name), ['Funny Animal Reactions', 'Deck the Halls Christmas Dance', 'Can I Ride Dance Challenge']);
  console.log('ok ChatGPT trend list');

  // 3. Pure decisions
  assert.ok(isUsable({ kid_safe: 0.9, fits: 0.8 }));
  assert.ok(!isUsable({ kid_safe: 0.5, fits: 0.9 }), 'not clearly safe: never used');
  assert.ok(!isUsable({ kid_safe: null, fits: null }), 'unjudged (no Jev): never used');
  assert.strictEqual(buildNextMessage(null), 'next');
  const msg = buildNextMessage({ name: 'Capybara spa', detail: 'calm and cute' });
  assert.ok(msg.startsWith('next.') && msg.includes('"Capybara spa" (calm and cute)'));
  assert.ok(msg.length < 260, 'short: it is typed into ChatGPT');
  assert.strictEqual(weightedIndex([0, 1, 0], () => 0.5), 1);
  assert.strictEqual(weightedIndex([1, 3], () => 0.2), 0);
  assert.strictEqual(weightedIndex([1, 3], () => 0.3), 1);
  assert.strictEqual(weightedIndex([], () => 0.5), 0);
  assert.strictEqual(nextInRotation(['a', 'b', 'c'], undefined), 'a');
  assert.strictEqual(nextInRotation(['a', 'b', 'c'], 'c'), 'a');
  assert.strictEqual(nextInRotation(['a', 'b'], 'gone'), 'a');
  assert.strictEqual(nextInRotation([], 'a'), null);
  const w = computeHourWeights([{ h: 18, views: 100 }, { h: 18, views: 300 }, { h: 9, views: 5 }, { h: 9, views: 15 }, { h: 3, views: 999 }]);
  assert.deepStrictEqual(w, { 18: 200, 9: 10 }, 'hours with one video are ignored');
  assert.strictEqual(pickBestDay([['09:00', '09:40'], ['18:10', '18:50'], ['12:00']], w), 1);
  assert.strictEqual(pickBestDay([['09:00'], ['18:00']], {}), 0, 'no data: first draw, as before');
  assert.strictEqual(matchJob('This Baby Donkey Just Went FULL YEEHAW MODE! #MrApple', [{ id: 'j1', title: 'This Baby Donkey Just Went FULL YEEHAW MODE! 🍎🫏' }]), 'j1');
  assert.strictEqual(matchJob('Totally different', [{ id: 'j1', title: 'This Baby Donkey' }]), null);
  const s = parseSmart({ enabled: 'yes', sounds: [' a ', '', 'b'], comments: 'x' });
  assert.deepStrictEqual([s.enabled, s.sounds, s.comments], [false, ['a', 'b'], []], 'bad values fall back to defaults');
  console.log('ok decisions');

  // 4. API: settings, stored insights, and every feature off by default
  const app = createApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const ch: any = await (await fetch(`${base}/api/channels`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Mr. Banana' }),
    })).json();
    const id = ch.id;

    const off: any = await (await fetch(`${base}/api/channels/${id}/insights`)).json();
    assert.strictEqual(off.settings.enabled, false, 'off by default');
    assert.strictEqual(off.nextMessage, 'next', 'off: ChatGPT gets plain "next"');
    assert.strictEqual(collectDue(id), false);
    assert.strictEqual(tikTokSoundForRun(id, 'Own sound'), 'Own sound');
    assert.strictEqual(commentForRun(id), null);

    db.prepare("INSERT INTO jobs (id, channel_id, concept_title, state, created_at, updated_at) VALUES ('jt1', ?, 'This Baby Tapir''s SNOOT DANCE Is Too Funny!', 'published', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)").run(id);
    saveStats(id, 'tiktok', parseTikTokStudioPosts(TIKTOK_POSTS));
    saveStats(id, 'youtube', parseYouTubeStudioShorts(YOUTUBE_SHORTS));
    saveStats(id, 'tiktok', parseTikTokStudioPosts(TIKTOK_POSTS)); // a second read updates, never doubles
    saveTrends(id, 'tiktok', [
      { name: 'Baby Capybara Spa Day', detail: 'Nature', views: 1, kidSafe: 0.95, fits: 0.9 },
      { name: 'Penguin Slide Challenge', detail: '', views: 3, kidSafe: 0.92, fits: 0.85 },
      { name: 'UFC fight', detail: '', views: 2, kidSafe: 0.05, fits: 0.1 },
    ]);
    const top = topVideos(id, 5);
    assert.strictEqual(top[0].views, 1200, 'most viewed first');
    assert.strictEqual(top[0].job_id, 'jt1', 'Studio row matched to the app video');

    const on: any = await (await fetch(`${base}/api/channels/${id}/smart`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, soundRotation: true, sounds: ['Song A', 'Song B'], firstComment: true }),
    })).json();
    assert.strictEqual(on.settings.enabled, true);
    assert.ok(on.trends[0].usable && on.trends[1].usable, 'usable trends first');
    assert.strictEqual(on.trends.find((t: any) => t.name === 'UFC fight').usable, false);
    assert.ok(on.nextMessage.startsWith('next.') && on.nextMessage.includes('one of 2 trends'), 'page preview');
    assert.strictEqual(nextMessage(id), on.nextMessage);
    // Each run gets ONE trend; never the unsafe one, and never the same one twice in a row.
    const picks: string[] = [];
    for (let i = 0; i < 6; i++) picks.push((await nextMessageForRun(id)).message);
    assert.ok(picks.every((m) => !m.includes('UFC')), 'unsafe trend never sent');
    assert.ok(picks.every((m) => m.includes('Baby Capybara Spa Day') || m.includes('Penguin Slide Challenge')));
    for (let i = 1; i < picks.length; i++) assert.notStrictEqual(picks[i], picks[i - 1], 'a different trend each run');
    assert.strictEqual(collectDue(id), true, 'never collected: due');
    writeInsightsState(id, { collectedAt: new Date().toISOString() });
    assert.strictEqual(collectDue(id), false, 'collected just now: not due');

    assert.deepStrictEqual([tikTokSoundForRun(id, 'x'), tikTokSoundForRun(id, 'x'), tikTokSoundForRun(id, 'x')], ['Song A', 'Song B', 'Song A']);
    assert.deepStrictEqual([commentForRun(id), commentForRun(id)], DEFAULT_COMMENTS.slice(0, 2), 'default comments rotate');

    const partial: any = await (await fetch(`${base}/api/channels/${id}/smart`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ smartPrompts: false }),
    })).json();
    assert.strictEqual(partial.settings.enabled, true, 'one change keeps the others');
    assert.strictEqual(partial.nextMessage, 'next');

    const master: any = await (await fetch(`${base}/api/channels/${id}/smart`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: false }),
    })).json();
    assert.strictEqual(master.settings.soundRotation, true, 'master off keeps the choices for later');
    assert.strictEqual(tikTokSoundForRun(id, 'Own sound'), 'Own sound', 'master off: every feature off');
    assert.strictEqual(commentForRun(id), null);

    // The manager: test untried trends, repeat what got views
    const ch2: any = await (await fetch(`${base}/api/channels`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Mr. Kiwi' }),
    })).json();
    const k = ch2.id;
    await fetch(`${base}/api/channels/${k}/smart`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true }) });
    const addJob = (jid: string, title: string, trend: string, views: number) => {
      db.prepare("INSERT INTO jobs (id, channel_id, concept_title, trend, state, created_at, updated_at) VALUES (?, ?, ?, ?, 'published', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)").run(jid, k, title, trend);
      db.prepare("INSERT INTO video_stats (channel_id, platform, title, posted_at, views, job_id, fetched_at) VALUES (?, 'tiktok', ?, ?, ?, ?, 'now')").run(k, title, jid, views, jid);
    };
    addJob('k1', "Kiwi's SNOOT DANCE Party", 'Dance A', 200);
    addJob('k2', 'Kiwi Bakes a Cake', 'Dance B', 2);
    addJob('k3', 'Kiwi Goes Skiing', 'Dance B', 3);
    saveTrends(k, 'chatgpt', ['Dance A', 'Dance B', 'Dance C'].map((name) => ({ name, detail: '', views: null, kidSafe: 0.9, fits: 0.9 })));
    const scores = trendScores(k);
    assert.deepStrictEqual(scores.filter((t) => t.winner).map((t) => t.name), ['Dance A'], '200 views vs typical 3: a winner');
    assert.deepStrictEqual(winnerTitles(k), ["Kiwi's SNOOT DANCE Party"], "a winner's idea may be repeated");
    const explore = await pickTrendForRun(k, () => 0.1);
    assert.deepStrictEqual([explore.mode, explore.trend?.name], ['test', 'Dance C'], 'below the explore rate: test the untried trend');
    const exploit = await pickTrendForRun(k, () => 0.9);
    assert.deepStrictEqual([exploit.mode, exploit.trend?.name], ['repeat', 'Dance A'], 'otherwise repeat the winner');
    const again = await pickTrendForRun(k, () => 0.9);
    assert.strictEqual(again.trend?.name, 'Dance A', 'a winner can repeat back to back');
    assert.ok((await nextMessageForRun(k)).message.startsWith('next.'));
    const view: any = await (await fetch(`${base}/api/channels/${k}/insights`)).json();
    assert.ok(view.lastDecision && view.trendScores[0].name === 'Dance A', 'the page shows the decision and what worked');
    console.log('ok insights through the API');
  } finally {
    server.close();
    await shutdownAllAgents();
  }
  console.log('--- ALL INSIGHTS TESTS PASSED ---');
}

run()
  .then(() => {
    cleanup();
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    cleanup();
    process.exit(1);
  });
