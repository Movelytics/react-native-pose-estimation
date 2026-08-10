# Tracking features & plan gating (WebView parity)

The SDK ports the feature flags of the PoseTracker WebView endpoint
(`/pose_tracker/tracking?token=…&exercise=…&angles=true&…`) with the **same
plan gating, the same limitations and the same error messages** as
`TrackingAppV3`. Nothing changed on the existing front API — this is a
client-side port.

## Base principle: free offline keypoints

Without an API key the SDK is free to use, **offline**, in keypoints-only
mode: bundled MoveNet Lightning, warm-up, camera pipeline, raw `keypoints`
events. No gating, no usage counting beyond anonymous best-effort telemetry.

With an API key, key-gated features (movement engine, exercises, developer
event streams) require **internet**:

1. the token is authenticated by the handshake (`POST /api/sdk/configure`,
   plan type included in the manifest);
2. the session is metered at camera start (`POST /api/sdk/track
   camera_start`) — offline metered sessions are refused
   (`offline_metered`), keypoints-only keeps running from the cache.

## WebView param → SDK option matrix

| WebView query param | SDK equivalent | Default | Notes |
|---|---|---|---|
| `token` | `PoseTrackerProvider apiToken` / `configure(apiToken)` | — | Optional: keyless = keypoints-only offline |
| `exercise` | `startExercise(exerciseId, options?)` | — | Requires full-engine mode. FSM (manifest) **and** custom (`jump_analysis`, `air_time_jump`) |
| `difficulty` | `startExercise(id, { difficulty })` | `'medium'` | Key into the movement `scale_acceptance` maps |
| `userHeightCm` | `startExercise('jump_analysis', { userHeightCm })` | — | **Required** by jump_analysis (cm/pixel calibration) |
| `devicePitchDeg` | `startExercise(id, { devicePitchDeg })` | — | Jump exercises: camera tilt compensation |
| `skeleton=true\|false` | `WebViewPoseView drawSkeleton` | `true` | Toggle in-page overlay |
| `skeleton=<api_uuid>` | `WebViewPoseView skeletonUuid` / `skeletonDef` | PoseTracker default navy+gold | Custom Strapi skeleton; default style matches Front `DEFAULT_SKELETON` |
| `loading_message` | `WebViewPoseView loadingText` | `"AI Loading"` | Branded boot overlay copy (not technical progress) |
| `postureBox` / placement | `WebViewPoseView drawPlacementBox` | `true` | Guide box while `posture.ready === false` |
| `keypoints` | `options.features.keypoints` | `false` | Keypoints **during an exercise session** (pose-only always streams) |
| `angles` | `options.features.angles` | `false` | `angles` events, paid plans only |
| `recommendations` | `options.features.recommendations` | `false` | `recommendations` events, paid plans only |
| `progression` | `options.features.progression` | `false` | `progression` events, paid plans only |
| `minGrade` | `options.features.minGrade` | — | `'A'…'D'`: only count reps at/above this grade (grades themselves are A–F) |
| `width` / `height` | RN layout (`style`) | — | Handled by the host layout |
| `isAndroid` | automatic (`Platform.OS`) | — | — |
| `blazepose`, `poseEngine`, `mediapipeModel`, `poseBackend`, `runInWorker` | **not available** | — | This SDK ships MoveNet Lightning only → `feature_not_supported` error |
| `reference` / `reference_movement` | Phase 2 (planned) | — | Combined with an exercise → same "cannot combine" front error |

```tsx
<PoseTrackerProvider
  apiToken="ptk_…"
  options={{
    features: {
      angles: true,
      recommendations: true,
      progression: true,
      keypoints: false,
      minGrade: 'B',
    },
  }}
>
  {/* Default overlay = API navy/gold. Custom: skeletonUuid or skeletonDef */}
  <WebViewPoseView drawSkeleton skeletonUuid="YOUR_SKELETON_API_UUID" />
</PoseTrackerProvider>
```

`movement.custom_skeleton` (flexibility pose id string) is **not** the overlay
theme — that field is unrelated to drawing. Overlay customs are Strapi
`skeleton` documents (`api_uuid`), fetched via `GET /api/sdk/skeleton?uuid=…`.

## Boot loading UI & watermark

Until the live camera + skeleton surface is ready (`coldStart: 'full'`),
`WebViewPoseView` shows a branded boot cover:

