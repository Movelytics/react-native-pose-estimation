# Preload & warm-up lifecycle

How and when the SDK loads MoveNet / the WebView runtime. For integrators
using `@pose-tracker/react-native-pose-estimation`.

**Camera permissions are required for live tracking** and must be declared
by the host app — see [`PERMISSIONS.md`](PERMISSIONS.md). Basic cold-start
never opens the camera; full cold-start / `<WebViewPoseView />` will.

---

## Short answer

| Action | Starts AI / model load? | Opens camera (`getUserMedia`)? |
|--------|-------------------------|--------------------------------|
| Mount `<PoseTrackerProvider>` | **No** | No |
| `<PoseTrackerProvider autoPreload>` | **Yes** — `preload()` basic | **No** |
| `preload()` / `warmup()` | **Yes** (default **basic**) | **No** |
| `preload({ coldStart: 'full' })` | **Yes** | **Yes** (may prompt) |
| `<WebViewPoseView coldStart="basic" />` | When page boots | **No** |
| `<WebViewPoseView />` (default `full`) | When page boots | **Yes** |

**Default:** `autoPreload={false}`. Mounting the provider alone does **not**
init the model. Call `preload()` on the screen *before* the camera (home,
diagnostics, exercise picker) — **basic** warms MoveNet only, without a
surprise camera permission prompt.

---

## Cold-start modes

| Mode | What it does | When to use |
|------|--------------|-------------|
| **`basic`** (default) | Load TF.js + MoveNet Lightning, zeros warm-up, pick capture tier. **No** `getUserMedia`. | Home / lobby / `preload()` before the user opens the camera |
| **`full`** | Same as basic, then open the camera (legacy warmer). | Visible camera UI, or `preload({ coldStart: 'full' })` when you intentionally want the permission prompt |

```tsx
// Lobby — model only (no permission prompt)
preload(); // == preload({ coldStart: 'basic' })
<WebViewPoseView coldStart="basic" /> // 1×1 warmer

// Camera screen — user expects the camera
<WebViewPoseView /> // coldStart="full" by default

// Optional: upgrade a basic page to open the camera later
await preload({ coldStart: 'full' }); // injects __PT_OPEN_CAMERA
```

## Recommended integration

```tsx
// App root — client only, no model work yet
<PoseTrackerProvider options={{ /* capturePriority, … */ }}>
  <Navigation />
</PoseTrackerProvider>

// Screen BEFORE the camera (home / lobby)
function HomeScreen() {
  const { preload, status } = usePoseTracker();

  useEffect(() => {
    void preload(); // basic — model only, idempotent
  }, [preload]);

  return (
    <>
      {/* Hidden warmer: required for WebView model cold-start */}
      <View style={{ width: 1, height: 1, opacity: 0 }} pointerEvents="none">
        <WebViewPoseView coldStart="basic" />
      </View>
      <Button
        title="Start"
        disabled={status !== 'ready'}
        onPress={() => navigation.navigate('Camera')}
      />
    </>
  );
}

// Camera screen — opens getUserMedia (permission expected here)
function CameraScreen() {
  return <WebViewPoseView />; // coldStart="full"
}
```

Optional one-liner if you prefer warm-up as soon as the provider mounts
(still **basic** — no camera):

```tsx
<PoseTrackerProvider autoPreload>{children}</PoseTrackerProvider>
```

---

## What `preload()` does (in order)

Idempotent: concurrent / repeated calls share one promise.

1. **Bundled pose runtime** — TF.js + MoveNet + page runtime from the npm
   package (`getRuntimeParts()`). No network.
2. **Handshake / engine** (optional) — if an API token is configured, try
   `configure` + movement engine. Failures degrade to **keypoints-only**;
   they do **not** block `ready`.
3. **Usage queue flush** — best-effort.
4. **Backend warm-up** — `WebViewPoseBackend.warmup()` waits until the
   Chromium/WKWebView page posts `ready` (model loaded + zeros bench done).

Status transitions typically: `configuring` → `downloading` → `warming` →
`ready` (or `error` only if the local model path fails fatally).

