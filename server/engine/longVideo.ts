/**
 * One-minute videos made of scenes.
 *
 * Grok makes at most 15 seconds. The story is split into scenes; scene 1 starts from the channel's reference image and
 * every later scene starts from the LAST frame of the scene before it (the owner's choice), so the video continues
 * without a visible jump. Every scene prompt still describes the characters in full, which keeps them from drifting
 * as the frames are chained. The clips are then joined into one video (audioMix.concatClips).
 *
 * The split is done by ChatGPT in a temporary chat (the channel's prompt chat is never touched). Its answer is read from
 * the page text, which loses formatting, so the scenes are fenced by plain-text markers.
 */

export const LONG_SCENES = 4;
export const SCENE_SECONDS = 15;

const BEGIN = 'SCENES_BEGIN';
const END = 'SCENES_END';

/** The message sent to ChatGPT: turn one 15-second Grok prompt into `count` standalone scene prompts. */
export function scenesQuestion(basePrompt: string, title: string, count = LONG_SCENES, seconds = SCENE_SECONDS): string {
  return [
    `Below is a Grok Imagine video prompt for a ${seconds}-second kids' cartoon called "${title}".`,
    `Turn it into ONE longer story told in exactly ${count} scenes of ${seconds} seconds each (${count * seconds} seconds in total).`,
    'Each scene is generated SEPARATELY in Grok. Scene 1 starts from the character reference image; every later scene starts',
    'from the exact LAST FRAME of the scene before it, which is given to Grok as the starting image. So every scene prompt must:',
    '- describe the characters, their look and the setting in full, word for word the same in every scene (Grok sees only this prompt and one image);',
    '- for scenes 2 and later, begin with "Starting exactly from the image:" and continue the action smoothly from where the previous scene ended;',
    `- describe only what happens in that scene's ${seconds} seconds: scene 1 sets up the story, the middle scenes build it, the last scene has the funny ending;`,
    '- end each scene on a clear, well-lit shot with the characters fully visible, facing the camera, no motion blur (that frame starts the next scene);',
    `- keep the original prompt's rules, style, sound and safety notes, and end with the same settings line, set to ${seconds} seconds.`,
    '',
    `Answer with nothing but the scenes, in this exact plain-text format (no code blocks, no canvas):`,
    BEGIN,
    'SCENE 1:',
    '(full prompt for scene 1)',
    'SCENE 2:',
    '(full prompt for scene 2)',
    '(and so on)',
    END,
    '',
    'ORIGINAL PROMPT:',
    basePrompt,
  ].join('\n');
}

/**
 * Reads the scenes from ChatGPT's page text. The question itself also contains the markers, so only the LAST complete
 * BEGIN…END block counts. Returns exactly `count` prompts, or [] when the answer is incomplete or a scene is too short.
 */
export function parseScenes(pageText: string, count = LONG_SCENES): string[] {
  const text = (pageText || '').replace(/\r/g, '');
  const end = text.lastIndexOf(END);
  if (end < 0) return [];
  const begin = text.lastIndexOf(BEGIN, end);
  if (begin < 0) return [];
  const block = text.slice(begin + BEGIN.length, end);
  // The question's own template ("(full prompt for scene 1)") is never a real answer.
  if (/\(full prompt for scene/i.test(block)) return [];
  const parts = block.split(/^\s*\**\s*SCENE\s+(\d+)\s*\**\s*[:.\-–—]?\s*\**\s*$/gim);
  // split with a capture group: [before, n1, body1, n2, body2, ...]
  const scenes: string[] = [];
  for (let i = 1; i + 1 < parts.length; i += 2) {
    const n = Number(parts[i]);
    const body = parts[i + 1].trim();
    if (n !== scenes.length + 1) return [];
    scenes.push(body);
  }
  if (scenes.length !== count || scenes.some((s) => s.length < 60)) return [];
  return scenes;
}
