/**
 * Audio for a finished Grok video, made with ffmpeg before upload:
 *   - silent:  Grok's sound replaced by a silent track (for a sound picked from TikTok's library)
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

/**
 * Same video with Grok's sound replaced by SILENCE (a real, silent audio track, not no track): TikTok's sound editor
 * mixes its library sound into the video's audio on its servers, and a file without an audio track fails there
 * ("Failed to publish") after Post was accepted. Reused when it already exists.
 */
export async function makeMutedVideo(videoPath: string): Promise<string> {
  const out = variantPath(videoPath, 'silent');
  if (fs.existsSync(out) && fs.statSync(out).size > 0) return out;
  const { ffmpeg } = tools();
  await execFileAsync(
    ffmpeg,
    [
      '-y', '-v', 'error',
      '-i', videoPath,
      '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
      '-map', '0:v:0', '-map', '1:a:0',
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k',
      '-shortest', '-movflags', '+faststart',
      out,
    ],
    { timeout: 120_000 }
  );
  return out;
}

/**
 * Copy for Instagram/Facebook Reels: only the first video stream and the first audio stream. Grok's MP4 also carries
 * an embedded cover picture as an extra (mjpeg) video stream, and Instagram labelled such a Reel as having no audio.
 * The picture is dropped, the video is copied untouched, the sound is re-encoded as plain AAC 44.1 kHz stereo, and
 * the index goes first (faststart). A file without any audio stream fails, so it is never posted silently.
 */
export async function makeReelsCopy(videoPath: string): Promise<string> {
  const out = variantPath(videoPath, 'reels');
  if (fs.existsSync(out) && fs.statSync(out).size > 0) return out;
  const { ffmpeg } = tools();
  await execFileAsync(
    ffmpeg,
    [
      '-y', '-v', 'error',
      '-i', videoPath,
      '-map', '0:v:0', '-map', '0:a:0',
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-ac', '2',
      '-movflags', '+faststart',
      out,
    ],
    { timeout: 120_000 }
  );
  return out;
}

/**
 * Saves the video's last frame as a JPEG (small, so Grok processes it quickly as a starting image). Reads from 0.2 s
 * before the end, so the final frame is always found, and keeps the full resolution.
 */
export async function lastFrame(videoPath: string, out: string): Promise<string> {
  const { ffmpeg } = tools();
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await execFileAsync(
    ffmpeg,
    ['-y', '-v', 'error', '-sseof', '-0.2', '-i', videoPath, '-update', '1', '-q:v', '2', out],
    { timeout: 60_000 }
  );
  if (!fs.existsSync(out) || fs.statSync(out).size === 0) throw new Error(`Could not read the last frame of ${path.basename(videoPath)}.`);
  return out;
}

/**
 * Joins scene clips into one video, in order. Every clip is scaled/padded to the first clip's size and 24 fps and its
 * sound resampled, so clips that differ slightly still join; the sound of each clip is kept. A short audio fade at
 * each join hides clicks. Fails if any clip has no audio (never a silent stretch).
 */
export async function concatClips(clips: string[], out: string): Promise<string> {
  if (clips.length < 2) throw new Error('At least two clips are needed to join.');
  const { ffmpeg, ffprobe } = tools();
  const { stdout } = await execFileAsync(ffprobe, [
    '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', clips[0],
  ]);
  const [w, h] = stdout.trim().split(',').map((n) => Number(n));
  if (!w || !h) throw new Error('Could not read the first clip\'s size.');
  for (const c of clips) {
    const probe = await execFileAsync(ffprobe, ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', c]);
    if (!probe.stdout.trim()) throw new Error(`A scene has no sound (${path.basename(c)}), so the clips were not joined.`);
  }
  const inputs = clips.flatMap((c) => ['-i', c]);
  const filters: string[] = [];
  for (let i = 0; i < clips.length; i++) {
    const d = await mediaDuration(clips[i]);
    const fadeOut = Math.max(0, d - 0.15).toFixed(2);
    filters.push(
      `[${i}:v:0]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24,format=yuv420p[v${i}]`,
      `[${i}:a:0]aresample=44100,aformat=channel_layouts=stereo,afade=t=in:d=0.1,afade=t=out:st=${fadeOut}:d=0.15[a${i}]`
    );
  }
  const pairs = clips.map((_c, i) => `[v${i}][a${i}]`).join('');
  filters.push(`${pairs}concat=n=${clips.length}:v=1:a=1[v][a]`);
  await execFileAsync(
    ffmpeg,
    [
      '-y', '-v', 'error', ...inputs,
      '-filter_complex', filters.join(';'),
      '-map', '[v]', '-map', '[a]',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '160k',
      '-movflags', '+faststart',
      out,
    ],
    { timeout: 600_000 }
  );
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

/** Background music level under Grok's own sound (0..1). */
export const MUSIC_BED_VOLUME = 0.22;

/**
 * Same video with a quiet music track laid UNDER its own sound (voices and effects stay on top). The music loops if
 * shorter, fades in over 0.5 s and out over the last 1.5 s, and is turned down further while the video's own sound is
 * loud (sidechain ducking), so dialogue stays clear. The video stream is copied. Output: <video>_music.mp4.
 */
export async function addMusicBed(videoPath: string, musicFile: string, volume = MUSIC_BED_VOLUME): Promise<string> {
  const { ffmpeg, ffprobe } = tools();
  const out = variantPath(videoPath, 'music');
  const duration = await mediaDuration(videoPath);
  const fadeOutStart = Math.max(0, duration - 1.5).toFixed(2);
  const bed = `aresample=44100,aformat=channel_layouts=stereo`;
  const probe = await execFileAsync(ffprobe, ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', videoPath]);
  const hasVoice = probe.stdout.trim().length > 0;
  const filter = hasVoice
    ? `[0:a:0]${bed},asplit=2[voice][key];` +
      `[1:a:0]${bed},volume=${volume},afade=t=in:d=0.5,afade=t=out:st=${fadeOutStart}:d=1.5[bed];` +
      `[bed][key]sidechaincompress=threshold=0.04:ratio=5:attack=20:release=400[ducked];` +
      `[voice][ducked]amix=inputs=2:duration=first:normalize=0[a]`
    : `[1:a:0]${bed},volume=${Math.min(0.8, volume * 2.5)},afade=t=in:d=0.5,afade=t=out:st=${fadeOutStart}:d=1.5[a]`;
  await execFileAsync(
    ffmpeg,
    [
      '-y', '-v', 'error',
      '-i', videoPath,
      '-stream_loop', '-1', '-i', musicFile,
      '-filter_complex', filter,
      '-map', '0:v:0', '-map', '[a]',
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
      '-t', duration.toFixed(2),
      '-movflags', '+faststart',
      out,
    ],
    { timeout: 300_000 }
  );
  if (!fs.existsSync(out) || fs.statSync(out).size === 0) {
    throw new Error(`Adding the music to ${path.basename(videoPath)} failed: no output file.`);
  }
  return out;
}
