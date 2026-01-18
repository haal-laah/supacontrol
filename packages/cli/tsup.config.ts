import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  minify: true,
  shims: true,
  banner: {
    js: '#!/usr/bin/env node',
  },
  target: 'node18',
  splitting: false,
  tsconfig: 'tsconfig.build.json',
});
