import fs from 'fs';
import path from 'path';

/** Where each finished video is posted, and how. Stored in storage/publish_targets.json (git-ignored). */

export type YouTubeVisibility = 'public' | 'unlisted' | 'private';

export interface PublishTargets {
  tiktok: boolean;
  youtube: boolean;
  /** YouTube requires every video to be marked "made for kids" or "not made for kids". This app's videos are kids' entertainment. */
  youtubeMadeForKids: boolean;
  youtubeVisibility: YouTubeVisibility;
}

const FILE = process.env.KINDRED_TARGETS_FILE || path.join(__dirname, '../../storage/publish_targets.json');

export const DEFAULT_TARGETS: PublishTargets = {
  tiktok: true,
  youtube: true,
  youtubeMadeForKids: true,
  youtubeVisibility: 'public',
};

const VISIBILITIES: YouTubeVisibility[] = ['public', 'unlisted', 'private'];

export function getPublishTargets(): PublishTargets {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return {
      tiktok: typeof raw.tiktok === 'boolean' ? raw.tiktok : DEFAULT_TARGETS.tiktok,
      youtube: typeof raw.youtube === 'boolean' ? raw.youtube : DEFAULT_TARGETS.youtube,
      youtubeMadeForKids: typeof raw.youtubeMadeForKids === 'boolean' ? raw.youtubeMadeForKids : DEFAULT_TARGETS.youtubeMadeForKids,
      youtubeVisibility: VISIBILITIES.includes(raw.youtubeVisibility) ? raw.youtubeVisibility : DEFAULT_TARGETS.youtubeVisibility,
    };
  } catch {
    return { ...DEFAULT_TARGETS };
  }
}

export function setPublishTargets(input: Partial<PublishTargets>): PublishTargets {
  const next: PublishTargets = { ...getPublishTargets() };
  if (typeof input.tiktok === 'boolean') next.tiktok = input.tiktok;
  if (typeof input.youtube === 'boolean') next.youtube = input.youtube;
  if (typeof input.youtubeMadeForKids === 'boolean') next.youtubeMadeForKids = input.youtubeMadeForKids;
  if (input.youtubeVisibility !== undefined) {
    if (!VISIBILITIES.includes(input.youtubeVisibility)) throw new Error('YouTube visibility must be public, unlisted or private.');
    next.youtubeVisibility = input.youtubeVisibility;
  }
  if (!next.tiktok && !next.youtube) throw new Error('Turn on at least one place to post (TikTok or YouTube).');
  fs.writeFileSync(FILE, JSON.stringify(next, null, 2));
  return next;
}
