import { useCallback, useEffect, useRef } from 'react';

/** Work to run on each tick. Call `isActive()` before writing state after an await. */
export type PollTask = (isActive: () => boolean) => Promise<unknown>;

/**
 * Runs `task` now and then every `intervalMs`. Pauses while the document is hidden,
 * never runs two ticks at once (a request made during a tick runs once it ends),
 * and stops on unmount. Returns a function that runs the task straight away.
 */
export function usePolling(task: PollTask, intervalMs: number, deps: readonly unknown[] = []): () => void {
  const taskRef = useRef(task);
  const triggerRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    taskRef.current = task;
  });

  useEffect(() => {
    let active = true;
    let inFlight = false;
    let queued = false;
    const isActive = () => active;

    const run = async (): Promise<void> => {
      if (!active || document.hidden) return;
      if (inFlight) {
        queued = true;
        return;
      }
      inFlight = true;
      try {
        await taskRef.current(isActive);
      } catch {
        // Tasks report their own failures; polling keeps going.
      } finally {
        inFlight = false;
        if (queued && active) {
          queued = false;
          void run();
        }
      }
    };

    triggerRef.current = () => {
      void run();
    };
    const onVisibility = () => {
      if (!document.hidden) void run();
    };
    void run();
    const timer = window.setInterval(() => {
      void run();
    }, intervalMs);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // deps are the caller's restart keys; the task itself is read through taskRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, ...deps]);

  return useCallback(() => triggerRef.current(), []);
}
