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

| | Offline `0.3.0` | Light `0.3.0` |
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
- `model: 'blazepose'` → CDN `@tensorflow-models/pose-detection` (lite, TF.js
  runtime) inside the WebView. Emits the same COCO-17 `keypoints` shape as
  MoveNet (extra BlazePose joints dropped). Heavier than MoveNet — prefer
  MoveNet on mid-range Android.

The **offline** package now accepts the same `model: 'blazepose'` flag: it
keeps bundled TF.js + MoveNet in the npm tarball, injects pose-detection from
CDN, and **warns** in Metro that the host should switch to light if they do
not need offline MoveNet. MoveNet on offline stays bundled (not CDN).

## Where the fetch happens (light)

1. `PoseTrackerClient.getRuntimeParts()` resolves CDN + `modelUrl` / BlazePose scripts.
2. `buildPoseHtml()` injects `<script src="cdn…">` + `window.__PT_MODEL_URL` (or
   `__PT_MODEL_KIND=blazepose` without a graph URL).
3. WebView `pose-runtime.js` calls `tf.loadGraphModel(modelUrl)` **or**
   `poseDetection.createDetector(BlazePose)` when `model: 'blazepose'`.

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

## Dual-package changes (for agents)

Offline and light share the product contract; they diverge only on **how** MoveNet /
TF.js are delivered. When editing **either** package:

- **Default:** if the change is shared UX / API / bugfix → apply it to **both**, or **ask** which package(s) before coding.
- **Usually both:** `poseHtml` boot UI, watermark, camera permission behavior, `WebViewPoseView` / client public API, event shapes, adaptive quality, shared `pose-runtime.js` logic.
- **Usually offline-only:** `bundledRuntime` / assets, pack size from bundling.
- **Usually light-only:** CDN TF.js / `modelUrl` / `onlineRuntime`, network-at-boot MoveNet, light pack size.
- **BlazePose exception (explicit):** both packages support `model: 'blazepose'`
  via CDN pose-detection. Offline does **not** bundle BlazePose and still
  ships unused MoveNet — warn the host to prefer light. Do not copy light
  CDN loading onto the offline **MoveNet** path.

Full checklist (monorepo): [`DUAL_SDK_CHANGES.md`](./DUAL_SDK_CHANGES.md) · package READMEs above · Cursor rule `dual-rn-pose-sdks`.

## Out of scope (voluntary)

- Local FS cache of the light model (fully online by design)
- Unifying delivery (do not turn light into a bundle or offline MoveNet into CDN-only unless explicitly requested)
- Bundling BlazePose weights inside the offline npm package (CDN only, same as light)

## Confirm

The offline package remains the default for offline-first apps. Shared product
fixes should land on **both** packages; delivery-only changes stay on one side.
