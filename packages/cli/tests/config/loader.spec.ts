/**
 * Unit Tests for Config Loader
 *
 * ====================================================================
 * If tests fail, FIX THE IMPLEMENTATION in src/config/, not these tests.
 * ====================================================================
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadConfig, ConfigError } from '../../src/config/loader.js';
import { VALID_CONFIGS, INVALID_CONFIGS, EXPECTED_PARSED } from '../fixtures/config.fixtures.js';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('Config Loader', () => {
  let testDir: string;

  beforeEach(async () => {
    // Create a unique temp directory for each test
    testDir = join(tmpdir(), `supacontrol-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up temp directory
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  /**
   * Helper to write a config file to the test directory
   */
  async function writeConfig(content: string, filename = 'supacontrol.toml'): Promise<void> {
    await writeFile(join(testDir, filename), content, 'utf-8');
  }

  describe('Valid Configurations', () => {
    it('should parse minimal valid config', async () => {
      await writeConfig(VALID_CONFIGS.minimal);

      const config = await loadConfig(testDir);

      expect(config).not.toBeNull();
      expect(config!.settings.strict_mode).toBe(false);
      expect(config!.settings.require_clean_git).toBe(true);
      expect(config!.environments['production']).toBeDefined();
    });

    it('should parse full config with all options', async () => {
      await writeConfig(VALID_CONFIGS.full);

      const config = await loadConfig(testDir);

      expect(config).not.toBeNull();
      expect(config!.settings.strict_mode).toBe(true);
      expect(config!.environments['staging']).toBeDefined();
      expect(config!.environments['production']).toBeDefined();
      expect(config!.environments['production']!.locked).toBe(true);
      expect(config!.environments['production']!.confirm_word).toBe('production');
    });

    it('should parse config with wildcard branch patterns', async () => {
      await writeConfig(VALID_CONFIGS.wildcards);

      const config = await loadConfig(testDir);

      expect(config).not.toBeNull();
      expect(config!.environments['preview']!.git_branches).toContain('preview/*');
      expect(config!.environments['preview']!.git_branches).toContain('feature/*');
    });

    it('should parse local-only config (no environments)', async () => {
      await writeConfig(VALID_CONFIGS.localOnly);

      const config = await loadConfig(testDir);

      expect(config).not.toBeNull();
      expect(config!.environments).toEqual({});
    });

    it('should parse config with multiple environments', async () => {
      await writeConfig(VALID_CONFIGS.multiEnv);

      const config = await loadConfig(testDir);

      expect(config).not.toBeNull();
      expect(Object.keys(config!.environments)).toHaveLength(3);
      expect(config!.environments['dev']).toBeDefined();
      expect(config!.environments['staging']).toBeDefined();
      expect(config!.environments['production']).toBeDefined();
    });
  });

  describe('Default Value Application', () => {
    it('should apply default settings when not specified', async () => {
      // Config with just environments, no settings
      await writeConfig(`
[environments.production]
project_ref = "test-ref"
`);

      const config = await loadConfig(testDir);

      expect(config).not.toBeNull();
      // Check defaults are applied
      expect(config!.settings.strict_mode).toBe(false);
      expect(config!.settings.require_clean_git).toBe(true);
      expect(config!.settings.show_migration_diff).toBe(true);
    });

    it('should apply default environment values', async () => {
      await writeConfig(`
[settings]
strict_mode = false
require_clean_git = true
show_migration_diff = true

[environments.test]
project_ref = "test-ref"
`);

      const config = await loadConfig(testDir);

      expect(config).not.toBeNull();
      // Check defaults are applied to environment
      expect(config!.environments['test']!.git_branches).toEqual([]);
      expect(config!.environments['test']!.protected_operations).toEqual([]);
      expect(config!.environments['test']!.locked).toBeUndefined();
    });
  });

  describe('Invalid Configurations', () => {
    it('should throw ConfigError for malformed TOML', async () => {
      await writeConfig(INVALID_CONFIGS.malformedToml);

      await expect(loadConfig(testDir)).rejects.toThrow(ConfigError);
      await expect(loadConfig(testDir)).rejects.toThrow(/Invalid TOML syntax/);
    });

    it('should throw ConfigError for wrong type', async () => {
      await writeConfig(INVALID_CONFIGS.wrongType);

      await expect(loadConfig(testDir)).rejects.toThrow(ConfigError);
    });

    it('should throw ConfigError for invalid operation name', async () => {
      await writeConfig(INVALID_CONFIGS.invalidOperation);

      await expect(loadConfig(testDir)).rejects.toThrow(ConfigError);
    });

    it('should handle empty config file', async () => {
      await writeConfig(INVALID_CONFIGS.empty);

      // Empty TOML should parse but may fail validation
      // depending on schema requirements
      const result = await loadConfig(testDir);
      // An empty config should return with defaults applied
      expect(result).not.toBeNull();
      expect(result!.settings).toBeDefined();
    });

    it('should handle whitespace-only config', async () => {
      await writeConfig(INVALID_CONFIGS.whitespace);

      const result = await loadConfig(testDir);
      // Whitespace-only should parse as empty and apply defaults
      expect(result).not.toBeNull();
    });
  });

  describe('Missing File Handling', () => {
    it('should return null when no config file exists', async () => {
      // Don't create any config file
      const config = await loadConfig(testDir);

      expect(config).toBeNull();
    });

    it('should search config/ subdirectory', async () => {
      // Create config in config/ subdirectory
      await mkdir(join(testDir, 'config'), { recursive: true });
      await writeFile(
        join(testDir, 'config', 'supacontrol.toml'),
        VALID_CONFIGS.minimal,
        'utf-8'
      );

      const config = await loadConfig(testDir);

      expect(config).not.toBeNull();
      expect(config!.environments['production']).toBeDefined();
    });

    it('should prefer root config over config/ subdirectory', async () => {
      // Create both root and config/ configs
      await writeConfig(`
[settings]
strict_mode = true
require_clean_git = true
show_migration_diff = true
`);

      await mkdir(join(testDir, 'config'), { recursive: true });
      await writeFile(
        join(testDir, 'config', 'supacontrol.toml'),
        `
[settings]
strict_mode = false
require_clean_git = true
show_migration_diff = true
`,
        'utf-8'
      );

      const config = await loadConfig(testDir);

      // Root config should be loaded (strict_mode = true)
      expect(config).not.toBeNull();
      expect(config!.settings.strict_mode).toBe(true);
    });
  });

  describe('Error Messages', () => {
    it('should include file path in error messages', async () => {
      await writeConfig(INVALID_CONFIGS.malformedToml);

      try {
        await loadConfig(testDir);
        expect.fail('Should have thrown ConfigError');
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigError);
        expect((error as ConfigError).filePath).toContain('supacontrol.toml');
      }
    });

    it('should provide helpful error for schema validation failures', async () => {
      await writeConfig(`
[settings]
strict_mode = "not-a-boolean"
require_clean_git = true
show_migration_diff = true
`);

      try {
        await loadConfig(testDir);
        expect.fail('Should have thrown ConfigError');
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigError);
        const message = (error as ConfigError).message;
        // Error message should mention the problematic field
        expect(message).toMatch(/strict_mode|boolean/i);
      }
    });
  });
});
