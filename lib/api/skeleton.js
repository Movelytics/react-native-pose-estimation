"use strict";
/**
 * Fetch a custom skeleton overlay by Strapi `api_uuid`
 * (WebView `?skeleton=<uuid>` parity).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SkeletonFetchError = void 0;
exports.fetchSkeletonDefinition = fetchSkeletonDefinition;
const configure_1 = require("./configure");
class SkeletonFetchError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'SkeletonFetchError';
    }
}
exports.SkeletonFetchError = SkeletonFetchError;
/**
 * GET /api/sdk/skeleton?uuid=…
 * Returns the overlay definition or throws {@link SkeletonFetchError}.
 */
async function fetchSkeletonDefinition(uuid, options = {}) {
    const id = uuid.trim();
    if (!id || id === 'true' || id === 'false') {
        throw new SkeletonFetchError('invalid', 'skeleton uuid is required');
    }
    const baseUrl = (options.baseUrl ?? configure_1.DEFAULT_BASE_URL).replace(/\/$/, '');
    let response;
    try {
        response = await fetch(`${baseUrl}/api/sdk/skeleton?uuid=${encodeURIComponent(id)}`);
    }
    catch (err) {
        throw new SkeletonFetchError('network', `Skeleton fetch failed: ${String(err)}`);
    }
    if (response.status === 404) {
        throw new SkeletonFetchError('not_found', `Skeleton '${id}' not found`);
    }
    if (!response.ok) {
        throw new SkeletonFetchError('network', `Skeleton fetch HTTP ${response.status}`);
    }
    const body = (await response.json());
    if (!body?.keypoints || !body?.keypoint_lines || !body?.circles || !body?.lines) {
        throw new SkeletonFetchError('invalid', 'Skeleton payload incomplete');
    }
    return {
        keypoints: body.keypoints,
        keypoint_lines: body.keypoint_lines,
        keypoint_angles: body.keypoint_angles ?? [],
        circles: body.circles,
        lines: body.lines,
        angles: body.angles,
    };
}