**Usage metering** (`POST /api/sdk/track` `camera_start`) is **not** part of
preload — it runs when the camera session actually starts.

---

## WebView detail (important)

For the default `webview-movenet` backend:

- `backend.init()` only notes that the page will load the model once a
  WebView is attached.
- `backend.warmup()` **blocks until** a mounted `WebViewPoseView` finishes
  its in-page boot and posts `ready`.

So if you call `preload()` with **no** `WebViewPoseView` in the tree,
warm-up waits (up to the backend timeout) for a page that never appears.

**Pattern used by the testapp:** on the home / diagnostics screen, mount a
hidden **basic** warmer:

```tsx
{needsWebViewWarmer ? (
  <View style={{ width: 1, height: 1, opacity: 0 }} pointerEvents="none">
    <WebViewPoseView coldStart="basic" />
  </View>
) : null}
```

…while calling `preload()` (basic) in the same screen’s `useEffect`. That
completes **model** warm-up without opening the camera or prompting for
permission.

When the user later opens the camera screen, a full `WebViewPoseView`
mounts and opens `getUserMedia` (permission is expected there). Preload
still helps: runtime parts are already resolved in the JS package; each
new WebView still loads MoveNet into its own page context.

---

## Provider vs page vs camera

```
App mount
  └─ PoseTrackerProvider          → client created (idle)
        │
        ├─ autoPreload? ─────────→ preload() automatically
        │
        └─ Host calls preload()   → runtime + optional engine + wait WebView ready
              │
              └─ WebViewPoseView mounted (warmer or camera)
                    └─ HTML boot: TF.js, MoveNet, zeros bench, (camera if visible)
                          └─ postMessage ready → preload() resolves → status ready

Camera UX
  └─ WebViewPoseView (full screen)
        └─ getUserMedia + inference loop
              └─ camera_start track (metering)
```

---

## API surface

| API | Role |
|-----|------|
| `PoseTrackerProvider` | Owns `PoseTrackerClient`; default no preload |
| `autoPreload` | If `true`, `preload()` on provider mount |
| `usePoseTracker().preload()` | Explicit warm-up (same as `.warmup()`) |
| `client.preload()` | Same, from the escape-hatch `client` |
| `WebViewPoseView` | Injects HTML; in-page MoveNet boot; required for WebView `warmup()` to finish |

---

## Background / battery behaviour (unload path)

Pose estimation is expensive (camera + GPU inference every frame). The SDK
releases those resources automatically — no host wiring needed:

- **App backgrounded** (`AppState` → `background`, or the page reports
  `visibilitychange: hidden`): the in-page pipeline **suspends** — camera
  tracks are stopped (`MediaStreamTrack.stop()`), the inference rAF loop is
  halted. The MoveNet model stays loaded (cheap, RAM only) so resume is
  instant.
- **App foregrounded again**: the camera is reacquired with the same
  constraints (including any adaptive-quality downgrade applied earlier) and
  the loop restarts. Diag lines: `pipeline suspended (…)` /
  `pipeline resumed — camera reacquired`.
- **`WebViewPoseView` unmount**: the WebView page is destroyed → camera,
  WebGL context and model memory are freed by the browser engine. A
  `pagehide` handler additionally stops camera tracks so the OS camera
  indicator dies with the page.
- **Broken session guard**: if inference starts failing on every frame
  (e.g. WebGL context loss), the page stops the loop and releases the camera
  after ~45 consecutive failures instead of burning battery on a dead
  session, and posts an `error` event.
- iOS `inactive` (control center / app switcher overlay) is intentionally
  **not** treated as background — brief overlays don't tear down the camera.

`client.dispose()` tears down everything (backend, session, listeners).

---

## Related

- Status / init events: [EVENTS.md](./EVENTS.md)
- Payload layout (bundled pose vs remote engine): [ARCHITECTURE.md](./ARCHITECTURE.md) §4
- Capture vs FPS trade-off: [ADAPTIVE_QUALITY.md](./ADAPTIVE_QUALITY.md) § Capture priority
