const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;

/** "3 min ago", "2 h ago", "in 4 h", or a short date after a week. */
export function relativeTime(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const diff = Math.round((now - t) / 1000);
  const abs = Math.abs(diff);
  if (abs < 45) return diff >= 0 ? 'just now' : 'any moment';
  let phrase: string;
  if (abs < HOUR) phrase = `${Math.round(abs / MINUTE)} min`;
  else if (abs < DAY) phrase = `${Math.round(abs / HOUR)} h`;
  else if (abs < 7 * DAY) phrase = `${Math.round(abs / DAY)} d`;
  else return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return diff >= 0 ? `${phrase} ago` : `in ${phrase}`;
}

/** Local 24-hour clock time, e.g. "14:30". */
export function clock(iso: string | null | undefined): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

/** Full local date and time, for tooltips. */
export function absolute(iso: string | null | undefined): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  return new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** A run or video length: "42 s" or "2 min 5 s". */
export function duration(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || Number.isNaN(sec)) return '';
  if (sec < 60) return `${Math.round(sec)} s`;
  return `${Math.floor(sec / 60)} min ${Math.round(sec % 60)} s`;
}

/** Elapsed clock for the production line: "04:12". */
export function mmss(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function megabytes(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '';
  if (n === 0) return '0 MB';
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} MB`;
}
