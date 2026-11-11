import { Request, Response, NextFunction } from 'express';

type RouteFn = (req: Request, res: Response) => unknown;

/** Runs a route; a thrown or rejected error goes to the JSON error handler in index.ts. */
export const route =
  (fn: RouteFn) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve()
      .then(() => fn(req, res))
      .catch(next);
  };

/** SQLite's CURRENT_TIMESTAMP ("2026-11-10 06:25:31", UTC) as ISO-8601. Values already in ISO form pass through. */
export function sqliteToIso(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.includes('T')) return value;
  return value.replace(' ', 'T') + 'Z';
}

export const megabytes = (bytes: number): number => Math.round((bytes / (1024 * 1024)) * 10) / 10;
