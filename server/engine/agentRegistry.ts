import { ChannelBrowserAgent } from './jevBrowserAutomation';
import { registerChannelBusyChecker, getChannel } from './channels';

const agents = new Map<number, ChannelBrowserAgent>();

export function getAgent(channelId = 1): ChannelBrowserAgent {
  let agent = agents.get(channelId);
  if (!agent) {
    agent = new ChannelBrowserAgent(channelId);
    agents.set(channelId, agent);
  }
  return agent;
}

export async function disposeAgent(channelId: number): Promise<void> {
  const agent = agents.get(channelId);
  if (agent) {
    await agent.shutdown().catch(() => {});
    agents.delete(channelId);
  }
}

export function isChannelBusy(channelId: number): { busy: boolean; reason?: string } {
  const agent = agents.get(channelId);
  if (agent && agent.isPipelineRunning()) {
    return { busy: true, reason: 'A video is currently being generated in this channel.' };
  }
  return { busy: false };
}

// Hook into channels.ts so deleteChannel cannot delete an active channel
registerChannelBusyChecker(isChannelBusy);


/**
 * Shuts down every browser agent that was created (closes its Playwright context). Each shutdown is isolated so one
 * failure cannot block the others, and the whole wait is capped so a hung browser cannot hang the server exit.
 */
export async function shutdownAllAgents(timeoutMs = 8000): Promise<void> {
  const all = [...agents.values()];
  agents.clear();
  const work = Promise.all(
    all.map((agent) =>
      Promise.resolve()
        .then(() => agent.shutdown())
        .catch((err: any) => console.warn(`[agents] shutdown failed for channel ${agent.channelId}:`, err?.message))
    )
  );
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      console.warn(`[agents] shutdown did not finish within ${timeoutMs} ms; exiting anyway.`);
      resolve();
    }, timeoutMs);
  });
  await Promise.race([work, timeout]);
  if (timer) clearTimeout(timer);
}
