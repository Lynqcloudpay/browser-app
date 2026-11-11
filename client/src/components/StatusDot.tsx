import { cx } from '../cx';

/** Shape and colour together, so state never rests on colour alone. */
export type DotTone = 'idle' | 'running' | 'waiting' | 'error' | 'in' | 'out' | 'unknown';

const TONE: Record<DotTone, string> = {
  idle: 'bg-track/60',
  running: 'bg-apple ks-pulse',
  waiting: 'bg-honey',
  error: 'bg-apple ring-2 ring-apple ring-offset-2 ring-offset-paper',
  in: 'bg-leaf',
  out: 'border-2 border-apple bg-sheet',
  unknown: 'border-2 border-dashed border-ink-soft bg-sheet',
};

export function StatusDot({ tone, className }: { tone: DotTone; className?: string }) {
  return <span aria-hidden="true" className={cx('inline-block size-2.5 shrink-0 rounded-full', TONE[tone], className)} />;
}
