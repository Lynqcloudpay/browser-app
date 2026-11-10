import fs from 'fs';
import path from 'path';
import { accountStatusFile } from './channels';

/** Last known sign-in state of each platform in the app's browser (stored per-channel, git-ignored). */

export type AccountKey = 'chatgpt' | 'grok' | 'tiktok' | 'youtube';
export const ACCOUNT_KEYS: AccountKey[] = ['chatgpt', 'grok', 'tiktok', 'youtube'];

export interface AccountStatus {
  state: 'in' | 'out' | 'unknown';
  checkedAt?: string;
}

export function getAccountStatuses(channelId = 1): Record<AccountKey, AccountStatus> {
  const file = process.env.KINDRED_ACCOUNT_STATUS_FILE || accountStatusFile(channelId);
  let raw: any = {};
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    /* nothing recorded yet */
  }
  const out = {} as Record<AccountKey, AccountStatus>;
  for (const k of ACCOUNT_KEYS) {
    const v = raw[k];
    out[k] = v && ['in', 'out', 'unknown'].includes(v.state) ? { state: v.state, checkedAt: v.checkedAt } : { state: 'unknown' };
  }
  return out;
}

export function recordAccountStatus(key: AccountKey, state: AccountStatus['state'], channelId = 1): void {
  try {
    const file = process.env.KINDRED_ACCOUNT_STATUS_FILE || accountStatusFile(channelId);
    const all = getAccountStatuses(channelId);
    all[key] = { state, checkedAt: new Date().toISOString() };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(all, null, 2));
  } catch {
    /* status is informational only */
  }
}
