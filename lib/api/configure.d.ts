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
import { SDK_VERSION } from '../sdkVersion';
import type { ConfigureRequest, PoseModelProfile, SdkManifest } from '../types/manifest';
import type { EngineChannel } from '../engineChannel';
export declare const SDK_NAME: "posetracker-rn";
export { SDK_VERSION };
/** Overridable for staging/self-hosted backends. */
export declare const DEFAULT_BASE_URL = "https://movelytics-strapi-c78a339b7070.herokuapp.com";
export interface ConfigureOptions {
    baseUrl?: string;
    poseModelProfile?: PoseModelProfile;
    locale?: string;
    /** Local cache versions, so the backend can answer `upToDate` per module. */
    localVersions?: ConfigureRequest['localVersions'];
    /**
     * Opt-in V4 heuristic engine. Default `'v3'` (production FSM).
     * Set `'v4'` at init — the handshake downloads `engine-v4.bundle.js`.
     */
    engine?: EngineChannel;
}
export declare class ConfigureError extends Error {
    readonly code: 'invalid_token' | 'quota_exceeded' | 'network' | 'internal';
    constructor(code: 'invalid_token' | 'quota_exceeded' | 'network' | 'internal', message: string);
}
export declare function configure(apiToken: string | null, options?: ConfigureOptions): Promise<SdkManifest>;
