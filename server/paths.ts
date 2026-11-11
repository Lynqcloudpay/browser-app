import fs from 'fs';
import path from 'path';

/** Absolute repo root (server/ lives directly under it). */
export const REPO_ROOT = path.resolve(__dirname, '..');

/** All mutable state (db, channels, videos, frames, thumbnails, logs). Overridable for tests. */
export const STORAGE_ROOT = process.env.KINDRED_STORAGE_DIR
  ? path.resolve(process.env.KINDRED_STORAGE_DIR)
  : path.join(REPO_ROOT, 'storage');

export const VIDEOS_DIR = path.join(STORAGE_ROOT, 'videos');
export const FRAMES_DIR = path.join(STORAGE_ROOT, 'frames');
export const THUMBNAILS_DIR = path.join(STORAGE_ROOT, 'thumbnails');
export const LOGS_DIR = path.join(STORAGE_ROOT, 'logs');

/** Creates the storage folders the app writes into. Safe to call repeatedly. */
export function ensureStorageDirs(): void {
  for (const dir of [VIDEOS_DIR, FRAMES_DIR, THUMBNAILS_DIR, LOGS_DIR, path.join(STORAGE_ROOT, 'channels')]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
