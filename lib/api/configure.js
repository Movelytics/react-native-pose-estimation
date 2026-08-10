"use strict";
/**
 * Handshake client: `configure(apiToken)` calls the Strapi backend, which
 * validates the API token (plan/quota) and returns the `SdkManifest` —
 * exercise configs, engine bundle descriptor, pose-runtime payload
 * descriptor, model profiles, reference movements. All server-driven
 * behavior flows from this single call.
 *
 * Keyless mode (`apiToken` null): the backend returns the PUBLIC manifest —
 * pose-runtime descriptor only, no session/engine/exercises. This is how
 * keypoints-only installs bootstrap the pose estimation payload.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfigureError = exports.DEFAULT_BASE_URL = exports.SDK_VERSION = exports.SDK_NAME = void 0;
exports.configure = configure;
const react_native_1 = require("react-native");
exports.SDK_NAME = 'posetracker-rn';
exports.SDK_VERSION = '0.1.1';
/** Overridable for staging/self-hosted backends. */
exports.DEFAULT_BASE_URL = 'https://movelytics-strapi-c78a339b7070.herokuapp.com';
class ConfigureError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'ConfigureError';
    }
}
exports.ConfigureError = ConfigureError;
async function configure(apiToken, options = {}) {
    const baseUrl = (options.baseUrl ?? exports.DEFAULT_BASE_URL).replace(/\/$/, '');
    const body = {
        ...(apiToken ? { apiToken } : {}),
        sdkName: exports.SDK_NAME,
        sdkVersion: exports.SDK_VERSION,
        targetPlatform: react_native_1.Platform.OS === 'ios' ? 'ios' : 'android',
        poseModelProfile: options.poseModelProfile ?? 'AdaptiveChoice',
        locale: options.locale,
        localVersions: options.localVersions,
    };
    let response;
    try {
        response = await fetch(`${baseUrl}/api/sdk/configure`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
    }
    catch (err) {
        throw new ConfigureError('network', `Handshake request failed: ${String(err)}`);
    }
    if (response.status === 401 || response.status === 403) {
        // The 401 body carries `revoked: true` — the caller purges the sealed
        // engine/session caches (a revoked key must not keep the engine alive).
        throw new ConfigureError('invalid_token', 'Invalid, revoked or unauthorized API token.');
    }
    if (response.status === 429) {
        throw new ConfigureError('quota_exceeded', 'API call quota exceeded for the current plan.');
    }
    if (!response.ok) {
        throw new ConfigureError('internal', `Handshake failed with HTTP ${response.status}.`);
    }
    return (await response.json());
}
