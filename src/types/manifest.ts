/**
 * Types for the `POST /api/sdk/configure` handshake response ("manifest").
 *
 * The manifest is the single source of truth for server-driven behavior:
 * exercise definitions (angle thresholds, rep state machines), reference
 * movements, engine bundle distribution and model profiles. Updating the
 * manifest server-side changes SDK behavior without republishing the app.
 */

/**
 * Model profiles (Sency-style). In v1 every profile maps to the bundled
 * MoveNet SinglePose Lightning model; the fields below exist so the backend
 * can later distribute per-profile models (e.g. Thunder for Prime, custom
 * TFLite for native backends) without breaking older SDKs.
 */
export type PoseModelProfile = 'UltraLite' | 'Lite' | 'Pro' | 'Prime' | 'AdaptiveChoice';

export type ModelFormat = 'tfjs-graph-model' | 'tflite' | 'coreml';

export interface ModelDescriptor {
  /** Stable identifier, e.g. "movenet-singlepose-lightning". */
  modelId: string;
  format: ModelFormat;
  /** Square input resolution in pixels (192 for MoveNet Lightning). */
  inputSize: number;
  /**
   * Signed (token-gated) download URL for a standalone model archive, or
   * null/absent when the model is delivered by another channel (stub-loader
   * architecture: MoveNet ships inside the `pose-runtime` payload).
   */
  signedUrl?: string | null;
  /** SHA-256 hex digest of the downloadable archive (null when signedUrl is null). */
  sha256?: string | null;
  /** Delivery channel; 'pose-runtime' = part of the public runtime payload. */
  deliveredBy?: 'pose-runtime';
  version: string;
}

/** Maps each profile to a model. v1: all profiles point to the same MoveNet entry. */
export type ModelsByProfile = Record<Exclude<PoseModelProfile, 'AdaptiveChoice'>, ModelDescriptor>;

// ---------------------------------------------------------------------------
// Exercise configuration (server-driven engine behavior)
// ---------------------------------------------------------------------------

/**
 * Full movement definition, mirroring the Strapi content-types
 * (`api::movement.movement` + steps/parameters/recommendations/initial
 * posture) that already drive the WebView engine. The remote engine bundle
 * consumes this structure as-is, so movements/exercises created or tuned in
 * the dashboard update SDK behavior without any republish.
 */
export interface MovementStepParameter {
  /** Keypoint/angle selector; `a||b` accepts either side (front convention). */
  name: string;
  type: 'angle' | 'upper_y' | 'matching_y' | 'same_y' | 'matching_x' | 'same_x' | 'distance_y';
  /** Weight of this parameter within the step (0–100). */
  percentage: number;
  operator?: string;
  value?: number;
  reference?: string;
  /** When true, the parameter is included in `step_completion` payloads. */
  public?: boolean;
  /** Per-difficulty acceptance values (e.g. { easy: 90, medium: 100 }). */
  scale_acceptance?: Record<string, number>;
  /** Acceptance values when the camera point of view is elevated. */
  upper_scale_acceptance?: Record<string, number>;
}

export interface MovementRecommendation {
  name: string;
  type: 'angle' | 'body_axe_without_arms' | 'upper_y' | 'matching_x';
  operator: string;
  value?: number;
  reference?: string;
  recommendation_text: string;
  scale_acceptance?: Record<string, number>;
  upper_scale_acceptance?: Record<string, number>;
}

export interface MovementStep {
  name: string;
  /** Order of the step within the movement (0-based). */
  position: number;
  /** Contribution of this step to the overall 0–100 progression. */
  percentage: number;
  /** Per-difficulty completion threshold to validate the step. */
  scale_acceptance: Record<string, number>;
  movement_parameters: MovementStepParameter[];
  movement_recommendations: MovementRecommendation[];
}

export interface InitialPosture {
  /** Expected orientation: 'face' or 'profile'. */
  type: string;
  /** Keypoints that must be visible inside the placement box. */
  required_points: string[];
  /** Placement box paddings, in % of the frame. */
  padding_horizontal?: number | string;
  padding_vertical?: number | string;
}

export interface MovementDefinition {
  name: string;
  type: 'dynamic' | 'static';
  scale_acceptance: Record<string, number>;
  movement_steps: MovementStep[];
  movement_initial_posture: InitialPosture | null;
  custom_skeleton?: string | null;
  silhouette_image_url?: string | null;
}

