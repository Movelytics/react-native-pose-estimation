/**
 * Local pose-runtime loader — assets are embedded in the npm package by
 * `scripts/build-runtime-payload.mjs` (`bundledRuntimeAssets.ts`).
 * No network, no filesystem cache required for keypoints-only **MoveNet**.
 *
 * BlazePose (`model: 'blazepose'`) reuses the bundled TF.js but loads
 * `@tensorflow-models/pose-detection` from CDN — see {@link resolvePoseModel}.
 */

import type { PoseRuntimeParts } from '../../runtime/RuntimeCache';
import {
  defaultPoseDetectionCdnUrl,
  resolvePoseModel,
  type PoseModelAlias,
} from '../../models/poseModels';
import {
  BUNDLED_MODEL_JSON,
  BUNDLED_PIPELINE_WASM_B64,
  BUNDLED_RUNTIME_JS,
  BUNDLED_RUNTIME_VERSION,
  BUNDLED_TFJS_JS,
  BUNDLED_TFJS_WASM_JSON,
  BUNDLED_WEIGHTS_JSON,
} from './bundledRuntimeAssets';

let cachedBase: PoseRuntimeParts | null = null;

export interface GetBundledRuntimeOptions {
  /** `movenet` (default, bundled) or `blazepose` (CDN pose-detection). */
  model?: PoseModelAlias;
}

function loadBundledBase(): PoseRuntimeParts {
  if (cachedBase) return cachedBase;
  cachedBase = {
    version: BUNDLED_RUNTIME_VERSION,
    tfjsJs: BUNDLED_TFJS_JS,
    tfjsWasmB64: JSON.parse(BUNDLED_TFJS_WASM_JSON) as PoseRuntimeParts['tfjsWasmB64'],
    modelJson: BUNDLED_MODEL_JSON,
    weightsB64: JSON.parse(BUNDLED_WEIGHTS_JSON) as string[],
    pipelineWasmB64: BUNDLED_PIPELINE_WASM_B64 || null,
    runtimeJs: BUNDLED_RUNTIME_JS,
    modelId: 'movenet-singlepose-lightning',
    modelKind: 'movenet-graph',
    poseDetectionScriptUrl: null,
  };
  return cachedBase;
}

/** Ready-to-inject pose runtime shipped inside the package. */
export function getBundledRuntimeParts(
  options: GetBundledRuntimeOptions = {},
): PoseRuntimeParts {
  const resolved = resolvePoseModel({ model: options.model });
  const base = loadBundledBase();
  if (resolved.kind !== 'blazepose') {
    return {
      ...base,
      modelId: resolved.modelId,
      modelKind: 'movenet-graph',
      poseDetectionScriptUrl: null,
    };
  }
  // Do not inject unused MoveNet graph / pipeline into the HTML document
  // (the npm package still contains those assets — that is the size warning).
  return {
    ...base,
    modelJson: '{}',
    weightsB64: [],
    pipelineWasmB64: null,
    modelId: 'blazepose',
    modelKind: 'blazepose',
    poseDetectionScriptUrl: defaultPoseDetectionCdnUrl(),
  };
}

export function getBundledRuntimeVersion(): string {
  return BUNDLED_RUNTIME_VERSION;
}
