/**
 * Local pose-runtime loader — assets are embedded in the npm package by
 * `scripts/build-runtime-payload.mjs` (`bundledRuntimeAssets.ts`).
 * No network, no filesystem cache required for keypoints-only.
 */

import type { PoseRuntimeParts } from '../../runtime/RuntimeCache';
import {
  BUNDLED_MODEL_JSON,
  BUNDLED_PIPELINE_WASM_B64,
  BUNDLED_RUNTIME_JS,
  BUNDLED_RUNTIME_VERSION,
  BUNDLED_TFJS_JS,
  BUNDLED_TFJS_WASM_JSON,
  BUNDLED_WEIGHTS_JSON,
} from './bundledRuntimeAssets';

let cached: PoseRuntimeParts | null = null;

/** Ready-to-inject pose runtime shipped inside the package. */
export function getBundledRuntimeParts(): PoseRuntimeParts {
  if (cached) return cached;
  cached = {
    version: BUNDLED_RUNTIME_VERSION,
    tfjsJs: BUNDLED_TFJS_JS,
    tfjsWasmB64: JSON.parse(BUNDLED_TFJS_WASM_JSON) as PoseRuntimeParts['tfjsWasmB64'],
    modelJson: BUNDLED_MODEL_JSON,
    weightsB64: JSON.parse(BUNDLED_WEIGHTS_JSON) as string[],
    pipelineWasmB64: BUNDLED_PIPELINE_WASM_B64 || null,
    runtimeJs: BUNDLED_RUNTIME_JS,
  };
  return cached;
}

export function getBundledRuntimeVersion(): string {
  return BUNDLED_RUNTIME_VERSION;
}
