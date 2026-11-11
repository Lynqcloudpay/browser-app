import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { buttonClass } from './Button';

export interface ConfirmOptions {
  title: string;
  body: ReactNode;
  /** Names the action, e.g. "Delete file". Never "OK". */
  confirmLabel: string;
  tone?: 'primary' | 'destructive';
  /** When set, the confirm button stays disabled until this exact text is typed. */
  requireText?: string;
}

interface ConfirmDialogProps extends ConfirmOptions {
  onResult: (ok: boolean) => void;
  returnFocusTo: HTMLElement | null;
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  tone = 'primary',
  requireText,
  onResult,
  returnFocusTo,
}: ConfirmDialogProps) {
  const titleId = useId();
  const bodyId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [typed, setTyped] = useState('');
  const armed = requireText === undefined || typed.trim() === requireText;

  useEffect(() => {
    (requireText === undefined ? cancelRef.current : inputRef.current)?.focus();
    const back = returnFocusTo;
    return () => back?.focus();
    // Mount-only: focus goes to the first control and returns to the trigger on close.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onResult(false);
      return;
    }
    if (e.key !== 'Tab' || !dialogRef.current) return;
    const focusable = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])'),
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/45 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        onKeyDown={onKeyDown}
        className="ks-enter w-full max-w-md rounded-[14px] bg-sheet p-6 shadow-[0_12px_40px_rgba(22,48,43,0.2)]"
      >
        <h2 id={titleId} className="text-[18px] font-bold leading-snug">
          {title}
        </h2>
        <div id={bodyId} className="mt-2 text-[15px] text-ink-soft">
          {body}
        </div>
        {requireText !== undefined && (
          <div className="mt-4">
            <label htmlFor={`${bodyId}-confirm`} className="block text-[14px] font-semibold">
              Type "{requireText}" to confirm.
            </label>
            <input
              id={`${bodyId}-confirm`}
              ref={inputRef}
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              className="mt-1.5 w-full rounded-[10px] border border-ink-soft bg-sheet px-3 py-2 text-[15px] focus:outline-2 focus:outline-ink"
            />
          </div>
        )}
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button ref={cancelRef} type="button" onClick={() => onResult(false)} className={buttonClass('secondary')}>
            Cancel
          </button>
          <button
            type="button"
            disabled={!armed}
            onClick={() => onResult(true)}
            className={buttonClass(tone === 'destructive' ? 'destructive' : 'primary')}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (ok: boolean) => void;
  returnFocusTo: HTMLElement | null;
}

/** Promise-based confirmation. Render `dialog` once in the page; `await confirm({...})` returns the answer. */
export function useConfirm() {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        const active = document.activeElement;
        setPending({
          ...options,
          resolve,
          returnFocusTo: active instanceof HTMLElement ? active : null,
        });
      }),
    [],
  );

  const settle = useCallback((ok: boolean) => {
    setPending((current) => {
      current?.resolve(ok);
      return null;
    });
  }, []);

  const dialog = pending ? (
    <ConfirmDialog
      title={pending.title}
      body={pending.body}
      confirmLabel={pending.confirmLabel}
      tone={pending.tone}
      requireText={pending.requireText}
      returnFocusTo={pending.returnFocusTo}
      onResult={settle}
    />
  ) : null;

  return { confirm, dialog };
}
