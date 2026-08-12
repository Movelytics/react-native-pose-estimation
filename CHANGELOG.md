# Changelog

All notable changes to the PoseTracker React Native human pose estimation SDK
will be documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/).
Versions follow [SemVer](https://semver.org/).

## [Unreleased]

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
