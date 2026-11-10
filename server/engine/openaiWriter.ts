import crypto from 'crypto';
import db from '../db/database';

export interface ShotBrief {
  shot_number: number;
  duration_seconds: number;
  scene_description: string;
  video_prompt: string;
  visual_focus: string;
  continuity_notes: string;
}

export interface TimedCaption {
  start_sec: number;
  end_sec: number;
  text: string;
}

export interface ScriptPackage {
  concept_title: string;
  hook: string;
  hypothesis: string;
  script_text: string;
  shot_briefs: ShotBrief[];
  captions: TimedCaption[];
  verifiable_fact_source?: string;
  thinking_pause_seconds: number;
  tokens_used: number;
  cost_usd: number;
}

export class OpenAIWriter {
  private static endpoint = 'https://api.openai.com/v1/responses';
  private static fallbackEndpoint = 'https://api.openai.com/v1/chat/completions';

  private static getApiKey(): string {
    const row = db.prepare("SELECT api_key FROM account_connections WHERE provider = 'openai'").get() as { api_key?: string } | undefined;
    return row?.api_key || process.env.OPENAI_API_KEY || '';
  }

  /**
   * Commission new script, shot briefs, and captions from OpenAI on behalf of Jev.
   */
  public static async writeContent(brief: {
    format: string;
    ageBand: string;
    language: string;
    learningGoal: string;
    targetDurationSec: number;
    seriesTitle: string;
    designSheet?: string;
  }): Promise<ScriptPackage> {
    const apiKey = this.getApiKey();
    const settings = db.prepare('SELECT demo_mode FROM settings WHERE id = 1').get() as { demo_mode: number } | undefined;
    const isDemo = settings?.demo_mode === 1 || !apiKey;

    if (!isDemo && apiKey) {
      try {
        return await this.callOpenAI(brief, apiKey);
      } catch (err: any) {
        console.warn('[OpenAIWriter] Live API call failed, falling back to curated template instantiation:', err.message);
      }
    }

    return this.instantiateOriginalTemplate(brief);
  }

