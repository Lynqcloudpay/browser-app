import { Router, Request } from 'express';
import fs from 'fs';
import path from 'path';
import db from '../db/database';
import { HttpError } from '../httpError';
import { route, sqliteToIso, megabytes } from './helpers';
import { VIDEOS_DIR, FRAMES_DIR, THUMBNAILS_DIR } from '../paths';
import { startRepublish, getRunStatus, isRunBusy } from '../engine/dailyRunner';
import { inspectJob } from '../engine/qaInspector';

/** Videos: every video the studio has made, with review, post-again and delete actions. */
export const libraryRouter = Router();

const MEDIA_DIRS: Array<{ dir: string; url: string }> = [
  { dir: VIDEOS_DIR, url: '/media/videos' },
  { dir: THUMBNAILS_DIR, url: '/media/thumbnails' },
  { dir: FRAMES_DIR, url: '/media/frames' },
];

/**
 * Finds a stored file and its /media URL. Paths are saved absolute, so if the project folder was moved the saved
 * path is stale: fall back to the same file name inside the current storage folders.
 */
export function locateMedia(savedPath: string | null | undefined): { file: string; url: string } | null {
  if (!savedPath) return null;
  const name = path.basename(savedPath);
  for (const { dir, url } of MEDIA_DIRS) {
    const candidate = path.join(dir, name);
    const sameDir = path.resolve(path.dirname(savedPath)) === path.resolve(dir);
    if ((sameDir || !fs.existsSync(savedPath)) && fs.existsSync(candidate)) {
      return { file: candidate, url: `${url}/${encodeURIComponent(name)}` };
    }
  }
  return null;
}

function toVideo(row: any) {
  const video = locateMedia(row.video_path);
  // Older videos have no saved cover path, but their cover is named after the job.
  const cover = locateMedia(row.thumbnail_path) || locateMedia(path.join(THUMBNAILS_DIR, `thumb_${row.id}.jpg`));
  let sizeMb: number | null = null;
  if (video) {
    try {
      sizeMb = megabytes(fs.statSync(video.file).size);
    } catch {
      sizeMb = null;
    }
  }
  let flags: Array<{ issue: string; severity: 'critical' | 'warning' }> = [];
  try {
    flags = JSON.parse(row.qa_flags || '[]').map((f: any) => ({ issue: String(f.issue), severity: f.severity === 'warning' ? 'warning' : 'critical' }));
  } catch {
    flags = [];
  }
  return {
    id: row.id,
    channel_id: row.channel_id ?? null,
    channel_name: row.channel_name || (row.channel_id ? `Deleted channel ${row.channel_id}` : 'No channel'),
    title: row.concept_title,
    hook: row.hook || '',
    prompt: row.script_text || '',
    state: row.state,
    hold_reason: row.hold_reason || null,
    duration_seconds: row.duration_seconds ?? null,
    video_url: video ? video.url : null,
    thumbnail_url: cover ? cover.url : null,
    file_exists: Boolean(video),
    size_mb: sizeMb,
    tiktok_url: row.tiktok_share_url || null,
    youtube_url: row.youtube_share_url || null,
    tiktok_status: row.tiktok_status || null,
    youtube_status: row.youtube_status || null,
    qa: row.qa_id ? { passed: Boolean(row.qa_passed), score: Number(row.qa_score) || 0, flags, reviewerAction: row.qa_reviewer_action } : null,
    created_at: sqliteToIso(row.created_at),
    updated_at: sqliteToIso(row.updated_at),
  };
}

const SELECT = `
  SELECT j.*, c.name AS channel_name,
         q.id AS qa_id, q.passed AS qa_passed, q.overall_score AS qa_score,
         q.flagged_reasons_json AS qa_flags, q.reviewer_action AS qa_reviewer_action
  FROM jobs j
  LEFT JOIN channels c ON c.id = j.channel_id
  LEFT JOIN qa_inspections q ON q.id = (
    SELECT id FROM qa_inspections WHERE job_id = j.id ORDER BY reviewed_at DESC, rowid DESC LIMIT 1
  )`;

function getRow(id: string): any {
  const row = db.prepare(`${SELECT} WHERE j.id = ?`).get(id);
  if (!row) throw new HttpError(404, 'Video not found');
  return row;
}

const idParam = (req: Request) => String(req.params.id);

