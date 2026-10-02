# Third-party notices

The PoseTracker React Native SDK redistributes or embeds the following
third-party software. Their licenses apply to those components only; the
PoseTracker SDK source remains under the repository `LICENSE`.

---

## TensorFlow.js / TensorFlow.js WASM backend

- Packages: `@tensorflow/tfjs`, `@tensorflow/tfjs-backend-wasm` (and bundled
  browser builds shipped inside the WebView runtime payload)
- Copyright: Google LLC and TensorFlow authors
- License: **Apache License 2.0**
- License text: https://www.apache.org/licenses/LICENSE-2.0
- Notice: portions of the bundled runtime include the Apache 2.0 header from
  Google LLC (“All Rights Reserved” / Apache 2.0).

---

## MoveNet SinglePose Lightning (model weights)

- Model: MoveNet SinglePose Lightning (TensorFlow Hub / TensorFlow Models)
- Copyright: Google LLC
- License: **Apache License 2.0**
- Model card / hub: https://tfhub.dev/google/movenet/singlepose/lightning/4
- License text: https://www.apache.org/licenses/LICENSE-2.0

---

## Other runtime dependencies

npm dependencies of the published package (e.g. `js-sha256`, and peer
dependencies such as `react-native-webview`) retain their own licenses as
declared on npm. They are not re-licensed by PoseTracker.

---

## Apache License 2.0 — required notice (summary)

Licensed under the Apache License, Version 2.0 (the "License"); you may not
use those files except in compliance with the License. You may obtain a copy
of the License at:

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
License for the specific language governing permissions and limitations under
the License.
