import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { useStore } from './store';
import { createImageLayer, fileToImageSource, isImageFile } from './components/imageImport';
import './styles.css';

/**
 * Programmatic control surface for the running app.
 *
 * Mirrors the same actions the UI uses (import a picture, read the rendered
 * grid), which lets automation drive and verify the pipeline end to end.
 */
Object.assign(window, {
  asciiStudio: {
    useStore,
    createImageLayer,
    fileToImageSource,
    isImageFile,
  },
});

const container = document.getElementById('root');
if (!container) throw new Error('Root element not found');
createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
