/**
 * One-minute videos made of scenes.
 *
 * Grok makes at most 15 seconds, so the story is planned by ChatGPT (a temporary chat; the channel's prompt chat is
 * never touched) as 4 scenes of 15 seconds, plus two picture prompts:
 *   - CAST IMAGE: Mr. Marshmallow (the channel's reference picture) with the other characters at their correct sizes,
 *     in the story's place. It is the first frame of scene 1 and a "Reference" for every scene, so nobody changes size
 *     or look (a baby yak turned into a huge yak when only text described it).
 *   - PLACE IMAGE: the place with its props and no characters, a "Reference" for every scene, so the background and
 *     the props stay put (a cake vanished and reappeared, the background changed).
 * Grok makes both pictures in Image mode, then every scene in Video mode with several images attached, each with a
 * role (Grok's image menu: First frame / Reference): scene 1 starts on the cast picture, every later scene starts on
 * the previous scene's last frame. The code puts the image legend at the top of every scene prompt (sceneImageLegend),
 * so "@Image 2" always means the same picture. The clips are then joined (audioMix.concatClips).
 *
 * The answer is read from the page text, which loses formatting, so it is fenced by plain-text markers.
 */

export const LONG_SCENES = 4;
export const SCENE_SECONDS = 15;

const BEGIN = 'SCENES_BEGIN';
const END = 'SCENES_END';

/**
 * The message sent to ChatGPT. The channel chat's "next" answer is a 15-second clip, so it is only the IDEA; ChatGPT
 * plans a simple, logical 1-minute story for toddlers and young kids (owner's feedback: the earlier stories made no
 * sense, things vanished, characters changed size, too many things happened at random).
 */