1. small **powered by** line  
2. PoseTracker join logo (icon + wordmark)  
3. spinner  
4. `loadingText` (default **`AI Loading`**, WebView `loading_message` parity)

Technical boot progress (`accessing webcam`, backend choice, `medianMs`, …)
is **not** shown on that UI. Hosts observe it via:

- typed `initialization` events (`step` / `message` / `ready`)
- `diag` lines on the client diagnostic logger

The optional `#hud` FPS overlay is **off by default** (Android `perfDebug` /
`debugHud` can enable it).

### Watermark (plan-gated)

On the live webcam overlay (bottom-right, above video/skeleton), a compact
**powered by + join logo** watermark is shown for:

| Plan | Watermark |
|---|---|
| no API key / keyless | **shown** |
| `free` | **shown** |
| paid (`developer`, `company`, `enterprise`, …) | **hidden** |

Derived from `client.getPlanType()` / configure manifest (`plan.plan`) via
`shouldShowWatermark(plan)`. Override with `WebViewPoseView showWatermark`.
`coldStart: 'basic'` warmers never show it. Plan upgrades after `configure()`
update the mark via `__PT_SET_WATERMARK` without remounting the WebView.

```tsx
<WebViewPoseView
  loadingText="Préparation de l'IA…"
  // showWatermark omitted → automatic from plan
/>
```

## Plan gating (identical to the WebView)

Plan type comes from the handshake manifest (`plan.plan`). Exactly like
`TrackingAppV3`:

| Plan | angles / recommendations / progression | keypoints | exercises |
|---|---|---|---|
| — no key | blocked (needs a token) | pose-only: **always free** | no |
| `free` | **blocked** | pose-only ok; **blocked with an exercise** | yes (non-premium list) |
| `developer` + | ok (flags opt-in) | ok | yes |

Errors (emitted as `error` events AND thrown by `startExercise()` when
relevant) use the **exact front strings**:

| Situation | `code` | `message` |
|---|---|---|
| Dev features requested without a token | `invalid_token` | `Invalid params. Please refer to the documentation and set token=YOUR API_KEY et exercise=A correct exercise. (visit: https://posetracker.gitbook.io/posetracker-api/tracking-endpoint)` |
| Unknown exercise id | `invalid_exercise` | `Exercise '<id>' is not available in V3 engine` |
| `jump_analysis` without `userHeightCm` | `jump_analysis_missing_height` | `User height (userHeightCm) must be provided for jump_analysis exercise` |
| `free` + angles/recommendations/progression (at configure), or + keypoints with an exercise (at `startExercise`) | `free_plan_feature_blocked` | `You cannot use developer features. (visit: https://posetracker.gitbook.io/posetracker-api/tracking-endpoint)` |
| `blazepose` / `poseEngine` / … passed by an untyped host | `feature_not_supported` | `The 'blazepose' option (BlazePose) is not available in this SDK. …` |
| Offline with an API key at camera start | `offline_metered` | usage cannot be counted — reconnect to start a metered session |
| Quota exhausted | `quota_exceeded` | from the API |
| Token revoked | `invalid_token` | sealed engine + session caches purged → keypoints-only |

Gating happens at **two moments**, like the front (page load + runtime):

1. **configure/preload** — once the manifest resolves, a `free` plan with
   `angles`/`recommendations`/`progression` gets the
   `free_plan_feature_blocked` error (one-shot; equivalent of the WebView
   blocking the page at load). Keypoints-only keeps running.
2. **`startExercise()`** — re-checked with the exercise context: on `free`,
   `features.keypoints` now also blocks (keypoints + exercise is a developer
   feature; pose-only keypoints stay free). Throws with the same message.

## Emission filtering

During an exercise session, events only stream when their flag is on
(WebView parity — both the engine AND the client filter, so a stale cached
engine bundle cannot leak):

- `angles` → `features.angles`
- `recommendations` → `features.recommendations`
- `progression` → `features.progression`
- `keypoints` → `features.keypoints` (outside a session: always streamed)
- `counter`, `posture`, `form_score`, `exercise_summary` → always (core
  exercise streams, like the WebView)

## Form grades & `minGrade`

GitBook / Front `BaseExercise` thresholds (engine ≥ **0.3.3** / runtime
`1.2.3`):

| Grade | Score |
|-------|-------|
| A | ≥ 90 |
| B | ≥ 80 |
| C | ≥ 70 |
| D | ≥ 60 |
| F | &lt; 60 |

