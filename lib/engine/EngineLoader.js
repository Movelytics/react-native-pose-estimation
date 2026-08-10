"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.EngineLoader = void 0;
exports.createExpoFileStore = createExpoFileStore;
exports.createRnfsFileStore = createRnfsFileStore;
exports.createBlobUtilFileStore = createBlobUtilFileStore;
exports.createMemoryFileStore = createMemoryFileStore;
exports.createNativeFileStore = createNativeFileStore;
exports.createAsyncKeyValueStore = createAsyncKeyValueStore;
const js_sha256_1 = require("js-sha256");
const obfuscate_1 = require("../cache/obfuscate");
function asExpoFileSystemLegacy(mod) {
    const raw = mod;
    const fs = (raw?.cacheDirectory != null ? raw : raw?.default);
    if (fs &&
        typeof fs.cacheDirectory === 'string' &&
        typeof fs.readAsStringAsync === 'function' &&
        typeof fs.writeAsStringAsync === 'function' &&
        typeof fs.deleteAsync === 'function' &&
        typeof fs.makeDirectoryAsync === 'function') {
        return fs;
    }
    return null;
}
/**
 * Resolve the Expo FS API that still exposes the classic helpers.
 * Expo SDK 54+ moved them to `expo-file-system/legacy` — the root export's
 * `readAsStringAsync` / `writeAsStringAsync` now THROW at runtime.
 *
 * Requires MUST be static string literals (Metro rejects `require(id)`).
 */
function requireExpoFileSystemLegacy() {
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const legacy = asExpoFileSystemLegacy(require('expo-file-system/legacy'));
        if (legacy)
            return legacy;
    }
    catch {
        /* not installed / old expo-file-system without /legacy */
    }
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const root = asExpoFileSystemLegacy(require('expo-file-system'));
        if (root)
            return root;
    }
    catch {
        /* expo-file-system not installed */
    }
    return null;
}
/** Filesystem-backed store using expo-file-system (optional peer dependency). */
function createExpoFileStore(dirName = 'posetracker-engine') {
    const FileSystem = requireExpoFileSystemLegacy();
    if (!FileSystem || !FileSystem.cacheDirectory) {
        return null;
    }
    const dir = `${FileSystem.cacheDirectory}${dirName}/`;
    const ensureDir = FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => { });
    return {
        async read(key) {
            try {
                return await FileSystem.readAsStringAsync(dir + key);
            }
            catch {
                return null;
            }
        },
        async write(key, contents) {
            await ensureDir;
            await FileSystem.writeAsStringAsync(dir + key, contents);
        },
        async remove(key) {
            await FileSystem.deleteAsync(dir + key, { idempotent: true });
        },
    };
}
/** Filesystem-backed store using react-native-fs (bare RN, optional). */
function createRnfsFileStore(dirName) {
    let RNFS;
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        RNFS = require('react-native-fs');
        if (!RNFS || typeof RNFS.CachesDirectoryPath !== 'string')
            return null;
    }
    catch {
        return null;
    }
    const dir = `${RNFS.CachesDirectoryPath}/${dirName}`;
    const ensureDir = RNFS.mkdir(dir).catch(() => { });
    return {
        async read(key) {
            try {
                return await RNFS.readFile(`${dir}/${key}`, 'utf8');
            }
            catch {
                return null;
            }
        },
        async write(key, contents) {
            await ensureDir;
            await RNFS.writeFile(`${dir}/${key}`, contents, 'utf8');
        },
        async remove(key) {
            await RNFS.unlink(`${dir}/${key}`).catch(() => { });
        },
    };
}
/** Filesystem-backed store using react-native-blob-util (bare RN, optional). */
function createBlobUtilFileStore(dirName) {
    let fs;
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require('react-native-blob-util');
        fs = (mod.default ?? mod).fs;
        if (!fs || !fs.dirs || typeof fs.dirs.CacheDir !== 'string')
            return null;
    }
    catch {
        return null;
    }
    const dir = `${fs.dirs.CacheDir}/${dirName}`;
    const ensureDir = fs.mkdir(dir).catch(() => { });
    return {
        async read(key) {
            try {
                return await fs.readFile(`${dir}/${key}`, 'utf8');
            }
            catch {
                return null;
            }
        },
        async write(key, contents) {
            await ensureDir;
            await fs.writeFile(`${dir}/${key}`, contents, 'utf8');
        },
        async remove(key) {
            await fs.unlink(`${dir}/${key}`).catch(() => { });
        },
    };
}
/**
 * In-memory store — last-resort fallback when no filesystem module is
 * installed (bare RN without expo-file-system / react-native-fs /
 * react-native-blob-util). The SDK stays fully functional but nothing
 * persists across app launches: every cold start needs the network again.
 */
