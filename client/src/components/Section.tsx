import { useId, type ReactNode } from 'react';
import { cx } from '../cx';

/** A settings-style section: heading and explanation on the left, controls on the right, separated by a hairline. */
export function Section({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className={cx('grid gap-5 border-t border-line py-9 min-[900px]:grid-cols-[240px_minmax(0,1fr)] min-[900px]:gap-10', className)}
    >
      <div>
        <h2 id={headingId} className="text-[18px] font-bold leading-snug">
          {title}
        </h2>
        {description && <div className="mt-1.5 text-[14px] text-ink-soft">{description}</div>}
      </div>
      <div className="min-w-0 space-y-5">{children}</div>
    </section>
  );
}