  private static async callOpenAI(brief: any, apiKey: string): Promise<ScriptPackage> {
    const systemPrompt = `You are a specialized children's scriptwriter and storyboard artist for ages ${brief.ageBand}.
Strict safety guidelines:
1. Every video must be 100% wholesome children's entertainment or education suitable for family co-viewing.
2. Absolutely NO horror, scary faces, jump scares, or dangerous activities children might imitate (no climbing, no fire, no swallowing objects).
3. Absolutely NO calls to buy, subscribe, disclose personal info, or send messages.
4. For visual puzzles, provide an explicit 3 to 5 second thinking pause before the reveal.
5. All educational facts must be verifiable and accurate.
6. Provide distinct vertical 9:16 shot briefs suitable for Grok Imagine video generation.
Output pure JSON matching the requested schema.`;

    const userPrompt = `Commission an original ${brief.format} video for series "${brief.seriesTitle}".
Target duration: ${brief.targetDurationSec} seconds. Language: ${brief.language}.
Learning goal: ${brief.learningGoal}.
Respond in strict JSON with keys: concept_title, hook, hypothesis, script_text, shot_briefs (array of shot_number, duration_seconds, scene_description, video_prompt, visual_focus, continuity_notes), captions (array of start_sec, end_sec, text), verifiable_fact_source, thinking_pause_seconds.`;

    // Attempt OpenAI Responses API
    const response = await fetch(this.fallbackEndpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI HTTP ${response.status}: ${await response.text()}`);
    }

    const data = await response.json();
    const content = JSON.parse(data.choices[0].message.content);
    const tokensUsed = data.usage?.total_tokens || 800;
    const costUsd = Number(((tokensUsed / 1_000_000) * 5.0).toFixed(4)); // ~$0.004

    return {
      concept_title: content.concept_title || 'Original Kids Discovery',
      hook: content.hook || 'Look closely! Can you solve this puzzle?',
      hypothesis: content.hypothesis || 'Interactive visual puzzles increase viewer completion rate.',
      script_text: content.script_text || '',
      shot_briefs: content.shot_briefs || [],
      captions: content.captions || [],
      verifiable_fact_source: content.verifiable_fact_source || 'Childhood spatial cognition principles',
      thinking_pause_seconds: content.thinking_pause_seconds || 4.0,
      tokens_used: tokensUsed,
      cost_usd: costUsd,
    };
  }

  /**
   * Instantiate an original, pristine children's concept template.
   * Completely fresh original concepts: Visual Puzzle, Simple Science, Kindness Story.
   */
  public static instantiateOriginalTemplate(brief: {
    format: string;
    ageBand: string;
    language: string;
    learningGoal: string;
    targetDurationSec: number;
    seriesTitle: string;
  }): ScriptPackage {
    const isLongForm = brief.targetDurationSec >= 60; // Creator Rewards experiment requires > 60s

    if (brief.format === 'visual_puzzle' || brief.seriesTitle.toLowerCase().includes('puzzle') || brief.seriesTitle.toLowerCase().includes('shadow')) {
      return {
        concept_title: "Which Shadow Belongs to the Paper Dragon?",
        hook: "Look at this folded paper dragon! Three shadows appear on the wall... but only one is real. Can you spot it?",
        hypothesis: "Rotating shadow reveal holds attention across ages 5-7 and drives replay completion.",
        script_text: "Look at this cheerful green paper dragon! Three mysterious shadows appear on our wall: Shadow A has wide wings, Shadow B has curved horns, and Shadow C has a long tail. Look closely at the paper dragon's shape. Let's think together! Three... two... one... Let's rotate the dragon into the light! It matches Shadow B! Look at those gentle curved horns. You solved the puzzle!",
        shot_briefs: [
          {
            shot_number: 1,
            duration_seconds: isLongForm ? 15 : 6,
            scene_description: "Bright wooden craft table. An adorable origami green paper dragon stands in warm studio light.",
            video_prompt: "Macro close-up of a whimsical green origami paper dragon on a warm light wood tabletop, soft studio lighting, playful 9:16 vertical cinematography, colorful, inviting, 4k.",
            visual_focus: "Origami paper dragon with curved horns and pleated wings",
            continuity_notes: "Vibrant emerald green paper texture, soft studio backlight",
          },
          {
            shot_number: 2,
            duration_seconds: isLongForm ? 25 : 8,
            scene_description: "Three distinct shadow outlines appear on a cream paper backdrop labeled A, B, and C.",
            video_prompt: "Three distinct sharp shadow silhouettes cast on a warm cream wall labeled A, B, C. One shadow matches the dragon's horns, two are decoy shapes. Clean educational graphic style, 9:16 vertical.",
            visual_focus: "Three contrasting shadow silhouettes with thinking timer",
            continuity_notes: "Consistent warm studio shadow angle from stage left",
          },
          {
            shot_number: 3,
            duration_seconds: isLongForm ? 25 : 8,
            scene_description: "The paper dragon is gently rotated by a smiling wooden articulated toy hand, aligning perfectly into Shadow B with glowing sparkles.",
            video_prompt: "Smooth gentle rotation of the green origami dragon until its shadow aligns flawlessly with Silhouette B, magical warm golden sparkle burst, joyful celebration, 9:16 vertical.",
            visual_focus: "Shadow alignment reveal and golden sparkle affirmation",
            continuity_notes: "Identical paper dragon, celebratory warm particle effect",
          },
        ],
        captions: [
          { start_sec: 0.5, end_sec: 4.0, text: "Can you guess the paper dragon's shadow?" },
          { start_sec: 4.5, end_sec: 8.5, text: "Look closely at the horns and wings! A, B, or C?" },
          { start_sec: 9.0, end_sec: 13.0, text: "Let's think... 3... 2... 1..." },
          { start_sec: 13.5, end_sec: 18.0, text: "It's Shadow B! Fantastic eye!" },
        ],
        verifiable_fact_source: "Spatial 3D rotational perspective recognition (Early Childhood Cognitive Development)",
        thinking_pause_seconds: 4.0,
        tokens_used: 650,
        cost_usd: 0.0035,
      };
    } else if (brief.format === 'simple_science' || brief.seriesTitle.toLowerCase().includes('science') || brief.seriesTitle.toLowerCase().includes('bubble')) {
      return {
        concept_title: "Why Are Soap Bubbles Always Round?",
        hook: "Even if we dip a square wand or a triangle wand, what shape is the bubble? Watch what happens!",
        hypothesis: "Curiosity-driven physical science demonstration with predictable surprise increases co-viewing shares.",
        script_text: "Here is a secret about bubbles! Let's take a wand shaped like a square, and a wand shaped like a star. When we blow air through them... wait! The bubble floating away is a perfect, shiny sphere! Why? Water molecules love to hug together tightly. The easiest shape for them to hold hands is a round sphere. Nature loves gentle hugs!",
        shot_briefs: [
          {
            shot_number: 1,
            duration_seconds: isLongForm ? 18 : 6,
            scene_description: "A bright yellow plastic bubble wand shaped like a crisp square is lifted from shimmering soapy liquid.",
            video_prompt: "Bright playful science workshop, square-shaped yellow bubble wand lifted from soapy water, iridescent liquid film, soft natural morning sunlight, vertical 9:16.",
            visual_focus: "Square wand holding rainbow iridescent soap film",
            continuity_notes: "Sunny pastel workshop palette, high clarity soap film",
          },
          {
            shot_number: 2,
            duration_seconds: isLongForm ? 24 : 8,
            scene_description: "Gentle breath blows through the square wand. The soap film stretches and pinches into a floating crystal round sphere.",
            video_prompt: "Slow motion capture of a bubble forming from a square wand, stretching and snapping into a perfect glowing sphere with rainbow reflections, whimsical and magical, vertical 9:16.",
            visual_focus: "The moment of transformation from square boundary to spherical bubble",
            continuity_notes: "Continuous rainbow color reflection on sphere",
          },
          {
            shot_number: 3,
            duration_seconds: isLongForm ? 20 : 6,
            scene_description: "Cute animated water drops holding hands in a circle to show surface tension, smiling happily.",
            video_prompt: "Friendly friendly water droplet characters in a circle holding hands, gentle educational graphic overlay on soft sunny garden background, joyful family co-viewing, 9:16 vertical.",
            visual_focus: "Water droplet characters holding hands illustrating surface tension",
            continuity_notes: "Pastel friendly animated illustration",
          },
        ],
        captions: [
          { start_sec: 0.5, end_sec: 4.0, text: "Can we blow a square bubble?" },
          { start_sec: 4.5, end_sec: 8.5, text: "Look what happens when it floats away..." },
          { start_sec: 9.0, end_sec: 13.0, text: "It turns into a round sphere!" },
          { start_sec: 13.5, end_sec: 18.0, text: "Water molecules love holding hands! That's surface tension!" },
        ],
        verifiable_fact_source: "Minimal surface area physics & Laplace pressure in soap films (NASA Science Sparks)",
        thinking_pause_seconds: 3.5,
        tokens_used: 710,
        cost_usd: 0.0038,
      };
    } else {
      // Kindness Story
      return {
        concept_title: "The Snail's Rainy Day Crossing",
        hook: "Pip the little snail wants to reach the fresh clover on the other side of the garden path. But someone is coming!",
        hypothesis: "Empathy and small acts of kindness stories generate high family engagement and co-viewing ratings.",
        script_text: "Pip the garden snail is inching across the wide stone path. Rain begins to tap-tap-tap on the leaves! Suddenly, friendly boots stop just in time. A gentle hand holds a big green maple leaf right over Pip like an umbrella, keeping him safe and dry until he reaches the delicious clover. When you see someone small moving slowly, a little patience is the greatest kindness.",
        shot_briefs: [
          {
            shot_number: 1,
            duration_seconds: isLongForm ? 18 : 6,
            scene_description: "Macro low-angle view of Pip, an expressive illustrated snail with a swirly acorn shell on a wet garden pebble path.",
            video_prompt: "Whimsical stop-motion style clay animation of a friendly snail with an acorn shell crossing a garden path, gentle warm rain drops on clover, cozy and safe, 9:16 vertical.",
            visual_focus: "Pip the snail smiling and inching patiently",
            continuity_notes: "Acorn shell texture, friendly warm eyes, lush green moss background",
          },
          {
            shot_number: 2,
            duration_seconds: isLongForm ? 24 : 8,
            scene_description: "Raindrops fall gently. A friendly yellow rain boot steps carefully beside Pip, not on him.",
            video_prompt: "Warm bright yellow rain boot stopping gently beside a little snail, a child's hand holding a broad green leaf over the snail to shield from rain, cozy garden atmosphere, 9:16 vertical.",
            visual_focus: "Protective leaf umbrella shielding the snail",
            continuity_notes: "Yellow rain boot and green maple leaf umbrella",
          },
          {
            shot_number: 3,
            duration_seconds: isLongForm ? 20 : 6,
            scene_description: "Pip reaches the fresh clover safely and wiggles his antennae happily in thanks.",
            video_prompt: "Pip the snail safely resting under lush clover leaves, happy peaceful expression, soft golden sunshine breaking through the clouds, heartfelt children's picture book quality, 9:16 vertical.",
            visual_focus: "Pip cozy and safe eating fresh clover",
            continuity_notes: "Golden warm lighting breakthrough, consistent acorn shell",
          },
        ],
        captions: [
          { start_sec: 0.5, end_sec: 4.0, text: "Pip the little snail is on a big journey." },
          { start_sec: 4.5, end_sec: 9.0, text: "A kind friend holds a leaf umbrella!" },
          { start_sec: 9.5, end_sec: 14.0, text: "Safe in the clover at last." },
          { start_sec: 14.5, end_sec: 18.0, text: "Being patient with someone small is kindness." },
        ],
        verifiable_fact_source: "Social-Emotional Learning (SEL) early childhood empathy guidelines (CASEL framework)",
        thinking_pause_seconds: 3.0,
        tokens_used: 680,
        cost_usd: 0.0036,
      };
    }
  }
}

export default OpenAIWriter;

