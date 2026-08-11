# SDK React Native — Light (online) vs Offline

Two published packages share the same product contract (free keypoints without
API key; paid movement engine with key). They differ only in **how MoveNet /
TF.js are delivered**.

## Choose which

| Need | Package |
|------|---------|
| Offline-first keypoints, no model download at boot | **Offline** `@pose-tracker/react-native-pose-estimation` |
| Smallest npm / OTA footprint; devices are online | **Light** `@pose-tracker/react-native-pose-estimation-light` |

Cross-links:

- Offline package README → [npm](https://www.npmjs.com/package/@pose-tracker/react-native-pose-estimation) · [GitHub](https://github.com/Movelytics/react-native-pose-estimation)
- Light package README → [npm](https://www.npmjs.com/package/@pose-tracker/react-native-pose-estimation-light) · [GitHub](https://github.com/Movelytics/react-native-pose-estimation-light)
- Light demo → [GitHub](https://github.com/Movelytics/react-native-pose-estimation-light-demo)

## Comparison

| | Offline | Light |
|--|---------|-------|
| Monorepo path | `packages/pose-estimation-react-native/` | `packages/pose-estimation-react-native-light/` |
| Local name (file:) | `@pose-tracker/react-native-pose-estimation` | `@pose-tracker/react-native-pose-estimation-light` |
| Published npm | `@pose-tracker/react-native-pose-estimation` | `@pose-tracker/react-native-pose-estimation-light` |
| MoveNet | Bundled (`bundledRuntimeAssets`) | URL each WebView boot |
| TF.js / WASM | Bundled | CDN jsDelivr (`@tensorflow/*@4.22.0`) |
| Page runtime | In bundle | Thin (~54 KB) in light package |
| Network for keypoints | No | **Yes** (TF.js + model) |
| Expo Go | Yes | Yes |
| API surface | Same | Same (where documented) |
| Default model | MoveNet SinglePose Lightning (local) | Same model, product URL |

## Packed size (measured `npm pack --dry-run`, 2026-08-11)

| | Offline `0.1.3` | Light `0.1.0` |
|--|-----------------|---------------|
| **Package size** (tarball) | **9.9 MB** | **206.0 kB** |
| **Unpacked size** | **14.7 MB** | **779.1 kB** |
| Total files | 126 | 125 |
| Largest file | `bundledRuntimeAssets.js` **9.2 MB** | `poseRuntimeSource.js` **54.0 kB** |
| Model assets | `assets/movenet…` ~4.6 MB | *(absent — fetched at runtime)* |

Light is roughly **~48× smaller** on the wire (9.9 MB → 206 kB).

```bash
cd packages/pose-estimation-react-native && npm run build && npm pack --dry-run
cd ../pose-estimation-react-native-light && npm run build && npm pack --dry-run
```

## Default model URL (light)

```
https://app.posetracker.com/scripts/tmp_model_to_remove.json
```

Identical to the Front tracking / Docs API MoveNet topology. Weight shards are
relative neighbors (`group1-shard1of2.bin`, etc.).

## API (light)

```ts
<PoseTrackerProvider
  options={{
    model: 'movenet', // Docs API parity (default)
    // modelUrl: 'https://…/model.json', // override TF.js graph model
    // poseModelProfile: 'AdaptiveChoice', // handshake / quality (unchanged)
    // tfjsCdnBase / tfjsVersion // advanced CDN override
  }}
>
```

- `model: 'movenet' | 'movenet-singlepose-lightning'` → product Lightning URL.
- `modelUrl` → explicit TF.js graph-model override.
- `model: 'blazepose'` → **not wired** yet (MediaPipe). Clear error at boot.

## Where the fetch happens (light)

1. `PoseTrackerClient.getRuntimeParts()` resolves CDN + `modelUrl` (no heavy local assets).
2. `buildPoseHtml()` injects `<script src="cdn…">` + `window.__PT_MODEL_URL`.
3. WebView `pose-runtime.js` calls `tf.loadGraphModel(modelUrl)`.

WebView `baseUrl` remains `https://localhost/` (same as offline) so
`getUserMedia` is reliable. Model / weights use absolute URLs with
`Access-Control-Allow-Origin: *` — document origin need not match
`app.posetracker.com`.

## Local test apps

```bash
# Light
cd posetracker-rn-sdk/packages/pose-estimation-react-native-light
npm install && npm run build
cd ../../testapp-light
npm install
npx expo start

# Offline (unchanged)
cd posetracker-rn-sdk/testapp   # or testapp-prod against published npm
npx expo start
```

## Publish / sync (ops)

Private runbook: `PoseTracker/.private/GITHUB_RELEASE_OPS.md`  
Sync script: `PoseTracker/.private/sync-public-repos.sh` (offline + light + demos).

## Out of scope (voluntary)

- BlazePose / MediaPipe Tasks in the RN WebView
- Local FS cache of the light model (fully online by design)
- Changing the offline bundled package except cross-link docs

## Confirm

The offline package remains the default for offline-first apps. Light does **not**
modify offline sources except documentation cross-references.
