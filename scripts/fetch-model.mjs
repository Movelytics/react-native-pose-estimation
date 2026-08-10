#!/usr/bin/env node
/**
 * Downloads MoveNet SinglePose Lightning v4 (tfjs-graph-model) into
 * assets/movenet-singlepose-lightning/. The model is normally committed with
 * the package; this script re-fetches it when needed (clean checkout, model
 * upgrade).
 *
 * Usage: node scripts/fetch-model.mjs
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const URL =
  'https://www.kaggle.com/api/v1/models/google/movenet/tfJs/singlepose-lightning/4/download';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'assets', 'movenet-singlepose-lightning');
const archive = join(target, 'movenet.tar.gz');

mkdirSync(target, { recursive: true });

if (existsSync(join(target, 'model.json'))) {
  console.log('Model already present at', target);
  process.exit(0);
}

console.log('Downloading MoveNet SinglePose Lightning v4 (tfjs)…');
execFileSync('curl', ['-fsSL', '-o', archive, URL], { stdio: 'inherit' });
execFileSync('tar', ['-xzf', archive, '-C', target], { stdio: 'inherit' });
rmSync(archive);
console.log('Model extracted to', target);
