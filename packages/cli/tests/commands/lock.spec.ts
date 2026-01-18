/**
 * Unit Tests for Lock/Unlock Commands
 *
 * These tests verify the lock and unlock command functionality.
 * We mock external dependencies to test in isolation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock config loader
vi.mock('../../src/config/loader.js', () => ({
  loadConfig: vi.fn(),
  loadConfigOrExit: vi.fn(),
}));

// Mock config resolver
vi.mock('../../src/config/resolver.js', () => ({
  resolveEnvironmentByProjectRef: vi.fn(),
  getEnvironmentByName: vi.fn(),
  listEnvironments: vi.fn(),
}));

// Mock config schema
vi.mock('../../src/config/schema.js', () => ({
  isEnvironmentLocked: vi.fn(),
}));

// Mock config writer
vi.mock('../../src/config/writer.js', () => ({
  writeConfig: vi.fn(),
}));

// Mock git utils
vi.mock('../../src/utils/git.js', () => ({
  clearGitCache: vi.fn(),
}));

// Mock project guard
vi.mock('../../src/guards/project-guard.js', () => ({
  getCurrentLinkedProject: vi.fn(),
  clearProjectCache: vi.fn(),
}));

// Mock @clack/prompts
vi.mock('@clack/prompts', () => ({
  note: vi.fn(),
  confirm: vi.fn(),
  isCancel: vi.fn((value) => value === Symbol.for('cancel')),
  cancel: vi.fn(),
}));

import { loadConfig, loadConfigOrExit } from '../../src/config/loader.js';
import { resolveEnvironmentByProjectRef, getEnvironmentByName, listEnvironments } from '../../src/config/resolver.js';
import { isEnvironmentLocked } from '../../src/config/schema.js';
import { writeConfig } from '../../src/config/writer.js';
import { getCurrentLinkedProject } from '../../src/guards/project-guard.js';
import * as p from '@clack/prompts';
import { createLockCommand, createUnlockCommand } from '../../src/commands/lock.js';

const mockLoadConfig = vi.mocked(loadConfig);
const mockLoadConfigOrExit = vi.mocked(loadConfigOrExit);
const mockResolveEnvironmentByProjectRef = vi.mocked(resolveEnvironmentByProjectRef);
const mockGetEnvironmentByName = vi.mocked(getEnvironmentByName);
const mockListEnvironments = vi.mocked(listEnvironments);
const mockIsEnvironmentLocked = vi.mocked(isEnvironmentLocked);
const mockWriteConfig = vi.mocked(writeConfig);
const mockGetCurrentLinkedProject = vi.mocked(getCurrentLinkedProject);
const mockConfirm = vi.mocked(p.confirm);

describe('Lock Command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createLockCommand', () => {
    it('should create a command with correct name and description', () => {
      const cmd = createLockCommand();
      
      expect(cmd.name()).toBe('lock');
      expect(cmd.description()).toContain('Lock an environment');
    });
  });

  describe('lock execution', () => {
    it('should lock environment by name', async () => {
      const config = {
        settings: { strict_mode: false, require_clean_git: true, show_migration_diff: true },
        environments: {
          staging: { project_ref: 'staging-ref', git_branches: ['develop'], protected_operations: [], locked: false },
        },
      };
      mockLoadConfigOrExit.mockResolvedValue(config);
      mockGetEnvironmentByName.mockReturnValue({
        name: 'staging',
        config: config.environments.staging,
      });
      mockIsEnvironmentLocked.mockReturnValue(false);
      mockWriteConfig.mockResolvedValue(undefined);

      const cmd = createLockCommand();
      
      await expect(cmd.parseAsync(['node', 'lock', 'staging'])).resolves.not.toThrow();
      
      expect(mockWriteConfig).toHaveBeenCalled();
      expect(config.environments.staging.locked).toBe(true);
    });

    it('should do nothing if already locked', async () => {
      const config = {
        settings: { strict_mode: false, require_clean_git: true, show_migration_diff: true },
        environments: {
          staging: { project_ref: 'staging-ref', git_branches: ['develop'], protected_operations: [], locked: true },
        },
      };
      mockLoadConfigOrExit.mockResolvedValue(config);
      mockGetEnvironmentByName.mockReturnValue({
        name: 'staging',
        config: config.environments.staging,
      });
      mockIsEnvironmentLocked.mockReturnValue(true);

      const cmd = createLockCommand();
      
      await expect(cmd.parseAsync(['node', 'lock', 'staging'])).resolves.not.toThrow();
      
      // Should not write config
      expect(mockWriteConfig).not.toHaveBeenCalled();
    });

    it('should lock current environment when no argument', async () => {
      const config = {
        settings: { strict_mode: false, require_clean_git: true, show_migration_diff: true },
        environments: {
          staging: { project_ref: 'staging-ref', git_branches: ['develop'], protected_operations: [], locked: false },
        },
      };
      mockLoadConfigOrExit.mockResolvedValue(config);
      mockLoadConfig.mockResolvedValue(config);
      mockGetCurrentLinkedProject.mockResolvedValue('staging-ref');
      mockResolveEnvironmentByProjectRef.mockReturnValue({
        name: 'staging',
        config: config.environments.staging,
      });
      mockIsEnvironmentLocked.mockReturnValue(false);
      mockWriteConfig.mockResolvedValue(undefined);

      const cmd = createLockCommand();
      
      await expect(cmd.parseAsync(['node', 'lock'])).resolves.not.toThrow();
      
      expect(mockWriteConfig).toHaveBeenCalled();
    });

    it('should fail when environment not found', async () => {
      const config = {
        settings: { strict_mode: false, require_clean_git: true, show_migration_diff: true },
        environments: {},
      };
      mockLoadConfigOrExit.mockResolvedValue(config);
      mockLoadConfig.mockResolvedValue(config);
      mockGetEnvironmentByName.mockReturnValue(null);
      mockListEnvironments.mockReturnValue([]);

      const cmd = createLockCommand();
      
      await expect(cmd.parseAsync(['node', 'lock', 'nonexistent'])).rejects.toThrow(/process\.exit/);
    });

    it('should fail when no project linked and no argument', async () => {
      const config = {
        settings: { strict_mode: false, require_clean_git: true, show_migration_diff: true },
        environments: {},
      };
      mockLoadConfigOrExit.mockResolvedValue(config);
      mockLoadConfig.mockResolvedValue(config);
      mockGetCurrentLinkedProject.mockResolvedValue(null);

      const cmd = createLockCommand();
      
      await expect(cmd.parseAsync(['node', 'lock'])).rejects.toThrow(/process\.exit/);
    });
  });
});

describe('Unlock Command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createUnlockCommand', () => {
    it('should create a command with correct name and description', () => {
      const cmd = createUnlockCommand();
      
      expect(cmd.name()).toBe('unlock');
      expect(cmd.description()).toContain('Unlock an environment');
    });
  });

  describe('unlock execution', () => {
    it('should unlock environment by name', async () => {
      const config = {
        settings: { strict_mode: false, require_clean_git: true, show_migration_diff: true },
        environments: {
          staging: { project_ref: 'staging-ref', git_branches: ['develop'], protected_operations: [], locked: true },
        },
      };
      mockLoadConfigOrExit.mockResolvedValue(config);
      mockGetEnvironmentByName.mockReturnValue({
        name: 'staging',
        config: config.environments.staging,
      });
      mockIsEnvironmentLocked.mockReturnValue(true);
      mockWriteConfig.mockResolvedValue(undefined);

      const cmd = createUnlockCommand();
      
      await expect(cmd.parseAsync(['node', 'unlock', 'staging'])).resolves.not.toThrow();
      
      expect(mockWriteConfig).toHaveBeenCalled();
      expect(config.environments.staging.locked).toBe(false);
    });

    it('should do nothing if already unlocked', async () => {
      const config = {
        settings: { strict_mode: false, require_clean_git: true, show_migration_diff: true },
        environments: {
          staging: { project_ref: 'staging-ref', git_branches: ['develop'], protected_operations: [], locked: false },
        },
      };
      mockLoadConfigOrExit.mockResolvedValue(config);
      mockGetEnvironmentByName.mockReturnValue({
        name: 'staging',
        config: config.environments.staging,
      });
      mockIsEnvironmentLocked.mockReturnValue(false);

      const cmd = createUnlockCommand();
      
      await expect(cmd.parseAsync(['node', 'unlock', 'staging'])).resolves.not.toThrow();
      
      // Should not write config
      expect(mockWriteConfig).not.toHaveBeenCalled();
    });

    it('should require confirmation for production unlock', async () => {
      const config = {
        settings: { strict_mode: false, require_clean_git: true, show_migration_diff: true },
        environments: {
          production: { project_ref: 'prod-ref', git_branches: ['main'], protected_operations: [], locked: true },
        },
      };
      mockLoadConfigOrExit.mockResolvedValue(config);
      mockGetEnvironmentByName.mockReturnValue({
        name: 'production',
        config: config.environments.production,
      });
      mockIsEnvironmentLocked.mockReturnValue(true);
      mockConfirm.mockResolvedValue(true);
      mockWriteConfig.mockResolvedValue(undefined);

      const cmd = createUnlockCommand();
      
      await expect(cmd.parseAsync(['node', 'unlock', 'production'])).resolves.not.toThrow();
      
      expect(mockConfirm).toHaveBeenCalled();
      expect(mockWriteConfig).toHaveBeenCalled();
    });

    it('should cancel when user declines production unlock', async () => {
      const config = {
        settings: { strict_mode: false, require_clean_git: true, show_migration_diff: true },
        environments: {
          production: { project_ref: 'prod-ref', git_branches: ['main'], protected_operations: [], locked: true },
        },
      };
      mockLoadConfigOrExit.mockResolvedValue(config);
      mockGetEnvironmentByName.mockReturnValue({
        name: 'production',
        config: config.environments.production,
      });
      mockIsEnvironmentLocked.mockReturnValue(true);
      mockConfirm.mockResolvedValue(false);

      const cmd = createUnlockCommand();
      
      await expect(cmd.parseAsync(['node', 'unlock', 'production'])).rejects.toThrow(/process\.exit/);
      
      expect(mockWriteConfig).not.toHaveBeenCalled();
    });

    it('should unlock current environment when no argument', async () => {
      const config = {
        settings: { strict_mode: false, require_clean_git: true, show_migration_diff: true },
        environments: {
          staging: { project_ref: 'staging-ref', git_branches: ['develop'], protected_operations: [], locked: true },
        },
      };
      mockLoadConfigOrExit.mockResolvedValue(config);
      mockLoadConfig.mockResolvedValue(config);
      mockGetCurrentLinkedProject.mockResolvedValue('staging-ref');
      mockResolveEnvironmentByProjectRef.mockReturnValue({
        name: 'staging',
        config: config.environments.staging,
      });
      mockIsEnvironmentLocked.mockReturnValue(true);
      mockWriteConfig.mockResolvedValue(undefined);

      const cmd = createUnlockCommand();
      
      await expect(cmd.parseAsync(['node', 'unlock'])).resolves.not.toThrow();
      
      expect(mockWriteConfig).toHaveBeenCalled();
    });

    it('should detect production-like environments by main branch', async () => {
      const config = {
        settings: { strict_mode: false, require_clean_git: true, show_migration_diff: true },
        environments: {
          prod: { project_ref: 'prod-ref', git_branches: ['main'], protected_operations: [], locked: true },
        },
      };
      mockLoadConfigOrExit.mockResolvedValue(config);
      mockGetEnvironmentByName.mockReturnValue({
        name: 'prod',
        config: config.environments.prod,
      });
      mockIsEnvironmentLocked.mockReturnValue(true);
      mockConfirm.mockResolvedValue(true);
      mockWriteConfig.mockResolvedValue(undefined);

      const cmd = createUnlockCommand();
      
      await expect(cmd.parseAsync(['node', 'unlock', 'prod'])).resolves.not.toThrow();
      
      // Should require confirmation because it has 'main' branch
      expect(mockConfirm).toHaveBeenCalled();
    });
  });
});
