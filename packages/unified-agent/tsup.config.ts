import { defineConfig } from 'tsup';

export default defineConfig([
  // 라이브러리 빌드
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    splitting: false,
    treeshake: true,
    target: 'node18',
    outDir: 'dist',
  },
  // CLI 빌드
  {
    entry: ['src/cli.ts'],
    format: ['esm'],
    banner: { js: '#!/usr/bin/env node' },
    sourcemap: false,
    clean: false,
    splitting: false,
    treeshake: true,
    target: 'node18',
    outDir: 'dist',
  },
]);
