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

import { sha256 } from 'js-sha256';

import type { PoseRuntimeDescriptor } from '../types/manifest';
import {
  createMemoryFileStore,
  createNativeFileStore,
  type FileStore,
} from '../engine/EngineLoader';

/** Part names, as declared by the backend runtime manifest. */
const PART_NAMES = ['tfjs', 'tfjs-wasm', 'model', 'weights', 'pipeline', 'runtime'] as const;
type PartName = (typeof PART_NAMES)[number];

/** Required parts — `pipeline` is optional (JS fallback lives in the runtime part). */
const REQUIRED_PARTS: PartName[] = ['tfjs', 'tfjs-wasm', 'model', 'weights', 'runtime'];

const CURRENT_KEY = 'current.json';

interface CurrentPointer {
  version: string;
  parts: Partial<Record<PartName, { key: string; sha256: string }>>;
}

/** Decoded, ready-to-inject runtime parts. */
export interface PoseRuntimeParts {
  version: string;
  /** TF.js bundle (core + converter + webgl + wasm backends). */
  tfjsJs: string;
  /** XNNPACK wasm binaries (base64). */
  tfjsWasmB64: { plain: string; simd: string; threadedSimd: string };
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

export class RuntimeCache {
  private readonly files: FileStore | null;
  private readonly fetchFn: typeof fetch;
  private memoryParts: PoseRuntimeParts | null = null;
  /** True when no persistent FS module is installed (memory-only fallback). */
  readonly persistent: boolean;

  constructor(options: RuntimeCacheOptions = {}) {
    let files =
      options.fileStore !== undefined
        ? options.fileStore
        : createNativeFileStore('posetracker-runtime');
    this.persistent = files !== null;
    if (files === null) {
      // Bare RN without any filesystem lib: stay functional with an
      // in-memory store — online works, but every cold start re-downloads.
      files = createMemoryFileStore();
    }
    this.files = files;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  /** Version currently committed to the cache, or null when cold/empty. */
  async getCachedVersion(): Promise<string | null> {
    const current = await this.readCurrent();
    return current?.version ?? null;
  }

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
  async warm(
    descriptor: PoseRuntimeDescriptor | null,
    onProgress?: (progress: RuntimeCacheProgress) => void,
  ): Promise<boolean> {
    if (!this.files) {
      return false;
    }
    const current = await this.readCurrent();
    if (!descriptor) {
      // Offline handshake: the existing cache (if any) is served as-is.
      return current !== null;
    }
    if (current && current.version === descriptor.version) {
      return true;
    }

    const wanted = Object.entries(descriptor.parts) as Array<
      [string, { url: string; sha256: string; bytes: number }]
    >;
    const next: CurrentPointer = { version: descriptor.version, parts: {} };
    let completed = 0;

    try {
      for (const [name, part] of wanted) {
        if (!this.isKnownPart(name)) {
          continue;
        }
        onProgress?.({
          part: name,
          completedParts: completed,
          totalParts: wanted.length,
          partBytes: part.bytes,
        });
        const key = `${name}@${descriptor.version}`;

        // Reuse without network when the exact content is already cached
        // (same key from an interrupted warm, or same sha in the previous
        // version under another key).
        let content = await this.readVerified(key, part.sha256);
        if (content === null) {
          const previous = current?.parts[name];
          if (previous && previous.sha256 === part.sha256) {
            content = await this.readVerified(previous.key, part.sha256);
          }
        }
        if (content === null) {
          const response = await this.fetchFn(part.url);
          if (!response.ok) {
            throw new Error(`pose-runtime part '${name}' HTTP ${response.status}`);
          }
          content = await response.text();
          // Integrity gate BEFORE commit: a truncated/corrupted download
          // never reaches the cache.
          if (sha256(content) !== part.sha256) {
            throw new Error(`pose-runtime part '${name}' failed sha256 verification`);
          }
        }
        await this.files.write(key, content);
        next.parts[name as PartName] = { key, sha256: part.sha256 };
        completed += 1;
      }

      for (const required of REQUIRED_PARTS) {
        if (!next.parts[required]) {
          throw new Error(`pose-runtime manifest is missing required part '${required}'`);
        }
      }

      // Commit point: flip the pointer only once every part is verified.
      await this.files.write(CURRENT_KEY, JSON.stringify(next));
      this.memoryParts = null;

      // Best-effort GC of the previous version's files.
      if (current) {
        for (const entry of Object.values(current.parts)) {
          if (entry && !Object.values(next.parts).some((p) => p && p.key === entry.key)) {
            await this.files.remove(entry.key).catch(() => {});
          }
        }
      }
      return true;
    } catch {
      // Warm failed: the previous committed version stays intact.
      return current !== null;
    }
  }

  /** Load (and decode) the committed runtime parts; null when cache is cold. */
  async load(): Promise<PoseRuntimeParts | null> {
    if (this.memoryParts) {
      return this.memoryParts;
    }
    if (!this.files) {
      return null;
    }
    const current = await this.readCurrent();
    if (!current) {
      return null;
    }

    const read = async (name: PartName): Promise<string | null> => {
      const entry = current.parts[name];
      if (!entry) {
        return null;
      }
      return this.readVerified(entry.key, entry.sha256);
    };

    const [tfjsJs, tfjsWasmRaw, modelJson, weightsRaw, pipelineWasmB64, runtimeJs] =
      await Promise.all([
        read('tfjs'),
        read('tfjs-wasm'),
        read('model'),
        read('weights'),
        read('pipeline'),
        read('runtime'),
      ]);

    if (!tfjsJs || !tfjsWasmRaw || !modelJson || !weightsRaw || !runtimeJs) {
      // A part is missing or failed integrity: treat the cache as cold.
      return null;
    }

    try {
      this.memoryParts = {
        version: current.version,
        tfjsJs,
        tfjsWasmB64: JSON.parse(tfjsWasmRaw) as PoseRuntimeParts['tfjsWasmB64'],
        modelJson,
        weightsB64: JSON.parse(weightsRaw) as string[],
        pipelineWasmB64: pipelineWasmB64 ?? null,
        runtimeJs,
      };
      return this.memoryParts;
    } catch {
      return null;
    }
  }

  /** Wipe the whole runtime cache (revocation / recovery). */
  async purge(): Promise<void> {
    this.memoryParts = null;
    if (!this.files) {
      return;
    }
    const current = await this.readCurrent();
    if (current) {
      for (const entry of Object.values(current.parts)) {
        if (entry) {
          await this.files.remove(entry.key).catch(() => {});
        }
      }
    }
    await this.files.remove(CURRENT_KEY).catch(() => {});
  }

  // -------------------------------------------------------------------------

  private isKnownPart(name: string): name is PartName {
    return (PART_NAMES as readonly string[]).includes(name);
  }

  private async readCurrent(): Promise<CurrentPointer | null> {
    try {
      const raw = await this.files?.read(CURRENT_KEY);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw) as CurrentPointer;
      if (!parsed.version || !parsed.parts) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  private async readVerified(key: string, expectedSha: string): Promise<string | null> {
    try {
      const content = await this.files?.read(key);
      if (content === null || content === undefined) {
        return null;
      }
      if (sha256(content) !== expectedSha) {
        await this.files?.remove(key).catch(() => {});
        return null;
      }
      return content;
    } catch {
      return null;
    }
  }
}
