import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative asset URLs so index.html works when loaded from file:// in Electron
  base: './',
  server: {
    port: 5173,
    strictPort: false,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    // The only chunk above 500 kB is the pixi.js vendor chunk, which is
    // fetched lazily (GPU preview); app chunks sit under 255 kB. Raise the
    // limit so the build reports real regressions instead of that known file.
    chunkSizeWarningLimit: 600,
    // Vite 8 bundles with Rolldown: chunking is expressed as
    // `codeSplitting.groups` (its replacement for Rollup's `manualChunks`).
    // One 847 kB index chunk meant every release invalidated react, pixi,
    // framer-motion and ffmpeg together; splitting them out keeps the app
    // chunk small, lets the browser cache the libraries across releases and
    // clears the >500 kB warning.
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: 'motion', test: /node_modules[\\/]framer-motion[\\/]/ },
            { name: 'pixi', test: /node_modules[\\/]pixi\.js[\\/]/ },
            { name: 'ffmpeg', test: /node_modules[\\/]@ffmpeg[\\/]/ },
          ],
        },
      },
    },
  },
  worker: {
    format: 'es',
  },
});