**Authoritative counted-rep grade:** nested on the `counter` event
(`counter.form_score` classic / `onCounter` → `formScore` typed). A
standalone `form_score` event is also emitted for convenience — do not
treat it as the source of truth for the rep that was just counted
([GitBook](https://posetracker.gitbook.io/posetracker-api/use-posetracker-on-real-time-camera-webcam/tracking-endpoint-message-to-handle)).

`minGrade` (A–D only): grade order A > B > C > D > F; `minGrade: 'B'`
counts A and B reps only. A rep below the bar is **not counted at all** —
no `counter` / `form_score` events, excluded from the history and averages
of `exercise_summary`.

## Custom exercises: jump_analysis & air_time_jump

Port of the WebView custom handlers (`lib/v3/customHandlers.js` +
`lib/v2/JumpAnalysisHandler / AirTimeJumpHandler / JumpSignatureDetector`),
shipped inside the **engine bundle ≥ 0.3.0** (engine version 1.2.0 —
full-engine mode required, like any exercise). List them with
`client.getAvailableCustomExercises()`.

```ts
// Jump height via cm/pixel calibration (requires the athlete's height)
startExercise('jump_analysis', { userHeightCm: 178, devicePitchDeg: 5 });

// Jump height from air time (physics h = g·t²/8) — no calibration needed
startExercise('air_time_jump');
```

Session flow, identical to the WebView (`CameraFeedV3`):

1. **placement** — every required point (hips, shoulders, ankles, eyes —
   `a||b` alternatives) inside the 10 % padding box for 8 consecutive
   frames + the handler's own readiness check (hips visible, height param).
   `posture` events carry the same hints (`Move fully into the frame`,
   `Hold still...`, `hips not visible - …`);
2. **countdown** — 1 s (`Get ready... 1`), then
   `posture { ready: true, hint: "Ready - tracking started" }`;
3. **measuring** — 10 s realtime warm-up (tracking stabilization, no events),
   then detection. Events per jump, same payload field names as the front:
   - `jump_calibration` (jump_analysis only: `cmPerPixel`, `baselineY`) —
     "Calibration complete - ready to jump";
   - `jump_started` — push-off detected;
   - `jump_height` — live (`measuring: true`) then final (`final: true`);
   - `jump_discarded` — aborted signature (`moved_toward_phone`,
     `jump_timeout`, `tracking_lost`, `no_flight_detected`…);
   - `jump_result` — completed jump N (`jumpNumber`, `jumpHeightCm`,
     `airTimeMs` for air_time_jump);
   - `jump_summary` — running totals (`totalJumps`, `avgJumpHeight`,
     `maxJumpHeight`, `minJumpHeight`, `avgAirTimeSeconds`, `jumps[]`).
   After each jump the handler resets (calibration kept) 200 ms later so the
   next jump is detected immediately — multi-jump sessions work out of the box.

`air_time_jump` uses the exact V3 realtime profile: simplified moving-start
detection over a 2.5 s sliding window with the default realtime guards
(min 10 cm, 900 ms cooldown, 3 stable landing frames).

Typed callbacks: `onJumpCalibration`, `onJumpStarted`, `onJumpHeight`,
`onJumpDiscarded`, `onJumpResult`, `onJumpSummary` — and the classic
`onMessage` stream carries the same `type` strings as the WebView.

## Classic `onMessage` parity

Hosts migrating from the WebView `onMessage` JSON keep the same strings via
`addMessageListener` / `usePoseTracker({ onMessage })`, including the front's
literal `"checking you plan and access"` (sic) initialization message and the
error messages above.

## Validating with the testapp

`testapp/App.tsx` has an `API_TOKEN` + `FEATURES` block at the top:

1. no token, all flags `false` → keypoints-only offline, no errors;
2. no token, `angles: true` → `invalid_token` with the front message;
3. free token, `angles: true` → `free_plan_feature_blocked` at configure;
4. free token, `keypoints: true`, no exercise → allowed (pose-only);
   `startExercise()` → throws `free_plan_feature_blocked`;
5. developer token, flags on → `angles` / `recommendations` / `progression`
   stream during the exercise; `minGrade: 'B'` drops C/D reps from the
   counter.

For jump exercises, set `EXERCISE_ID` at the top of
`testapp/src/CameraScreen.tsx` (`'jump_analysis'` with `userHeightCm`, or
`'air_time_jump'`): the green line under the badge shows the live session
state (placement hints → countdown → warm-up → `jump #N: X cm`).