libraryRouter.get(
  '/videos',
  route((req, res) => {
    const where: string[] = [];
    const params: any[] = [];
    if (req.query.channel_id) {
      const channelId = Number(req.query.channel_id);
      if (!Number.isInteger(channelId) || channelId <= 0) throw new HttpError(400, 'Invalid channel id');
      where.push('j.channel_id = ?');
      params.push(channelId);
    }
    if (req.query.state) {
      where.push('j.state = ?');
      params.push(String(req.query.state));
    }
    const clause = where.length ? ` WHERE ${where.join(' AND ')}` : '';
    const limit = Math.min(Math.max(Number(req.query.limit) || 60, 1), 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM jobs j${clause}`).get(...params) as { n: number }).n;
    const rows = db.prepare(`${SELECT}${clause} ORDER BY j.created_at DESC, j.rowid DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
    res.json({ videos: rows.map(toVideo), total });
  })
);

libraryRouter.get(
  '/videos/:id',
  route((req, res) => {
    res.json(toVideo(getRow(idParam(req))));
  })
);

// A person watched a held video and says it is fine. It becomes postable; nothing is posted by this call.
libraryRouter.post(
  '/videos/:id/approve',
  route((req, res) => {
    const row = getRow(idParam(req));
    if (row.state !== 'held_for_review') throw new HttpError(400, 'Only a video that is held for review can be approved.');
    if (!locateMedia(row.video_path)) throw new HttpError(400, 'The video file is missing, so there is nothing to approve.');
    db.transaction(() => {
      db.prepare(`UPDATE jobs SET state = 'ready_to_publish', hold_reason = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(row.id);
      db.prepare(`UPDATE qa_inspections SET reviewer_action = 'manually_approved' WHERE job_id = ?`).run(row.id);
    })();
    res.json(toVideo(getRow(row.id)));
  })
);

libraryRouter.post(
  '/videos/:id/reject',
  route((req, res) => {
    const row = getRow(idParam(req));
    if (row.state === 'published') throw new HttpError(400, 'This video is already posted. Remove it on TikTok or YouTube instead.');
    db.transaction(() => {
      db.prepare(`UPDATE jobs SET state = 'rejected', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(row.id);
      db.prepare(`UPDATE qa_inspections SET reviewer_action = 'discarded' WHERE job_id = ?`).run(row.id);
    })();
    res.json(toVideo(getRow(row.id)));
  })
);

libraryRouter.post(
  '/videos/:id/publish',
  route(async (req, res) => {
    const row = getRow(idParam(req));
    if (!['ready_to_publish', 'failed', 'scheduled'].includes(row.state)) {
      throw new HttpError(400, row.state === 'held_for_review' ? 'Approve this video first.' : 'This video cannot be posted from its current state.');
    }
    const video = locateMedia(row.video_path);
    if (!video) throw new HttpError(400, 'The video file is missing from disk, so it cannot be posted.');
    if (video.file !== row.video_path) {
      db.prepare('UPDATE jobs SET video_path = ? WHERE id = ?').run(video.file, row.id);
    }

    // Nothing is posted without a safety check on record: a video whose run died before the check gets it now.
    const cleared = row.qa_id && (row.qa_passed || row.qa_reviewer_action === 'manually_approved');
    if (!cleared) {
      const qa = await inspectJob(row.id, { title: row.concept_title, hook: row.hook || '', prompt: row.script_text || '', videoPath: video.file });
      if (!qa.passed) throw new HttpError(400, 'The safety check held this video. Review and approve it before posting.');
    }

    const result = startRepublish(row.id);
    if (!result.started) throw new HttpError(409, result.reason || 'Could not start posting.');
    res.status(202).json({ started: true, channel_id: result.channelId, ...getRunStatus(result.channelId) });
  })
);

libraryRouter.delete(
  '/videos/:id',
  route((req, res) => {
    const row = getRow(idParam(req));
    if (row.channel_id && isRunBusy(row.channel_id)) {
      throw new HttpError(409, 'This channel is making or posting a video right now. Try again when it finishes.');
    }
    for (const saved of [row.video_path, row.thumbnail_path]) {
      const found = locateMedia(saved);
      if (found) fs.rmSync(found.file, { force: true });
    }
    if (req.query.record === '1') {
      db.transaction(() => {
        db.prepare('DELETE FROM qa_inspections WHERE job_id = ?').run(row.id);
        db.prepare('UPDATE runs SET job_id = NULL WHERE job_id = ?').run(row.id);
        db.prepare('DELETE FROM jobs WHERE id = ?').run(row.id);
      })();
    }
    res.json({ success: true });
  })
);
