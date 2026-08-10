# Changelog

All notable changes to the PoseTracker React Native human pose estimation SDK
will be documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/).
Versions follow [SemVer](https://semver.org/).

## [Unreleased]

### Added

- Branded loading UI + plan-gated watermark
- Default PoseTracker skeleton theme + `skeletonUuid` / `skeletonDef`
- Cold-start modes: `basic` (no camera) vs `full`
- Host permissions docs (`docs/PERMISSIONS.md`)
- Publishing / SEO-GEO runbook (`docs/PUBLISHING.md`, `llms.txt`)

### Fixed

- Hermes-safe engine bundle (Babel after esbuild)
- WebView parity: grades A–F, nested `counter.form_score`, classic angles

## [0.1.1] — 2026-08 (internal)

- Internal monorepo release before first public npm publish.

## [0.1.0] — TBD (first public npm)

- First public release of `@pose-tracker/react-native-pose-estimation`
  (org: https://www.npmjs.com/org/pose-tracker — see `docs/PUBLISHING.md`).
