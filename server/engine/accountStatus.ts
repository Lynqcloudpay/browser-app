import fs from 'fs';
import path from 'path';

/** Last known sign-in state of each platform in the app's browser (storage/account_status.json, git-ignored). */

export type AccountKey = 'chatgpt' | 'grok' | 'tiktok' | 'youtube';
export const ACCOUNT_KEYS: AccountKey[] = ['chatgpt', 'grok', 'tiktok', 'youtube'];

export interface AccountStatus {
  state: 'in' | 'out' | 'unknown';
  checkedAt?: string;
}

const FILE = process.env.KINDRED_ACCOUNT_STATUS_FILE || path.join(__dirname, '../../storage/account_status.json');

export function getAccountStatuses(): Record<AccountKey, AccountStatus> {
  let raw: any = {};
  try {
    raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
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

export function recordAccountStatus(key: AccountKey, state: AccountStatus['state']): void {
  try {
    const all = getAccountStatuses();
    all[key] = { state, checkedAt: new Date().toISOString() };
    fs.writeFileSync(FILE, JSON.stringify(all, null, 2));
  } catch {
    /* status is informational only */
  }
}
