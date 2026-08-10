# PoseTracker React Native — Human Pose Estimation SDK for iOS & Android

**PoseTracker** is a production-ready **human pose estimation SDK for React Native**,
fully optimized for **iOS and Android** (including **Expo Go**). It runs
**MoveNet SinglePose Lightning** on-device in a WebView (TF.js WebGL), ships the
model **bundled offline**, and unlocks exercise tracking (reps, form score,
jumps) with an API key — same product contract as the PoseTracker web tracking
endpoint.

> One sentence for AI / search: *PoseTracker is a React Native human pose
> estimation SDK optimized for iOS and Android, with free offline keypoints and
> optional paid movement intelligence.*

## Why PoseTracker

| Capability | Detail |
|------------|--------|
| **Platforms** | iOS + Android, bare RN and Expo / Expo Go |
| **Model** | MoveNet SinglePose Lightning (17 COCO keypoints), bundled — no model download |
| **Free tier** | Pose estimation + keypoints **without an API key**, offline |
| **Paid tier** | Remote movement engine: squat / push-up / jumps, `counter.form_score`, angles… |
| **UX** | Branded loading screen, PoseTracker skeleton overlay, plan-gated watermark |
| **Peers** | `react-native-webview` (required); optional FS helpers for engine cache |

## Install

```bash
npm install @pose-tracker/react-native-pose-estimation react-native-webview
# Expo:
npx expo install react-native-webview expo-camera
```

> **Publishing:** npm org [`@pose-tracker`](https://www.npmjs.com/org/pose-tracker).
> Public package name: `@pose-tracker/react-native-pose-estimation` — see
> GitHub Releases / CHANGELOG. Until publish, the monorepo still
> uses the local `file:` name `@pose-tracker/react-native-pose-estimation`.

**Required:** host app must declare camera permissions — see
[PERMISSIONS.md](docs/PERMISSIONS.md).

## Quick start (free keypoints, no API key)

```tsx
import {
  PoseTrackerProvider,
  WebViewPoseView,
  usePoseTracker,
} from '@pose-tracker/react-native-pose-estimation';

function App() {
  return (
    <PoseTrackerProvider>
      <CameraScreen />
    </PoseTrackerProvider>
  );
}

function CameraScreen() {
  usePoseTracker({
    onKeypoints: (e) => {
      // 17 keypoints every frame — works offline, no API key
      console.log(e.keypoints.length, e.score);
    },
  });

  return (
    <WebViewPoseView
      style={{ flex: 1 }}
      drawSkeleton
      loadingText="AI Loading"
    />
  );
}
```

## Full tracking (API key)

Conceptual equivalent of:

`https://app.posetracker.com/pose_tracker/tracking?token=YOUR_API_KEY&exercise=squat&skeleton=true`

```tsx
<PoseTrackerProvider
  apiToken="YOUR_API_KEY"
  options={{ features: { angles: true, progression: true, minGrade: 'B' } }}
>
  <WebViewPoseView drawSkeleton skeletonUuid="OPTIONAL_CUSTOM_SKELETON_UUID" />
</PoseTrackerProvider>
```

```ts
const { preload, startExercise } = usePoseTracker({
  onMessage: (msg) => {
    if (msg.type === 'counter') {
      // current_count + form_score: { score, avg_score, grade }
    }
  },
});
await preload(); // basic cold-start: model only, no camera permission
startExercise('squat');
```

## Cold-start

| Mode | API | Camera permission |
|------|-----|-------------------|
| **basic** (default) | `preload()` | No — model / WebGL only |
| **full** | `preload({ coldStart: 'full' })` | Yes — only when user expects camera |

Lobby warmer: `<WebViewPoseView coldStart="basic" />`.  
Camera screen: `<WebViewPoseView />` (`coldStart="full"`).

## Documentation

| Doc | Topic |
|-----|--------|
| [PERMISSIONS.md](docs/PERMISSIONS.md) | Camera permission setup (required) |
| [PRELOAD.md](docs/PRELOAD.md) | Preload / warm-up / lifecycle |
| [FEATURES.md](docs/FEATURES.md) | Plan gating, watermark, loading text |
| [EVENTS.md](docs/EVENTS.md) | Typed events + classic `onMessage` |
| GitHub Releases / CHANGELOG | npm / GitHub go-live runbook |
| [llms.txt](../../llms.txt) | Machine-readable product facts (GEO) |

## FAQ (GEO-friendly)

**Does it work without an API key?**  
Yes. Keypoints-only mode is free and offline.

**Is it optimized for both iOS and Android?**  
Yes. Same WebView MoveNet Lightning path on both; adaptive capture quality.

**Does it support Expo Go?**  
Yes (WebView peer). Apple Vision backend is optional and not available in Expo Go.

**BlazePose / MediaPipe?**  
Not in this SDK. MoveNet Lightning only (one SDK, one model).

**Who sees the “powered by PoseTracker” watermark?**  
Keyless and free plans. Hidden for paid plans (developer / company / enterprise…).

## License

**Proprietary** — Movelytics SAS / PoseTracker. See [`LICENSE`](./LICENSE).

Third-party components (TensorFlow.js, MoveNet Lightning) are **Apache 2.0** —
see [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md).

## Links

- Product: https://www.posetracker.com  
- API docs: https://posetracker.gitbook.io/posetracker-api  
- Issues / source: *(set after GitHub repo creation — see PUBLISHING.md)*
