"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.deriveCacheSecret = deriveCacheSecret;
exports.sealString = sealString;
exports.openString = openString;
const js_sha256_1 = require("js-sha256");
const MAGIC = 'ptc1:';
/** Derives the cache secret from the API token (never stored on disk). */
function deriveCacheSecret(apiToken) {
    return (0, js_sha256_1.sha256)(`posetracker-sdk-cache:${apiToken}`);
}
function utf8Encode(text) {
    // encodeURIComponent-based UTF-8, avoids relying on TextEncoder (Hermes).
    const escaped = unescape(encodeURIComponent(text));
    const bytes = new Uint8Array(escaped.length);
    for (let i = 0; i < escaped.length; i++) {
        bytes[i] = escaped.charCodeAt(i);
    }
    return bytes;
}
function utf8Decode(bytes) {
    let escaped = '';
    for (let i = 0; i < bytes.length; i++) {
        escaped += String.fromCharCode(bytes[i]);
    }
    return decodeURIComponent(escape(escaped));
}
function toHex(bytes) {
    let hex = '';
    for (let i = 0; i < bytes.length; i++) {
        hex += bytes[i].toString(16).padStart(2, '0');
    }
    return hex;
}
function fromHex(hex) {
    if (hex.length % 2 !== 0 || /[^0-9a-f]/.test(hex)) {
        return null;
    }
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
}
/** SHA-256 counter-mode keystream. */
function xorWithKeystream(bytes, secret) {
    const out = new Uint8Array(bytes.length);
    let counter = 0;
    let offset = 0;
    while (offset < bytes.length) {
        const block = js_sha256_1.sha256.array(`${secret}:${counter++}`);
        for (let i = 0; i < block.length && offset < bytes.length; i++, offset++) {
            out[offset] = bytes[offset] ^ block[i];
        }
    }
    return out;
}
function sealString(plain, secret) {
    return MAGIC + toHex(xorWithKeystream(utf8Encode(plain), secret));
}
/** Returns null when the payload is not a sealed blob or cannot be decoded. */
function openString(sealed, secret) {
    if (!sealed.startsWith(MAGIC)) {
        return null;
    }
    const bytes = fromHex(sealed.slice(MAGIC.length));
    if (!bytes) {
        return null;
    }
    try {
        return utf8Decode(xorWithKeystream(bytes, secret));
    }
    catch {
        // Wrong secret produces invalid UTF-8 → decodeURIComponent throws.
        return null;
    }
}