export interface ExerciseConfig {
  /** Stable identifier, e.g. "squat". */
  id: string;
  name: string;
  type: 'dynamic' | 'static';
  /**
   * Full server-driven definition, consumed by the remote engine bundle.
   * Exercise configs only ever exist behind a validated handshake (live or
   * encrypted session cache) — the npm package ships zero movement
   * intelligence (commercial boundary, see ARCHITECTURE.md §Modes).
   */
  movement: MovementDefinition;
}

export interface ReferenceMovementDescriptor {
  uuid: string;
  name: string;
  /** Signed URL to the movement signature JSON (angles/ratios/deltas over time). */
  signedSignatureUrl: string;
  sha256: string;
}

// ---------------------------------------------------------------------------
// Engine bundle distribution
// ---------------------------------------------------------------------------

export interface EngineBundleDescriptor {
  version: string;
  /** Signed, token-gated URL of the JS engine bundle. */
  signedUrl: string;
  /** SHA-256 hex digest used for integrity validation after download. */
  sha256: string;
  /** Minimum SDK version able to run this bundle (semver). */
  minSdkVersion: string;
  /** True when the version sent in `localVersions.engine` is already current. */
  upToDate?: boolean;
}

// ---------------------------------------------------------------------------
// Pose-runtime payload distribution (public, stub-loader architecture)
// ---------------------------------------------------------------------------

export interface PoseRuntimePartDescriptor {
  /** Download URL of this part (`GET /api/sdk/pose-runtime?part=...&v=...`). */
  url: string;
  /** SHA-256 hex digest, verified BEFORE the part is committed to the cache. */
  sha256: string;
  bytes: number;
}

/**
 * Descriptor of the public pose estimation payload (TF.js + MoveNet +
 * proprietary pipeline wasm + page runtime). No API key required: pose
 * estimation is the free tier; the movement engine stays key-gated.
 */
export interface PoseRuntimeDescriptor {
  version: string;
  /** True when the version sent in `localVersions.poseRuntime` is current. */
  upToDate?: boolean;
  baseUrl?: string;
  /** Parts by name: tfjs, tfjs-wasm, model, weights, pipeline, runtime. */
  parts: Record<string, PoseRuntimePartDescriptor>;
}

// ---------------------------------------------------------------------------
// Handshake request / response
// ---------------------------------------------------------------------------

export interface ConfigureRequest {
  /** Optional: keyless handshakes get the public manifest (pose-runtime only). */
  apiToken?: string;
  sdkName: 'posetracker-rn';
  sdkVersion: string;
  targetPlatform: 'ios' | 'android';
  /** Requested profile; the backend may downgrade it based on plan. */
  poseModelProfile: PoseModelProfile;
  /** Locale for localized strings in configs (hints, recommendations). */
  locale?: string;
  /**
   * Versions currently committed to the local caches; the backend answers
   * with `upToDate` flags per module so unchanged payloads are not
   * re-downloaded.
   */
  localVersions?: {
    poseRuntime?: string | null;
    engine?: string | null;
  };
}

export interface PlanInfo {
  plan: string;
  /** Remaining API calls for the current period; null = unlimited. */
  remainingCalls: number | null;
  commercialUse: boolean;
}

export interface SdkManifest {
  /**
   * Short-lived session token for follow-up SDK requests (downloads, usage
   * pings). Null on keyless handshakes (public manifest).
   */
  sessionToken: string | null;
  /** Null on keyless handshakes. */
  plan: PlanInfo | null;
  models: ModelsByProfile;
  /** Profile the backend resolved for this device/plan. */
  resolvedProfile: Exclude<PoseModelProfile, 'AdaptiveChoice'>;
  /** Public pose estimation payload (always present, key or not). */
  poseRuntime: PoseRuntimeDescriptor | null;
  /** Null on keyless handshakes or when no engine bundle is deployed. */
  engine: EngineBundleDescriptor | null;
  exercises: ExerciseConfig[];
  referenceMovements: ReferenceMovementDescriptor[];
  /** Revocation signal: when true the SDK purges its sealed engine cache. */
  revoked?: boolean;
  /** Unix epoch ms after which the SDK should re-run the handshake. */
  expiresAt: number;
}
