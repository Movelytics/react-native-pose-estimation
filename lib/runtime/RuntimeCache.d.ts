/**
 * Versioned filesystem cache of the pose-runtime payload (stub-loader
 * architecture): the npm package ships ZERO runtime assets — TF.js, the
 * MoveNet model, the proprietary pipeline wasm and the page runtime are
 * downloaded from the PoseTracker API, verified and cached here, then
 * injected into the WebView HTML at mount.
 *
 * Guarantees:
 * - sha256 is verified BEFORE a part is committed to the cache: a network
 *   cut mid-update never corrupts the cache, the previous version stays
 *   intact until every part of the new version is verified (`current.json`
 *   is flipped last).
 * - Warmed by `PoseTrackerClient.preload()` (cold-start), works fully
 *   offline afterwards.
 * - `purge()` on revocation signals.
 */
import type { PoseRuntimeDescriptor } from '../types/manifest';
import { type FileStore } from '../engine/EngineLoader';
/** Decoded, ready-to-inject runtime parts. */
export interface PoseRuntimeParts {
    version: string;
    /** TF.js bundle (core + converter + webgl + wasm backends). */
    tfjsJs: string;
    /** XNNPACK wasm binaries (base64). */
    tfjsWasmB64: {
        plain: string;
        simd: string;
        threadedSimd: string;
    };
    /** MoveNet graph model topology (raw model.json). */
    modelJson: string;
    /** Weight shards (base64, manifest order). */
    weightsB64: string[];
    /** Proprietary pose pipeline wasm (base64), null when not deployed. */
    pipelineWasmB64: string | null;
    /** Page runtime (camera, presets, inference loop, events). */
    runtimeJs: string;
}
export interface RuntimeCacheProgress {
    part: string;
    completedParts: number;
    totalParts: number;
    /** Bytes of the part being downloaded (from the manifest). */
    partBytes: number;
}
export interface RuntimeCacheOptions {
    fileStore?: FileStore | null;
    /** Injectable for tests. */
    fetchFn?: typeof fetch;
}
export declare class RuntimeCache {
    private readonly files;
    private readonly fetchFn;
    private memoryParts;
    /** True when no persistent FS module is installed (memory-only fallback). */
    readonly persistent: boolean;
    constructor(options?: RuntimeCacheOptions);
    /** Version currently committed to the cache, or null when cold/empty. */
    getCachedVersion(): Promise<string | null>;
    /**
     * Ensure the cache holds the version described by the manifest. Downloads
     * only what is missing/outdated; every part is checksum-verified BEFORE
     * being committed. The previous version keeps serving until the new one is
     * fully committed (atomic flip of `current.json`, then best-effort GC).
     *
     * Returns true when the cache is warm (either already up-to-date or
     * successfully updated); false when it could not be warmed (offline...) —
     * the caller decides whether a stale/absent cache is acceptable.
     */
    warm(descriptor: PoseRuntimeDescriptor | null, onProgress?: (progress: RuntimeCacheProgress) => void): Promise<boolean>;
    /** Load (and decode) the committed runtime parts; null when cache is cold. */
    load(): Promise<PoseRuntimeParts | null>;
    /** Wipe the whole runtime cache (revocation / recovery). */
    purge(): Promise<void>;
    private isKnownPart;
    private readCurrent;
    private readVerified;
}
