# Camera permissions (required)

The SDK opens the device camera via **`getUserMedia` inside `WebViewPoseView`**
when `coldStart` is `full` (the default on the camera screen). It does **not**
ship iOS/Android permission strings or request UI — **the host app must
declare and request camera access**.

Without a correct native declaration, iOS will crash or reject the prompt;
Android may fail silently; Expo Go needs the plugin/`infoPlist` entries.

Related: [`PRELOAD.md`](PRELOAD.md) — use `preload()` / `coldStart: 'basic'`
on lobby screens so you never prompt before the user opens the camera.

---

## Responsibility split

| Layer | Who | What |
|-------|-----|------|
| Usage description + manifest | **Host app** | `NSCameraUsageDescription`, Android `CAMERA`, Expo plugin text |
| When to ask the user | **Host app** | Prefer asking on the camera screen (or just before) |
| `getUserMedia` | **SDK** | Called when mounting `<WebViewPoseView />` (`coldStart="full"`) or `preload({ coldStart: 'full' })` |
| Model-only warm-up | **SDK** | `preload()` + `<WebViewPoseView coldStart="basic" />` — **no** permission |

---

## Expo (recommended)

### 1. Declare permission text in `app.json` / `app.config.js`

```json
{
  "expo": {
    "ios": {
      "infoPlist": {
        "NSCameraUsageDescription": "Camera access is required for on-device pose estimation."
      }
    },
    "android": {
      "permissions": ["android.permission.CAMERA"]
    },
    "plugins": [
      [
        "expo-camera",
        {
          "cameraPermission": "Camera access is required for on-device pose estimation."
        }
      ]
    ]
  }
}
```

Use your own product wording (localized if needed). Rebuild the native
project after changing plugins (`npx expo prebuild` / EAS).

### 2. Request permission before opening the camera UI

```tsx
import { useEffect } from 'react';
import { Text, View } from 'react-native';
import { useCameraPermissions } from 'expo-camera';
import { WebViewPoseView } from '@pose-tracker/react-native-pose-estimation';

export function CameraScreen() {
  const [permission, requestPermission] = useCameraPermissions();

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      void requestPermission();
    }
  }, [permission, requestPermission]);

  if (!permission) {
    return <View />;
  }
  if (!permission.granted) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', padding: 24 }}>
        <Text>
          Camera permission is required for pose tracking. Enable it in
          Settings if you previously denied it.
        </Text>
      </View>
    );
  }

  // Only mount the SDK camera surface after permission is granted.
  return <WebViewPoseView style={{ flex: 1 }} drawSkeleton />;
}
```

`expo-camera` is used here **only** for the permission API. The PoseTracker
SDK still owns capture inside its WebView (you do not need Expo Camera’s
preview for the default WebView backend).

---

## Bare React Native — iOS

Add to `ios/<App>/Info.plist`:

```xml
<key>NSCameraUsageDescription</key>
<string>Camera access is required for on-device pose estimation.</string>
```

Optional host-side request (e.g. with `react-native-permissions`):

```ts
import { request, PERMISSIONS, RESULTS } from 'react-native-permissions';
import { Platform } from 'react-native';

async function ensureCameraPermission(): Promise<boolean> {
  const permission =
    Platform.OS === 'ios'
      ? PERMISSIONS.IOS.CAMERA
      : PERMISSIONS.ANDROID.CAMERA;
  const result = await request(permission);
  return result === RESULTS.GRANTED;
}

// Before navigating to the camera screen:
if (await ensureCameraPermission()) {
  navigation.navigate('Camera');
}
```

---

## Bare React Native — Android

In `android/app/src/main/AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.CAMERA" />
```

Optional (helps Play Store filtering; not strictly required for WebView):

```xml
<uses-feature android:name="android.hardware.camera" android:required="false" />
<uses-feature android:name="android.hardware.camera.front" android:required="false" />
```

Runtime permission (API 23+) — request before mounting `WebViewPoseView`
(`PermissionsAndroid` or `react-native-permissions` as above).

```ts
import { PermissionsAndroid, Platform } from 'react-native';

async function ensureAndroidCamera(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const granted = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.CAMERA,
    {
      title: 'Camera permission',
      message: 'Camera access is required for on-device pose estimation.',
      buttonPositive: 'OK',
      buttonNegative: 'Cancel',
    },
  );
  return granted === PermissionsAndroid.RESULTS.GRANTED;
}
```

---

## WebView note

`WebViewPoseView` sets `mediaCapturePermissionGrantType="grant"` so the
in-page `getUserMedia` can proceed **after** the OS has granted camera
access to the app. That does **not** replace `Info.plist` /
`AndroidManifest` / Expo plugin configuration.

---

## Checklist for integrators

1. [ ] Declare camera usage string (iOS + Expo plugin text).
2. [ ] Declare Android `CAMERA` permission.
3. [ ] Request permission on (or just before) the camera screen.
4. [ ] Mount `<WebViewPoseView />` only when granted (or handle denial UX).
5. [ ] Use `preload()` + `<WebViewPoseView coldStart="basic" />` on lobby —
      **no** prompt there.
6. [ ] Never call `preload({ coldStart: 'full' })` outside a camera context
      the user expects.

---

## AI / integrator summary

- **Required host config:** camera permission declaration + user-facing
  message; runtime request before live tracking.
- **SDK does not** provide `NSCameraUsageDescription` or Android manifest
  merges for you.
- **Safe pattern:** basic cold-start on home → request permission → mount
  full `WebViewPoseView` on the camera screen.
