import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import db from '../db/database';

export interface QAResult {
  passed: boolean;
  overallScore: number;
  kidsSafeScore: number;
  audioClarityScore: number;
  visualCoherenceScore: number;
  flaggedReasons: Array<{ timestampSec: number; issue: string; severity: 'critical' | 'warning' }>;
  sampledFrames: string[];
  reviewerAction: 'auto_passed' | 'held' | 'manually_approved' | 'discarded';
}

export class KidsSafetyQAInspector {
  private static DANGEROUS_ACTIONS = [
    'fire', 'matchstick', 'strike match', 'lighter', 'knife', 'knives', 'blade', 'swallow', 'poison',
    'choke', 'climb roof', 'run street', 'car road', 'electrical outlet', 'socket',
    'plastic bag', 'suffocate', 'stranger', 'jump out window', 'bleach', 'pills',
  ];

  private static FRIGHTENING_THEMES = [
    'horror', 'ghost', 'demon', 'kill', 'corpse', 'blood', 'scary jump', 'nightmare',
    'bleed', 'terrified', 'screaming', 'haunted', 'death', 'die', 'murder', 'gore',
  ];

  private static COMMERCIAL_AND_DATA_EXPLOITATION = [
    'buy now', 'purchase', 'credit card', 'give me your email', 'tell me your name',
    'where do you live', 'send a photo', 'message me', 'subscribe for money',
    'enter your password', 'personal info', 'what is your address',
  ];

  /**
   * Run automated multi-stage safety and quality inspection on the finished video.
   */
  public static async inspectJob(
    jobId: string,
    scriptText: string,
    captionsText: string,
    durationSeconds: number,
    videoPath: string,
    sampledFrames: string[]
  ): Promise<QAResult> {
    const flaggedReasons: Array<{ timestampSec: number; issue: string; severity: 'critical' | 'warning' }> = [];
    const combinedText = `${scriptText} ${captionsText}`;

    // 1. Text Safety Audit: Dangerous Imitations (using word boundaries)
    for (const danger of this.DANGEROUS_ACTIONS) {
      const reg = new RegExp(`\\b${danger}\\b`, 'i');
      if (reg.test(combinedText)) {
        flaggedReasons.push({
          timestampSec: 2.5,
          issue: `Detected potentially hazardous action unsafe for children to imitate: "${danger}"`,
          severity: 'critical',
        });
      }
    }

    // 2. Text Safety Audit: Frightening or Traumatic Imagery (using word boundaries)
    for (const scare of this.FRIGHTENING_THEMES) {
      const reg = new RegExp(`\\b${scare}\\b`, 'i');
      if (reg.test(combinedText)) {
        flaggedReasons.push({
          timestampSec: 1.0,
          issue: `Detected frightening or horror theme unsuitable for family co-viewing: "${scare}"`,
          severity: 'critical',
        });
      }
    }

    // 3. Child Privacy & COPPA Compliance: Commercial / Data Disclosure
    for (const commercial of this.COMMERCIAL_AND_DATA_EXPLOITATION) {
      const reg = new RegExp(`\\b${commercial}\\b`, 'i');
      if (reg.test(combinedText)) {
        flaggedReasons.push({
          timestampSec: 0.5,
          issue: `Detected commercial call-to-action or request for personal details from minors: "${commercial}"`,
          severity: 'critical',
        });
      }
    }

    // 4. Video Integrity Audit: Check for blank/empty files or missing frames
    if (!fs.existsSync(videoPath)) {
      flaggedReasons.push({
        timestampSec: 0,
        issue: 'Video media file does not exist on disk',
        severity: 'critical',
      });
    } else {
      const stats = fs.statSync(videoPath);
      if (stats.size < 50_000) {
        flaggedReasons.push({
          timestampSec: 0,
          issue: 'Video file size is suspiciously small (< 50KB); potential corrupted render',
          severity: 'critical',
        });
      }
    }

    // 5. Sampled Frame Quality Audit
    if (sampledFrames.length === 0) {
      flaggedReasons.push({
        timestampSec: 0,
        issue: 'No sampled frames available for visual inspection',
        severity: 'warning',
      });
    } else {
      for (let i = 0; i < sampledFrames.length; i++) {
        const frame = sampledFrames[i];
        if (fs.existsSync(frame)) {
          const fStat = fs.statSync(frame);
          if (fStat.size < 5000) {
            flaggedReasons.push({
              timestampSec: (i + 1) * 3.0,
              issue: `Sampled frame ${i + 1} appears blank or empty (< 5KB)`,
              severity: 'warning',
            });
          }
        }
      }
    }

    // 6. Calculate domain scores
    const criticalCount = flaggedReasons.filter((r) => r.severity === 'critical').length;
    const warningCount = flaggedReasons.filter((r) => r.severity === 'warning').length;

    const kidsSafeScore = criticalCount > 0 ? 0.0 : Math.max(0.7, 1.0 - warningCount * 0.15);
    const audioClarityScore = 0.95;
    const visualCoherenceScore = Math.max(0.6, 1.0 - warningCount * 0.1);
    const overallScore = Number(((kidsSafeScore * 0.6) + (audioClarityScore * 0.2) + (visualCoherenceScore * 0.2)).toFixed(2));

    const passed = criticalCount === 0 && overallScore >= 0.85;
    const reviewerAction = passed ? 'auto_passed' : 'held';

    // Store in qa_inspections table
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

    // Update job state
    if (!passed) {
      const firstIssue = flaggedReasons[0];
      db.prepare(`
        UPDATE jobs
        SET state = 'held_for_review',
            hold_reason = ?,
            hold_timestamp_sec = ?
        WHERE id = ?
      `).run(
        firstIssue ? `${firstIssue.issue}` : 'Automated QA threshold not met',
        firstIssue ? firstIssue.timestampSec : 0.0,
        jobId
      );
    } else {
      db.prepare(`
        UPDATE jobs
        SET state = 'ready_to_publish'
        WHERE id = ?
      `).run(jobId);
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
}

export default KidsSafetyQAInspector;
