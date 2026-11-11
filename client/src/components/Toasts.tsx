import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, CircleAlert, X } from 'lucide-react';
import { errorMessage } from '../api';
import { cx } from '../cx';

type ToastKind = 'success' | 'error';

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

export interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  /** Shows the server's error text for a failed request. */
  failure: (err: unknown) => void;
}

const ToastContext = createContext<ToastApi | null>(null);
const AUTO_DISMISS_MS = 5000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (kind: ToastKind, message: string) => {
      const id = nextId.current++;
      setItems((prev) => [...prev.slice(-4), { id, kind, message }]);
      if (kind === 'success') window.setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (message) => push('success', message),
      error: (message) => push('error', message),
      failure: (err) => push('error', errorMessage(err)),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-4 bottom-4 z-[60] flex flex-col items-end gap-2 sm:inset-x-auto sm:right-6 sm:bottom-6"
      >
        {items.map((t) => (
          <div
            key={t.id}
            className={cx(
              'ks-enter pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-[10px] border bg-sheet px-4 py-3 text-[14px] shadow-[0_8px_24px_rgba(22,48,43,0.14)]',
              t.kind === 'error' ? 'border-apple' : 'border-line',
            )}
          >
            {t.kind === 'error' ? (
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-apple-deep" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-leaf-ink" aria-hidden="true" />
            )}
            <p className="min-w-0 flex-1">
              {t.kind === 'error' && <strong className="font-semibold text-apple-deep">Problem. </strong>}
              {t.message}
            </p>
            {t.kind === 'error' && (
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss message"
                className="-m-1 shrink-0 rounded-md p-1 text-ink-soft hover:text-ink"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast must be used inside ToastProvider');
  return value;
}
