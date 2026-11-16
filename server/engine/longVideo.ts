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
 * Second round of feedback: the first story stood in one frame and the voices changed between scenes. So the request
 * now asks for travel, 3-4 visible action beats and camera moves per scene, cliffhangers between scenes, and a fixed
 * VOICE description per character copied into every scene (Grok invents a voice per generation otherwise).
 */
export function scenesQuestion(basePrompt: string, title: string, count = LONG_SCENES, seconds = SCENE_SECONDS): string {
  return [
    `Below is a Grok Imagine video prompt for a ${seconds}-second kids' cartoon called "${title}".`,
    `Use it only as the IDEA (characters, setting, style, rules). Write a NEW ${count * seconds}-second ADVENTURE STORY around it,`,
    `told in exactly ${count} scenes of ${seconds} seconds each, that makes a young child (3-7) want to keep watching to the end.`,
    'Do NOT stretch the short clip\'s single gag over the scenes, and NEVER let a scene be characters standing in one spot talking.',
    '',
    'STORY (think of a great 1-minute cartoon episode):',
    '- Scene 1, HOOK: the very first second is a surprise (something pops, falls, runs past, goes BOING). We instantly learn what the',
    '  heroes want (a goal kids understand: find, catch, win, rescue, deliver). End on a question the child wants answered.',
    '- Scene 2, CHASE / TRY: the heroes go after it and MOVE through a new part of the world (path, bridge, hill, river, playground).',
    '  First attempt fails in a funny physical way. A new element appears (a second animal, a gadget, a rolling object).',
    '- Scene 3, BIGGEST TROUBLE: things escalate, faster and sillier (a chase, a tumble, a mix-up, a chain reaction). Peak excitement.',
    '- Scene 4, PAYOFF: a clever or silly idea saves the day, a big happy celebration (dance, cheer, hug), and a final funny button',
    '  gag in the last second.',
    '- Every scene ends on a mini-cliffhanger or "uh-oh" moment that the next scene picks up.',
    '- Use a simple catchphrase the hero says in scene 1 and again at the end. One or two moments may talk to the viewer',
    '  ("Can you see it?", "Count with me: one, two, three!").',
    '',
    'MAKE IT DYNAMIC (every scene):',
    '- 3 to 4 clear story beats per scene, each with visible action: running, jumping, sliding, chasing, bouncing, hiding, spinning.',
    '- The camera moves: tracking shots following the characters, a quick zoom on a funny face, a low angle for big moments, a',
    '  wide shot to show where they are going. Characters cross the frame, the background changes as they travel.',
    '- Funny sound effects (boing, whoosh, splash, pop) and lively, cheerful music matching the action.',
    '',
    'VOICES MUST STAY THE SAME IN EVERY SCENE (Grok makes each scene separately and otherwise invents a new voice each time):',
    '- In scene 1, give every speaking character a fixed VOICE description (for example: "Mr. Marshmallow: a soft, warm, gentle,',
    '  slightly deep cheerful voice, speaks slowly"; "Baby goat: a tiny, high-pitched, giggly voice, short words").',
    '- Copy each character\'s VOICE description word for word into every scene, next to their dialogue.',
    '- Keep dialogue short (a few words per line, at most 3 to 4 lines per scene). Only the characters with a voice description speak.',
    '',
    'GROK RULES (each scene is generated SEPARATELY; scene 1 starts from the character reference image, every later scene starts',
    'from the exact LAST FRAME of the scene before it, given to Grok as the starting image). Every scene prompt must:',
    '- describe the characters\' look in full, word for word the same in every scene (Grok sees only this prompt and one image);',
    '- for scenes 2 and later, begin with "Starting exactly from the image:" and continue the action from where the previous scene',
    '  ended; the characters may then travel to a new spot in the same world;',
    `- describe that scene's ${seconds} seconds beat by beat with rough timings (0-4s, 4-8s, 8-12s, 12-15s): action, camera, dialogue;`,
    '- end on a frame where the main characters are clearly visible and sharp (no heavy motion blur), even if they are mid-action;',
    `- keep the original prompt's style, quality and safety rules, and end with the same settings line, set to ${seconds} seconds.`,
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
