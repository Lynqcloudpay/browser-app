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
