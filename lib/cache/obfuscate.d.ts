/**
 * Obfuscation of the local session cache (manifest + engine bundle).
 *
 * Purpose: the cached business logic and exercise configs must not be
 * readable without the API key that earned them (commercial boundary). The
 * scheme is an SHA-256-based XOR keystream keyed by the API token — this is
 * deliberate *obfuscation*, not cryptographic security against an attacker
 * who owns both the device and a valid token (such an attacker can already
 * read the downloaded engine at runtime). What it guarantees:
 * - a device with no API token cannot exploit a cache left by another app
 *   or a previous integration;
 * - the cache written for token A is unreadable after switching to token B.
 */
/** Derives the cache secret from the API token (never stored on disk). */
export declare function deriveCacheSecret(apiToken: string): string;
export declare function sealString(plain: string, secret: string): string;
/** Returns null when the payload is not a sealed blob or cannot be decoded. */
export declare function openString(sealed: string, secret: string): string | null;
