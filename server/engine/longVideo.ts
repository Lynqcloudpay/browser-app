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

/**
 * The message sent to ChatGPT: the channel chat's "next" answer is a 15-second clip, so it is used only as the idea, and
 * ChatGPT writes a real 1-minute story (hook, problem, twist, payoff) in `count` scene prompts. Splitting the short
 * clip instead stretched one small action over a minute with nothing to follow (owner's feedback).
 */
export function scenesQuestion(basePrompt: string, title: string, count = LONG_SCENES, seconds = SCENE_SECONDS): string {
  return [
    `Below is a Grok Imagine video prompt for a ${seconds}-second kids' cartoon called "${title}".`,
    `Use it only as the IDEA (characters, setting, style, rules): write a NEW, complete ${count * seconds}-second story around`,
    `that idea, told in exactly ${count} scenes of ${seconds} seconds each. Do NOT stretch the short clip's single action over`,
    `${count} scenes: a viewer must be able to follow a real story for the full ${count * seconds} seconds, with something new`,
    'happening in every scene. Story shape:',
    '- Scene 1: the hook and setup. Within the first seconds something surprising or funny happens, and we learn what the characters want.',
    '- Scene 2: they try, and a problem or obstacle appears.',
    '- Scene 3: the problem gets bigger or takes a funny twist; the tension peaks.',
    '- Scene 4: the payoff: the problem is solved in a surprising, funny way, with a happy, heartwarming ending.',
    'Keep it simple enough for young children: few characters, one location (or two that are clearly connected), clear actions.',
    'Each scene is generated SEPARATELY in Grok. Scene 1 starts from the character reference image; every later scene starts',
    'from the exact LAST FRAME of the scene before it, which is given to Grok as the starting image. So every scene prompt must:',
    '- describe the characters, their look and the setting in full, word for word the same in every scene (Grok sees only this prompt and one image);',
    '- for scenes 2 and later, begin with "Starting exactly from the image:" and continue the action smoothly from where the previous scene ended;',
    `- describe only what happens in that scene's ${seconds} seconds, beat by beat (what the characters do and say);`,
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
