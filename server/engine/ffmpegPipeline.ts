import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { TimedCaption } from './openaiWriter';
import { RenderedShot } from './xaiVideoGenerator';

const execFileAsync = promisify(execFile);

export interface AssembledVideoResult {
  videoPath: string;
  thumbnailPath: string;
  captionsVttPath: string;
  durationSeconds: number;
  sampledFrames: string[];
  fileSizeBytes: number;
}

export class FFmpegPipeline {
  /**
   * Generates a voiceover narration audio file.
   * Uses macOS `say` when available, with fallback to procedural audio tone synthesis.
   */
  public static async generateVoiceover(scriptText: string, outputDir: string): Promise<string> {
    const audioPathAiff = path.join(outputDir, `voice_${Date.now()}_${crypto.randomUUID().slice(0, 6)}.aiff`);
    const audioPathAac = audioPathAiff.replace('.aiff', '.m4a');

    try {
      // Use clean warm system voice
      await execFileAsync('say', ['-v', 'Samantha', '-r', '175', '-o', audioPathAiff, scriptText]);
      // Convert to AAC
      await execFileAsync('ffmpeg', [
        '-y',
        '-i', audioPathAiff,
        '-c:a', 'aac',
        '-b:a', '128k',
        audioPathAac,
      ]);
      if (fs.existsSync(audioPathAiff)) fs.unlinkSync(audioPathAiff);
      return audioPathAac;
    } catch (err: any) {
      console.warn('[FFmpegPipeline] `say` command voiceover failed or unavailable, synthesizing chime tone:', err.message);
      // Fallback: Generate gentle musical speech pacing via aevalsrc
      const estDuration = Math.max(8, Math.round(scriptText.split(' ').length * 0.45));
      await execFileAsync('ffmpeg', [
        '-y',
        '-f', 'lavfi',
        '-i', `aevalsrc=sin(440*2*PI*t)*0.1:s=44100:d=${estDuration}`,
        '-c:a', 'aac',
        audioPathAac,
      ]);
      return audioPathAac;
    }
  }

  /**
   * Generates gentle background music and chimes for family co-viewing.
   */
  public static async generateBackgroundMusic(durationSec: number, outputDir: string): Promise<string> {
    const musicPath = path.join(outputDir, `bgm_${Date.now()}_${crypto.randomUUID().slice(0, 6)}.m4a`);
    // Gentle lofi chord progression using harmonic sine waves
    const filter = `aevalsrc=(sin(261.63*2*PI*t)*0.03 + sin(329.63*2*PI*t)*0.02 + sin(392.00*2*PI*t)*0.025 + sin(523.25*2*PI*t)*0.015):s=44100:d=${durationSec}`;
    await execFileAsync('ffmpeg', [
      '-y',
      '-f', 'lavfi',
      '-i', filter,
      '-c:a', 'aac',
      '-b:a', '96k',
      musicPath,
    ]);
    return musicPath;
  }

  /**
   * Generates a WebVTT and SRT caption file from timed captions.
   */
  public static generateSubtitleFiles(captions: TimedCaption[], outputDir: string): { vttPath: string; srtPath: string } {
    const baseName = `captions_${Date.now()}_${crypto.randomUUID().slice(0, 6)}`;
    const vttPath = path.join(outputDir, `${baseName}.vtt`);
    const srtPath = path.join(outputDir, `${baseName}.srt`);

    let vttContent = 'WEBVTT\n\n';
    let srtContent = '';

    const formatTimestampVtt = (sec: number) => {
      const m = Math.floor(sec / 60);
      const s = Math.floor(sec % 60);
      const ms = Math.floor((sec % 1) * 1000);
      return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
    };

    const formatTimestampSrt = (sec: number) => {
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      const s = Math.floor(sec % 60);
      const ms = Math.floor((sec % 1) * 1000);
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
    };

    captions.forEach((cap, idx) => {
      vttContent += `${idx + 1}\n${formatTimestampVtt(cap.start_sec)} --> ${formatTimestampVtt(cap.end_sec)}\n${cap.text}\n\n`;
      srtContent += `${idx + 1}\n${formatTimestampSrt(cap.start_sec)} --> ${formatTimestampSrt(cap.end_sec)}\n${cap.text}\n\n`;
    });

    fs.writeFileSync(vttPath, vttContent, 'utf-8');
    fs.writeFileSync(srtPath, srtContent, 'utf-8');

    return { vttPath, srtPath };
  }

