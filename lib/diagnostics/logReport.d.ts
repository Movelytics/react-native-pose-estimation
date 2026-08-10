/**
 * Human-readable diagnostic dumps for Metro / adb logcat.
 * Designed so a host can paste the terminal output into a support chat.
 */
import type { AccelerationDiagnostics } from '../types/acceleration';
/** Always-on console sink — shows up in `npx expo start` / Metro. */
export declare function defaultDiagnosticLogger(message: string): void;
export declare function logPlatformBanner(): void;
/**
 * Multi-line dump of the warm-up / acceleration verdict. Call after
 * preload()/warmup() so Android CPU-fallback reasons are visible in Metro.
 */
export declare function logAccelerationReport(diag: AccelerationDiagnostics | null, extra?: Record<string, unknown>): void;
/** Throttled FPS / latency line for the camera loop (Metro-friendly). */
export declare function logFrameStats(stats: {
    fps: number;
    medianLatencyMs: number | null;
    backend: string;
    acceleration: string;
    frames: number;
    keypointsAbove03: number;
    meanScore: number;
}): void;
