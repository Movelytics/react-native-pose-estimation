/**
 * Fetch a custom skeleton overlay by Strapi `api_uuid`
 * (WebView `?skeleton=<uuid>` parity).
 */
import type { SkeletonDefinition } from '../types/skeleton';
export interface FetchSkeletonOptions {
    baseUrl?: string;
}
export declare class SkeletonFetchError extends Error {
    readonly code: 'not_found' | 'network' | 'invalid';
    constructor(code: 'not_found' | 'network' | 'invalid', message: string);
}
/**
 * GET /api/sdk/skeleton?uuid=…
 * Returns the overlay definition or throws {@link SkeletonFetchError}.
 */
export declare function fetchSkeletonDefinition(uuid: string, options?: FetchSkeletonOptions): Promise<SkeletonDefinition>;
