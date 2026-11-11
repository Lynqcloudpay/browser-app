import crypto from 'crypto';
import db from '../db/database';
import { isValidVideoFile } from './videoFile';

export interface Flag {
  issue: string;
  severity: 'critical' | 'warning';
}

export interface QAResult {
  passed: boolean;
  overallScore: number;
  kidsSafeScore: number;
  audioClarityScore: number;
  visualCoherenceScore: number;
  flaggedReasons: Flag[];
  sampledFrames: string[];
  reviewerAction: 'auto_passed' | 'held';
}

export interface InspectInput {
  title: string;
  hook: string;
  /** The full ChatGPT / Grok prompt text. This is what Grok is asked to render, so it is scanned in full. */
  prompt: string;
  videoPath: string;
  coverPath?: string | null;
}

// Terms are phrases a kids' video prompt should not contain. Single words that are also harmless in everyday
// description ("lighter shade", "fire truck", "eye socket", "a stranger arrives") are listed as the risky phrase
// instead, so a normal prompt is not held. A hold stops the video from posting until a person approves it.
const DANGEROUS_ACTIONS = [
  'play with fire', 'playing with fire', 'set fire', 'sets fire', 'setting fire', 'on fire', 'catch fire', 'start a fire',
  'matchstick', 'strike a match', 'cigarette lighter', 'cigarette', 'vape', 'alcohol', 'beer', 'drunk',
  'knife', 'knives', 'razor blade', 'gun', 'pistol', 'rifle', 'weapon',
  'swallow', 'poison', 'choke', 'suffocate', 'plastic bag', 'bleach', 'pills',
  'electrical outlet', 'power socket', 'jump out the window', 'jump off the roof', 'run into the street',
  'go with a stranger', 'talk to strangers',
];

const FRIGHTENING_THEMES = [
  'horror', 'demon', 'kill', 'corpse', 'blood', 'bloody', 'jump scare', 'nightmare',
  'bleed', 'terrified', 'haunted', 'death', 'dead', 'die', 'murder', 'gore', 'stab', 'strangle',
];

const COMMERCIAL_AND_DATA_EXPLOITATION = [
  'buy now', 'credit card', 'give me your email', 'tell me your name', 'where do you live',
  'send a photo', 'message me', 'enter your password', 'personal info', 'what is your address',
  'home address', 'phone number',
];

/** A term matches as a whole word, allowing simple plurals and -ed/-ing (knife, knives, fires, killing...). */
function termPattern(term: string): RegExp {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}(s|es|ed|ing)?\\b`, 'i');
}

const CATEGORIES: Array<{ terms: string[]; describe: (term: string) => string }> = [
  {
    terms: DANGEROUS_ACTIONS,
    describe: (t) => `Detected potentially hazardous action unsafe for children to imitate: "${t}"`,
  },
  {
    terms: FRIGHTENING_THEMES,
    describe: (t) => `Detected frightening or horror theme unsuitable for family co-viewing: "${t}"`,
  },
  {
    terms: COMMERCIAL_AND_DATA_EXPLOITATION,
    describe: (t) => `Detected commercial call-to-action or request for personal details from minors: "${t}"`,
  },
];

/**
 * Pure text scan: returns one critical flag per matching term. No database or file access, so it can be unit-tested.
 */
export function scanTextForSafety(text: string): Flag[] {
  const flags: Flag[] = [];
  for (const category of CATEGORIES) {
    for (const term of category.terms) {
      if (termPattern(term).test(text)) {
        flags.push({ issue: category.describe(term), severity: 'critical' });
      }
    }
  }
  return flags;
}

/**
 * Runs the kids-safety text scan and the video integrity check, stores a qa_inspections row and updates the job state.
 * The job row must already exist.
 */
export async function inspectJob(jobId: string, input: InspectInput): Promise<QAResult> {
  const flaggedReasons = scanTextForSafety(`${input.title} ${input.hook} ${input.prompt}`);

  // Video integrity: a missing or non-MP4/WebM file is critical; nothing can be posted without it.
  const videoValid = isValidVideoFile(input.videoPath);
  if (!videoValid) {
    flaggedReasons.push({
      issue: input.videoPath
        ? 'Video file is missing or is not a valid MP4/WebM file'
        : 'Video file path is missing',
      severity: 'critical',
    });
  }

  const criticalCount = flaggedReasons.filter((r) => r.severity === 'critical').length;
  const passed = criticalCount === 0;
  const kidsSafeScore = criticalCount === 0 ? 1 : 0;
  const audioClarityScore = videoValid ? 1 : 0;
  const visualCoherenceScore = videoValid ? 1 : 0;
  const overallScore = kidsSafeScore;
  const reviewerAction = passed ? 'auto_passed' : 'held';
  const sampledFrames = input.coverPath ? [input.coverPath] : [];

  const qaId = 'qa_' + crypto.randomUUID().slice(0, 10);
  db.prepare(`
    INSERT INTO qa_inspections (
      id, job_id, passed, overall_score, flagged_reasons_json,
      sampled_frames_json, kids_safe_score, audio_clarity_score,
      visual_coherence_score, reviewer_action, reviewed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(
    qaId,
    jobId,
    passed ? 1 : 0,
    overallScore,
    JSON.stringify(flaggedReasons),
    JSON.stringify(sampledFrames),
    kidsSafeScore,
    audioClarityScore,
    visualCoherenceScore,
    reviewerAction
  );

  if (!passed) {
    const holdReason = flaggedReasons.slice(0, 3).map((r) => r.issue).join('; ');
    db.prepare(`
      UPDATE jobs
      SET state = 'held_for_review',
          hold_reason = ?,
          hold_timestamp_sec = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(holdReason || 'Automated QA did not pass', jobId);
  } else {
    db.prepare(`UPDATE jobs SET state = 'ready_to_publish', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(jobId);
  }

  return {
    passed,
    overallScore,
    kidsSafeScore,
    audioClarityScore,
    visualCoherenceScore,
    flaggedReasons,
    sampledFrames,
    reviewerAction,
  };
}
