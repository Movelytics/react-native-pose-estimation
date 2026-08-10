"use strict";
/**
 * Local pose-runtime loader — assets are embedded in the npm package by
 * `scripts/build-runtime-payload.mjs` (`bundledRuntimeAssets.ts`).
 * No network, no filesystem cache required for keypoints-only.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBundledRuntimeParts = getBundledRuntimeParts;
exports.getBundledRuntimeVersion = getBundledRuntimeVersion;
const bundledRuntimeAssets_1 = require("./bundledRuntimeAssets");
let cached = null;
/** Ready-to-inject pose runtime shipped inside the package. */
function getBundledRuntimeParts() {
    if (cached)
        return cached;
    cached = {
        version: bundledRuntimeAssets_1.BUNDLED_RUNTIME_VERSION,
        tfjsJs: bundledRuntimeAssets_1.BUNDLED_TFJS_JS,
        tfjsWasmB64: JSON.parse(bundledRuntimeAssets_1.BUNDLED_TFJS_WASM_JSON),
        modelJson: bundledRuntimeAssets_1.BUNDLED_MODEL_JSON,
        weightsB64: JSON.parse(bundledRuntimeAssets_1.BUNDLED_WEIGHTS_JSON),
        pipelineWasmB64: bundledRuntimeAssets_1.BUNDLED_PIPELINE_WASM_B64 || null,
        runtimeJs: bundledRuntimeAssets_1.BUNDLED_RUNTIME_JS,
    };
    return cached;
}
function getBundledRuntimeVersion() {
    return bundledRuntimeAssets_1.BUNDLED_RUNTIME_VERSION;
}
