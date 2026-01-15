import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Test file patterns
    include: ['tests/**/*.spec.ts', 'tests/**/*.test.ts'],

    // Exclude patterns
    exclude: ['tests/fixtures/**', 'node_modules/**', 'dist/**'],

    // TypeScript support via esbuild (built into Vitest)
    globals: true,

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: [
        'src/index.ts', // CLI entry point
        '**/*.d.ts',
        '**/types.ts',
      ],
      thresholds: {
        // Start with reasonable thresholds, increase over time
        branches: 70,
        functions: 70,
        lines: 70,
        statements: 70,
      },
    },

    // Setup file for common mocks
    setupFiles: ['./tests/setup.ts'],

    // Environment
    environment: 'node',

    // Timeout for slow tests
    testTimeout: 10000,

    // Fail fast on first error in CI
    bail: process.env.CI ? 1 : 0,

    // Reporter configuration
    reporters: process.env.CI ? ['verbose', 'json'] : ['verbose'],

    // Output file for JSON reporter in CI
    outputFile: process.env.CI ? './test-results.json' : undefined,
  },
});
