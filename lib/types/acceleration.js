"use strict";
/**
 * GPU-acceleration status types.
 *
 * Historical context (see docs/ANDROID_GL_ACCELERATION.md): on Android the
 * previous product generation had to run TF.js inside a WebView because it
 * was the only reliable way to get a working WebGL backend. The native path
 * (tfjs-react-native over expo-gl) can silently degrade — the platform
 * adapter *shims* float-texture extension queries, so TF.js may believe the
 * GPU supports float32 render targets when it does not, and expo-gl contexts
 * die on Android when the surface is backgrounded. These types exist so the
 * SDK reports an explicit acceleration verdict instead of failing silently
 * into a 1-2 fps CPU fallback.
 */
Object.defineProperty(exports, "__esModule", { value: true });
