/**
 * Local pose-runtime loader — assets are embedded in the npm package by
 * `scripts/build-runtime-payload.mjs` (`bundledRuntimeAssets.ts`).
 * No network, no filesystem cache required for keypoints-only.
 */
import type { PoseRuntimeParts } from '../../runtime/RuntimeCache';
/** Ready-to-inject pose runtime shipped inside the package. */
export declare function getBundledRuntimeParts(): PoseRuntimeParts;
export declare function getBundledRuntimeVersion(): string;
