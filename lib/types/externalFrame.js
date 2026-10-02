"use strict";
/**
 * External frames: the host app owns the camera and the preview, and pushes
 * frames to {@link PoseTrackerClient.processFrame}. The SDK infers, runs the
 * active exercise engine, and returns data. It draws nothing.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isExternalFrame = isExternalFrame;
function isExternalFrame(frame) {
    if (frame == null || typeof frame !== 'object')
        return false;
    const f = frame;
    return ((typeof f.base64 === 'string' || typeof f.uri === 'string') &&
        typeof f.width === 'number' &&
        typeof f.height === 'number');
}
