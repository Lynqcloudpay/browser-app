/**
 * Audio for a finished Grok video, made with ffmpeg before upload:
 *   - muted:   Grok's sound removed (for a platform library sound picked on TikTok / YouTube)
 *   - my song: Grok's sound removed and the channel's own song laid underneath, cut to the video's length
 * The video stream is copied, never re-encoded. ffmpeg comes from Homebrew (`brew install ffmpeg`) or FFMPEG_PATH.
 */
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const CANDIDATES = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'];

function findTool(name: 'ffmpeg' | 'ffprobe'): string | null {
  const fromEnv = name === 'ffmpeg' ? process.env.FFMPEG_PATH : process.env.FFPROBE_PATH;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  const dirs = [...(process.env.PATH || '').split(':'), ...CANDIDATES];
  for (const dir of dirs) {
    if (!dir) continue;
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export function audioToolsAvailable(): boolean {
  return Boolean(findTool('ffmpeg') && findTool('ffprobe'));
}

function tools(): { ffmpeg: string; ffprobe: string } {
  const ffmpeg = findTool('ffmpeg');
  const ffprobe = findTool('ffprobe');
  if (!ffmpeg || !ffprobe) {
    throw new Error('ffmpeg is not installed, so the audio cannot be changed. Install it with: brew install ffmpeg');
  }
  return { ffmpeg, ffprobe };
}

/** Video length in seconds. */
export async function mediaDuration(file: string): Promise<number> {
  const { ffprobe } = tools();
  const { stdout } = await execFileAsync(ffprobe, [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file,
  ]);
  const d = Number(String(stdout).trim());
  if (!Number.isFinite(d) || d <= 0) throw new Error(`Could not read the length of ${path.basename(file)}.`);
  return d;
}

const variantPath = (videoPath: string, suffix: string) => {
  const ext = path.extname(videoPath) || '.mp4';
  return path.join(path.dirname(videoPath), `${path.basename(videoPath, ext)}_${suffix}.mp4`);
};

/** Same video with no audio track. Reused when it already exists. */
export async function makeMutedVideo(videoPath: string): Promise<string> {
  const out = variantPath(videoPath, 'muted');
  if (fs.existsSync(out) && fs.statSync(out).size > 0) return out;
  const { ffmpeg } = tools();
  await execFileAsync(ffmpeg, ['-y', '-v', 'error', '-i', videoPath, '-map', '0:v:0', '-c:v', 'copy', '-an', '-movflags', '+faststart', out], {
    timeout: 120_000,
  });
  return out;
}

/**
 * Same video with Grok's sound replaced by the song: the song starts at 0, loops if shorter than the video, is cut at
 * the video's end and fades out over the last half second.
 */
export async function makeVideoWithSong(videoPath: string, songFile: string): Promise<string> {
  const { ffmpeg } = tools();
  // One file per song (song.mp3 → _song, youtube_track.m4a → _youtube_track): TikTok and YouTube may use different ones.
  const out = variantPath(videoPath, path.basename(songFile, path.extname(songFile)).replace(/[^a-z0-9_]+/gi, '_'));
  const duration = await mediaDuration(videoPath);
  const fade = Math.min(0.5, duration / 4);
  await execFileAsync(
    ffmpeg,
    [
      '-y', '-v', 'error',
      '-i', videoPath,
      '-stream_loop', '-1', '-i', songFile,
      '-map', '0:v:0', '-map', '1:a:0',
      '-c:v', 'copy',
      '-c:a', 'aac', '-b:a', '192k',
      '-af', `afade=t=out:st=${(duration - fade).toFixed(2)}:d=${fade.toFixed(2)}`,
      '-t', duration.toFixed(2),
      '-movflags', '+faststart',
      out,
    ],
    { timeout: 120_000 }
  );
  return out;
}

/** Recognise the song formats the app accepts from the first bytes of the file. */
export function detectSongExtension(buf: Buffer): '.mp3' | '.m4a' | '.wav' | '.aac' | null {
  if (buf.length < 12) return null;
  if (buf.subarray(0, 3).toString('ascii') === 'ID3') return '.mp3';
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) {
    // MPEG audio frame: layer bits 01 = layer III (mp3); layer 00 = ADTS AAC
    return (buf[1] & 0x06) === 0 ? '.aac' : '.mp3';
  }
  if (buf.subarray(4, 8).toString('ascii') === 'ftyp') return '.m4a';
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WAVE') return '.wav';
  return null;
}
