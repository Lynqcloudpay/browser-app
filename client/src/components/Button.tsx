import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from '../cx';

export type ButtonVariant = 'primary' | 'secondary' | 'destructive' | 'ghost';

export function buttonClass(variant: ButtonVariant = 'secondary', size: 'md' | 'sm' = 'md', extra?: string): string {
  return cx(
    'inline-flex items-center justify-center gap-2 rounded-[10px] font-semibold transition-colors',
    'cursor-pointer disabled:cursor-not-allowed disabled:opacity-50',
    size === 'md' ? 'min-h-10 px-4 text-[15px]' : 'min-h-8 px-3 text-[13px]',
    variant === 'primary' && 'bg-apple text-white hover:bg-apple-deep',
    variant === 'secondary' && 'border border-ink-soft bg-sheet text-ink hover:bg-paper',
    variant === 'destructive' && 'border border-apple bg-sheet text-apple-deep hover:bg-apple-wash',
    variant === 'ghost' && 'text-ink underline-offset-4 hover:underline',
    extra,
  );
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'md' | 'sm';
  /** Disables the button and marks it busy while a request is in flight. */
  busy?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  busy = false,
  icon,
  className,
  disabled,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={buttonClass(variant, size, className)}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}
