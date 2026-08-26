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

import { Platform } from 'react-native';

import { SDK_VERSION } from '../sdkVersion';
import type { ConfigureRequest, PoseModelProfile, SdkManifest } from '../types/manifest';
import type { EngineChannel } from '../engineChannel';

export const SDK_NAME = 'posetracker-rn' as const;
export { SDK_VERSION };

/** Overridable for staging/self-hosted backends. */
export const DEFAULT_BASE_URL =
  'https://movelytics-strapi-c78a339b7070.herokuapp.com';

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

export class ConfigureError extends Error {
  constructor(
    readonly code: 'invalid_token' | 'quota_exceeded' | 'network' | 'internal',
    message: string,
  ) {
    super(message);
    this.name = 'ConfigureError';
  }
}

export async function configure(
  apiToken: string | null,
  options: ConfigureOptions = {},
): Promise<SdkManifest> {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  const body: ConfigureRequest = {
    ...(apiToken ? { apiToken } : {}),
    sdkName: SDK_NAME,
    sdkVersion: SDK_VERSION,
    targetPlatform: Platform.OS === 'ios' ? 'ios' : 'android',
    poseModelProfile: options.poseModelProfile ?? 'AdaptiveChoice',
    locale: options.locale,
    localVersions: options.localVersions,
    engineChannel: options.engine === 'v4' ? 'v4' : 'v3',
  };

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/sdk/configure`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
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

  return (await response.json()) as SdkManifest;
}
