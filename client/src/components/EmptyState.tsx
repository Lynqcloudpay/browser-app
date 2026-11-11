import type { ReactNode } from 'react';

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-card border border-dashed border-ink-soft/50 bg-sheet p-8 text-center">
      <p className="text-[16px] font-semibold">{title}</p>
      {children && <div className="mx-auto mt-1.5 max-w-md text-[14px] text-ink-soft">{children}</div>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}
