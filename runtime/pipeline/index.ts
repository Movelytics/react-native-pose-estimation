/**
 * PoseTracker proprietary pose pipeline — compiled to WebAssembly
 * (AssemblyScript) and delivered at runtime as the `pose-pipeline.wasm`
 * part of the pose-runtime payload. NEVER shipped in the npm package.
 *
 * Per-frame processing of the raw MoveNet output:
 *   1. decode [y, x, score] * 17 normalized over the letterboxed square
 *   2. letterbox square -> video pixel coordinates
 *   3. temporal EMA smoothing (state lives inside this module)
 *   4. video pixels -> object-fit:cover display pixels
 *   5. display pixels -> normalized [0,1] host coordinates (mirror-aware)
 *
 * Interface (all f32, zero-copy via exported linear memory):
 *   inputPtr():  51 floats  — raw MoveNet output [y, x, score] * 17
 *   outputPtr(): 119 floats — [xPx, yPx, dx, dy, nx, ny, score] * 17
 *   setFrame(vw, vh, dispW, dispH, offX, offY, drawW, drawH, inputSize, mirror)
 *   process(): f32 — runs the pipeline, returns mean raw score
 *   reset() — clears the smoothing state (camera restart)
 */

const JOINTS = 17;

const input = new StaticArray<f32>(JOINTS * 3);
const output = new StaticArray<f32>(JOINTS * 7);

// EMA smoothing state, in video pixel space.
const smoothX = new StaticArray<f32>(JOINTS);
const smoothY = new StaticArray<f32>(JOINTS);
const smoothS = new StaticArray<f32>(JOINTS);
let hasSmoothState: bool = false;

const SMOOTH_ALPHA: f32 = 0.5;
const SMOOTH_MIN_SCORE: f32 = 0.1;

// Frame geometry (set once per frame before process()).
let videoW: f32 = 1.0;
let videoH: f32 = 1.0;
let displayW: f32 = 1.0;
let displayH: f32 = 1.0;
let letterboxOffX: f32 = 0.0;
let letterboxOffY: f32 = 0.0;
let letterboxDrawW: f32 = 192.0;
let letterboxDrawH: f32 = 192.0;
let modelInputSize: f32 = 192.0;
let mirrorX: bool = false;

export function inputPtr(): usize {
  return changetype<usize>(input);
}

export function outputPtr(): usize {
  return changetype<usize>(output);
}

export function reset(): void {
  hasSmoothState = false;
}

export function setFrame(
  vw: f32,
  vh: f32,
  dispW: f32,
  dispH: f32,
  offX: f32,
  offY: f32,
  drawW: f32,
  drawH: f32,
  inputSize: f32,
  mirror: i32,
): void {
  videoW = vw > 0 ? vw : 1.0;
  videoH = vh > 0 ? vh : 1.0;
  displayW = dispW > 0 ? dispW : 1.0;
  displayH = dispH > 0 ? dispH : 1.0;
  letterboxOffX = offX;
  letterboxOffY = offY;
  letterboxDrawW = drawW > 0 ? drawW : 1.0;
  letterboxDrawH = drawH > 0 ? drawH : 1.0;
  modelInputSize = inputSize > 0 ? inputSize : 192.0;
  mirrorX = mirror != 0;
}

@inline
function clamp01(v: f32): f32 {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

export function process(): f32 {
  // object-fit:cover mapping constants for this frame.
  const scaleW: f32 = displayW / videoW;
  const scaleH: f32 = displayH / videoH;
  const coverScale: f32 = scaleW > scaleH ? scaleW : scaleH;
  const coverOffX: f32 = (displayW - videoW * coverScale) / 2.0;
  const coverOffY: f32 = (displayH - videoH * coverScale) / 2.0;

  let rawScoreSum: f32 = 0.0;

  for (let i = 0; i < JOINTS; i++) {
    const yNorm = clamp01(unchecked(input[i * 3]));
    const xNorm = clamp01(unchecked(input[i * 3 + 1]));
    const score = unchecked(input[i * 3 + 2]);
    rawScoreSum += score;

    // MoveNet [0,1] over the letterboxed square -> video pixels.
    const xSq = xNorm * modelInputSize;
    const ySq = yNorm * modelInputSize;
    const vx = (xSq - letterboxOffX) * (videoW / letterboxDrawW);
    const vy = (ySq - letterboxOffY) * (videoH / letterboxDrawH);

    // Temporal EMA in video space. Low-confidence joints hold their last
    // smoothed position (and score) instead of jittering.
    if (!hasSmoothState) {
      unchecked((smoothX[i] = vx));
      unchecked((smoothY[i] = vy));
      unchecked((smoothS[i] = score));
    } else if (score >= SMOOTH_MIN_SCORE) {
      unchecked((smoothX[i] = SMOOTH_ALPHA * vx + (1.0 - SMOOTH_ALPHA) * smoothX[i]));
      unchecked((smoothY[i] = SMOOTH_ALPHA * vy + (1.0 - SMOOTH_ALPHA) * smoothY[i]));
      unchecked((smoothS[i] = score));
    }

    const sx = unchecked(smoothX[i]);
    const sy = unchecked(smoothY[i]);
    const ss = unchecked(smoothS[i]);

    // Video pixels -> object-fit:cover display pixels.
    const dx = sx * coverScale + coverOffX;
    const dy = sy * coverScale + coverOffY;

    // Display pixels -> normalized host coordinates (mirror front camera).
    let nx = displayW > 0 ? dx / displayW : 0.0;
    let ny = displayH > 0 ? dy / displayH : 0.0;
    if (mirrorX) nx = 1.0 - nx;
    nx = clamp01(nx);
    ny = clamp01(ny);

    const o = i * 7;
    unchecked((output[o] = sx));
    unchecked((output[o + 1] = sy));
    unchecked((output[o + 2] = dx));
    unchecked((output[o + 3] = dy));
    unchecked((output[o + 4] = nx));
    unchecked((output[o + 5] = ny));
    unchecked((output[o + 6] = ss));
  }

  hasSmoothState = true;
  return rawScoreSum / <f32>JOINTS;
}
