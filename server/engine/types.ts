/** Output resolution Grok Imagine offers in its composer. */
export type GrokResolution = '480p' | '720p';

export interface ShotBrief {
  shot_number: number;
  duration_seconds: number;
  scene_description: string;
  video_prompt: string;
  visual_focus: string;
  continuity_notes: string;
}

/** The ChatGPT output the browser pipeline works from: one title, one hook and the full Grok prompt. */
export interface ScriptPackage {
  concept_title: string;
  hook: string;
  script_text: string;
  shot_briefs: ShotBrief[];
}
