/**
 * External frames API (warmupExternal / processFrame) against the compiled
 * client. Run: npm run build && npm test
 *
 * The WebView page is simulated through the same message contract the
 * runtime implements (`__PT_PUSH_FRAME` → `pose` with frameId →
 * `frame_result`). The exercise engine is a fake: these tests check the
 * orchestration, not MoveNet.
 */
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const { test } = require('node:test');

const stub = path.join(__dirname, 'stubs/react-native.cjs');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function resolve(request, ...rest) {
  if (request === 'react-native') return stub;
  return originalResolve.call(this, request, ...rest);
};

globalThis.fetch = async () => {
  throw new Error('offline (test)');
};

const { PoseTrackerClient } = require('../lib/client');
const { WebViewPoseBackend } = require('../lib/backends/webview/WebViewPoseBackend');

const KEYPOINT_NAMES = [
  'nose', 'left_eye', 'right_eye', 'left_ear', 'right_ear',
  'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow',
  'left_wrist', 'right_wrist', 'left_hip', 'right_hip',
  'left_knee', 'right_knee', 'left_ankle', 'right_ankle',
];

function fakeTracker() {
  return {
    flushQueue: async () => {},
    trackAnonymous: async () => {},
    trackMetered: async () => {},
  };
}

function makeClient() {
  const backend = new WebViewPoseBackend();
  const client = new PoseTrackerClient(undefined, {
    backend,
    engine: 'v4',
    fileStore: null,
    usageTracker: fakeTracker(),
    onDiagnostic: () => {},
  });
  return { client, backend };
}

/**
 * Attach a simulated basic page, the way WebViewPoseView does: poses go to
 * client.ingestPose, pushed frames are answered asynchronously.
 */
function attachSimulatedPage(client, backend, { delayMs = 5, cameraOpened = false } = {}) {
  const pushed = [];
  let busy = false;
  backend.setAttached(true);
  backend.setOnPose((pose) => client.ingestPose(pose));
  backend.setPushFrameHandler((payload) => {
    const msg = JSON.parse(payload);
    pushed.push(msg);
    if (busy) {
      backend.handleMessage(JSON.stringify({ type: 'frame_result', id: msg.id, dropped: true }));
      return;
    }
    busy = true;
    setTimeout(() => {
      backend.handleMessage(
        JSON.stringify({
          type: 'pose',
          frameId: msg.id,
          keypoints: KEYPOINT_NAMES.map((name) => ({ name, x: 0.4, y: 0.6, score: 0.9 })),
          score: 0.9,
          inferenceTimeMs: 12,
          timestampMs: msg.timestampMs,
        }),
      );
      backend.handleMessage(JSON.stringify({ type: 'frame_result', id: msg.id, dropped: false }));
      busy = false;
    }, delayMs);
  });
  backend.handleMessage(
    JSON.stringify({
      type: 'ready',
      backend: 'webgl',
      medianInferenceMs: 12,
      warmUpRunsMs: [12],
      cameraOpened,
      coldStart: cameraOpened ? 'full' : 'basic',
      gl: null,
    }),
  );
  return pushed;
}

async function warm(client, backend, pageOptions) {
  const warming = client.warmupExternal();
  await new Promise((r) => setTimeout(r, 0));
  const pushed = attachSimulatedPage(client, backend, pageOptions);
  await warming;
  return pushed;
}

function fakeEngine() {
  const state = { sessions: 0, ended: 0 };
  return {
    state,
    version: 'test',
    listExercises: () => [{ id: 'squat', displayName: 'Squat', type: 'dynamic' }],
    createSession(_opts, sink) {
      state.sessions += 1;
      let count = 0;
      return {
        processPose(pose) {
          count += 1;
          sink({ type: 'counter', count, timestampMs: pose.timestampMs });
          sink({ type: 'posture', ready: count > 1, timestampMs: pose.timestampMs });
        },
        end() {
          state.ended += 1;
        },
      };
    },
  };
}

const frame = (timestampMs, extra = {}) => ({
  base64: 'AAAA',
  width: 192,
  height: 144,
  timestampMs,
  ...extra,
});

