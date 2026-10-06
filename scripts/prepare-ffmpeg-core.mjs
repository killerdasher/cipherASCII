// Copies the @ffmpeg/core WASM build into public/ so the renderer can load
// it offline (Vite copies public/ into dist/, electron-builder packs dist/
// into the asar). Runs on `npm install` (postinstall) and before `npm run
// build` (prebuild).
import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = path.join(root, 'node_modules', '@ffmpeg', 'core', 'dist', 'esm');
const dest = path.join(root, 'public', 'ffmpeg');

mkdirSync(dest, { recursive: true });
for (const file of ['ffmpeg-core.js', 'ffmpeg-core.wasm']) {
  copyFileSync(path.join(src, file), path.join(dest, file));
}
console.log('[prepare-ffmpeg] copied ffmpeg-core.js + ffmpeg-core.wasm to public/ffmpeg');
