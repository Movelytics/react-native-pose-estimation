/**
 * Fetch a custom skeleton overlay by Strapi `api_uuid`
 * (WebView `?skeleton=<uuid>` parity).
 */

import type { SkeletonDefinition } from '../types/skeleton';
import { DEFAULT_BASE_URL } from './configure';

export interface FetchSkeletonOptions {
  baseUrl?: string;
}

export class SkeletonFetchError extends Error {
  constructor(
    readonly code: 'not_found' | 'network' | 'invalid',
    message: string,
  ) {
    super(message);
    this.name = 'SkeletonFetchError';
  }
}

/**
 * GET /api/sdk/skeleton?uuid=…
 * Returns the overlay definition or throws {@link SkeletonFetchError}.
 */
export async function fetchSkeletonDefinition(
  uuid: string,
  options: FetchSkeletonOptions = {},
): Promise<SkeletonDefinition> {
  const id = uuid.trim();
  if (!id || id === 'true' || id === 'false') {
    throw new SkeletonFetchError('invalid', 'skeleton uuid is required');
  }
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/sdk/skeleton?uuid=${encodeURIComponent(id)}`);
  } catch (err) {
    throw new SkeletonFetchError('network', `Skeleton fetch failed: ${String(err)}`);
  }
  if (response.status === 404) {
    throw new SkeletonFetchError('not_found', `Skeleton '${id}' not found`);
  }
  if (!response.ok) {
    throw new SkeletonFetchError('network', `Skeleton fetch HTTP ${response.status}`);
  }
  const body = (await response.json()) as SkeletonDefinition & { api_uuid?: string };
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
