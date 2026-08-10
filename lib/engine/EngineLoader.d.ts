/**
 * Remote engine distribution (Sency-style model distribution, applied to the
 * business-logic bundle):
 *
 * 1. The handshake manifest carries a signed, token-gated URL of a versioned
 *    JS engine bundle plus its SHA-256 digest.
 * 2. The bundle is cached on the local filesystem, sealed with a secret
 *    derived from the API token (see `cache/obfuscate.ts`): a device without
 *    the key cannot read the cached business logic. Integrity is re-validated
 *    against the manifest digest on every load (corrupted/partial downloads
 *    are purged, like Sency's `TFL3` magic check on cached TFLite files).
 * 3. A crash-loop guard (analog of Sency's `TfliteRuntimeGuard`
 *    PROBING→PASSED/FAILED state machine) marks the bundle as "probing"
 *    before evaluation; if the app died while probing, the next launch
 *    skips that exact bundle.
 * 4. NO business logic ships in the npm package: when no engine can be
 *    obtained (no network, no valid cache, crash-looping bundle), `load`
 *    returns null and the SDK runs in keypoints-only mode.
 */
import type { EngineBundleDescriptor } from '../types/manifest';
import type { PoseTrackerEngine } from './types';
export interface FileStore {
    read(key: string): Promise<string | null>;
    write(key: string, contents: string): Promise<void>;
    remove(key: string): Promise<void>;
}
export interface KeyValueStore {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<void>;
    removeItem(key: string): Promise<void>;
}
/** Filesystem-backed store using expo-file-system (optional peer dependency). */
export declare function createExpoFileStore(dirName?: string): FileStore | null;
/** Filesystem-backed store using react-native-fs (bare RN, optional). */
export declare function createRnfsFileStore(dirName: string): FileStore | null;
/** Filesystem-backed store using react-native-blob-util (bare RN, optional). */
export declare function createBlobUtilFileStore(dirName: string): FileStore | null;
/**
 * In-memory store — last-resort fallback when no filesystem module is
 * installed (bare RN without expo-file-system / react-native-fs /
 * react-native-blob-util). The SDK stays fully functional but nothing
 * persists across app launches: every cold start needs the network again.
 */
export declare function createMemoryFileStore(): FileStore;
/**
 * Best available persistent file store for the host app:
 * expo-file-system (Expo / Expo Go) → react-native-fs (bare RN) →
 * react-native-blob-util (bare RN). Returns null when none is installed —
 * callers may fall back to {@link createMemoryFileStore}.
 */
export declare function createNativeFileStore(dirName: string): FileStore | null;
/** AsyncStorage-backed store (already a peer dep via tfjs-react-native). */
export declare function createAsyncKeyValueStore(): KeyValueStore | null;
export interface EngineLoadResult {
    engine: PoseTrackerEngine;
    source: 'remote-cache' | 'remote-download';
}
export interface EngineLoaderOptions {
    fileStore?: FileStore | null;
    keyValueStore?: KeyValueStore | null;
    /** Injectable for tests. */
    fetchFn?: typeof fetch;
    /** Diagnostic trail (Metro / logcat) — why a load returned null. */
    onDiagnostic?: (message: string) => void;
}
export declare class EngineLoader {
    private readonly files;
    private readonly kv;
    private readonly fetchFn;
    private readonly onDiagnostic;
    /** Last load failure detail (surfaced by the client error event). */
    lastError: string | null;
    constructor(options?: EngineLoaderOptions);
    /**
     * Clear a crash-guard mark so the next {@link load} can retry this bundle
     * (e.g. after the host taps "Test key").
     */
    clearGuard(descriptor: EngineBundleDescriptor | null): Promise<void>;
    /**
     * Load the engine described by the manifest. Returns null when no engine
     * can be obtained (the caller then runs keypoints-only).
     *
     * @param cacheSecret secret derived from the API token, used to seal/open
     *   the cached bundle (`deriveCacheSecret`).
     */
    load(descriptor: EngineBundleDescriptor | null, cacheSecret: string, options?: {
        forceRetry?: boolean;
    }): Promise<EngineLoadResult | null>;
    /**
     * Evaluate an engine bundle (CommonJS-style: the bundle assigns
     * `module.exports.createEngine`). Wrapped by the crash-loop guard.
     * Hermes and JSC both support runtime evaluation via `new Function`.
     */
    private evaluate;
}
