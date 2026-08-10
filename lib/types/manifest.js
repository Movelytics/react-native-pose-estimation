"use strict";
/**
 * Types for the `POST /api/sdk/configure` handshake response ("manifest").
 *
 * The manifest is the single source of truth for server-driven behavior:
 * exercise definitions (angle thresholds, rep state machines), reference
 * movements, engine bundle distribution and model profiles. Updating the
 * manifest server-side changes SDK behavior without republishing the app.
 */
Object.defineProperty(exports, "__esModule", { value: true });
