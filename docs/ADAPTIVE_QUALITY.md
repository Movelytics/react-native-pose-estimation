# Adaptive camera quality & crash-loop guard

English developer reference for
`@pose-tracker/react-native-pose-estimation`.

This document describes how the SDK picks and adapts the **camera capture
profile** so pose inference stays stable across phones — especially mid-range
Android (Mali GPUs) where HD `getUserMedia` can destroy FPS even though MoveNet
itself always runs at 192×192.

Inspired by Sency’s `AdaptiveChoice` + `TfliteRuntimeGuard` (see
`sency-teardown/findings/SENCY_TEARDOWN.md`).

---

## 0. Capture priority (FPS vs preview sharpness)

Host option on `PoseTrackerProvider` / `PoseTrackerClient`:

```ts
<PoseTrackerProvider
  options={{
    // default — omit or set explicitly
    capturePriority: 'performance',
  }}
/>

// Opt into sharp preview; accept slower pose FPS (esp. Android mid-range):
<PoseTrackerProvider options={{ capturePriority: 'quality' }} />
```

| Value | Behaviour |
|-------|-----------|
| **`performance`** (default) | SDK optimizes for the platform FPS floor. On Android that includes soft-capping capture (often `basic` 320×240), warm-up mapping below-floor benches to `basic`, and live median-based downgrades. Preview can look soft; pose stays as fast as the device allows. |
| **`quality`** | Keep high capture (prime / device-native HD). **No FPS-driven capture downgrades** (warm-up or live). Pose FPS may drop well below the floor (e.g. ~5–8 on Mali). Still emits `performance_warning` so hosts can show a UX notice. Crash-guard (real crashes) can still move tiers. |

**Recommendation:** leave the default (`performance`) unless the product explicitly needs a sharp webcam feed and the integrator accepts slower skeleton updates. Image quality is part of the Android performance budget — raising capture cost almost always lowers pose FPS on mid-range GPUs.

Explicit `qualityChoice: 'prime' | 'pro' | …` still pins the starting tier; `capturePriority: 'quality'` only disables automatic FPS-driven drops.

---

## 0b. Minimum target FPS (platform floor)

The SDK uses a **minimum target FPS** (floor), not a single setpoint:

| Platform | Min target (floor) | Acceptable / ideal band |
|----------|--------------------|-------------------------|
| **iOS** | **30** | ~30–50+ |
| **Android** | **10** (experiment; was 15) | ~10–30 (harder on mid-range GPUs) |

Downgrades and `performance_warning` use the **min** only. Going above the
ideal band is fine.

1. **Warm-up estimate (before webcam)** — MoveNet is benched on zeros inside
   the WebView *before* `getUserMedia`. `estimatedFps = 1000 / medianMs`.
   If that estimate is below the platform min-target, the page picks a lower
   capture profile (`warmup_estimate` → `quality_changed` reason
   `warmup_estimate`) and only then opens the camera.
2. **Live auto-downgrade** — keyed on **median inference ms** (not pipeline
   FPS: camera+bitmap often keeps loop FPS ~20–25 on iPhone while execute
   is ~25–30 ms). If median stays above `1.2 × (1000/minTarget)` for 4
   samples *after* a 5 s settle window post-ready / quality swap, drop one
   tier. Live `low_fps` does **not** mark tiers as crash-FAILED.
3. **Developer warning** — if even `basic` cannot hold the floor, emit
   `performance_warning` (`device_too_slow`). Critical threshold is lower
   still (iOS &lt;20, Android &lt;10).

API: `getMinTargetFps()`, `getIdealFpsRange()`, `MIN_TARGET_FPS_IOS`,
`MIN_TARGET_FPS_ANDROID`. Quality state exposes `minTargetFps` +
`idealFpsRange` (`targetFps` kept as deprecated alias of the floor).

---

## 1. Why camera resolution matters

MoveNet Lightning always letterboxes frames to **192×192** before inference.
Preview quality and preprocess cost are driven by the **camera capture size**:

