import { cx } from '../cx';

/** The studio mark: an apple silhouette with a leaf. */
export function AppleGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cx('size-6', className)} aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M12 7.6c-1-1.2-2.3-1.8-3.6-1.8-2.7 0-4.7 2.4-4.7 5.4 0 4.3 2.7 8.6 5.1 8.6.9 0 1.5-.6 2.6-.6s1.6.6 2.5.6c2.3 0 4.2-3.8 4.9-6.2-2.9-1.1-3.4-5.3-.4-6.8-1.1-1.2-2.4-1.8-3.6-1.8-1.1 0-2 .6-2.8.6S12.9 7.6 12 7.6z"
      />
      <path fill="#23804A" d="M12.6 6.2c.2-1.6 1.2-2.7 2.8-3.1-.2 1.6-1.2 2.8-2.8 3.1z" />
    </svg>
  );
}
