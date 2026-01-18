/**
 * Unit Tests for Config Writer
 *
 * These tests verify config serialization to TOML and file writing.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  configToToml,
  generateDefaultConfig,
  generateExampleToml,
  configExists,
  writeConfig,
} from '../../src/config/writer.js';
import type { Config } from '../../src/config/schema.js';

describe('Config Writer', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `supacontrol-writer-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('configToToml', () => {
    it('should convert minimal config to TOML', () => {
      const config: Config = {
        settings: {
          strict_mode: false,
          require_clean_git: true,
          show_migration_diff: true,
        },
        environments: {},
      };

      const toml = configToToml(config);

      expect(toml).toContain('[settings]');
      expect(toml).toContain('strict_mode = false');
      expect(toml).toContain('require_clean_git = true');
      expect(toml).toContain('show_migration_diff = true');
    });

    it('should include environment section', () => {
      const config: Config = {
        settings: {
          strict_mode: false,
          require_clean_git: true,
          show_migration_diff: true,
        },
        environments: {
          production: {
            project_ref: 'prod-ref-12345',
            git_branches: ['main', 'master'],
            protected_operations: ['push', 'reset'],
            confirm_word: undefined,
            locked: true,
          },
        },
      };

      const toml = configToToml(config);

      expect(toml).toContain('[environments.production]');
      expect(toml).toContain('project_ref = "prod-ref-12345"');
      expect(toml).toContain('git_branches = ["main", "master"]');
      expect(toml).toContain('protected_operations = ["push", "reset"]');
      expect(toml).toContain('locked = true');
    });

    it('should include confirm_word when specified', () => {
      const config: Config = {
        settings: {
          strict_mode: false,
          require_clean_git: true,
          show_migration_diff: true,
        },
        environments: {
          production: {
            project_ref: 'prod-ref',
            git_branches: ['main'],
            protected_operations: ['push'],
            confirm_word: 'PRODUCTION',
            locked: true,
          },
        },
      };

      const toml = configToToml(config);

      expect(toml).toContain('confirm_word = "PRODUCTION"');
    });

    it('should omit undefined optional fields', () => {
      const config: Config = {
        settings: {
          strict_mode: false,
          require_clean_git: true,
          show_migration_diff: true,
        },
        environments: {
          staging: {
            project_ref: undefined,
            git_branches: [],
            protected_operations: [],
            confirm_word: undefined,
            locked: undefined,
          },
        },
      };

      const toml = configToToml(config);

      expect(toml).toContain('[environments.staging]');
      expect(toml).not.toContain('project_ref');
      expect(toml).not.toContain('git_branches');
      expect(toml).not.toContain('protected_operations');
      expect(toml).not.toContain('confirm_word');
      expect(toml).not.toContain('locked');
    });

    it('should include multiple environments', () => {
      const config: Config = {
        settings: {
          strict_mode: false,
          require_clean_git: true,
          show_migration_diff: true,
        },
        environments: {
          staging: {
            project_ref: 'staging-ref',
            git_branches: ['develop'],
            protected_operations: ['reset'],
            confirm_word: undefined,
            locked: false,
          },
          production: {
            project_ref: 'prod-ref',
            git_branches: ['main'],
            protected_operations: ['push', 'reset'],
            confirm_word: 'production',
            locked: true,
          },
        },
      };

      const toml = configToToml(config);

      expect(toml).toContain('[environments.staging]');
      expect(toml).toContain('[environments.production]');
      expect(toml).toContain('project_ref = "staging-ref"');
      expect(toml).toContain('project_ref = "prod-ref"');
    });

    it('should include comments', () => {
      const config: Config = {
        settings: {
          strict_mode: true,
          require_clean_git: true,
          show_migration_diff: false,
        },
        environments: {},
      };

      const toml = configToToml(config);

      // Should have header comment
      expect(toml).toContain('# SupaControl Configuration');
      // Should have setting comments
      expect(toml).toContain('# Fail on any guard warning');
      expect(toml).toContain('# Require clean git working tree');
      expect(toml).toContain('# Show migration diff');
    });

    it('should end with newline', () => {
      const config: Config = {
        settings: {
          strict_mode: false,
          require_clean_git: true,
          show_migration_diff: true,
        },
        environments: {},
      };

      const toml = configToToml(config);

      expect(toml.endsWith('\n')).toBe(true);
      // But not double newline
      expect(toml.endsWith('\n\n')).toBe(false);
    });
  });

  describe('generateDefaultConfig', () => {
    it('should return config with default settings', () => {
      const config = generateDefaultConfig();

      expect(config.settings.strict_mode).toBe(false);
      expect(config.settings.require_clean_git).toBe(true);
      expect(config.settings.show_migration_diff).toBe(true);
    });

    it('should include staging and production environments', () => {
      const config = generateDefaultConfig();

      expect(config.environments.staging).toBeDefined();
      expect(config.environments.production).toBeDefined();
    });

    it('should have staging unlocked', () => {
      const config = generateDefaultConfig();

      expect(config.environments.staging?.locked).toBeUndefined();
    });

    it('should have production locked', () => {
      const config = generateDefaultConfig();

      expect(config.environments.production?.locked).toBe(true);
    });

    it('should have production protected operations', () => {
      const config = generateDefaultConfig();

      expect(config.environments.production?.protected_operations).toContain('push');
      expect(config.environments.production?.protected_operations).toContain('reset');
      expect(config.environments.production?.protected_operations).toContain('seed');
    });

    it('should have production confirm_word set', () => {
      const config = generateDefaultConfig();

      expect(config.environments.production?.confirm_word).toBe('production');
    });

    it('should have appropriate git branches', () => {
      const config = generateDefaultConfig();

      expect(config.environments.staging?.git_branches).toContain('develop');
      expect(config.environments.staging?.git_branches).toContain('staging');
      expect(config.environments.production?.git_branches).toContain('main');
      expect(config.environments.production?.git_branches).toContain('master');
    });
  });

  describe('generateExampleToml', () => {
    it('should generate valid TOML from default config', () => {
      const toml = generateExampleToml();

      expect(toml).toContain('[settings]');
      expect(toml).toContain('[environments.staging]');
      expect(toml).toContain('[environments.production]');
    });

    it('should be consistent with generateDefaultConfig', () => {
      const defaultConfig = generateDefaultConfig();
      const exampleToml = generateExampleToml();
      const directToml = configToToml(defaultConfig);

      expect(exampleToml).toBe(directToml);
    });
  });

  describe('configExists', () => {
    it('should return false when no config file exists', async () => {
      const exists = await configExists(testDir);

      expect(exists).toBe(false);
    });

    it('should return true when config file exists', async () => {
      await writeFile(join(testDir, 'supacontrol.toml'), '[settings]', 'utf-8');

      const exists = await configExists(testDir);

      expect(exists).toBe(true);
    });

    it('should use process.cwd() by default', async () => {
      // This tests the default behavior - just verify it doesn't throw
      const exists = await configExists();

      // May or may not exist depending on test environment
      expect(typeof exists).toBe('boolean');
    });
  });

  describe('writeConfig', () => {
    it('should write config to file', async () => {
      const config: Config = {
        settings: {
          strict_mode: true,
          require_clean_git: false,
          show_migration_diff: true,
        },
        environments: {},
      };

      const filePath = await writeConfig(config, testDir);

      expect(filePath).toBe(join(testDir, 'supacontrol.toml'));

      const content = await readFile(filePath, 'utf-8');
      expect(content).toContain('strict_mode = true');
      expect(content).toContain('require_clean_git = false');
    });

    it('should overwrite existing config', async () => {
      await writeFile(join(testDir, 'supacontrol.toml'), 'old content', 'utf-8');

      const config: Config = {
        settings: {
          strict_mode: false,
          require_clean_git: true,
          show_migration_diff: true,
        },
        environments: {},
      };

      await writeConfig(config, testDir);

      const content = await readFile(join(testDir, 'supacontrol.toml'), 'utf-8');
      expect(content).not.toContain('old content');
      expect(content).toContain('[settings]');
    });

    it('should write complete config with environments', async () => {
      const config: Config = {
        settings: {
          strict_mode: false,
          require_clean_git: true,
          show_migration_diff: true,
        },
        environments: {
          production: {
            project_ref: 'prod-123',
            git_branches: ['main'],
            protected_operations: ['push', 'reset'],
            confirm_word: 'production',
            locked: true,
          },
        },
      };

      await writeConfig(config, testDir);

      const content = await readFile(join(testDir, 'supacontrol.toml'), 'utf-8');
      expect(content).toContain('[environments.production]');
      expect(content).toContain('project_ref = "prod-123"');
      expect(content).toContain('locked = true');
    });

    it('should return the path to the written file', async () => {
      const config = generateDefaultConfig();

      const filePath = await writeConfig(config, testDir);

      expect(filePath).toContain('supacontrol.toml');
      expect(filePath).toContain(testDir);
    });
  });
});