| Capture | Typical Mali `bitmap` (preprocess) | Typical Apple GPU |
|---------|------------------------------------|-------------------|
| 720×1280 | ~90–100 ms | ~4–5 ms |
| 240×320  | ~1 ms | ~1 ms |

On Android mid-range, an HD stream can make preprocess dominate the frame
budget. iOS usually stays real-time at HD.

PoseTrackerFront historically opens `getUserMedia({ video: true })` with **no**
resolution ideals (device-native HD preview). The SDK used to force AdaptiveChoice
ideals (often UltraLite on Android).

### Experiment: Front-aligned capture (`device-native`) — 2026-08-06

Flag file: [`src/quality/captureMode.ts`](../packages/pose-estimation-react-native/src/quality/captureMode.ts)

| Constant | Experiment (current) | Previous stable / iOS |
|----------|----------------------|------------------------|
| `CAPTURE_CONSTRAINT_MODE` | `'device-native'` | `'profile-constrained'` |
| `ENABLE_MALI_HARD_CAP` | `false` | `true` |
| `ANDROID_INFER_FRAME_SKIP` | `1` | `0` (iOS forced 0) |
| `ANDROID_PREPROCESS_PATH` | `'canvas-direct'` | `'imagebitmap'` (iOS) |
| `ANDROID_SOFT_CAP_PROFILE` | `'basic'` (320×240 max) | `null` (iOS) |
| `ANDROID_MIN_TARGET_FPS` | `10` | `15` (iOS stays 30) |
| `ANDROID_PERF_DEBUG` | `true` | n/a |

- **Cold open**: device-native, optionally soft-capped on Android (`pro` = max 960×540).
- **Live downgrade**: median full-pipeline ms vs `1.2 × (1000/minTarget)` (Android floor 10).
- **Frame skip / preprocess**: Android only; iOS unchanged.
- **Debug**: HUD + RN logs show stage breakdown, `inferred/skipped`, and `leverHints`
  (which stage dominates → which lever is still useful).

#### REVERT

```bash
# 1) Edit packages/pose-estimation-react-native/src/quality/captureMode.ts
#    CAPTURE_CONSTRAINT_MODE = 'profile-constrained'
#    ENABLE_MALI_HARD_CAP = true
#    ANDROID_INFER_FRAME_SKIP = 0
#    ANDROID_PREPROCESS_PATH = 'imagebitmap'
#    ANDROID_SOFT_CAP_PROFILE = null
#    ANDROID_MIN_TARGET_FPS = 15
#    ANDROID_PERF_DEBUG = false

cd packages/pose-estimation-react-native
npm run build:runtime-payload   # re-embeds pose-runtime.js
npm run build

cd ../../testapp
rm -rf node_modules/@pose-tracker/react-native-pose-estimation
npm install
npx expo start -c
```

You also kept a zip archive of the previous SDK as a full rollback.

---

## 2. Quality profiles

| Id | Capture (ideal) | Frame rate |
|----|-----------------|------------|
| `prime` | 1280×720 | 30 |
| `pro` | 960×540 | 30 |
| `lite` | 640×480 | 30 |
| `ultralite` | 480×360 | 24 |
| `basic` | 320×240 | 20 |

Ladder (highest → lowest): `prime → pro → lite → ultralite → basic`.

Auto-downgrade when live FPS &lt; platform **min target** (30 iOS / 15 Android),
not a per-profile different floor.

---

## 3. `AdaptiveChoice` (default)

```ts
<PoseTrackerProvider
  options={{
    qualityChoice: 'AdaptiveChoice', // default
    // or pin: 'basic' | 'ultralite' | 'lite' | 'pro' | 'prime'
  }}
>
```

Initial profile = device capability score (0–100) from:

- Platform (iOS starts much higher than Android)
- OS / Android API level
- Optional RAM via `expo-device` / `react-native-device-info` when present
- GL renderer hint once the WebView reports it (Mali → hard cap ≤ UltraLite)

