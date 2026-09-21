/**
 * Local pose-runtime loader — assets are embedded in the npm package by
 * `scripts/build-runtime-payload.mjs` (`bundledRuntimeAssets.ts`).
 * No network, no filesystem cache required for keypoints-only **MoveNet**.
 *
 * BlazePose (`model: 'blazepose'`) reuses the bundled TF.js but loads
 * `@tensorflow-models/pose-detection` from CDN — see {@link resolvePoseModel}.
 */
import type { PoseRuntimeParts } from '../../runtime/RuntimeCache';
import { type PoseModelAlias } from '../../models/poseModels';
export interface GetBundledRuntimeOptions {
    /** `movenet` (default, bundled) or `blazepose` (CDN pose-detection). */
    model?: PoseModelAlias;
}
/** Ready-to-inject pose runtime shipped inside the package. */
export declare function getBundledRuntimeParts(options?: GetBundledRuntimeOptions): PoseRuntimeParts;
export declare function getBundledRuntimeVersion(): string;
