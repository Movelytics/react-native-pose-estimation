"use strict";
/**
 * Local pose-runtime loader — assets are embedded in the npm package by
 * `scripts/build-runtime-payload.mjs` (`bundledRuntimeAssets.ts`).
 * No network, no filesystem cache required for keypoints-only **MoveNet**.
 *
 * BlazePose (`model: 'blazepose'`) reuses the bundled TF.js but loads
 * `@tensorflow-models/pose-detection` from CDN — see {@link resolvePoseModel}.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBundledRuntimeParts = getBundledRuntimeParts;
exports.getBundledRuntimeVersion = getBundledRuntimeVersion;
const poseModels_1 = require("../../models/poseModels");
const bundledRuntimeAssets_1 = require("./bundledRuntimeAssets");
let cachedBase = null;
function loadBundledBase() {
    if (cachedBase)
        return cachedBase;
    cachedBase = {
        version: bundledRuntimeAssets_1.BUNDLED_RUNTIME_VERSION,
        tfjsJs: bundledRuntimeAssets_1.BUNDLED_TFJS_JS,
        tfjsWasmB64: JSON.parse(bundledRuntimeAssets_1.BUNDLED_TFJS_WASM_JSON),
        modelJson: bundledRuntimeAssets_1.BUNDLED_MODEL_JSON,
        weightsB64: JSON.parse(bundledRuntimeAssets_1.BUNDLED_WEIGHTS_JSON),
        pipelineWasmB64: bundledRuntimeAssets_1.BUNDLED_PIPELINE_WASM_B64 || null,
        runtimeJs: bundledRuntimeAssets_1.BUNDLED_RUNTIME_JS,
        modelId: 'movenet-singlepose-lightning',
        modelKind: 'movenet-graph',
        poseDetectionScriptUrl: null,
    };
    return cachedBase;
}
/** Ready-to-inject pose runtime shipped inside the package. */
function getBundledRuntimeParts(options = {}) {
    const resolved = (0, poseModels_1.resolvePoseModel)({ model: options.model });
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
        poseDetectionScriptUrl: (0, poseModels_1.defaultPoseDetectionCdnUrl)(),
    };
}
function getBundledRuntimeVersion() {
    return bundledRuntimeAssets_1.BUNDLED_RUNTIME_VERSION;
}
