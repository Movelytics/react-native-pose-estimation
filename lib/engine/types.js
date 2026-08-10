"use strict";
/**
 * Contract between the SDK shell and the engine (business logic: angles,
 * rep counting, form scoring, posture, progression, recommendations).
 *
 * The engine is EXCLUSIVELY distributed remotely as a versioned JS bundle
 * (signed URL in the handshake manifest, SHA-256 integrity check, sealed
 * local cache) — the npm package ships zero business logic. Without a
 * loaded engine the SDK runs in keypoints-only mode.
 */
Object.defineProperty(exports, "__esModule", { value: true });
