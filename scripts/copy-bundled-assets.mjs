/**
 * After `tsc`, copy the generated ~9 MB bundledRuntimeAssets into lib/
 * (excluded from TypeScript compile for speed).
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'src/backends/webview');
const libDir = join(root, 'lib/backends/webview');

const files = ['bundledRuntimeAssets.js', 'bundledRuntimeAssets.d.ts'];
for (const name of files) {
  const from = join(srcDir, name);
  if (!existsSync(from)) {
    console.error(
      `Missing ${from}. Run: npm run build:runtime-payload`,
    );
    process.exit(1);
  }
}
mkdirSync(libDir, { recursive: true });
for (const name of files) {
  copyFileSync(join(srcDir, name), join(libDir, name));
}
console.log('copied bundledRuntimeAssets → lib/backends/webview/');
