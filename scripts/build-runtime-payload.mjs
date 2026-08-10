/**
 * Builds the versioned pose-runtime payload AND embeds it in the npm package.
 *
 * Primary output (shipped in the SDK — cold start with zero pose download):
 *   src/backends/webview/bundledRuntimeAssets.ts
 *
 * Also writes dist-runtime/ (and optionally deploys to Strapi private/sdk-runtime
 * for the optional remote endpoint — the RN SDK no longer requires that path).
 *
 * Parts:
 *   - tfjs.bundle.js          TF.js core+converter+webgl+wasm backends (minified)
 *   - tfjs-wasm.b64.json      XNNPACK wasm binaries (base64: plain/simd/threadedSimd)
 *   - movenet.model.json      MoveNet SinglePose Lightning graph model topology
 *   - movenet.weights.b64.json weight shards (base64, manifest order)
 *   - pose-pipeline.wasm.b64  proprietary pipeline (AssemblyScript → wasm, base64)
 *   - pose-runtime.js         page runtime (camera, presets, loop, events)
 *   - runtime.meta.json       { version, parts: { name: { file, sha256, bytes } } }
 *
 * Usage:
 *   node scripts/build-runtime-payload.mjs             # build + embed in src/
 *   node scripts/build-runtime-payload.mjs --deploy    # + copy to Strapi
 *   node scripts/build-runtime-payload.mjs --deploy /path/to/private/sdk-runtime
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'dist-runtime');
mkdirSync(outDir, { recursive: true });

function sha256(content) {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function readScript(rel) {
  // `</script` inside a JS string would terminate the inline <script> tag
  // when the SDK assembles the HTML page.
  return readFileSync(join(root, 'node_modules', rel), 'utf8').replace(
    /<\/script/gi,
    '<\\/script',
  );
}

// --- 1. TF.js bundle -------------------------------------------------------
const tfjsVersion = JSON.parse(
  readFileSync(join(root, 'node_modules/@tensorflow/tfjs-core/package.json'), 'utf8'),
).version;

const tfjsBundle = [
  readScript('@tensorflow/tfjs-core/dist/tf-core.min.js'),
  readScript('@tensorflow/tfjs-converter/dist/tf-converter.min.js'),
  readScript('@tensorflow/tfjs-backend-webgl/dist/tf-backend-webgl.min.js'),
  // WASM backend (XNNPACK) — the fast MoveNet path in the PoseTracker product.
  readScript('@tensorflow/tfjs-backend-wasm/dist/tf-backend-wasm.min.js'),
].join('\n');

// --- 2. tfjs XNNPACK wasm binaries (base64) --------------------------------
const wasmDist = '@tensorflow/tfjs-backend-wasm/dist';
const tfjsWasm = JSON.stringify({
  plain: readFileSync(join(root, 'node_modules', wasmDist, 'tfjs-backend-wasm.wasm')).toString('base64'),
  simd: readFileSync(join(root, 'node_modules', wasmDist, 'tfjs-backend-wasm-simd.wasm')).toString('base64'),
  threadedSimd: readFileSync(join(root, 'node_modules', wasmDist, 'tfjs-backend-wasm-threaded-simd.wasm')).toString('base64'),
});

// --- 3. MoveNet model + weights --------------------------------------------
const modelDir = join(root, 'assets/movenet-singlepose-lightning');
const modelJson = readFileSync(join(modelDir, 'model.json'), 'utf8');
const weightsManifest = JSON.parse(modelJson).weightsManifest;
const shardNames = weightsManifest.flatMap((group) => group.paths);
const weights = JSON.stringify(
  shardNames.map((name) => readFileSync(join(modelDir, name)).toString('base64')),
);

// --- 4. Proprietary pipeline: AssemblyScript → wasm → base64 ----------------
const pipelineWasmPath = join(outDir, 'pose-pipeline.wasm');
execFileSync(
  'npx',
  [
    'asc', 'runtime/pipeline/index.ts',
    '-o', pipelineWasmPath,
    '-O3', '--runtime', 'stub', '--noAssert',
  ],
  { cwd: root, stdio: 'inherit' },
);
const pipelineWasmB64 = readFileSync(pipelineWasmPath).toString('base64');

// --- 5. Page runtime ---------------------------------------------------------
const runtimeJs = readFileSync(join(root, 'runtime/pose-runtime.js'), 'utf8').replace(
  /<\/script/gi,
  '<\\/script',
);

// --- 6. Assemble parts + version -------------------------------------------
const partContents = {
  tfjs: { file: 'tfjs.bundle.js', content: tfjsBundle },
  'tfjs-wasm': { file: 'tfjs-wasm.b64.json', content: tfjsWasm },
  model: { file: 'movenet.model.json', content: modelJson },
  weights: { file: 'movenet.weights.b64.json', content: weights },
  pipeline: { file: 'pose-pipeline.wasm.b64', content: pipelineWasmB64 },
  runtime: { file: 'pose-runtime.js', content: runtimeJs },
};

const combinedHash = createHash('sha256');
const parts = {};
for (const [name, { file, content }] of Object.entries(partContents)) {
  writeFileSync(join(outDir, file), content);
  const digest = sha256(content);
  combinedHash.update(digest);
  parts[name] = { file, sha256: digest, bytes: Buffer.byteLength(content, 'utf8') };
}

const version = `${new Date().toISOString().slice(0, 10)}-${combinedHash.digest('hex').slice(0, 8)}`;

const meta = {
  version,
  tfjsVersion,
  generatedAt: new Date().toISOString(),
  parts,
};
writeFileSync(join(outDir, 'runtime.meta.json'), JSON.stringify(meta, null, 2));

const totalMb = Object.values(parts).reduce((s, p) => s + p.bytes, 0) / 1024 / 1024;
console.log(`pose-runtime payload ${version} built (${totalMb.toFixed(1)} MB, tfjs=${tfjsVersion})`);
for (const [name, p] of Object.entries(parts)) {
  console.log(`  ${name.padEnd(10)} ${p.file.padEnd(26)} ${(p.bytes / 1024).toFixed(0).padStart(6)} KB  ${p.sha256.slice(0, 12)}…`);
}

// --- 7. Embed into the npm package (cold-start, no pose download) -----------
// Emit CommonJS .js + tiny .d.ts so `tsc` never parses the ~9 MB payload.
const webviewDir = join(root, 'src/backends/webview');
const bundledJsPath = join(webviewDir, 'bundledRuntimeAssets.js');
const bundledDtsPath = join(webviewDir, 'bundledRuntimeAssets.d.ts');
const bundledJs = [
  '/* eslint-disable */',
  '/**',
  ' * AUTO-GENERATED by scripts/build-runtime-payload.mjs — do not edit.',
  ` * version=${version} tfjs=${tfjsVersion} generatedAt=${meta.generatedAt}`,
  ' *',
  ' * Bundled pose runtime (TF.js + MoveNet + page runtime + pipeline wasm).',
  ' * Shipped in the npm package so preload never downloads the model.',
  ' */',
  `'use strict';`,
  `exports.BUNDLED_RUNTIME_VERSION = ${JSON.stringify(version)};`,
  `exports.BUNDLED_TFJS_VERSION = ${JSON.stringify(tfjsVersion)};`,
  `exports.BUNDLED_TFJS_JS = ${JSON.stringify(partContents.tfjs.content)};`,
  `exports.BUNDLED_TFJS_WASM_JSON = ${JSON.stringify(partContents['tfjs-wasm'].content)};`,
  `exports.BUNDLED_MODEL_JSON = ${JSON.stringify(partContents.model.content)};`,
  `exports.BUNDLED_WEIGHTS_JSON = ${JSON.stringify(partContents.weights.content)};`,
  `exports.BUNDLED_PIPELINE_WASM_B64 = ${JSON.stringify(partContents.pipeline.content)};`,
  `exports.BUNDLED_RUNTIME_JS = ${JSON.stringify(partContents.runtime.content)};`,
  '',
].join('\n');
const bundledDts = [
  '/** AUTO-GENERATED by scripts/build-runtime-payload.mjs — do not edit. */',
  `export declare const BUNDLED_RUNTIME_VERSION: string;`,
  `export declare const BUNDLED_TFJS_VERSION: string;`,
  `export declare const BUNDLED_TFJS_JS: string;`,
  `export declare const BUNDLED_TFJS_WASM_JSON: string;`,
  `export declare const BUNDLED_MODEL_JSON: string;`,
  `export declare const BUNDLED_WEIGHTS_JSON: string;`,
  `export declare const BUNDLED_PIPELINE_WASM_B64: string;`,
  `export declare const BUNDLED_RUNTIME_JS: string;`,
  '',
].join('\n');
writeFileSync(bundledJsPath, bundledJs);
writeFileSync(bundledDtsPath, bundledDts);
// Mirror into lib/ when present so `main: lib/index.js` consumers resolve it.
const libWebviewDir = join(root, 'lib/backends/webview');
if (existsSync(join(root, 'lib'))) {
  mkdirSync(libWebviewDir, { recursive: true });
  writeFileSync(join(libWebviewDir, 'bundledRuntimeAssets.js'), bundledJs);
  writeFileSync(join(libWebviewDir, 'bundledRuntimeAssets.d.ts'), bundledDts);
}
console.log(`embedded → ${bundledJsPath} (${(Buffer.byteLength(bundledJs, 'utf8') / 1024 / 1024).toFixed(1)} MB)`);

// --- 8. Optional deploy to the Strapi private folder ------------------------
const deployIdx = process.argv.indexOf('--deploy');
if (deployIdx >= 0) {
  const deployDir = process.argv[deployIdx + 1]
    ? resolve(process.argv[deployIdx + 1])
    : resolve(root, '../../../PoseTrackerStrAPI/private/sdk-runtime');
  if (!existsSync(dirname(deployDir))) {
    console.error(`deploy target parent missing: ${dirname(deployDir)}`);
    process.exit(1);
  }
  mkdirSync(deployDir, { recursive: true });
  for (const { file } of Object.values(parts)) {
    copyFileSync(join(outDir, file), join(deployDir, file));
  }
  copyFileSync(join(outDir, 'runtime.meta.json'), join(deployDir, 'runtime.meta.json'));
  console.log(`deployed to ${deployDir}`);
}
