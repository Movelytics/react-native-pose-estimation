/**
 * Cold-start / preload modes for {@link PoseTrackerClient.preload}.
 *
 * - `basic` (default): load MoveNet + warm TF.js/WebGL with zero tensors.
 *   Does **not** call `getUserMedia` — no unexpected camera permission prompt.
 * - `full`: also open the camera during warm-up (legacy behaviour). Only use
 *   when the host UI is already in a camera context the user expects.
 */
export type ColdStartMode = 'basic' | 'full';
export interface PreloadOptions {
    /**
     * Cold-start depth. Default `basic`.
     * Pass `full` only when you intentionally want getUserMedia during preload
     * (e.g. a visible camera screen that also warms the model).
     */
    coldStart?: ColdStartMode;
}