Then the **crash-loop guard** may walk further down the ladder (see §4).
A previously saved last-good profile is restored only if it is **at most one
tier below** the suggested profile (a bigger gap is treated as stale — e.g.
an iPhone stuck on UltraLite after a bad session while capability says Pro).
Warm-up may also **upgrade** when the zeros bench shows clear headroom.

---

## 4. Crash-loop guard (`RuntimeGuard`)

State machine per `(sdkVersion, profile)` key, persisted in AsyncStorage when
`@react-native-async-storage/async-storage` is installed:

```
UNKNOWN → PROBING → PASSED
                 ↘ FAILED  (app died while probing, or 30s timeout)
```

1. Before booting a profile: `markProbing`.
2. On WebView `ready`: `markPassed` + persist as last-good.
3. Next cold start still `PROBING` ⇒ previous run crashed ⇒ mark `FAILED` and
   pick `nextLowerQualityProfile`.

This prevents infinite crash loops on devices that cannot survive a given
capture / WebGL configuration.

---

## 5. Live FPS auto-downgrade

Every ~1 s the WebView posts inference FPS. The controller:

1. Tracks a rolling mean (last 10 samples).
2. If FPS &lt; platform min-target for **2 consecutive** samples →
   downgrade one step, restart `getUserMedia` (no full WebView remount),
   emit `quality_changed`.
3. If mean FPS &lt; critical floor (iOS 20 / Android 10), or still below
   min-target on `basic` → emit `performance_warning` (`device_too_slow`),
   throttled to once / 30 s. Message is English, for **developers** (telemetry,
   support tooling, optional in-app fallback UX you localize yourself).

---

## 6. Events (host app)

```tsx
usePoseTracker({
  onQualityChanged: (e) => {
    // e.previousProfile, e.activeProfile, e.reason, e.detail, e.profile
    console.warn('[PoseTracker] quality', e.activeProfile, e.reason);
  },
  onPerformanceWarning: (e) => {
    // e.code === 'device_too_slow', e.meanFps, e.message (English)
    // Recommended: show your own fallback UI / disable live pose on this device.
    analytics.track('pose_device_too_slow', {
      meanFps: e.meanFps,
      profile: e.activeProfile,
    });
  },
});
```

Also available via `client.addEventListener` / `client.getQualityState()`.

Context: `const { quality } = usePoseTracker()` →
`{ activeProfile, profile, capability, meanFps, minTargetFps, idealFpsRange, … }`.

---

## 7. Recommended host behaviour

1. Leave `qualityChoice: 'AdaptiveChoice'` (default).
2. Subscribe to `onPerformanceWarning` and degrade UX gracefully (message,
   still photo mode, “device not supported”, etc.).
3. Do **not** force `prime` on Android mid-range in production.
4. Install `@react-native-async-storage/async-storage` so the crash-guard and
   last-good profile persist across launches (optional but strongly recommended).

---

## 8. Diagnostics (Metro / logcat)

Look for:

```
[posetracker] quality: initial profile=ultralite minTargetFps=15 idealBand=15-30+ …
[posetracker] quality: guard PROBING profile=ultralite
[posetracker] quality: guard PASSED profile=ultralite
[posetracker] quality: lite → ultralite reason=low_fps — …
[posetracker] WARNING: This device appears unsuitable for real-time pose estimation…
[posetracker] WebView diag: warmup … minTarget=15 capture=ultralite …
```

Build stamp in WebView diag: `build=20260805-minTargetFps`.

---

## 9. Source map

| Module | Role |
|--------|------|
| `src/quality/profiles.ts` | Ladder + min-target floors + constraints |
| `src/quality/deviceCapability.ts` | Score → suggested profile |
| `src/quality/RuntimeGuard.ts` | PROBING / PASSED / FAILED |
| `src/quality/AdaptiveQualityController.ts` | Orchestration |
| `src/backends/webview/poseHtml.ts` | `__PT_SET_QUALITY` + letterbox |
| `src/camera/WebViewPoseView.tsx` | Boot profile + inject downgrades |
| `src/types/events.ts` | `quality_changed`, `performance_warning` |
