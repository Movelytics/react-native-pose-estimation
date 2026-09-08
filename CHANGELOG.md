# Changelog

All notable changes to the PoseTracker React Native human pose estimation SDK
will be documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/).
Versions follow [SemVer](https://semver.org/).

## [Unreleased]

## [0.3.1] — 2026-09-08

### Changed

- Handshake default is now **V4** (`engineChannel: 'v4'` unless `engine: 'v3'`).
- Unlabeled `startExercise('squat')` / `face_squat` still runs the production V3 FSM (embedded in `engine-v4.bundle.js`).
- Pass `engine: 'v4'` at the Provider for the V4 catalog squat; `engine: 'v3'` for the full V3 bundle.
- V4-only ids (`shoulder_roll`, …) work on the default handshake (no extra flag).

### Notes

- Apps on **0.3.0** still default to V3 until they upgrade. **0.2.x** still omits `engineChannel` and stays on V3.
- V4 does not emit `recommendations`. V4 does emit `progression`.

## [0.3.0] — 2026-08-26

### Added

- Opt-in engine channel `engine: 'v4'` on `PoseTrackerProvider` / `configure()` (default remains `'v3'`).
- Handshake sends `engineChannel`; V4 downloads `engine-v4.bundle.js` (remote engine `4.0.0`).
- V4 catalog: `squat`, `shoulder_roll`, `shoulder_deep_breath`, `chair_forward_fold`.
- V4-only ids on a V3 client throw `Exercise 'x' requires engine: 'v4'` (no silent fallback).
- `getEngineChannel()`, `listExercises()` on the V4 bundle, `exercise_summary` on V4 `stopExercise()`.

### Notes

- Jumps (`jump_analysis`, `air_time_jump`) stay V3-only.
- V4 does not emit `recommendations`.
- Apps on **0.2.x** are unchanged (handshake without `engineChannel` still gets V3).

## [0.2.2] — 2026-08-21

### Added

- Expo Go Snack try path in the README (offline + light), linking
  https://docs.posetracker.com/try-expo-go

## [0.2.1] — 2026-08-12

### Changed

- Minor client/session wiring for PoseTracker-internal diagnostics (not a supported public API — see private ops notes).

### Notes

- Exercise counting is served by the **remote engine** via `configure`. Apps on **0.2.0** continue to work when Strapi serves the current engine bundle.

## [0.2.0] — 2026-08-11

### Added

- Camera / video / image media sources
- Branded loading UI + plan-gated watermark
- Default PoseTracker skeleton theme + `skeletonUuid` / `skeletonDef`
- Cold-start modes: `basic` (no camera) vs `full`
- Host permissions docs (`docs/PERMISSIONS.md`)
- Publishing / SEO-GEO runbook (`docs/PUBLISHING.md`, `llms.txt`)

### Fixed

- Hermes-safe engine bundle (Babel after esbuild)
- WebView parity: grades A–F, nested `counter.form_score`, classic angles

## [Light 0.1.0] — 2026-08-11

First public release of **`@pose-tracker/react-native-pose-estimation-light`**.

- Online MoveNet / TF.js (CDN + product model URL); no bundled weights
- Packed tarball ~**206 kB** vs offline ~**9.9 MB** (see `docs/LIGHT_SDK.md`)
- GitHub: https://github.com/Movelytics/react-native-pose-estimation-light

## [0.1.3] — 2026-08-10

### Fixed

- `SDK_VERSION` handshake now tracks `package.json` (was stuck on 0.1.1)
- npm tarball no longer ships duplicate `bundledRuntimeAssets.js` in `src/` (~9 MB saved); Metro uses `lib/`

## [0.1.2] — 2026-08-10

### Changed

- Live watermark (“powered by” + logo) ~20% larger

## [0.1.1] — 2026-08 (first public npm)
