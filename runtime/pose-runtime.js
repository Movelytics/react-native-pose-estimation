/**
 * PoseTracker pose-runtime — the WebView page runtime (camera, capture
 * presets, MoveNet inference loop, skeleton, events). Delivered at runtime
 * as the `pose-runtime.js` part of the pose-runtime payload; NEVER shipped
 * in the npm package.
 *
 * Expects the following globals injected by the SDK HTML assembler:
 *   __PT_BUILD, __PT_CONFIG, __PT_MODEL_JSON, __PT_WEIGHTS_B64,
 *   __PT_WASM_B64 (tfjs XNNPACK binaries), __PT_PIPELINE_WASM_B64
 *   (proprietary pose pipeline, see runtime/pipeline/index.ts).
 */
(function () {
  var CFG = window.__PT_CONFIG;
  var FACING = CFG.facingMode;
  var MIN_SCORE = CFG.minScore;
  var INPUT_SIZE = 192;
  var KEYPOINT_NAMES = [
    'nose', 'left_eye', 'right_eye', 'left_ear', 'right_ear',
    'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow',
    'left_wrist', 'right_wrist', 'left_hip', 'right_hip',
    'left_knee', 'right_knee', 'left_ankle', 'right_ankle'
  ];

  /**
   * Default skeleton — same document as PoseTrackerFront
   * `lib/drawing_on_canvas.js` DEFAULT_SKELETON (navy + gold, body edges).
   * Overridable via CFG.skeletonDef / __PT_SET_SKELETON (custom Strapi skeleton).
   */
  var DEFAULT_SKELETON = {
    keypoints: [
      'nose', 'left_eye', 'right_eye', 'left_ear', 'right_ear',
      'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow',
      'left_wrist', 'right_wrist', 'left_hip', 'right_hip',
      'left_knee', 'right_knee', 'left_ankle', 'right_ankle'
    ],
    keypoint_lines: [
      'right_shoulder||left_shoulder',
      'right_hip||left_hip',
      'right_hip||right_shoulder',
      'right_hip||right_knee',
      'right_ankle||right_knee',
      'right_shoulder||right_elbow',
      'right_wrist||right_elbow',
      'left_hip||left_shoulder',
      'left_hip||left_knee',
      'left_ankle||left_knee',
      'left_shoulder||left_elbow',
      'left_wrist||left_elbow'
    ],
    keypoint_angles: [],
    angles: { fontColor: '#000000', strokeColor: '#FFC300' },
    circles: {
      circleFillColor: '#010A73',
      circleStrokeColor: '#FFC300',
      strokeWidth: '4',
      radius: '8'
    },
    lines: { lineStrokeColor: '#010A73', strokeWidth: '4' }
  };
  /** V3 drawOnCanvas threshold (not the older drawing_on_canvas 0.5). */
  var SKELETON_SCORE = 0.3;

  var video = document.getElementById('video');
  var canvas = document.getElementById('overlay');
  var hud = document.getElementById('hud');
  var bootCover = document.getElementById('boot');
  var watermarkEl = document.getElementById('wm');
  var ctx = canvas.getContext('2d');
  var cameraRevealed = false;
  var loadingText =
    (CFG.loadingText && String(CFG.loadingText).trim()) || 'AI Loading';
  var showWatermark = CFG.showWatermark !== false;
  var debugHud = !!CFG.debugHud || !!CFG.perfDebug;

  function applyWatermarkVisibility() {
    if (!watermarkEl) return;
    // Only on live full camera surfaces once revealed (skip 1×1 basic warmers).
    var on = showWatermark && CFG.coldStart === 'full' && cameraRevealed;
    if (on) watermarkEl.classList.add('show');
    else watermarkEl.classList.remove('show');
  }

  function setBootMessage(text, isError) {
    if (!bootCover) return;
    var msg = bootCover.querySelector('.boot-msg');
    if (!msg) return;
    msg.textContent = text;
    if (isError) msg.classList.add('is-error');
    else msg.classList.remove('is-error');
  }

  function resetBootLoadingText() {
    setBootMessage(loadingText, false);
  }

  /**
   * Keep video/canvas hidden until metadata + layout settle. Showing the
   * <video> at 0×0 (or before aspect is known) makes object-fit:cover flash
   * a tiny or over-zoomed frame for a few frames.
   */
  function setCameraVisible(visible) {
    video.style.opacity = visible ? '1' : '0';
    canvas.style.opacity = visible ? '1' : '0';
    if (bootCover) {
      if (visible) {
        bootCover.classList.add('hide');
      } else {
        bootCover.classList.remove('hide');
        resetBootLoadingText();
      }
    }
    applyWatermarkVisibility();
  }

  function revealCameraWhenReady() {
    if (cameraRevealed) return;
    if (!(video.videoWidth > 0 && video.videoHeight > 0)) return;
    // Two rAFs: let the browser apply object-fit:cover with real intrinsic size.
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        if (cameraRevealed) return;
        if (!(video.videoWidth > 0 && video.videoHeight > 0)) return;
        cameraRevealed = true;
        setCameraVisible(true);
        applyWatermarkVisibility();
      });
    });
  }
  var model = null;
  var running = false;
  var busy = false;
  // Android experiment: skip N ready rAF ticks between inferences (iOS = 0).
  // Injected from captureMode.ANDROID_INFER_FRAME_SKIP via poseHtml.
  var INFER_FRAME_SKIP = (CFG.inferFrameSkip != null && CFG.inferFrameSkip > 0)
    ? (CFG.inferFrameSkip | 0)
    : 0;
  var skipCountdown = 0;
  var PREPROCESS_PATH = CFG.preprocessPath === 'canvas-direct'
    ? 'canvas-direct'
    : 'imagebitmap';
  var SOFT_CAP_PROFILE = CFG.softCapProfile || null;
  var CAPTURE_PRIORITY = CFG.capturePriority === 'quality' ? 'quality' : 'performance';
  var PERF_DEBUG = !!CFG.perfDebug;
  var lastInferMs = [];
  var frameCount = 0;
  var fpsWindow = 0;
  var fpsTimer = 0;
  var skipTicksWindow = 0;
  var inferTicksWindow = 0;
  var smoothed = null;
  var SMOOTH_ALPHA = 0.5;
  var stageMs = { bitmap: [], pixels: [], exec: [], total: [] };
  var activeFlags = 'default';
  var activeBackend = null;
  // Letterbox params for the last pose input (contain into 192×192).
  // Needed to map MoveNet [0,1] square coords → video pixels → object-fit:cover display.
  var letterbox = { offsetX: 0, offsetY: 0, drawW: INPUT_SIZE, drawH: INPUT_SIZE, vw: 1, vh: 1 };

  function post(msg) {
    try {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify(msg));
      }
    } catch (e) {}
  }

  /**
   * Technical status line for the optional debug HUD only.
   * Boot overlay keeps the branded loadingText — progress is emitted via
   * `initialization` / `diag` events for the host developer.
   */
  function setHud(t) {
    if (!hud) return;
    if (debugHud) {
      hud.classList.add('debug');
      hud.textContent = t;
    }
  }

  function median(arr) {
    if (!arr.length) return null;
    var s = arr.slice().sort(function (a, b) { return a - b; });
    return s[Math.floor(s.length / 2)];
  }

  function pushStage(k, v) {
    var a = stageMs[k];
    a.push(v);
    if (a.length > 30) a.shift();
  }

  function applyMirrorCss() {
    var t = FACING === 'user' ? 'scaleX(-1)' : 'none';
    video.style.transform = t;
    canvas.style.transform = t;
  }

  function base64ToArrayBuffer(b64) {
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }

  function wasmBlobUrl(b64) {
    return URL.createObjectURL(
      new Blob([base64ToArrayBuffer(b64)], { type: 'application/wasm' })
    );
  }

  // -------------------------------------------------------------------------
  // Proprietary pose pipeline (WASM): decode + letterbox/cover mapping + EMA.
  // Falls back to the equivalent JS path below when instantiation fails.
  // -------------------------------------------------------------------------
  var pipeline = null;

  async function initPipeline() {
    try {
      var b64 = window.__PT_PIPELINE_WASM_B64;
      if (!b64 || typeof WebAssembly === 'undefined') {
        post({ type: 'diag', message: 'pose-pipeline: js path (no wasm payload)' });
        return;
      }
      var res = await WebAssembly.instantiate(base64ToArrayBuffer(b64), {
        env: { abort: function () {} }
      });
      var ex = res.instance.exports;
      pipeline = {
        memory: ex.memory,
        inputPtr: ex.inputPtr(),
        outputPtr: ex.outputPtr(),
        setFrame: ex.setFrame,
        process: ex.process,
        reset: ex.reset
      };
      post({ type: 'diag', message: 'pose-pipeline.wasm active' });
    } catch (e) {
      pipeline = null;
      post({
        type: 'diag',
        message: 'pose-pipeline.wasm unavailable: ' +
          (e && e.message ? e.message : String(e)) + ' — js path'
      });
    }
    window.__PT_PIPELINE_WASM_B64 = null;
  }

  function buildModelArtifacts() {
    var json = JSON.parse(window.__PT_MODEL_JSON);
    var shards = window.__PT_WEIGHTS_B64.map(base64ToArrayBuffer);
    var total = 0;
    shards.forEach(function (b) { total += b.byteLength; });
    var weightData = new Uint8Array(total);
    var offset = 0;
    shards.forEach(function (b) {
      weightData.set(new Uint8Array(b), offset);
      offset += b.byteLength;
    });
    var weightSpecs = [];
    json.weightsManifest.forEach(function (group) {
      weightSpecs = weightSpecs.concat(group.weights);
    });
    return {
      modelTopology: json.modelTopology,
      weightSpecs: weightSpecs,
      weightData: weightData.buffer,
      format: json.format,
      generatedBy: json.generatedBy,
      convertedBy: json.convertedBy,
      signature: json.signature,
      userDefinedMetadata: json.userDefinedMetadata
    };
  }

  function glInfo() {
    try {
      var c = document.createElement('canvas');
      var gl = c.getContext('webgl') || c.getContext('experimental-webgl');
      if (!gl) return null;
      var dbg = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null,
        vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : null,
        version: gl.getParameter(gl.VERSION)
      };
    } catch (e) { return null; }
  }

  function isMali(renderer) {
    return !!(renderer && /mali/i.test(renderer));
  }

  // Product flags (poseWorker.js) — must be set BEFORE the first setBackend('webgl').
  // Never call tf.removeBackend('webgl'): that deletes the factory from the
  // registry and setBackend then fails with "webgl not found in registry".
  function applyProductFlags() {
    try { tf.env().set('WEBGL_CPU_FORWARD', false); } catch (e) {}
    try { tf.env().set('WEBGL_PACK', false); } catch (e) {}
    try { tf.env().set('WEBGL_FORCE_F16_TEXTURES', false); } catch (e) {}
    try { tf.env().set('WEBGL_RENDER_FLOAT32_ENABLED', false); } catch (e) {}
    try { tf.env().set('WEBGL_FLUSH_THRESHOLD', 1.75); } catch (e) {}
    try { tf.env().set('WEBGL_DISJOINT_QUERY_TIMER_EXTENSION_VERSION', 0); } catch (e) {}
    try { tf.env().set('WEBGL_AUTO_SQUARIFY_NARROW_TEXTURE_SHAPE', true); } catch (e) {}
  }

  // dataSync (not await data): exact product parity — pose-detection's MoveNet
  // detector uses dataSync on WebGL. Async data() waits on a GPU fence polled
  // via setTimeout, which adds big per-frame latency in an Android WebView.
  function readOutput(out) {
    return out.dataSync();
  }

  async function benchZeros(n) {
    var times = [];
    for (var i = 0; i < n; i++) {
      var z = tf.zeros([1, INPUT_SIZE, INPUT_SIZE, 3], 'int32');
      var t0 = performance.now();
      var out = model.execute(z);
      readOutput(out);
      var dt = performance.now() - t0;
      z.dispose(); out.dispose();
      if (i > 0) times.push(dt);
    }
    return times;
  }

  async function loadModel() {
    if (model && model.dispose) try { model.dispose(); } catch (e) {}
    model = await tf.loadGraphModel({
      load: function () { return Promise.resolve(buildModelArtifacts()); }
    });
  }

  async function initWasmFallback() {
    var b = window.__PT_WASM_B64;
    if (!tf.wasm || !b || typeof WebAssembly === 'undefined') {
      throw new Error('wasm unavailable');
    }
    tf.wasm.setWasmPaths({
      'tfjs-backend-wasm.wasm': wasmBlobUrl(b.plain),
      'tfjs-backend-wasm-simd.wasm': wasmBlobUrl(b.simd),
      'tfjs-backend-wasm-threaded-simd.wasm': wasmBlobUrl(b.threadedSimd)
    });
    var ok = await tf.setBackend('wasm');
    await tf.ready();
    if (ok === false || tf.getBackend() !== 'wasm') throw new Error('wasm setBackend failed');
  }

  /**
   * Init WebGL once (product path). WASM only if WebGL truly fails.
   */
  async function pickFastestBackend() {
    var info = glInfo();
    var mali = isMali(info && info.renderer);
    var registered = [];
    try {
      if (tf.engine && tf.engine().registryFactory) {
        registered = Object.keys(tf.engine().registryFactory);
      }
    } catch (e) {}
    post({
      type: 'diag',
      message: 'build=' + (window.__PT_BUILD || '?') +
        ' gl renderer=' + ((info && info.renderer) || '?') +
        ' mali=' + mali +
        ' backends=[' + registered.join(',') + ']'
    });

    try {
      post({
        type: 'initialization',
        step: 'init_webgl',
        message: 'init webgl (product flags)',
        ready: false
      });
      setHud('init webgl (product flags)…');
      applyProductFlags();
      var ok = await tf.setBackend('webgl');
      await tf.ready();
      if (ok === false || tf.getBackend() !== 'webgl') {
        throw new Error('setBackend webgl returned ' + String(tf.getBackend()));
      }
      await loadModel();
      var times = await benchZeros(5);
      var med = median(times);
      post({
        type: 'diag',
        message: 'bench webgl/stable medianMs=' +
          (med != null ? med.toFixed(1) : '?') +
          ' runs=[' + times.map(function (t) { return Math.round(t); }).join(',') + ']'
      });
      activeFlags = 'stable';
      activeBackend = 'webgl';
      return { name: 'stable', med: med, times: times, backend: 'webgl' };
    } catch (e) {
      post({
        type: 'diag',
        message: 'webgl init failed: ' + (e && e.message ? e.message : String(e)) +
          ' — falling back to wasm'
      });
    }

    post({
      type: 'initialization',
      step: 'init_wasm_fallback',
      message: 'webgl failed — trying wasm',
      ready: false
    });
    setHud('webgl failed — trying wasm…');
    await initWasmFallback();
    await loadModel();
    var wtimes = await benchZeros(4);
    activeFlags = 'wasm';
    activeBackend = 'wasm';
    return { name: 'wasm', med: median(wtimes), times: wtimes, backend: 'wasm' };
  }

  function poseCanvasCtx() {
    if (!window.__PT_FC) {
      window.__PT_FC = document.createElement('canvas');
      window.__PT_FC.width = INPUT_SIZE;
      window.__PT_FC.height = INPUT_SIZE;
      window.__PT_FCTX = window.__PT_FC.getContext('2d', { willReadFrequently: true });
    }
    return window.__PT_FCTX;
  }

  /**
   * Letterbox video → 192×192 canvas (contain). Stretching with
   * resizeWidth/Height=192 broke aspect ratio → wrong skeleton.
   * Returns either an ImageBitmap or the canvas itself for fromPixels.
   */
  async function preparePoseInput() {
    var t0 = performance.now();
    var vw = video.videoWidth || 1;
    var vh = video.videoHeight || 1;
    var scale = Math.min(INPUT_SIZE / vw, INPUT_SIZE / vh);
    var drawW = vw * scale;
    var drawH = vh * scale;
    var offsetX = (INPUT_SIZE - drawW) / 2;
    var offsetY = (INPUT_SIZE - drawH) / 2;
    letterbox = { offsetX: offsetX, offsetY: offsetY, drawW: drawW, drawH: drawH, vw: vw, vh: vh };

    var c2d = poseCanvasCtx();
    c2d.fillStyle = '#000';
    c2d.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE);
    c2d.drawImage(video, 0, 0, vw, vh, offsetX, offsetY, drawW, drawH);

    if (PREPROCESS_PATH === 'canvas-direct') {
      pushStage('bitmap', performance.now() - t0);
      return { kind: 'canvas', source: window.__PT_FC };
    }

    var bmp = await createImageBitmap(window.__PT_FC);
    pushStage('bitmap', performance.now() - t0);
    return { kind: 'bitmap', source: bmp };
  }

  /** MoveNet norm (0–1 over the 192 square) → video pixel coords. (JS fallback) */
  function modelNormToVideo(xNorm, yNorm) {
    var xSq = xNorm * INPUT_SIZE;
    var ySq = yNorm * INPUT_SIZE;
    return {
      x: (xSq - letterbox.offsetX) * (letterbox.vw / letterbox.drawW),
      y: (ySq - letterbox.offsetY) * (letterbox.vh / letterbox.drawH)
    };
  }

  /** Video pixels → CSS object-fit:cover display pixels. (JS fallback) */
  function videoToCover(vx, vy, dispW, dispH) {
    var scale = Math.max(dispW / letterbox.vw, dispH / letterbox.vh);
    var ox = (dispW - letterbox.vw * scale) / 2;
    var oy = (dispH - letterbox.vh * scale) / 2;
    return { x: vx * scale + ox, y: vy * scale + oy };
  }

  async function infer() {
    var t0 = performance.now();
    var prepared = await preparePoseInput();
    var t1 = performance.now();
    var input = tf.tidy(function () {
      return tf.expandDims(tf.browser.fromPixels(prepared.source), 0);
    });
    if (prepared.kind === 'bitmap' && prepared.source && prepared.source.close) {
      prepared.source.close();
    }
    var t2 = performance.now();
    var out = model.execute(input);
    var data = readOutput(out);
    var t3 = performance.now();
    input.dispose();
    out.dispose();
    pushStage('pixels', t2 - t1);
    pushStage('exec', t3 - t2);
    // Full pipeline (draw + fromPixels + execute) — adaptive quality + debug
    // must see preprocess cost, especially on Android HD capture.
    var totalMs = t3 - t0;
    pushStage('total', totalMs);
    return { data: data, totalMs: totalMs };
  }

  /** Rank which stage dominates the frame (for leverHints). */
  function dominantStage(drawMs, pixelsMs, execMs) {
    var entries = [
      { stage: 'bitmap', ms: drawMs || 0 },
      { stage: 'fromPixels', ms: pixelsMs || 0 },
      { stage: 'execute', ms: execMs || 0 }
    ];
    entries.sort(function (a, b) { return b.ms - a.ms; });
    return entries[0];
  }

  /**
   * Heuristic hints: which experiment lever is likely helping / wasted.
   * Purely diagnostic — never changes behaviour.
   */
  function buildLeverHints(medTotal, drawMs, pixelsMs, execMs, poseFps) {
    var dom = dominantStage(drawMs, pixelsMs, execMs);
    var hints = [];
    var total = medTotal > 0 ? medTotal : (drawMs || 0) + (pixelsMs || 0) + (execMs || 0);
    var bmpShare = total > 0 ? (drawMs || 0) / total : 0;
    var pxShare = total > 0 ? (pixelsMs || 0) / total : 0;
    var exShare = total > 0 ? (execMs || 0) / total : 0;

    if (bmpShare >= 0.45) {
      hints.push('bitmap_dominates→softCap_or_lower_capture_still_useful');
    } else {
      hints.push('bitmap_not_dominant→softCap_less_useful_now');
    }
    if (PREPROCESS_PATH === 'canvas-direct') {
      if (pxShare >= 0.35) {
        hints.push('fromPixels_still_heavy→canvas-direct_may_not_be_enough');
      } else if (bmpShare + pxShare < 0.35) {
        hints.push('preprocess_light→canvas-direct_likely_helping_or_neutral');
      } else {
        hints.push('preprocess_mixed→compare_vs_imagebitmap_A/B');
      }
    } else if (pxShare >= 0.25) {
      hints.push('imagebitmap_path→try_canvas-direct_if_fromPixels_high');
    }
    if (exShare >= 0.5) {
      hints.push('execute_dominates→frameSkip_helps_GPU_breathing_not_capture');
    }
    if (INFER_FRAME_SKIP > 0) {
      if (poseFps != null && poseFps >= MIN_TARGET_FPS) {
        hints.push('frameSkip_on_and_floor_met→keep_or_try_skip0_to_measure');
      } else {
        hints.push('frameSkip_on_but_below_floor→try_skip2_or_lower_capture');
      }
    }
    if (SOFT_CAP_PROFILE) {
      hints.push('softCap=' + SOFT_CAP_PROFILE + '_active');
    }
    return {
      dominantStage: dom.stage,
      dominantMs: dom.ms,
      bitmapShare: Math.round(bmpShare * 100) / 100,
      fromPixelsShare: Math.round(pxShare * 100) / 100,
      executeShare: Math.round(exShare * 100) / 100,
      hints: hints
    };
  }

  function smoothKeypoints(raw) {
    if (!smoothed) { smoothed = raw; return raw; }
    for (var i = 0; i < raw.length; i++) {
      if (raw[i].score < 0.1) continue;
      smoothed[i].xPx = SMOOTH_ALPHA * raw[i].xPx + (1 - SMOOTH_ALPHA) * smoothed[i].xPx;
      smoothed[i].yPx = SMOOTH_ALPHA * raw[i].yPx + (1 - SMOOTH_ALPHA) * smoothed[i].yPx;
      smoothed[i].score = raw[i].score;
    }
    return smoothed;
  }

  function activeSkeleton() {
    var def = CFG.skeletonDef;
    if (def && Array.isArray(def.keypoint_lines) && def.circles && def.lines) {
      return def;
    }
    return DEFAULT_SKELETON;
  }

  /**
   * Draw skeleton in display pixels (object-fit:cover mapping already applied).
   * Parity with PoseTrackerFront `lib/v2/drawOnCanvas.js` drawSkeleton.
   */
  function drawSkeletonDisplay(kps, dispW, dispH) {
    if (canvas.width !== dispW) canvas.width = dispW;
    if (canvas.height !== dispH) canvas.height = dispH;
    ctx.clearRect(0, 0, dispW, dispH);
    if (!CFG.drawSkeleton) return;

    var sk = activeSkeleton();
    var byName = {};
    for (var i = 0; i < kps.length; i++) {
      byName[kps[i].name] = kps[i];
    }

    var lineStroke = (sk.lines && sk.lines.lineStrokeColor) || '#010A73';
    var lineWidth = Number((sk.lines && sk.lines.strokeWidth) || 4);
    var lines = sk.keypoint_lines || [];
    for (var e = 0; e < lines.length; e++) {
      var pair = String(lines[e]).split('||');
      if (pair.length < 2) continue;
      var a = byName[pair[0]];
      var b = byName[pair[1]];
      if (!a || !b || a.score <= SKELETON_SCORE || b.score <= SKELETON_SCORE) continue;
      ctx.beginPath();
      ctx.moveTo(a.dx, a.dy);
      ctx.lineTo(b.dx, b.dy);
      ctx.lineWidth = lineWidth;
      ctx.strokeStyle = lineStroke;
      ctx.stroke();
    }

    var fill = (sk.circles && sk.circles.circleFillColor) || '#010A73';
    var stroke = (sk.circles && sk.circles.circleStrokeColor) || '#FFC300';
    var circleStrokeW = Number((sk.circles && sk.circles.strokeWidth) || 4);
    var radius = Number((sk.circles && sk.circles.radius) || 8);
    var allowed = new Set(sk.keypoints || KEYPOINT_NAMES);
    for (var j = 0; j < kps.length; j++) {
      var kp = kps[j];
      if (!allowed.has(kp.name) || kp.score <= SKELETON_SCORE) continue;
      ctx.beginPath();
      ctx.arc(kp.dx, kp.dy, radius, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineWidth = circleStrokeW;
      ctx.strokeStyle = stroke;
      ctx.stroke();
    }
  }

  window.__PT_SET_SKELETON = function (def) {
    CFG.skeletonDef = def && typeof def === 'object' ? def : null;
  };

  /** WASM pipeline path: decode + map + smooth inside pose-pipeline.wasm. */
  function decodeWithPipeline(data, dispW, dispH) {
    var inArr = new Float32Array(pipeline.memory.buffer, pipeline.inputPtr, 51);
    for (var i = 0; i < 51; i++) inArr[i] = data[i];
    pipeline.setFrame(
      letterbox.vw, letterbox.vh, dispW, dispH,
      letterbox.offsetX, letterbox.offsetY, letterbox.drawW, letterbox.drawH,
      INPUT_SIZE, FACING === 'user' ? 1 : 0
    );
    var meanScore = pipeline.process();
    var outArr = new Float32Array(pipeline.memory.buffer, pipeline.outputPtr, 119);
    var drawKps = [];
    var rnKps = [];
    var above = 0;
    for (var j = 0; j < 17; j++) {
      var o = j * 7;
      var rawScore = data[j * 3 + 2];
      if (rawScore >= 0.3) above += 1;
      drawKps.push({
        name: KEYPOINT_NAMES[j],
        xPx: outArr[o],
        yPx: outArr[o + 1],
        dx: outArr[o + 2],
        dy: outArr[o + 3],
        score: outArr[o + 6]
      });
      rnKps.push({
        name: KEYPOINT_NAMES[j],
        x: outArr[o + 4],
        y: outArr[o + 5],
        score: outArr[o + 6]
      });
    }
    return { drawKps: drawKps, rnKps: rnKps, meanScore: meanScore, above: above };
  }

  /** JS fallback path (same math as the wasm pipeline). */
  function decodeWithJs(data, dispW, dispH) {
    var drawKps = [];
    var scoreSum = 0;
    var above = 0;
    for (var i = 0; i < 17; i++) {
      var xNorm = Math.min(1, Math.max(0, data[i * 3 + 1]));
      var yNorm = Math.min(1, Math.max(0, data[i * 3]));
      var score = data[i * 3 + 2];
      var vid = modelNormToVideo(xNorm, yNorm);
      var disp = videoToCover(vid.x, vid.y, dispW, dispH);
      drawKps.push({
        name: KEYPOINT_NAMES[i],
        xPx: vid.x,
        yPx: vid.y,
        dx: disp.x,
        dy: disp.y,
        score: score
      });
      scoreSum += score;
      if (score >= 0.3) above += 1;
    }
    var raw = drawKps.map(function (k) {
      return { xPx: k.xPx, yPx: k.yPx, score: k.score };
    });
    var sm = smoothKeypoints(raw);
    for (var k = 0; k < 17; k++) {
      drawKps[k].xPx = sm[k].xPx;
      drawKps[k].yPx = sm[k].yPx;
      drawKps[k].score = sm[k].score;
      var d2 = videoToCover(sm[k].xPx, sm[k].yPx, dispW, dispH);
      drawKps[k].dx = d2.x;
      drawKps[k].dy = d2.y;
    }
    var rnKps = drawKps.map(function (k) {
      var nx = dispW > 0 ? k.dx / dispW : 0;
      var ny = dispH > 0 ? k.dy / dispH : 0;
      if (FACING === 'user') nx = 1 - nx;
      return {
        name: k.name,
        x: Math.min(1, Math.max(0, nx)),
        y: Math.min(1, Math.max(0, ny)),
        score: k.score
      };
    });
    return { drawKps: drawKps, rnKps: rnKps, meanScore: scoreSum / 17, above: above };
  }

  function decodeAndPublish(data, inferenceTimeMs) {
    // Pipeline (matches PoseTrackerFront):
    //   MoveNet [0,1] on letterboxed 192² → video pixels → object-fit:cover display
    // Front camera: video+canvas CSS scaleX(-1). Draw in SENSOR display space;
    // flip only the RN payload so host overlays match the mirrored preview.
    var dispW = canvas.clientWidth || 1;
    var dispH = canvas.clientHeight || 1;
    var decoded = pipeline
      ? decodeWithPipeline(data, dispW, dispH)
      : decodeWithJs(data, dispW, dispH);
    var drawKps = decoded.drawKps;
    var meanScore = decoded.meanScore;
    var above = decoded.above;
    drawSkeletonDisplay(drawKps, dispW, dispH);

    lastInferMs.push(inferenceTimeMs);
    if (lastInferMs.length > 30) lastInferMs.shift();
    frameCount += 1;
    fpsWindow += 1;

    var now = performance.now();
    if (now - fpsTimer >= 1000) {
      var fps = fpsWindow;
      var skipped = skipTicksWindow;
      var inferred = inferTicksWindow;
      fpsWindow = 0;
      skipTicksWindow = 0;
      inferTicksWindow = 0;
      fpsTimer = now;
      var med = median(lastInferMs);
      var drawMs = median(stageMs.bitmap);
      var pixelsMs = median(stageMs.pixels);
      var execMs = median(stageMs.exec);
      var totalMed = median(stageMs.total);
      var estFromMed = med != null && med > 0 ? 1000 / med : null;
      var modeTag = 'main/' + activeFlags +
        (pipeline ? '/wasm-pipeline' : '') +
        '/' + PREPROCESS_PATH +
        (INFER_FRAME_SKIP > 0 ? '/skip' + INFER_FRAME_SKIP : '') +
        (SOFT_CAP_PROFILE ? '/soft:' + SOFT_CAP_PROFILE : '');

      var hudLine =
        'movenet · ' + activeBackend + '/' + activeFlags + ' · ' +
        fps + ' fps · ' + (med != null ? Math.round(med) + ' ms' : '?') +
        ' · kp≥0.3=' + above + '/17';
      if (PERF_DEBUG) {
        hudLine =
          fps + 'fps med=' + (med != null ? Math.round(med) : '?') +
          'ms (~' + (estFromMed != null ? estFromMed.toFixed(1) : '?') + 'fps) ' +
          'bmp=' + (drawMs != null ? Math.round(drawMs) : '?') +
          ' px=' + (pixelsMs != null ? Math.round(pixelsMs) : '?') +
          ' ex=' + (execMs != null ? Math.round(execMs) : '?') +
          ' | ' + PREPROCESS_PATH +
          (INFER_FRAME_SKIP > 0 ? ' skip' + INFER_FRAME_SKIP : '') +
          (SOFT_CAP_PROFILE ? ' soft:' + SOFT_CAP_PROFILE : '') +
          ' ' + video.videoWidth + 'x' + video.videoHeight +
          ' inf/sk=' + inferred + '/' + skipped;
      }
      setHud(hudLine);

      var experiments = {
        platform: CFG.platform || 'unknown',
        captureMode: CAPTURE_CONSTRAINT_MODE,
        capturePriority: CAPTURE_PRIORITY,
        preprocessPath: PREPROCESS_PATH,
        inferFrameSkip: INFER_FRAME_SKIP,
        softCapProfile: SOFT_CAP_PROFILE,
        minTargetFps: MIN_TARGET_FPS,
        perfDebug: PERF_DEBUG
      };
      var leverHints = PERF_DEBUG
        ? buildLeverHints(totalMed != null ? totalMed : med, drawMs, pixelsMs, execMs, fps)
        : null;

      post({
        type: 'stats',
        fps: fps,
        medianInferenceMs: med,
        estimatedFpsFromMedian: estFromMed,
        frames: frameCount,
        backend: activeBackend,
        keypointsAbove03: above,
        meanScore: meanScore,
        breakdown: {
          drawMs: drawMs,
          fromPixelsMs: pixelsMs,
          executeMs: execMs,
          totalPipelineMs: totalMed
        },
        windowCounts: { inferred: inferred, skipped: skipped },
        experiments: experiments,
        leverHints: leverHints,
        videoSize: video.videoWidth + 'x' + video.videoHeight,
        mode: modeTag
      });
    }

    post({
      type: 'pose',
      keypoints: decoded.rnKps,
      score: meanScore,
      inferenceTimeMs: inferenceTimeMs,
      timestampMs: Date.now()
    });
  }

  // Loop token: a stale rAF chain (pre-suspend) must never survive next to a
  // resumed one — two chains would double the inference attempt rate.
  var loopToken = 0;
  var inferErrorStreak = 0;
  // ~45 consecutive failures ≈ a few seconds of a dead GL context / broken
  // session. Stop the loop and release the camera instead of burning battery.
  var INFER_ERROR_LIMIT = 45;

  async function loop(token) {
    if (token !== loopToken || !running || !model) return;
    if (!busy && video.readyState >= 2 && video.videoWidth > 0) {
      // Android frame-skip: after each inference, burn N free rAF ticks before
      // the next one. Preview keeps streaming; last skeleton stays on canvas.
      if (skipCountdown > 0) {
        skipCountdown -= 1;
        skipTicksWindow += 1;
      } else {
        busy = true;
        try {
          var result = await infer();
          inferErrorStreak = 0;
          inferTicksWindow += 1;
          decodeAndPublish(result.data, result.totalMs);
          skipCountdown = INFER_FRAME_SKIP;
        } catch (err) {
          var message = err && err.message ? err.message : String(err);
          setHud('infer error: ' + message);
          if (frameCount < 3) post({ type: 'error', message: 'inference: ' + message });
          inferErrorStreak += 1;
          if (inferErrorStreak >= INFER_ERROR_LIMIT) {
            busy = false;
            post({
              type: 'error',
              message: 'inference failed repeatedly (' + message +
                ') — pipeline stopped and camera released to protect the device'
            });
            suspendPipeline('inference-errors');
            return;
          }
        }
        busy = false;
      }
    }
    requestAnimationFrame(function () { loop(token); });
  }

  function startLoop() {
    running = true;
    fpsTimer = performance.now();
    loop(++loopToken);
  }

  // Capture constraint mode (injected by poseHtml from captureMode.ts):
  //   'device-native'        — Front-like: facingMode only (often HD preview)
  //   'profile-constrained' — AdaptiveChoice ideals (previous stable default)
  // REVERT: set CAPTURE_CONSTRAINT_MODE = 'profile-constrained' in captureMode.ts
  // then npm run build:runtime-payload && npm run build
  var CAPTURE_CONSTRAINT_MODE = CFG.captureConstraintMode === 'profile-constrained'
    ? 'profile-constrained'
    : 'device-native';

  // Capture profiles (mirror RN AdaptiveChoice ladder). Used to pick camera
  // resolution from the zeros warm-up BEFORE getUserMedia (profile-constrained)
  // or as live setQuality downgrade targets (both modes).
  // minTargetFps is a floor (iOS 30 / Android 15), not a single setpoint.
  var MIN_TARGET_FPS = (CFG.minTargetFps != null && CFG.minTargetFps > 0)
    ? CFG.minTargetFps
    : 15;
  var CAPTURE_PROFILES = {
    prime: { id: 'prime', idealWidth: 1280, idealHeight: 720, idealFrameRate: 30 },
    pro: { id: 'pro', idealWidth: 960, idealHeight: 540, idealFrameRate: 30 },
    lite: { id: 'lite', idealWidth: 640, idealHeight: 480, idealFrameRate: 30 },
    ultralite: { id: 'ultralite', idealWidth: 480, idealHeight: 360, idealFrameRate: 24 },
    basic: { id: 'basic', idealWidth: 320, idealHeight: 240, idealFrameRate: 20 }
  };
  var CAPTURE_LADDER = ['prime', 'pro', 'lite', 'ultralite', 'basic'];

  function profileRank(id) {
    var i = CAPTURE_LADDER.indexOf(id);
    return i < 0 ? CAPTURE_LADDER.length - 1 : i;
  }

  function lowerProfile(a, b) {
    return profileRank(a) >= profileRank(b) ? a : b;
  }

  /** Map warm-up execute median → max safe capture profile (scales with floor). */
  function profileFromWarmupMs(medMs) {
    if (medMs == null || !(medMs > 0)) return 'basic';
    var budget = 1000 / MIN_TARGET_FPS;
    // Over floor on zeros alone → basic (camera adds cost; no ultralite gift).
    if (medMs > budget) return 'basic';
    if (medMs <= budget * 0.6) return 'prime';
    if (medMs <= budget * 0.75) return 'pro';
    if (medMs <= budget * 0.9) return 'lite';
    return 'ultralite';
  }

  function applyCaptureProfile(id) {
    var p = CAPTURE_PROFILES[id] || CAPTURE_PROFILES.ultralite;
    CFG.idealWidth = p.idealWidth;
    CFG.idealHeight = p.idealHeight;
    CFG.idealFrameRate = p.idealFrameRate;
    CFG.profileId = p.id;
    return p;
  }

  /** Build getUserMedia video constraints for the active capture mode. */
  function videoConstraints(forceProfileIdeals) {
    var video = { facingMode: { ideal: FACING } };
    if (forceProfileIdeals || CAPTURE_CONSTRAINT_MODE === 'profile-constrained') {
      video.width = { ideal: CFG.idealWidth };
      video.height = { ideal: CFG.idealHeight };
      video.frameRate = { ideal: CFG.idealFrameRate || 30 };
      return video;
    }
    // device-native + optional Android soft-cap: use the warm-up-selected
    // CFG ideals (already clamped ≤ softCap) as ideal+max so Chromium
    // cannot open unrestricted 1080p.
    if (SOFT_CAP_PROFILE) {
      video.width = { ideal: CFG.idealWidth, max: CFG.idealWidth };
      video.height = { ideal: CFG.idealHeight, max: CFG.idealHeight };
      video.frameRate = { ideal: CFG.idealFrameRate || 30 };
    }
    return video;
  }

  async function boot() {
    try {
      applyMirrorCss();
      if (CFG.idealFrameRate == null) CFG.idealFrameRate = 30;
      if (!CFG.profileId) CFG.profileId = 'ultralite';

      // 0) Proprietary pipeline module (non-fatal when unavailable).
      await initPipeline();

      // 1) Bench MoveNet WITHOUT the camera — estimate FPS, pick capture tier.
      post({
        type: 'initialization',
        step: 'loading_pose_model',
        message: 'loading pose model',
        ready: false
      });
      setHud('loading MoveNet (webgl)…');
      var best = await pickFastestBackend();

      var estFps = best.med != null && best.med > 0 ? 1000 / best.med : null;
      var rnHint = CFG.profileId;
      var fromWarmup = profileFromWarmupMs(best.med);
      // Prefer warm-up evidence for the *initial* open. Using RN hint as a hard
      // ceiling pinned poisoned crash-guard sessions on basic, then RN upgraded
      // mid-getUserMedia and aborted the stream ("The operation was aborted").
      // Live FPS path can still downgrade after ready.
      var selected = fromWarmup;
      if (CAPTURE_PRIORITY === 'quality') {
        // Host opted into sharp preview — do not FPS-floor to basic/ultralite.
        selected = 'prime';
      } else if (SOFT_CAP_PROFILE && CAPTURE_PROFILES[SOFT_CAP_PROFILE]) {
        selected = lowerProfile(selected, SOFT_CAP_PROFILE);
      }
      var applied = applyCaptureProfile(selected);

      post({
        type: 'warmup_estimate',
        medianInferenceMs: best.med,
        estimatedFps: estFps,
        minTargetFps: MIN_TARGET_FPS,
        targetFps: MIN_TARGET_FPS,
        profileId: applied.id,
        previousProfileId: rnHint,
        idealWidth: applied.idealWidth,
        idealHeight: applied.idealHeight,
        gl: glInfo()
      });
      post({
        type: 'diag',
        message: 'warmup estimatedFps=' +
          (estFps != null ? estFps.toFixed(1) : '?') +
          ' medianMs=' + (best.med != null ? best.med.toFixed(1) : '?') +
          ' minTarget=' + MIN_TARGET_FPS +
          ' capture=' + applied.id + ' (' + applied.idealWidth + 'x' + applied.idealHeight + ')' +
          (SOFT_CAP_PROFILE ? ' softCap=' + SOFT_CAP_PROFILE : '') +
          (selected !== rnHint ? ' (rnHint=' + rnHint + ')' : '')
      });
      post({
        type: 'diag',
        message: 'experiments platform=' + (CFG.platform || '?') +
          ' captureMode=' + CAPTURE_CONSTRAINT_MODE +
          ' capturePriority=' + CAPTURE_PRIORITY +
          ' preprocess=' + PREPROCESS_PATH +
          ' frameSkip=' + INFER_FRAME_SKIP +
          ' softCap=' + (SOFT_CAP_PROFILE || 'off') +
          ' minTargetFps=' + MIN_TARGET_FPS +
          ' perfDebug=' + PERF_DEBUG
      });

      // Free base64 payloads after final model load.
      window.__PT_MODEL_JSON = null;
      window.__PT_WEIGHTS_B64 = null;
      window.__PT_WASM_B64 = null;

      var flagsSnapshot = '';
      try {
        flagsSnapshot =
          ' glVersion=' + tf.env().getNumber('WEBGL_VERSION') +
          ' pack=' + tf.env().getBool('WEBGL_PACK') +
          ' f32render=' + tf.env().getBool('WEBGL_RENDER_FLOAT32_ENABLED') +
          ' fenceApi=' + tf.env().getBool('WEBGL_FENCE_API_ENABLED');
      } catch (e) {}
      post({
        type: 'diag',
        message: 'final backend=' + best.backend + ' flags=' + best.name +
          ' medianMs=' + (best.med != null ? best.med.toFixed(1) : '?') +
          ' profile=' + CFG.profileId +
          ' coldStart=' + (BOOT_CAMERA ? 'full' : 'basic') +
          flagsSnapshot
      });

      lastWarmBackend = best.backend;
      lastWarmMedMs = best.med;
      lastWarmTimes = best.times || [];
      lastWarmEstFps = estFps;

      setHud('ready · ' + best.backend + '/' + CFG.profileId + ' · warm ' +
        (best.med != null ? Math.round(best.med) + 'ms' : '?') +
        (estFps != null ? ' (~' + Math.round(estFps) + 'fps est)' : '') +
        (BOOT_CAMERA ? '' : ' · model-only'));

      if (BOOT_CAMERA) {
        // Full cold-start (legacy): open camera before posting ready — same
        // as the historical warmer that called getUserMedia during preload.
        await openCameraAndLoop('boot-full');
        if (suspended) {
          post({ type: 'diag', message: 'boot finished while hidden — staying suspended (camera released)' });
          stopCameraTracks();
          // Still mark model+backend ready so preload can resolve; camera
          // reopens on resume because cameraArmed is true.
        } else {
          startLoop();
        }
        postReadySignal(true, 'full');
      } else {
        // Basic cold-start: model / WebGL only — no permission prompt.
        postReadySignal(false, 'basic');
        post({
          type: 'diag',
          message: 'basic cold-start — model warm, camera deferred until openCamera/full'
        });
        if (bootCover) {
          bootCover.classList.add('hide');
        }
        applyWatermarkVisibility();
      }
    } catch (err) {
      var message = err && err.message ? err.message : String(err);
      // Abort during a concurrent setQuality must not kill the session — the
      // quality path will reopen the camera.
      if (/abort/i.test(message) || (err && err.name === 'AbortError')) {
        post({ type: 'diag', message: 'boot getUserMedia aborted (ignored — quality swap)' });
        return;
      }
      setHud('error: ' + message);
      setBootMessage('error: ' + message, true);
      post({ type: 'error', message: message });
    }
  }

  window.__PT_SET_FACING = function (mode) {
    FACING = mode === 'environment' ? 'environment' : 'user';
    applyMirrorCss();
  };

  /** Live plan upgrade: toggle watermark without remounting the WebView. */
  window.__PT_SET_WATERMARK = function (on) {
    showWatermark = !!on;
    CFG.showWatermark = showWatermark;
    applyWatermarkVisibility();
  };

  /** Update boot overlay copy (WebView loading_message parity). */
  window.__PT_SET_LOADING_TEXT = function (text) {
    if (typeof text === 'string' && text.trim().length > 0) {
      loadingText = text.trim();
    } else {
      loadingText = 'AI Loading';
    }
    CFG.loadingText = loadingText;
    if (!cameraRevealed) resetBootLoadingText();
  };

  /**
   * Restart getUserMedia with new ideal resolution (adaptive quality ladder).
   * Inference stays at 192² letterbox — only capture / preprocess cost changes.
   */
  window.__PT_SET_QUALITY = async function (opts) {
    try {
      if (!opts) return;
      if (opts.idealWidth) CFG.idealWidth = opts.idealWidth;
      if (opts.idealHeight) CFG.idealHeight = opts.idealHeight;
      if (opts.idealFrameRate) CFG.idealFrameRate = opts.idealFrameRate;
      qualityForced = true;
      if (suspended) {
        // Camera is released while hidden; resume reopens with the new CFG.
        post({ type: 'diag', message: 'setQuality deferred (pipeline suspended)' });
        return;
      }
      // Hide during stream swap — same 0×0 / wrong-aspect flash as cold boot.
      // Boot overlay keeps branded loadingText (tech progress via diag).
      cameraRevealed = false;
      setCameraVisible(false);
      post({
        type: 'diag',
        message: 'adjusting camera (quality swap)'
      });
      var old = video.srcObject;
      if (old && old.getTracks) {
        old.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
      }
      // Live quality swaps always use profile ideals (downgrade ladder).
      var stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: videoConstraints(true)
      });
      video.srcObject = stream;
      await video.play();
      await new Promise(function (resolve) {
        if (video.videoWidth > 0) { resolve(); return; }
        video.onloadedmetadata = function () { resolve(); };
        setTimeout(resolve, 1500);
      });
      await new Promise(function (resolve) {
        if (typeof video.requestVideoFrameCallback === 'function') {
          video.requestVideoFrameCallback(function () { resolve(); });
          setTimeout(resolve, 500);
          return;
        }
        setTimeout(resolve, 80);
      });
      revealCameraWhenReady();
      post({
        type: 'diag',
        message: 'quality applied camera=' + video.videoWidth + 'x' + video.videoHeight +
          ' ideal=' + CFG.idealWidth + 'x' + CFG.idealHeight +
          '@' + (CFG.idealFrameRate || 30) +
          (opts.profileId ? ' profile=' + opts.profileId : '')
      });
    } catch (err) {
      revealCameraWhenReady();
      post({
        type: 'diag',
        message: 'setQuality failed: ' + (err && err.message ? err.message : String(err))
      });
    }
  };

  // ── Cold-start modes ────────────────────────────────────────────────────
  // basic (default): model + zeros warm-up only — NEVER calls getUserMedia.
  // full: open camera after warm-up (legacy warmer / explicit preload full).
  // Camera screens pass coldStart=full (or call __PT_OPEN_CAMERA later).
  var BOOT_CAMERA = CFG.coldStart === 'full' || CFG.bootCamera === true;
  // True only after a successful getUserMedia — resume must not open camera
  // for a basic (model-only) warm page.
  var cameraArmed = false;
  var lastWarmBackend = null;
  var lastWarmMedMs = null;
  var lastWarmTimes = [];
  var lastWarmEstFps = null;

  function postReadySignal(cameraOpened, coldStart) {
    post({
      type: 'ready',
      backend: lastWarmBackend,
      medianInferenceMs: lastWarmMedMs,
      warmUpRunsMs: lastWarmTimes,
      estimatedFps: lastWarmEstFps,
      profileId: CFG.profileId,
      cameraOpened: !!cameraOpened,
      coldStart: coldStart,
      gl: glInfo(),
      note: 'main/' + (lastWarmBackend || '?') + '/' + CFG.profileId +
        (pipeline ? '/wasm-pipeline' : '') +
        (cameraOpened ? '/camera' : '/model-only')
    });
  }

  async function openCameraOnce(forceProfileIdeals) {
    var stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: videoConstraints(!!forceProfileIdeals)
    });
    video.srcObject = stream;
    await video.play();
    await new Promise(function (resolve) {
      if (video.videoWidth > 0) { resolve(); return; }
      video.onloadedmetadata = function () { resolve(); };
      setTimeout(resolve, 2000);
    });
    await new Promise(function (resolve) {
      if (typeof video.requestVideoFrameCallback === 'function') {
        video.requestVideoFrameCallback(function () { resolve(); });
        setTimeout(resolve, 500);
        return;
      }
      setTimeout(resolve, 80);
    });
  }

  /** Open webcam (does not start the loop — caller decides). */
  async function openCameraAndLoop(reason) {
    if (cameraArmed && video.srcObject) {
      return;
    }
    post({
      type: 'initialization',
      step: 'accessing_webcam',
      message: 'accessing webcam',
      ready: false
    });
    setHud(
      'getUserMedia ' +
        (CAPTURE_CONSTRAINT_MODE === 'device-native' ? 'device-native' : CFG.profileId) +
        '…'
    );
    try {
      await openCameraOnce();
    } catch (camErr) {
      var camMsg = camErr && camErr.message ? camErr.message : String(camErr);
      var isAbort = /abort/i.test(camMsg) || (camErr && camErr.name === 'AbortError');
      if (!isAbort) throw camErr;
      post({ type: 'diag', message: 'getUserMedia aborted — retrying once' });
      await new Promise(function (r) { setTimeout(r, 120); });
      await openCameraOnce();
    }
    cameraArmed = true;
    revealCameraWhenReady();
    post({
      type: 'diag',
      message: 'camera size=' + video.videoWidth + 'x' + video.videoHeight +
        ' mode=' + CAPTURE_CONSTRAINT_MODE +
        ' ideal=' + CFG.idealWidth + 'x' + CFG.idealHeight +
        ' profile=' + CFG.profileId +
        ' reason=' + reason
    });
  }

  window.__PT_OPEN_CAMERA = function () {
    return openCameraAndLoop('host-openCamera').then(function () {
      if (suspended) {
        stopCameraTracks();
        return;
      }
      startLoop();
      postReadySignal(true, 'full');
    });
  };

  // ── Battery / thermal safety: release the camera and halt inference when
  // the page is hidden (app backgrounded, view covered), reacquire on return.
  // Belt-and-braces with the RN AppState hook (__PT_SUSPEND / __PT_RESUME):
  // Android WebView and WKWebView background semantics differ, page-level
  // visibilitychange + host injection together cover both. ──────────────────
  var suspended = false;
  // True once RN pushed an explicit quality profile — resume must reopen the
  // camera with profile ideals instead of the boot-time device-native path.
  var qualityForced = false;

  function stopCameraTracks() {
    var s = video.srcObject;
    if (s && s.getTracks) {
      s.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
    }
    video.srcObject = null;
  }

  function suspendPipeline(reason) {
    if (suspended) return;
    suspended = true;
    running = false;
    loopToken += 1; // kill any pending rAF chain
    stopCameraTracks();
    cameraRevealed = false;
    setCameraVisible(false);
    post({
      type: 'diag',
      message: 'pipeline suspended (' + reason + ') — camera released, inference stopped'
    });
  }

  async function resumePipeline() {
    if (!suspended) return;
    suspended = false;
    if (!model) return; // boot still in flight — it owns the camera
    // Model-only warm page: never open the camera on foreground.
    if (!cameraArmed) {
      post({ type: 'diag', message: 'resume skipped — camera not armed (basic cold-start)' });
      return;
    }
    try {
      var stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: videoConstraints(qualityForced)
      });
      if (suspended) {
        // Hidden again while getUserMedia was in flight.
        stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
        return;
      }
      stopCameraTracks();
      video.srcObject = stream;
      await video.play();
      await new Promise(function (resolve) {
        if (video.videoWidth > 0) { resolve(); return; }
        video.onloadedmetadata = function () { resolve(); };
        setTimeout(resolve, 1500);
      });
      revealCameraWhenReady();
      inferErrorStreak = 0;
      startLoop();
      post({
        type: 'diag',
        message: 'pipeline resumed — camera reacquired (' +
          video.videoWidth + 'x' + video.videoHeight + ')'
      });
    } catch (err) {
      post({
        type: 'diag',
        message: 'resume failed: ' + (err && err.message ? err.message : String(err))
      });
    }
  }

  window.__PT_SUSPEND = function () { suspendPipeline('host'); };
  window.__PT_RESUME = function () { resumePipeline(); };

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') {
      suspendPipeline('page-hidden');
    } else {
      resumePipeline();
    }
  });
  // WKWebView / Chromium teardown: the camera indicator must die with the page.
  window.addEventListener('pagehide', function () {
    running = false;
    loopToken += 1;
    stopCameraTracks();
  });

  window.addEventListener('message', function (ev) {
    try {
      var data = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data;
      if (data && data.type === 'setFacing') window.__PT_SET_FACING(data.facingMode);
      if (data && data.type === 'setQuality') window.__PT_SET_QUALITY(data);
      if (data && data.type === 'stop') {
        running = false;
        loopToken += 1;
        stopCameraTracks();
      }
    } catch (e) {}
  });

  boot();
})();
