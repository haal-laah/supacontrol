/**
 * Smoke test to verify Vitest setup works
 */

import { describe, it, expect } from 'vitest';
import { createMockConfig, createMockGuardContext } from './setup.js';

describe('Test Setup', () => {
  it('should run a basic test', () => {
    expect(1 + 1).toBe(2);
  });

  it('should have access to setup helpers', () => {
    const config = createMockConfig();
    expect(config.settings).toBeDefined();
    expect(config.environments).toBeDefined();
  });

  it('should create mock guard context', () => {
    const ctx = createMockGuardContext({ operation: 'reset' });
    expect(ctx.operation).toBe('reset');
    expect(ctx.ci).toBe(false);
  });

  it('should override mock config properties', () => {
    const config = createMockConfig({
      settings: {
        strict_mode: true,
        require_clean_git: false,
        show_migration_diff: false,
      },
    });
    expect(config.settings.strict_mode).toBe(true);
  });
});
