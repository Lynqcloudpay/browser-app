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
    'THE STORY MUST BE FUN, CLEVER, ENERGETIC AND PHYSICALLY REAL (little kids have a very short attention span):',
    '- Think like the writer of a hit preschool cartoon: ONE funny, surprising premise a 3-year-old gets in one second',
    '  (a friend who sneezes and gets blown backwards, a puddle that makes everyone dance when they step in it, a too-tall',
    '  friend stuck under a low branch, a game of copy-me that gets sillier). Rule of three: try, fail funnier, try BIGGER,',
    '  fail even funnier, then a clever win, and a last-second surprise twist that makes kids laugh.',
    '- SMALL CAST: Mr. Marshmallow plus 2 cute baby animal friends from Marshmallow Village (3 characters in total), each',
    '  with one clear colour, one funny habit and a big expressive face. All three are in the cast picture and every scene.',
    '- ONE place for the whole story (one meadow, one village square, one playground) with at most 2 BIG, simple props',
    '  (a tree, a puddle, a slide, a big box, a hill) that stay where they are from the first second to the last.',
    '- ENERGY COMES FROM BODIES, FACES, CAMERA AND MUSIC, NOT FROM OBJECTS. Nobody stands still: bouncing, hopping,',
    '  spinning, wiggling, running, sliding on their bottom, dancing, big surprised jumps, huge happy and shocked faces.',
    '  A new big, clear action every 5 seconds; no slow walking, no long talking, nobody frozen.',
    '- REAL PHYSICS (AI video breaks objects that fly or change hands, so avoid them): an object only moves while a',
    '  character is visibly holding or pushing it, and it stays where it was put. NEVER: throwing, catching, kicking,',
    '  rolling or bouncing balls, ball games or sports (no bowling, soccer, basketball), passing things between',
    '  characters, pouring, stacking, building, vehicles, magic, objects flying or moving by themselves. Characters walk',
    '  and land on the ground with weight; one action at a time per character, clear cause and effect.',
    '- NO MIX-UPS OF BODIES AND THINGS (AI video melts them together): never a character hiding inside, under or behind',
    '  an object, no disguises or costumes, no "a thing with legs", no only-legs-or-tail-showing gags, nothing that looks',
    '  like something else, no transformations. Every character is always fully visible, head to feet, with clear empty',
    '  space between characters: no hugging, piling up, carrying each other or overlapping. Every animal has exactly 4',
    '  legs, 2 ears and 1 tail; Mr. Marshmallow has 2 arms and 2 feet.',
    '- Start every scene in the middle of the action with a hook in the first second (a big jump, a funny face, a fall',
    '  on the bottom). Every scene follows from the one before. Bumps, boings and giggles are funny, never scary or hurtful.',
    '- Scene 1: the funny problem starts at once. Scenes 2-3: bigger and funnier tries that fail. Scene 4: the clever win,',
    '  the surprise twist, then all three dance and cheer together.',
    '- Camera: a steady wide shot with all three characters in view, with slow gentle push-ins only; no whip pans, no',
    '  fast swings, no extreme close-ups (fast camera moves make the picture melt).',
    '- MUSIC: cheerful, bouncy kids\' background music plays under EVERY scene from the first frame to the last and never',
    '  stops, with the dialogue and sound effects on top. Write this in every scene.',
    '- ABSOLUTE RULES: characters never change size, shape, colour or species; props never disappear, appear from nowhere or',
    '  move by themselves; no new characters or places; the background stays the same place. No decorations appear for',
    '  the celebration (no banners, flags, balloons, confetti, mats or signs): celebrate with actions, hugs and cheers only.',
    '  Every object any scene mentions must be in the PLACE IMAGE prompt from the start.',
    '- DIALOGUE: at most 3 short spoken lines per scene (2-4 words each), every line different, never repeated in another',
    '  scene. NO catchphrase. Never use the word "silly" anywhere in the prompts (Grok reads descriptive words out loud).',
    '  Write each line as: Name says: "line". Add to every scene: "Only the quoted lines are spoken; no other words,',
    '  no narrator, no on-screen text or captions." Each speaking character has a fixed VOICE description, copied word',
    '  for word into every scene.',
    '- Character habits are physical only (a bounce, a sneeze, an ear wiggle), never a word or phrase.',
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
    `- Describe the ${seconds} seconds in 3 beats of 5 seconds (0-5s, 5-10s, 10-15s). In each beat ONE character does the`,
    '  one main action (big and clear: a jump, a run, a slide, a sneeze) while the other two react with simple bouncing,',
    '  clapping or surprised faces in place. Fewer, clearer actions: Grok breaks bodies when too much happens at once.',
    '  Add sound effects (boing, whoosh, giggles).',
    '- Say in every scene: "Cheerful bouncy background music plays the whole time, under the voices."',
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
    'Real physics: objects never move, fly or roll by themselves; an object moves only while a character holds or pushes',
    'it. Characters never merge with each other or with objects: every animal keeps exactly 4 legs, 2 ears and 1 tail,',
    'Mr. Marshmallow keeps 2 arms and 2 feet, and everyone stays fully visible with space between them.',
    'Only the quoted lines are spoken; no other words, no narrator, no on-screen text or captions.',
    'Cheerful background music plays the whole time, under the voices.',
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
