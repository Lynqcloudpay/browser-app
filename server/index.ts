import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { initDatabase } from './db/database';
import { apiRouter } from './routes/api';
import ProductionWorker from './engine/worker';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Initialize SQLite database
initDatabase();

// Ensure storage subfolders exist
const storageRoot = path.join(__dirname, '../storage');
['videos', 'thumbnails', 'frames'].forEach((sub) => {
  const dir = path.join(storageRoot, sub);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Serve generated media assets
app.use('/media', express.static(storageRoot));

// Mount REST API
app.use('/api', apiRouter);

// Serve client in production
const clientDist = path.join(__dirname, '../client/dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.use((req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/media')) {
      return res.status(404).json({ error: `Not found: ${req.path}` });
    }
    if (req.method === 'GET') {
      return res.sendFile(path.join(clientDist, 'index.html'));
    }
    next();
  });
}

// Global JSON error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('[API Error Handler]', err);
  if (!res.headersSent) {
    res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
});

// Background worker is trigger-only; auto-generation of synthetic videos is disabled per operator preference.
// Production worker cycles can be triggered via POST /api/worker/tick or Jev browser automation.

app.listen(PORT, () => {
  console.log(`[KindredStudio] Studio server running at http://localhost:${PORT}`);
});

export default app;
