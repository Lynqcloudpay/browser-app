import JevBrowserAgent from './jevBrowserAutomation';
import { ACCOUNT_KEYS, AccountKey, getAccountStatuses } from './accountStatus';
import { getGrokSettings } from './grokSettings';

/**
 * "Change the account" for each platform. One operation at a time, run in the background; the page polls getAccountsOverview().
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

let op: AccountOp = { state: 'idle', step: '' };

export function isAccountOpBusy(): boolean {
  return op.state === 'working' || op.state === 'waiting_login';
}

export function getAccountsOverview() {
  const statuses = getAccountStatuses();
  return {
    sites: ACCOUNT_KEYS.map((key) => ({ key, name: JevBrowserAgent.ACCOUNT_SITES[key].name, ...statuses[key] })),
    grokSettings: getGrokSettings(),
    op: { ...op },
  };
}

function begin(kind: 'check' | 'switch', site: AccountKey | undefined, step: string): { ok: boolean; reason?: string } {
  if (isAccountOpBusy()) return { ok: false, reason: 'An account change is already in progress.' };
  if (JevBrowserAgent.isPipelineRunning()) return { ok: false, reason: 'A video is being made right now. Wait for it to finish first.' };
  op = { state: 'working', kind, site, step, startedAt: new Date().toISOString() };
  return { ok: true };
}

const say = (step: string, kind?: 'running' | 'waiting_login') => {
  op = { ...op, step, state: kind === 'waiting_login' ? 'waiting_login' : 'working' };
};

export function startCheck(): { started: boolean; reason?: string } {
  const b = begin('check', undefined, 'Opening the browser and checking each platform…');
  if (!b.ok) return { started: false, reason: b.reason };
  void JevBrowserAgent.checkAccounts(say)
    .then(() => {
      op = { ...op, state: 'done', step: 'Finished checking. The browser window is closed.', finishedAt: new Date().toISOString() };
    })
    .catch(async (err: any) => {
      await JevBrowserAgent.shutdown().catch(() => {});
      op = { ...op, state: 'error', step: err?.message || 'The check failed.', finishedAt: new Date().toISOString() };
    });
  return { started: true };
}

export function startSwitch(site: AccountKey): { started: boolean; reason?: string } {
  if (!ACCOUNT_KEYS.includes(site)) return { started: false, reason: 'Unknown platform.' };
  const b = begin('switch', site, `Opening ${JevBrowserAgent.ACCOUNT_SITES[site].name}…`);
  if (!b.ok) return { started: false, reason: b.reason };
  void JevBrowserAgent.switchAccount(site, say)
    .then((message) => {
      op = { ...op, state: 'done', step: message, finishedAt: new Date().toISOString() };
    })
    .catch(async (err: any) => {
      await JevBrowserAgent.shutdown().catch(() => {});
      op = { ...op, state: 'error', step: err?.message || 'Could not switch the account.', finishedAt: new Date().toISOString() };
    });
  return { started: true };
}

export function cancelAccountOp(): void {
  JevBrowserAgent.cancelAccountWait();
}