function createMemoryFileStore() {
    const entries = new Map();
    return {
        async read(key) {
            return entries.has(key) ? entries.get(key) : null;
        },
        async write(key, contents) {
            entries.set(key, contents);
        },
        async remove(key) {
            entries.delete(key);
        },
    };
}
/**
 * Best available persistent file store for the host app:
 * expo-file-system (Expo / Expo Go) → react-native-fs (bare RN) →
 * react-native-blob-util (bare RN). Returns null when none is installed —
 * callers may fall back to {@link createMemoryFileStore}.
 */
function createNativeFileStore(dirName) {
    return (createExpoFileStore(dirName) ??
        createRnfsFileStore(dirName) ??
        createBlobUtilFileStore(dirName));
}
/** AsyncStorage-backed store (already a peer dep via tfjs-react-native). */
function createAsyncKeyValueStore() {
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const AsyncStorage = require('@react-native-async-storage/async-storage').default;
        return AsyncStorage;
    }
    catch {
        return null;
    }
}
// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------
const GUARD_KEY_PREFIX = 'posetracker.engine.guard.';
class EngineLoader {
    constructor(options = {}) {
        /** Last load failure detail (surfaced by the client error event). */
        this.lastError = null;
        this.files =
            options.fileStore !== undefined
                ? options.fileStore
                : createNativeFileStore('posetracker-engine');
        this.kv =
            options.keyValueStore !== undefined ? options.keyValueStore : createAsyncKeyValueStore();
        this.fetchFn = options.fetchFn ?? fetch;
        this.onDiagnostic = options.onDiagnostic;
        this.onDiagnostic?.(`[posetracker] EngineLoader fileStore=${this.files ? 'native' : 'none'} ` +
            `kv=${this.kv ? 'async-storage' : 'none'}`);
    }
    /**
     * Clear a crash-guard mark so the next {@link load} can retry this bundle
     * (e.g. after the host taps "Test key").
     */
    async clearGuard(descriptor) {
        if (!descriptor || !this.kv)
            return;
        const guardKey = `${GUARD_KEY_PREFIX}${descriptor.version}.${descriptor.sha256}`;
        await this.kv.removeItem(guardKey).catch(() => { });
    }
    /**
     * Load the engine described by the manifest. Returns null when no engine
     * can be obtained (the caller then runs keypoints-only).
     *
     * @param cacheSecret secret derived from the API token, used to seal/open
     *   the cached bundle (`deriveCacheSecret`).
     */
    async load(descriptor, cacheSecret, options) {
        this.lastError = null;
        if (!descriptor) {
            this.lastError = 'manifest has no engine descriptor';
            return null;
        }
        const guardKey = `${GUARD_KEY_PREFIX}${descriptor.version}.${descriptor.sha256}`;
        if (options?.forceRetry) {
            await this.kv?.removeItem(guardKey).catch(() => { });
        }
        const guardState = (await this.kv?.getItem(guardKey));
        if (guardState === 'probing' || guardState === 'failed') {
            // 'probing' left over = the app crashed while evaluating this exact
            // bundle on a previous launch. Do not retry it automatically.
            await this.kv?.setItem(guardKey, 'failed');
            this.lastError =
                `engine crash-guard blocked version=${descriptor.version} ` +
                    `(state=${guardState}) — tap Test key to force retry`;
            this.onDiagnostic?.(`[posetracker] ${this.lastError}`);
            return null;
        }
        const cacheKey = `engine-${descriptor.version}.sealed`;
        // 1. Cache hit: unseal + integrity check.
        const sealed = await this.files?.read(cacheKey);
        if (sealed !== null && sealed !== undefined) {
            const code = (0, obfuscate_1.openString)(sealed, cacheSecret);
            if (code !== null && (0, js_sha256_1.sha256)(code) === descriptor.sha256) {
                const engine = await this.evaluate(code, guardKey);
                if (engine) {
                    this.onDiagnostic?.(`[posetracker] engine loaded from cache version=${descriptor.version}`);
                    return { engine, source: 'remote-cache' };
                }
            }
            else {
                // Corrupted, partial, or sealed with another token: purge it.
                this.onDiagnostic?.(`[posetracker] engine cache purged (unseal/integrity mismatch) key=${cacheKey}`);
                await this.files?.remove(cacheKey);
            }
        }
        // 2. Download → integrity → evaluate. Cache write is best-effort AFTER
        //    evaluate so a broken FS API (Expo 54 root export) cannot block the
        //    engine when the download itself succeeded.
        try {
            this.onDiagnostic?.(`[posetracker] downloading engine version=${descriptor.version}…`);
            const response = await this.fetchFn(descriptor.signedUrl);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const code = await response.text();
            const digest = (0, js_sha256_1.sha256)(code);
            if (digest !== descriptor.sha256) {
                throw new Error(`integrity check failed (got ${digest.slice(0, 12)}… expected ${descriptor.sha256.slice(0, 12)}…, ` +
                    `bytes=${code.length})`);
            }
            const engine = await this.evaluate(code, guardKey);
            if (engine) {
                try {
                    await this.files?.write(cacheKey, (0, obfuscate_1.sealString)(code, cacheSecret));
                }
                catch (err) {
                    // Non-fatal: next cold start will re-download.
                    this.onDiagnostic?.(`[posetracker] engine cache write failed (non-fatal): ` +
                        (err instanceof Error ? err.message : String(err)));
                }
                this.onDiagnostic?.(`[posetracker] engine loaded from download version=${descriptor.version} bytes=${code.length}`);
                return { engine, source: 'remote-download' };
            }
        }
        catch (err) {
            this.lastError = err instanceof Error ? err.message : String(err);
            this.onDiagnostic?.(`[posetracker] engine download/load failed: ${this.lastError}`);
        }
        if (!this.lastError) {
            this.lastError = 'engine evaluate returned null';
        }
        return null;
    }
    /**
     * Evaluate an engine bundle (CommonJS-style: the bundle assigns
     * `module.exports.createEngine`). Wrapped by the crash-loop guard.
     * Hermes and JSC both support runtime evaluation via `new Function`.
     */
    async evaluate(code, guardKey) {
        await this.kv?.setItem(guardKey, 'probing');
        try {
            const moduleRef = { exports: {} };
            // eslint-disable-next-line no-new-func
            const run = new Function('module', 'exports', code);
            run(moduleRef, moduleRef.exports);
            const factory = moduleRef.exports.createEngine;
            if (typeof factory !== 'function') {
                throw new Error(`engine bundle does not export createEngine() (got ${typeof factory}, keys=${Object.keys(moduleRef.exports).join(',')})`);
            }
            const engine = factory();
            await this.kv?.setItem(guardKey, 'passed');
            return engine;
        }
        catch (err) {
            this.lastError =
                'engine evaluate failed: ' + (err instanceof Error ? err.message : String(err));
            this.onDiagnostic?.(`[posetracker] ${this.lastError}`);
            await this.kv?.setItem(guardKey, 'failed');
            return null;
        }
    }
}
exports.EngineLoader = EngineLoader;
