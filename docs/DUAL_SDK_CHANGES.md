# Dual SDK changes — offline + light (for agents)

Internal policy for anyone (human or LLM) editing either React Native pose package.

## Packages

| | Offline | Light |
|--|---------|-------|
| Path | `packages/pose-estimation-react-native/` | `packages/pose-estimation-react-native-light/` |
| npm | `@pose-tracker/react-native-pose-estimation` | `@pose-tracker/react-native-pose-estimation-light` |
| Delivery | Bundled MoveNet / TF.js (`bundledRuntime`) | CDN + `modelUrl` each boot (`onlineRuntime`) |

Cross-links:

- Comparison + sizes → [`LIGHT_SDK.md`](./LIGHT_SDK.md)
- Offline README → [`../packages/pose-estimation-react-native/README.md`](../packages/pose-estimation-react-native/README.md)
- Light README → [`../packages/pose-estimation-react-native-light/README.md`](../packages/pose-estimation-react-native-light/README.md)
- Cursor rule → `PoseTracker/.cursor/rules/dual-rn-pose-sdks.mdc` (and `posetracker-rn-sdk/.cursor/rules/`)

## Default assumption

When you edit **one** SDK:

1. Check whether the change is **shared UX / API / bug fix** (WebView shell, events, client surface, watermark, permissions behavior, adaptive quality, boot UI).
2. If **yes** → mirror the same change to the **other** package in the same task.
3. If **unclear** → **ask the user before implementing**: offline only, light only, or both.
4. Do not silently land a shared fix on a single package.

## Almost always both

- `poseHtml` boot UI / CSS / loading copy
- Watermark / free-tier chrome
- Camera permission behavior and `docs/PERMISSIONS.md` (shared docs)
- `WebViewPoseView` props and provider options that are product API
- Client / provider public TypeScript API (where both expose it)
- Event shapes and classic `onMessage` parity (`docs/EVENTS.md`)
- Adaptive quality / `capturePriority` behavior (`docs/ADAPTIVE_QUALITY.md`)
- Shared logic inside `pose-runtime.js` (inference loop, messaging) — not asset injection

## Usually offline-only

- `bundledRuntime` / `bundledRuntimeAssets` and generate/pack scripts for them
- Model / WASM / TF.js files under package `assets/`
- Offline pack size and “no network for keypoints” guarantees

## Usually light-only

- CDN base URLs, `tfjsVersion`, `modelUrl` resolution / model catalog
- `onlineRuntime` thin page runtime wiring
- Network-required boot path and light pack-size claims
- Light-only demo (`testapp-light/`) unless the change is a shared demo pattern

## Divergent by design — do not “unify” casually

Offline = assets in npm. Light = fetch TF.js + model at boot. Keep those delivery paths separate unless the user explicitly requests a redesign.

## Checklist (before finishing a shared change)

- [ ] Same behavior/API on offline **and** light (or user said one-sided)
- [ ] Both package builds still make sense (`npm run build` in each touched package)
- [ ] Shared markdown under `docs/` updated once (not duplicated per package)
- [ ] Public sync later if needed: `.private/sync-public-repos.sh` (do not block on publish)
