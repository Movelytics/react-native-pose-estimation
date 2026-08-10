/**
 * Inference backend abstraction.
 *
 * v1 ships a single implementation (`TfjsMoveNetBackend`, TF.js +
 * bundleResourceIO). The interface is deliberately minimal so a native
 * TFLite backend (react-native-fast-tflite + custom models downloaded from
 * the manifest) can be plugged in later without touching the engine or the
 * provider: anything that turns an input frame into a `Pose` qualifies.
 */
import type { Pose } from '../types/pose';
import type { ModelDescriptor } from '../types/manifest';
import type { AccelerationDiagnostics } from '../types/acceleration';
/**
 * Input frame handed to the backend. For the TF.js backend this is a
 * `tf.Tensor3D` ([height, width, 3], int32/float32). Kept opaque here so the
 * interface does not force a TF.js dependency on future native backends
 * (which would receive a native frame/buffer reference instead).
 */
export type PoseInputFrame = unknown;
export interface PoseBackendInitOptions {
    /** Model resolved from the manifest for the active profile. */
    model: ModelDescriptor;
    /**
     * Local filesystem path of a downloaded model archive, when the manifest
     * provided one and it passed integrity validation. Undefined = use the
     * model bundled in the SDK package.
     */
    localModelPath?: string;
}
export interface PoseBackend {
    readonly name: string;
    /** Prepare the runtime (TF.js ready + backend selection for tfjs). */
    init(options: PoseBackendInitOptions): Promise<void>;
    /**
     * Run 1–2 dummy inferences so shaders/kernels are compiled before the
     * first real camera frame. No-op if already warm.
     */
    warmup(): Promise<void>;
    /** Estimate a single pose from an input frame. */
    estimatePose(frame: PoseInputFrame): Promise<Pose | null>;
    /** Release model and GPU resources. */
    dispose(): Promise<void>;
    /**
     * Optional: GPU-acceleration verdict + diagnostics collected during
     * `warmup()` (see docs/ANDROID_GL_ACCELERATION.md). Backends that cannot
     * introspect their accelerator (or a future native TFLite backend using
     * GPU/NNAPI delegates) may omit it or return null before warm-up.
     */
    getAcceleration?(): AccelerationDiagnostics | null;
}
