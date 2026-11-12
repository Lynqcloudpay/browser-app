/**
 * Nightly planner for random series (started by launchd at 00:05, see buildPlanPlist in server/engine/dailySchedule.ts).
 * Makes tomorrow's random launch times for one channel and reinstalls its run job. Does nothing for other modes.
 *
 *   npx tsx scripts/planSeries.ts --channel 2
 */
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

const chArgIdx = process.argv.indexOf('--channel');
const CHANNEL_ID = chArgIdx !== -1 && process.argv[chArgIdx + 1] ? Number(process.argv[chArgIdx + 1]) : NaN;

async function main() {
  if (!Number.isInteger(CHANNEL_ID) || CHANNEL_ID < 1) throw new Error('Usage: npx tsx scripts/planSeries.ts --channel <id>');
  const { planChannelSeries } = await import('../server/engine/dailySchedule');
  const times = await planChannelSeries(CHANNEL_ID);
  console.log(
    times
      ? `[${new Date().toLocaleString()}] [plan ch${CHANNEL_ID}] today's random times: ${times.join(', ')}`
      : `[${new Date().toLocaleString()}] [plan ch${CHANNEL_ID}] not a random series on; nothing to plan`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(`[plan ch${CHANNEL_ID}] failed:`, err);
  process.exit(1);
});
