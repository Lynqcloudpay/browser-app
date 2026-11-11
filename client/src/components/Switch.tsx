import type { ReactNode } from 'react';
import { cx } from '../cx';

interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  /** The label, plus optional explanation. The whole row is clickable. */
  children: ReactNode;
}

export function Switch({ checked, onChange, disabled = false, children }: SwitchProps) {
  return (
    <label
      className={cx(
        'flex items-start justify-between gap-4 py-1',
        disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
      )}
    >
      <span className="min-w-0 text-[15px]">{children}</span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className={cx(
          'relative mt-0.5 inline-block h-6 w-11 shrink-0 rounded-full bg-track transition-colors',
          'before:absolute before:top-0.5 before:left-0.5 before:size-5 before:rounded-full before:bg-white before:shadow-sm before:transition-transform',
          'peer-checked:bg-leaf peer-checked:before:translate-x-5',
          'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink',
        )}
      />
    </label>
  );
}
