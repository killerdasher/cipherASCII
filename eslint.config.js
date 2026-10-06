// Flat ESLint config: TypeScript + React hooks over the whole repository.
// Run with `npm run lint`; fixable issues with `npm run lint -- --fix`.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'release/**',
      'coverage/**',
      'node_modules/**',
      '**/dist-electron/**',
      // Vendored third-party binaries/scripts (ffmpeg.wasm core).
      'public/ffmpeg/**',
      '*.config.ts',
      'eslint.config.js',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'off',
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-nocheck': 'allow-with-description', minimumDescriptionLength: 10 },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    files: ['tests/**/*', 'scripts/**/*'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        setTimeout: 'readonly',
        performance: 'readonly',
        document: 'readonly',
        window: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-unused-expressions': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-control-regex': 'off',
    },
  },
  {
    // Plain JavaScript in the renderer runs in a browser window; TS files are
    // exempt from no-undef by typescript-eslint, so declare the DOM globals
    // explicitly for .js/.jsx to keep the same protection.
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      globals: {
        document: 'readonly',
        window: 'readonly',
        self: 'readonly',
        navigator: 'readonly',
        location: 'readonly',
        console: 'readonly',
        performance: 'readonly',
        crypto: 'readonly',
        getComputedStyle: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        Blob: 'readonly',
        File: 'readonly',
        FileReader: 'readonly',
        ImageData: 'readonly',
        OffscreenCanvas: 'readonly',
        Worker: 'readonly',
        MutationObserver: 'readonly',
        ResizeObserver: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        HTMLElement: 'readonly',
        HTMLCanvasElement: 'readonly',
        HTMLInputElement: 'readonly',
        alert: 'readonly',
      },
    },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: {
      globals: {
        require: 'readonly',
        module: 'readonly',
        process: 'readonly',
        console: 'readonly',
        __dirname: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      'no-undef': 'off',
    },
  },
);