  /**
   * Concatenate shots, mix voiceover and background music, generate thumbnail, and extract sample frames for QA.
   */
  public static async assembleVideo(
    jobId: string,
    shots: RenderedShot[],
    scriptText: string,
    captions: TimedCaption[]
  ): Promise<AssembledVideoResult> {
    const storageDir = path.join(__dirname, '../../storage');
    const videosDir = path.join(storageDir, 'videos');
    const thumbDir = path.join(storageDir, 'thumbnails');
    const framesDir = path.join(storageDir, 'frames');

    [videosDir, thumbDir, framesDir].forEach((dir) => {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    });

    // 1. Measure raw Grok shot duration
    let singleShotDur = 15;
    if (shots.length > 0 && fs.existsSync(shots[0].filePath)) {
      try {
        const { stdout: shotDurOut } = await execFileAsync('ffprobe', [
          '-v', 'error',
          '-show_entries', 'format=duration',
          '-of', 'default=noprint_wrappers=1:nokey=1',
          shots[0].filePath,
        ]);
        const p = parseFloat(shotDurOut.trim());
        if (!isNaN(p) && p > 0) singleShotDur = p;
      } catch {}
    }

    const finalVideoPath = path.join(videosDir, `final_${jobId}.mp4`);
    let totalShotDuration = singleShotDur;

    // 2. Assemble/Copy Video - NEVER replace Grok's original sound or truncate the video!
    if (shots.length === 1) {
      console.log(`[FFmpegPipeline] Preserving 100% genuine Grok video with original audio soundtrack (${singleShotDur}s): ${shots[0].filePath}`);
      fs.copyFileSync(shots[0].filePath, finalVideoPath);
    } else {
      // Multiple shots: Concatenate preserving original video and audio streams via FFmpeg copy
      const concatListPath = path.join(videosDir, `concat_${jobId}.txt`);
      const shotBasenames = shots.map((s) => `file '${path.resolve(s.filePath).replace(/'/g, "\\'")}'`);
      fs.writeFileSync(concatListPath, shotBasenames.join('\n'), 'utf-8');

      try {
        await execFileAsync('ffmpeg', [
          '-y',
          '-f', 'concat',
          '-safe', '0',
          '-i', concatListPath,
          '-c', 'copy',
          finalVideoPath,
        ]);
      } catch (concatErr: any) {
        console.warn('[FFmpegPipeline] Stream copy concat note, using re-encode fallback:', concatErr.message);
        await execFileAsync('ffmpeg', [
          '-y',
          '-f', 'concat',
          '-safe', '0',
          '-i', concatListPath,
          '-c:v', 'libx264',
          '-pix_fmt', 'yuv420p',
          '-c:a', 'aac',
          finalVideoPath,
        ]);
      }

      if (fs.existsSync(concatListPath)) fs.unlinkSync(concatListPath);

      // Measure final concatenated video duration
      try {
        const { stdout: totalOut } = await execFileAsync('ffprobe', [
          '-v', 'error',
          '-show_entries', 'format=duration',
          '-of', 'default=noprint_wrappers=1:nokey=1',
          finalVideoPath,
        ]);
        const tp = parseFloat(totalOut.trim());
        if (!isNaN(tp) && tp > 0) totalShotDuration = tp;
      } catch {}
    }

    // 3. Generate subtitles
    const { vttPath } = this.generateSubtitleFiles(captions, videosDir);

    // 6. Extract high-res thumbnail (at 2.0s or half duration)
    const thumbnailPath = path.join(thumbDir, `thumb_${jobId}.jpg`);
    await execFileAsync('ffmpeg', [
      '-y',
      '-ss', '2.0',
      '-i', finalVideoPath,
      '-vframes', '1',
      '-q:v', '2',
      thumbnailPath,
    ]);

    // 7. Sample key frames across the full video span for Kids Safety QA Inspection
    const sampledFrames: string[] = [];
    const sampleIntervals = [
      2.0,
      Math.round(totalShotDuration * 0.25),
      Math.round(totalShotDuration * 0.50),
      Math.round(totalShotDuration * 0.75),
      Math.max(2.0, Math.round(totalShotDuration * 0.95)),
    ];
    for (let i = 0; i < sampleIntervals.length; i++) {
      const sec = sampleIntervals[i];
      if (sec < totalShotDuration) {
        const framePath = path.join(framesDir, `frame_${jobId}_${i + 1}.jpg`);
        try {
          await execFileAsync('ffmpeg', [
            '-y',
            '-ss', `${sec}`,
            '-i', finalVideoPath,
            '-vframes', '1',
            '-q:v', '4',
            framePath,
          ]);
          sampledFrames.push(framePath);
        } catch (fErr) {
          // ignore frame extraction boundary errors
        }
      }
    }

    const fileStats = fs.statSync(finalVideoPath);

    return {
      videoPath: finalVideoPath,
      thumbnailPath,
      captionsVttPath: vttPath,
      durationSeconds: totalShotDuration,
      sampledFrames,
      fileSizeBytes: fileStats.size,
    };
  }
}

export default FFmpegPipeline;
