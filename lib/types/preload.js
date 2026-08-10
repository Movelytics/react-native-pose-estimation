"use strict";
/**
 * Cold-start / preload modes for {@link PoseTrackerClient.preload}.
 *
 * - `basic` (default): load MoveNet + warm TF.js/WebGL with zero tensors.
 *   Does **not** call `getUserMedia` — no unexpected camera permission prompt.
 * - `full`: also open the camera during warm-up (legacy behaviour). Only use
 *   when the host UI is already in a camera context the user expects.
 */
Object.defineProperty(exports, "__esModule", { value: true });
