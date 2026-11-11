import { useState } from 'react';
import { api } from '../../api';
import { Button } from '../../components/Button';
import { useConfirm } from '../../components/ConfirmDialog';
import { Section } from '../../components/Section';
import { StatusDot, type DotTone } from '../../components/StatusDot';
import { useToast } from '../../components/Toasts';
import { clock } from '../../format';
import { isAccountBusy } from '../../labels';
import type { AccountSite, AccountsOverview, ChannelView } from '../../types';
import type { PatchFn } from './ChannelHeader';

const toneOf = (state: AccountSite['state']): DotTone => (state === 'in' ? 'in' : state === 'out' ? 'out' : 'unknown');
const wordOf = (state: AccountSite['state']): string => (state === 'in' ? 'Signed in' : state === 'out' ? 'Signed out' : 'Not checked');

export function LoginsSection({
  channel,
  accounts,
  runBusy,
  patch,
  onChanged,
}: {
  channel: ChannelView;
  accounts: AccountsOverview | null;
  runBusy: boolean;
  patch: PatchFn;
  onChanged: () => void;
}) {
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [pendingOp, setPendingOp] = useState<string | null>(null);
  const [savingGrok, setSavingGrok] = useState(false);
  const [grokSaved, setGrokSaved] = useState(false);

  const locked = isAccountBusy(accounts) || runBusy || pendingOp !== null;
  const op = accounts?.op;

  const runOp = async (key: string, task: () => Promise<unknown>) => {
    setPendingOp(key);
    try {
      await task();
    } catch (err) {
      toast.failure(err);
    } finally {
      setPendingOp(null);
      onChanged();
    }
  };

  const switchAccount = async (site: AccountSite) => {
    const ok = await confirm({
      title: `Switch the ${site.name} account for ${channel.name}?`,
      body: `You will sign in to a different ${site.name} account for ${channel.name}.`,
      confirmLabel: 'Switch account',
    });
    if (ok) await runOp(`switch:${site.key}`, () => api.switchAccount(channel.id, site.key));
  };

  const saveGrok = async (change: Partial<Pick<ChannelView, 'grok_resolution' | 'grok_duration'>>) => {
    setSavingGrok(true);
    setGrokSaved(false);
    try {
      await patch(change);
      setGrokSaved(true);
      window.setTimeout(() => setGrokSaved(false), 2500);
    } catch (err) {
      toast.failure(err);
    } finally {
      setSavingGrok(false);
    }
  };

  return (
    <Section
      title="Logins"
      description="Each channel has its own browser profile. Sign in once per platform, and the browser remembers it."
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[14px] text-ink-soft">Check whether each platform is still signed in.</p>
        <Button disabled={locked} busy={pendingOp === 'check'} onClick={() => void runOp('check', () => api.checkAccounts(channel.id))}>
          Check logins
        </Button>
      </div>

      {accounts === null ? (
        <p className="text-ink-soft">Loading logins...</p>
      ) : (
        <ul className="space-y-2.5">
          {accounts.sites.map((site) => (
            <li
              key={site.key}
              className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-line bg-sheet px-4 py-3"
            >
              <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                <StatusDot tone={toneOf(site.state)} />
                <span className="font-semibold">{site.name}</span>
                <span className="text-[13px] text-ink-soft">
                  {wordOf(site.state)}
                  {site.checkedAt ? `, checked ${clock(site.checkedAt)}` : ''}
                </span>
              </div>
              <Button
                size="sm"
                disabled={locked}
                busy={pendingOp === `switch:${site.key}`}
                onClick={() => void switchAccount(site)}
              >
                Switch account
              </Button>
            </li>
          ))}
        </ul>
      )}

      {op && op.state !== 'idle' && (
        <div
          role="status"
          className={
            op.state === 'error'
              ? 'flex flex-wrap items-center gap-3 rounded-[10px] bg-apple-wash p-4 text-[14px] text-apple-deep'
              : op.state === 'waiting_login'
                ? 'flex flex-wrap items-center gap-3 rounded-[10px] bg-honey-wash p-4 text-[14px] text-honey-ink'
                : 'flex flex-wrap items-center gap-3 rounded-[10px] bg-paper p-4 text-[14px]'
          }
        >
          <p className="min-w-0 flex-1">
            {op.state === 'waiting_login' && <strong className="font-semibold">Sign-in needed. </strong>}
            {op.state === 'error' && <strong className="font-semibold">Failed. </strong>}
            {op.step}
          </p>
          {isAccountBusy(accounts) && (
            <Button size="sm" busy={pendingOp === 'cancel'} onClick={() => void runOp('cancel', () => api.cancelAccounts(channel.id))}>
              Cancel
            </Button>
          )}
        </div>
      )}

      <div className="border-t border-line pt-5">
        <h3 className="text-[16px] font-bold">Video settings</h3>
        <p className="mt-1 text-[13px] text-ink-soft">Quality and length Grok uses for every video on this channel.</p>
        <div className="mt-4 flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1.5 text-[14px] font-semibold">
            Quality
            <select
              value={channel.grok_resolution}
              disabled={savingGrok}
              onChange={(e) => void saveGrok({ grok_resolution: e.target.value as '480p' | '720p' })}
              className="rounded-[10px] border border-ink-soft bg-sheet px-3 py-2 text-[15px] font-normal"
            >
              <option value="720p">720p (HD)</option>
              <option value="480p">480p (SD)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-[14px] font-semibold">
            Length
            <select
              value={String(channel.grok_duration)}
              disabled={savingGrok}
              onChange={(e) => void saveGrok({ grok_duration: Number(e.target.value) as 6 | 10 | 15 })}
              className="rounded-[10px] border border-ink-soft bg-sheet px-3 py-2 text-[15px] font-normal"
            >
              <option value="15">15 s (long)</option>
              <option value="10">10 s (medium)</option>
              <option value="6">6 s (short)</option>
            </select>
          </label>
          {grokSaved && (
            <p role="status" className="pb-2 text-[14px] font-semibold text-leaf-ink">
              Saved.
            </p>
          )}
        </div>
      </div>
      {dialog}
    </Section>
  );
}
