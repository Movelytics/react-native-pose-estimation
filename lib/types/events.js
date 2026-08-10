"use strict";
/**
 * SDK event types.
 *
 * These mirror the postMessage payloads of the existing PoseTracker WebView
 * API (keypoints, angles, counter, posture, progression, recommendations,
 * form_score, exercise_summary) so existing integrations can migrate with
 * minimal changes: the WebView `onMessage` JSON becomes a typed callback.
 */
Object.defineProperty(exports, "__esModule", { value: true });
