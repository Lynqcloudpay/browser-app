import fs from 'fs';
import path from 'path';

/**
 * Operator preferences for Grok Imagine video generation (resolution and duration).
 * Stored in storage/grok_settings.json (git-ignored).
 */

export type GrokResolution = '480p' | '720p';
export type GrokDuration = 6 | 10 | 15;

export interface GrokSettings {
  resolution: GrokResolution;
  duration: GrokDuration;
}

const FILE = process.env.KINDRED_GROK_SETTINGS_FILE || path.join(__dirname, '../../storage/grok_settings.json');

export const DEFAULT_GROK_SETTINGS: GrokSettings = {
  resolution: '720p',
  duration: 15,
};

export function getGrokSettings(): GrokSettings {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    const resolution: GrokResolution = raw.resolution === '480p' ? '480p' : '720p';
    const duration: GrokDuration = [6, 10, 15].includes(Number(raw.duration))
      ? (Number(raw.duration) as GrokDuration)
      : 15;
    return { resolution, duration };
  } catch {
    return { ...DEFAULT_GROK_SETTINGS };
  }
}

export function setGrokSettings(input: Partial<GrokSettings>): GrokSettings {
  const next: GrokSettings = { ...getGrokSettings() };
  if (input.resolution === '480p' || input.resolution === '720p') {
    next.resolution = input.resolution;
  }
  if ([6, 10, 15].includes(Number(input.duration))) {
    next.duration = Number(input.duration) as GrokDuration;
  }
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(next, null, 2));
  return next;
}

