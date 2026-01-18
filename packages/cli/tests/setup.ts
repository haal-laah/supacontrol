/**
 * Vitest Setup File
 *
 * This file runs before each test file.
 * Use it for global mocks, environment setup, and test utilities.
 */

import { vi, beforeEach, afterAll } from 'vitest';

/**
 * Mock process.exit to prevent tests from actually exiting
 */
vi.stubGlobal(
  'process',
  Object.assign({}, process, {
    exit: vi.fn((code?: number) => {
      throw new Error(`process.exit(${code}) called`);
    }),
  })
);

/**
 * Mock console methods to reduce noise in tests
 * Use vi.mocked(console.log).mockClear() in tests if needed
 */
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});

/**
 * Reset all mocks between tests
 */
beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * Clean up after all tests
 */
afterAll(() => {
  vi.restoreAllMocks();
});

/**
 * Common test utilities
 */

/**
 * Create a temporary directory path for testing
 */
export function getTempDir(suffix = ''): string {
  return `/tmp/supacontrol-test-${Date.now()}${suffix ? `-${suffix}` : ''}`;
}

/**
 * Helper to create mock environment config
 */
export function createMockEnvironmentConfig(overrides = {}) {
  return {
    project_ref: 'test-project-ref',
    git_branches: ['main'],
    protected_operations: ['reset'],
    confirm_word: undefined,
    locked: undefined,
    ...overrides,
  };
}

/**
 * Helper to create mock config
 */
export function createMockConfig(overrides = {}) {
  return {
    settings: {
      strict_mode: false,
      require_clean_git: true,
      show_migration_diff: true,
    },
    environments: {
      production: createMockEnvironmentConfig({ locked: true }),
      staging: createMockEnvironmentConfig({ locked: false }),
    },
    ...overrides,
  };
}

/**
 * Helper to create mock guard context
 */
export function createMockGuardContext(overrides = {}) {
  return {
    operation: 'push' as const,
    environment: 'staging',
    config: createMockEnvironmentConfig(),
    globalConfig: createMockConfig(),
    ci: false,
    verbose: false,
    ...overrides,
  };
}
