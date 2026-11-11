import 'dotenv/config';
import express, { NextFunction, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import http from 'http';
import { initDatabase, db } from './db/database';
import { apiRouter } from './routes/api';
import { migrateLegacySchedule } from './engine/dailySchedule';
import { shutdownAllAgents } from './engine/agentRegistry';
import { HttpError } from './httpError';
import { closeInterruptedRuns } from './engine/runs';
import { ensureStorageDirs, REPO_ROOT, VIDEOS_DIR, FRAMES_DIR, THUMBNAILS_DIR } from './paths';

// SERVER_PORT, not PORT: dev launchers set PORT for the Vite page (5173), and the /api proxy expects 3000.
const PORT = Number(process.env.SERVER_PORT) || 3000;
const HOST = process.env.SERVER_HOST || '127.0.0.1';

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

function hostnameOf(value: string): string | null {
  try {
    return new URL(`http://${value}`).hostname;
  } catch {
    return null;
  }
}

/**
 * Builds the Express app without listening on a port, so tests can mount it. Safe to call more than once.
 * This server can post videos and delete files, so it only answers local clients: no cross-origin browser requests
 * and no foreign Host headers (DNS rebinding).
 */
export function createApp(): express.Express {
  initDatabase();
  ensureStorageDirs();

  const app = express();

  // DNS-rebinding guard: only accept requests addressed to this machine.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const host = req.headers.host ? hostnameOf(req.headers.host) : null;
    if (!host || !LOCAL_HOSTNAMES.has(host)) {
      return res.status(403).json({ error: 'Forbidden host.' });
    }
    next();
  });

  // CORS: only local origins (any port) may call the API from a browser page. Requests without an Origin header
  // (curl, the app's own server-side fetches) are not browser cross-site requests and are allowed.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (origin === undefined) return next();
    let local = false;
    try {
      local = LOCAL_HOSTNAMES.has(new URL(origin).hostname);
    } catch {
      local = false;
    }
    if (!local) return res.status(403).json({ error: 'Cross-origin requests are not allowed.' });
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });

  app.use(express.json({ limit: '1mb' }));

  // Generated media. Only the three output folders are served. Channel profiles, cookies (saved logins),
  // databases, JSON state and logs are never reachable through /media.
  const deniedMedia = /(^|\/)(channels|logs)(\/|$)|\.db|\.json$/i;
  app.use('/media', (req: Request, res: Response, next: NextFunction) => {
    let decoded = req.path;
    try {
      decoded = decodeURIComponent(req.path);
    } catch {}
    if (deniedMedia.test(decoded)) return res.status(403).json({ error: 'Forbidden' });
    next();
  });
  app.use('/media/videos', express.static(VIDEOS_DIR));
  app.use('/media/frames', express.static(FRAMES_DIR));
  app.use('/media/thumbnails', express.static(THUMBNAILS_DIR));
  app.use('/media', (req: Request, res: Response) => res.status(404).json({ error: `Not found: ${req.path}` }));

  app.use('/api', apiRouter);
  // Any other /api path is a JSON 404, whether or not the client is built.
  app.use('/api', (req: Request, res: Response) => {
    res.status(404).json({ error: `Not found: ${req.originalUrl.split('?')[0]}` });
  });

  // Serve the built client in production (SPA fallback for GET pages).
  const clientDist = path.join(REPO_ROOT, 'client', 'dist');
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method === 'GET' && !req.path.startsWith('/api') && !req.path.startsWith('/media')) {
        return res.sendFile(path.join(clientDist, 'index.html'));
      }
      next();
    });
  }

  // Global JSON error handler.
  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(err);
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message });
    }
    // Body-parser errors (malformed or oversized JSON) are client errors.
    if (err && err.type && typeof err.status === 'number' && err.status >= 400 && err.status < 500) {
      return res.status(400).json({ error: err.message || 'Invalid request body' });
    }
    console.error('[API Error Handler]', err);
    res.status(500).json({ error: err?.message || 'Internal Server Error' });
  });

  return app;
}

let shuttingDown = false;

function startServer(): void {
  const app = createApp();
  const interrupted = closeInterruptedRuns();
  if (interrupted) console.log(`[KindredStudio] Closed out ${interrupted} run(s) that were interrupted by a restart.`);
  // Launchd schedule migration only does anything on a Mac with a legacy job present.
  migrateLegacySchedule().catch((e) => console.warn('[Schedule] Migration check error:', e.message));

  const server: http.Server = app.listen(PORT, HOST);

  server.on('listening', () => {
    console.log(`[KindredStudio] API running at http://${HOST}:${PORT}`);
  });

  server.on('error', (err: any) => {
    if (err?.code === 'EADDRINUSE') {
      console.error(
        `Port ${PORT} is already in use — KindredStudio is probably already running. Close the other copy or set SERVER_PORT.`
      );
    } else {
      console.error('[KindredStudio] Server failed to start:', err);
    }
    process.exit(1);
  });

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[KindredStudio] ${signal} received — shutting down.`);
    server.close();
    await shutdownAllAgents();
    try {
      db.close();
    } catch {}
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

if (require.main === module) {
  startServer();
}
