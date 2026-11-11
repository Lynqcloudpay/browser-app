import { getAgent } from './agentRegistry';
import { ACCOUNT_KEYS, AccountKey, getAccountStatuses } from './accountStatus';
import { getChannel } from './channels';

/**
 * "Change the account" for each platform. Per-channel, run in the background.
 *  - check:  opens the browser, looks at every platform, records signed in / signed out, closes the window.
 *  - switch: opens the browser on ONE platform, signs it out, waits for you to sign in with the other account, closes the window.
 */

export type AccountOpState = 'idle' | 'working' | 'waiting_login' | 'done' | 'error';

export interface AccountOp {
  state: AccountOpState;
  kind?: 'check' | 'switch';
  site?: AccountKey;
  step: string;
  startedAt?: string;
  finishedAt?: string;
}

const channelOps = new Map<number, AccountOp>();

function getOp(channelId = 1): AccountOp {
  return channelOps.get(channelId) || { state: 'idle', step: '' };
}

export function isAccountOpBusy(channelId = 1): boolean {
  const op = getOp(channelId);
  return op.state === 'working' || op.state === 'waiting_login';
}

export function getAccountsOverview(channelId = 1) {
  const statuses = getAccountStatuses(channelId);
  const ch = getChannel(channelId);
  const grokView = {
    resolution: ch?.grok_resolution || '720p',
    duration: ch?.grok_duration || 15,
  };
  const agent = getAgent(channelId);
  return {
    sites: ACCOUNT_KEYS.map((key) => ({ key, name: agent.ACCOUNT_SITES[key].name, ...statuses[key] })),
    grokSettings: grokView,
    op: { ...getOp(channelId) },
  };
}

function begin(channelId: number, kind: 'check' | 'switch', site: AccountKey | undefined, step: string): { ok: boolean; reason?: string } {
  if (isAccountOpBusy(channelId)) return { ok: false, reason: 'An account change is already in progress for this channel.' };
  if (getAgent(channelId).isPipelineRunning()) return { ok: false, reason: 'A video is being made right now. Wait for it to finish first.' };
  channelOps.set(channelId, { state: 'working', kind, site, step, startedAt: new Date().toISOString() });
  return { ok: true };
}

export function startCheck(channelId = 1): { started: boolean; reason?: string } {
  const b = begin(channelId, 'check', undefined, 'Opening the browser and checking each platform…');
  if (!b.ok) return { started: false, reason: b.reason };
  const say = (step: string, kind?: 'running' | 'waiting_login') => {
    channelOps.set(channelId, { ...getOp(channelId), step, state: kind === 'waiting_login' ? 'waiting_login' : 'working' });
  };
  const agent = getAgent(channelId);
  void agent.checkAccounts(say)
    .then(() => {
      channelOps.set(channelId, { ...getOp(channelId), state: 'done', step: agent.isBrowserOpen() ? 'Finished checking. The browser stays open for the next video; the TikTok and YouTube tabs were closed.' : 'Finished checking. The browser window is closed.', finishedAt: new Date().toISOString() });
    })
    .catch(async (err: any) => {
      await agent.shutdown().catch(() => {});
      channelOps.set(channelId, { ...getOp(channelId), state: 'error', step: err?.message || 'The check failed.', finishedAt: new Date().toISOString() });
    });
  return { started: true };
}

export function startSwitch(site: AccountKey, channelId = 1): { started: boolean; reason?: string } {
  if (!ACCOUNT_KEYS.includes(site)) return { started: false, reason: 'Unknown platform.' };
  const agent = getAgent(channelId);
  const b = begin(channelId, 'switch', site, `Opening ${agent.ACCOUNT_SITES[site].name}…`);
  if (!b.ok) return { started: false, reason: b.reason };
  const say = (step: string, kind?: 'running' | 'waiting_login') => {
    channelOps.set(channelId, { ...getOp(channelId), step, state: kind === 'waiting_login' ? 'waiting_login' : 'working' });
  };
  void agent.switchAccount(site, say)
    .then((message) => {
      channelOps.set(channelId, { ...getOp(channelId), state: 'done', step: message, finishedAt: new Date().toISOString() });
    })
    .catch(async (err: any) => {
      await agent.shutdown().catch(() => {});
      channelOps.set(channelId, { ...getOp(channelId), state: 'error', step: err?.message || 'Could not switch the account.', finishedAt: new Date().toISOString() });
    });
  return { started: true };
}

export function cancelAccountOp(channelId = 1): void {
  getAgent(channelId).cancelAccountWait();
}
