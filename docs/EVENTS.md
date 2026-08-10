# Real-time events — PoseTracker WebView parity

English developer reference for listening to SDK updates in the host app,
the same way native apps listen to PoseTracker WebView `sendDataToNative`
messages.

---

## 1. Two ways to listen (pick one)

### A. Typed callbacks (recommended for new apps)

```tsx
import { usePoseTracker } from '@pose-tracker/react-native-pose-estimation';

function TrackingScreen() {
  usePoseTracker({
    onInitialization: (e) => {
      // e.message: "accessing webcam" | "loading pose model" | "running" | …
      // e.ready: true when inference is live
      setStatusText(e.message);
    },
    onKeypoints: (e) => {
      // Offline + online: 17 MoveNet keypoints every frame
      drawSkeleton(e.keypoints);
    },
    onWarning: (e) => console.warn(e.code, e.message),
    onError: (e) => console.error(e.code, e.message),
    onPerformanceWarning: (e) => {
      // mean inference FPS < 8 — device likely unsuitable
      showDeviceTooSlowUi(e.message);
    },
    onQualityChanged: (e) => {
      // AdaptiveChoice auto-downgraded camera profile
    },
    // full-engine only (requires API token + remote engine):
    onCounter: (e) => {
      // e.count + e.formScore?: { score, average, grade }  // A–F
      setReps(e.count);
    },
    onAngles: (e) => {},
    onPosture: (e) => {
      // e.ready, e.hint, e.direction, e.missingKeypoints
    },
    onProgression: (e) => {},
    onRecommendations: (e) => {},
    // Convenience stream — prefer onCounter.formScore for counted reps:
    onFormScore: (e) => {},
    onExerciseSummary: (e) => {},
    // custom jump exercises (jump_analysis / air_time_jump):
    onJumpCalibration: (e) => {},   // cm/pixel ready (jump_analysis)
    onJumpStarted: (e) => {},       // push-off detected
    onJumpHeight: (e) => {},        // live + final height (cm)
    onJumpDiscarded: (e) => {},     // aborted signature + userMessage
    onJumpResult: (e) => setLastJump(e.jumpHeightCm),
    onJumpSummary: (e) => setJumps(e.jumps),
  });
}
```

### B. Classic PoseTracker JSON (`onMessage`)

Same envelope as the WebView product (`type`, `data`, `message`, `ready`,
`current_count`, …). Drop-in for apps that already parse WebView `onMessage`:

```tsx
usePoseTracker({
  onMessage: (msg) => {
    switch (msg.type) {
      case 'initialization':
        // { message, ready }
        break;
      case 'keypoints':
        // { data: [{ name, x, y, score }, ...] }
        break;
      case 'error':
        // { error, message }  — includes device_too_slow
        break;
      case 'warning':
        // { error, message }  — e.g. quality_downgraded
        break;
      case 'counter':
        // { current_count, form_score: { score, avg_score, grade } }
        break;
      case 'angles':
        // { data: { left_side: { knee_angle: … }, right_side: { … } } }
        break;
      // full-engine: posture, progression, recommendations, jump_*, …
    }
  },
});
```

Or imperatively:

```ts
const off = client.addMessageListener((msg) => { /* … */ });
const off2 = client.addEventListener((event) => { /* typed */ });
```

---

## 2. What fires in **keypoints-only** mode (no API token)

Always available offline (bundled MoveNet WebView runtime):

| Typed event | Classic `type` | When |
|-------------|----------------|------|
| `initialization` | `initialization` | Boot steps + `ready: true` / `"running"` |
| `keypoints` | `keypoints` | Every inferred pose |
| `warning` | `warning` | Soft issues (e.g. from WebView) |
| `error` | `error` | Failures (camera, model, webview) |
| `quality_changed` | `warning` (`quality_downgraded`) | Adaptive camera downgrade |
| `performance_warning` | `error` (`device_too_slow`) | Mean FPS &lt; 8 |

Business events (`counter`, `angles`, `posture`, …) require **full-engine**
(API token + remote engine bundle). `angles` / `recommendations` /
`progression` / in-exercise `keypoints` are additionally opt-in feature
flags gated by plan — free plans get `free_plan_feature_blocked` /
`feature_not_supported` errors with the exact WebView strings, see
[FEATURES.md](./FEATURES.md).

Custom jump exercises (`startExercise('jump_analysis', { userHeightCm })` /
`startExercise('air_time_jump')`) additionally emit `jump_calibration`,
`jump_started`, `jump_height`, `jump_discarded`, `jump_result` and
`jump_summary` with the exact WebView payload field names (`jumpHeightCm`,
`airTimeMs`, `cmPerPixel`, …) — see [FEATURES.md](./FEATURES.md) §Custom
exercises. `posture` events also carry the WebView `direction` hint
(`in-frame`, `face-camera`, `profile-camera`).

---

## 3. Init sequence (camera WebView)

Classic-style messages the host receives while the camera boots:

1. `{ type: "initialization", message: "accessing webcam", ready: false }`
2. `{ type: "initialization", message: "loading pose model", ready: false }`
3. `{ type: "initialization", message: "running", ready: true }`

Plus preload-level steps when you call `preload()` / `warmup()`:
`checking you plan and access` (front-literal string, sic) →
`loading pose model` → `running`.

See [PRELOAD.md](./PRELOAD.md) for when those calls run (Provider mount does
**not** preload by default; WebView warm-up needs a mounted `WebViewPoseView`).

---

## 4. Keypoints payload

**Typed:**

```ts
{
  type: 'keypoints',
  keypoints: [{ name, x, y, score }], // normalized 0–1, display space
  score: number,
  timestampMs: number,
}
```

**Classic (`onMessage`):**

```ts
{
  type: 'keypoints',
  data: [{ name, x, y, score }],
  score: number,
  timestampMs: number,
}
```

Coordinates are normalized to the mirrored preview (front camera).

---

## 5. HUD text vs events

The yellow text at the bottom of the camera preview is an **internal WebView
debug HUD** (`poseHtml` `#hud`). It is **not** what your app receives.

Your app must subscribe with `usePoseTracker({ onKeypoints, onMessage, … })`
(or `addEventListener` / `addMessageListener`) to drive its own UI.

---

## 6. Related docs

- Adaptive quality / FPS warnings: [`ADAPTIVE_QUALITY.md`](./ADAPTIVE_QUALITY.md)
- Architecture / modes: [`ARCHITECTURE.md`](./ARCHITECTURE.md)
- Classic contract reference (product): `PoseTrackerFront/lib/v3/sendDataToNativeContract.js`