export function scenesQuestion(basePrompt: string, title: string, count = LONG_SCENES, seconds = SCENE_SECONDS): string {
  return [
    `Below is a Grok Imagine video prompt for a ${seconds}-second kids' cartoon called "${title}".`,
    `Use it only as the IDEA (main character, style, safety rules). Plan a ${count * seconds}-second story told in exactly`,
    `${count} scenes of ${seconds} seconds each, for babies, toddlers and young kids (1-6).`,
    '',
    'THE STORY MUST BE SIMPLE, LOGICAL AND HYPER-ENERGETIC (little kids have a very short attention span):',
    '- Use a classic, easy game little kids love: hide-and-seek, tag, a race, a treasure hunt, finding a lost toy, catching',
    '  a bouncing ball, a dance-off. One clear goal the whole minute (for example "find where Baby Sheep is hiding").',
    '- A little VILLAGE of friends: Mr. Marshmallow plus 3 or 4 cute baby animal friends from Marshmallow Village, each',
    '  with one clear colour and one funny habit. All of them are in the cast picture and in every scene, all doing things.',
    '- ONE place for the whole story (one village square, one meadow, one playground) with a few fixed props / hiding spots',
    '  that are there from the first second to the last.',
    '- NOBODY EVER STANDS STILL. Every character moves all the time: running, hopping, bouncing, spinning, sliding,',
    '  tumbling, dancing, chasing, waving, peeking. Something new and visible happens every 2-3 seconds. No task takes',
    '  longer than 3-4 seconds; no slow walking, no long looking around, no long talking. Fast, bouncy, cartoon timing.',
    '- Start every scene in the middle of the action (a big jump, a crash, a pop-up), with a hook in the first second.',
    '- Every scene follows from the one before: cause and effect a toddler can follow. Fast repetition is good (try, oops!,',
    '  try again, oops!, found!). Funny bumps, boings, slips and giggles (never scary or hurtful), a big happy ending.',
    '- Scene 1: the friends burst in and the goal starts at once. Scenes 2-3: quick tries that fail in funny ways, each',
    '  friend helping in their own way. Scene 4: the win, then everyone jumps, dances and cheers together.',
    '- Camera: lively and simple: quick push-ins, follow the running characters, playful swings; never a still camera.',
    '- ABSOLUTE RULES: characters never change size, shape, colour or species; props never disappear, appear from nowhere or',
    '  move by themselves; no new characters or places; the background stays the same place. No decorations appear for',
    '  the celebration (no banners, flags, balloons, confetti, mats or signs): celebrate with actions, hugs and cheers only.',
    '  Every object any scene mentions must be in the PLACE IMAGE prompt from the start.',
    '- Short, clear dialogue (a few words per line) and one simple catchphrase. Each speaking character has a fixed VOICE',
    '  description, copied word for word into every scene next to their lines.',
    '',
    'PICTURES (Grok will draw these first and attach them to every scene):',
    '- CAST IMAGE: a prompt for ONE picture of all the characters together, full body, side by side in the place, at their',
    '  correct sizes relative to Mr. Marshmallow (say the sizes, e.g. "Baby Sheep is half as tall as Mr. Marshmallow").',
    '  Mr. Marshmallow is the star: in the front and the centre, and the TALLEST; every friend is a baby animal between',
    '  half and three quarters of his height.',
    '  Say "Mr. Marshmallow exactly as in @Image 1". This picture is the opening shot of scene 1.',
    '- PLACE IMAGE: a prompt for ONE picture of the place alone, with every hiding spot / prop, and NO characters.',
    '- Both: soft pastel 3D cartoon, bright daylight, vertical 9:16, simple and uncluttered.',
    '',
    'SCENE PROMPTS (each one is generated separately in Grok, with these pictures attached):',
    '  @Image 1 = the first frame (scene 1: the cast picture; later scenes: the last frame of the scene before),',
    '  @Image 2 = Mr. Marshmallow, @Image 3 = the cast picture (correct sizes), @Image 4 = the place picture.',
    '- Refer to the pictures by these names ("keep Baby Sheep exactly as in @Image 3").',
    '- Describe the characters\' look and sizes in full, word for word the same in every scene.',
    '- For scenes 2 and later, continue the action exactly from @Image 1.',
    `- Describe the ${seconds} seconds beat by beat in 3-second beats (0-3s, 3-6s, 6-9s, 9-12s, 12-15s): what EVERY`,
    '  character is doing in each beat (all moving), camera move, short dialogue, sound effects (boing, whoosh, pop,',
    '  giggles), upbeat bouncy music. Busy and energetic, but every action is clear and easy to follow.',
    '- End on a clear, sharp frame with the characters visible (it starts the next scene).',
    `- Keep the original prompt's style, quality and safety rules, and end with the settings line set to ${seconds} seconds.`,
    '',
    'Answer with nothing but this, in this exact plain-text format (no code blocks, no canvas):',
    BEGIN,
    'CAST IMAGE:',
    '(picture prompt)',
    'PLACE IMAGE:',
    '(picture prompt)',
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

export interface StoryPlan {
  castImage: string;
  placeImage: string;
  scenes: string[];
}

/** The last complete BEGIN…END block on the page (the question itself contains the markers too), or ''. */
function lastBlock(pageText: string): string {
  const text = (pageText || '').replace(/\r/g, '');
  const end = text.lastIndexOf(END);
  if (end < 0) return '';
  const begin = text.lastIndexOf(BEGIN, end);
  if (begin < 0) return '';
  const block = text.slice(begin + BEGIN.length, end);
  // The question's own template ("(full prompt for scene 1)", "(picture prompt)") is never a real answer.
  return /\((full prompt for scene|picture prompt)/i.test(block) ? '' : block;
}

/**
 * A heading line: "CAST IMAGE:", "**SCENE 2:**", "### Scene 3 (0-15s):", "SCENE 4 — The big find". The text after the
 * heading on the same line belongs to its body (ChatGPT often writes "CAST IMAGE: Create ONE …" on one line). A
 * heading needs ":" / a dash, or nothing after it, so a body line like "Scene 1 ends with a hug" is not one.
 */
const HEADING = /^[\s#>*_]*(CAST IMAGE|PLACE IMAGE|SCENE\s+\d+)(?:\s*\([^)\n]{0,30}\))?[\s*_]*(?:(?::|\s[-–—]\s|[-–—]\s)[\s*_]*(.*)|$)/i;

/**
 * Reads ChatGPT's plan: the two picture prompts and exactly `count` scene prompts. null when anything is missing or
 * too short (never a partial story).
 */
export function parsePlan(pageText: string, count = LONG_SCENES): StoryPlan | null {
  const block = lastBlock(pageText);
  if (!block) return null;
  const sections: Array<{ head: string; lines: string[] }> = [];
  for (const line of block.split('\n')) {
    const m = line.match(HEADING);
    if (m) sections.push({ head: m[1].toUpperCase().replace(/\s+/g, ' '), lines: m[2] ? [m[2]] : [] });
    else if (sections.length) sections[sections.length - 1].lines.push(line);
  }
  let castImage = '';
  let placeImage = '';
  const scenes: string[] = [];
  for (const s of sections) {
    const body = s.lines.join('\n').replace(/[\s*_]+$/, '').trim();
    if (s.head === 'CAST IMAGE') castImage = body;
    else if (s.head === 'PLACE IMAGE') placeImage = body;
    else {
      const n = Number(s.head.replace(/\D/g, ''));
      if (n !== scenes.length + 1) return null;
      scenes.push(body);
    }
  }
  if (scenes.length !== count || scenes.some((s) => s.length < 60)) return null;
  if (castImage.length < 30 || placeImage.length < 30) return null;
  return { castImage, placeImage, scenes };
}

/** Scene prompts only (kept for callers and tests that only need the scenes). */
export function parseScenes(pageText: string, count = LONG_SCENES): string[] {
  return parsePlan(pageText, count)?.scenes || [];
}

/**
 * Put at the top of every scene prompt by the code, matching the order the pictures are attached in, so "@Image n"
 * always means the same picture whatever ChatGPT wrote.
 */
export function sceneImageLegend(scene: number): string {
  return [
    'PICTURES ATTACHED:',
    `@Image 1 = the first frame: this scene starts exactly on this picture${scene > 1 ? ' (the last frame of the previous scene)' : ''}.`,
    '@Image 2 = Mr. Marshmallow: keep his exact look and size.',
    '@Image 3 = all the characters at their correct sizes: keep every character exactly this size, shape, colour and look.',
    '@Image 4 = the place: keep this exact background, hiding spots and props; nothing disappears or appears from nowhere.',
    'Do not add, remove or resize any character or object unless this prompt says so. No new decorations, banners, flags,',
    'balloons, confetti or mats; the camera stays in this same place.',
    '',
  ].join('\n');
}

/**
 * The pictures attached to a scene, in the order sceneImageLegend names them: @Image 1 first frame, @Image 2
 * Mr. Marshmallow, @Image 3 cast, @Image 4 place. A missing picture is replaced by the nearest one we have, so the
 * numbering never shifts (a shifted "@Image 3" would point Grok at the wrong picture). [] when there is nothing at all.
 */
export function sceneImages(p: { first?: string; character?: string; cast?: string; place?: string }): Array<{
  path: string;
  role: 'first' | 'reference';
}> {
  const character = p.character || p.cast || p.first;
  const cast = p.cast || character;
  const place = p.place || cast;
  const first = p.first || cast;
  if (!first || !character || !cast || !place) return [];
  return [
    { path: first, role: 'first' },
    { path: character, role: 'reference' },
    { path: cast, role: 'reference' },
    { path: place, role: 'reference' },
  ];
}
