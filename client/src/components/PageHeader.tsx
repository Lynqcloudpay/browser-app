import type { ReactNode } from 'react';

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="mb-8">
      <h1 className="text-[28px] font-bold leading-[1.15]">{title}</h1>
      {children && <div className="mt-2 text-[15px] text-ink-soft">{children}</div>}
    </header>
  );
}