test('default path never requests the external warmer', async () => {
  const { client, backend } = makeClient();
  // Camera screen: WebViewPoseView attaches with coldStart full.
  backend.setAttached(true);
  backend.handleMessage(
    JSON.stringify({ type: 'ready', backend: 'webgl', medianInferenceMs: 10, warmUpRunsMs: [], cameraOpened: true, gl: null }),
  );
  assert.equal(client.isExternalWarmerRequested(), false);
  // Legacy processFrame(frame) keeps returning the last camera pose.
  assert.equal(await client.processFrame({ shape: [1, 192, 192, 3] }), null);
  await client.dispose();
});

test('processFrame before warmupExternal throws', async () => {
  const { client } = makeClient();
  await assert.rejects(() => client.processFrame(frame(1)), /warmupExternal/);
  await client.dispose();
});

test('warmupExternal requests the hidden warmer and resolves on basic ready', async () => {
  const { client, backend } = makeClient();
  let notified = false;
  client.onStateChange(() => {
    if (client.isExternalWarmerRequested()) notified = true;
  });
  await warm(client, backend);
  assert.equal(notified, true);
  assert.equal(client.getStatus(), 'ready');
  assert.equal(backend.isCameraOpened(), false);
  await client.warmupExternal();
  await client.dispose();
});

test('frame resolves pose + events; payload carries the frame contract', async () => {
  const { client, backend } = makeClient();
  const pushed = await warm(client, backend);
  const seen = [];
  client.addEventListener((e) => seen.push(e.type));
  const result = await client.processFrame(frame(1000, { mirrored: false, mime: 'image/png' }));
  assert.equal(result.dropped, false);
  assert.equal(result.pose.timestampMs, 1000);
  assert.equal(result.pose.keypoints.length, 17);
  assert.deepEqual(result.events.map((e) => e.type), ['keypoints']);
  assert.deepEqual(seen, ['keypoints']);
  assert.equal(pushed[0].mirrored, false);
  assert.equal(pushed[0].mime, 'image/png');
  assert.equal(pushed[0].base64, 'AAAA');
  assert.equal((await client.processFrame(frame(1033))).dropped, false);
  assert.equal(pushed[1].mirrored, true);
  await client.dispose();
});

test('overlapping calls drop the second frame before injection', async () => {
  const { client, backend } = makeClient();
  const pushed = await warm(client, backend, { delayMs: 20 });
  const first = client.processFrame(frame(1));
  const second = await client.processFrame(frame(2));
  assert.equal(second.dropped, true);
  assert.deepEqual(second.events, []);
  assert.equal((await first).dropped, false);
  assert.equal(pushed.length, 1);
  await client.dispose();
});

test('one exercise session runs across frames: counter advances, engine not reset', async () => {
  const { client, backend } = makeClient();
  await warm(client, backend);
  const engine = fakeEngine();
  client.engine = engine;
  client.mode = 'full-engine';
  client.startExercise('squat');

  const counters = [];
  client.addEventListener((e) => {
    if (e.type === 'counter') counters.push(e.count);
  });
  const r1 = await client.processFrame(frame(1000));
  const r2 = await client.processFrame(frame(1033));

  assert.equal(engine.state.sessions, 1);
  assert.equal(engine.state.ended, 0);
  assert.deepEqual(counters, [1, 2]);
  assert.deepEqual(r1.events.filter((e) => e.type === 'counter').map((e) => e.count), [1]);
  assert.deepEqual(r2.events.filter((e) => e.type === 'counter').map((e) => e.count), [2]);
  const posture = r2.events.find((e) => e.type === 'posture');
  assert.equal(posture.ready, true);
  await client.dispose();
});

test('processFrame refuses to mix with an open SDK camera', async () => {
  const { client, backend } = makeClient();
  await warm(client, backend);
  backend.handleMessage(
    JSON.stringify({ type: 'ready', backend: 'webgl', medianInferenceMs: 10, warmUpRunsMs: [], cameraOpened: true, gl: null }),
  );
  await assert.rejects(() => client.processFrame(frame(1)), /cannot run together/);
  await client.dispose();
});

test('detaching the warmer rejects the in-flight frame', async () => {
  const { client, backend } = makeClient();
  await warm(client, backend, { delayMs: 50 });
  const inFlight = client.processFrame(frame(1));
  backend.setAttached(false);
  await assert.rejects(() => inFlight, /detached/);
  await client.dispose();
});
