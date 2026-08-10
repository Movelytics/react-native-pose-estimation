"use strict";
/**
 * Inference backend abstraction.
 *
 * v1 ships a single implementation (`TfjsMoveNetBackend`, TF.js +
 * bundleResourceIO). The interface is deliberately minimal so a native
 * TFLite backend (react-native-fast-tflite + custom models downloaded from
 * the manifest) can be plugged in later without touching the engine or the
 * provider: anything that turns an input frame into a `Pose` qualifies.
 */
Object.defineProperty(exports, "__esModule", { value: true });
