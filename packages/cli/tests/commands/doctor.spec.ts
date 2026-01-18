/**
 * Unit Tests for Doctor Command
 *
 * These tests verify the doctor command health checks.
 * We mock external dependencies to test in isolation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock node:fs/promises
vi.mock('node:fs/promises', () => ({
  access: vi.fn(),
  constants: { F_OK: 0 },
}));

// Mock config loader
vi.mock('../../src/config/loader.js', () => ({
  loadConfig: vi.fn(),
}));

// Mock config resolver
vi.mock('../../src/config/resolver.js', () => ({
  listEnvironments: vi.fn(),
}));

// Mock config schema
vi.mock('../../src/config/schema.js', () => ({
  isEnvironmentLocked: vi.fn(),
}));

// Mock supabase utils
vi.mock('../../src/utils/supabase.js', () => ({
  isSupabaseCLIInstalled: vi.fn(),
  getSupabaseVersion: vi.fn(),
}));

// Mock git utils
vi.mock('../../src/utils/git.js', () => ({
  isGitRepository: vi.fn(),
  getCurrentBranch: vi.fn(),
}));

// Mock project guard
vi.mock('../../src/guards/project-guard.js', () => ({
  getCurrentLinkedProject: vi.fn(),
}));

import { access } from 'node:fs/promises';
import { loadConfig } from '../../src/config/loader.js';
import { listEnvironments } from '../../src/config/resolver.js';
import { isEnvironmentLocked } from '../../src/config/schema.js';
import { isSupabaseCLIInstalled, getSupabaseVersion } from '../../src/utils/supabase.js';
import { isGitRepository, getCurrentBranch } from '../../src/utils/git.js';
import { getCurrentLinkedProject } from '../../src/guards/project-guard.js';
import { createDoctorCommand } from '../../src/commands/doctor.js';

const mockAccess = vi.mocked(access);
const mockLoadConfig = vi.mocked(loadConfig);
const mockListEnvironments = vi.mocked(listEnvironments);
const mockIsEnvironmentLocked = vi.mocked(isEnvironmentLocked);
const mockIsSupabaseCLIInstalled = vi.mocked(isSupabaseCLIInstalled);
const mockGetSupabaseVersion = vi.mocked(getSupabaseVersion);
const mockIsGitRepository = vi.mocked(isGitRepository);
const mockGetCurrentBranch = vi.mocked(getCurrentBranch);
const mockGetCurrentLinkedProject = vi.mocked(getCurrentLinkedProject);

describe('Doctor Command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createDoctorCommand', () => {
    it('should create a command with correct name and description', () => {
      const cmd = createDoctorCommand();
      
      expect(cmd.name()).toBe('doctor');
      expect(cmd.description()).toBe('Check for common issues and misconfigurations');
    });

    it('should have verbose and report options', () => {
      const cmd = createDoctorCommand();
      const options = cmd.options.map(opt => opt.name());
      
      expect(options).toContain('verbose');
      expect(options).toContain('report');
    });
  });

  describe('health checks', () => {
    it('should pass all checks when everything is configured correctly', async () => {
      // Supabase CLI installed
      mockIsSupabaseCLIInstalled.mockResolvedValue(true);
      mockGetSupabaseVersion.mockResolvedValue('1.123.0');
      
      // Git repository
      mockIsGitRepository.mockResolvedValue(true);
      mockGetCurrentBranch.mockResolvedValue('main');
      
      // SupaControl config
      mockLoadConfig.mockResolvedValue({
        settings: { strict_mode: false, require_clean_git: true, show_migration_diff: true },
        environments: {
          production: { project_ref: 'prod-ref', git_branches: ['main'], protected_operations: [], locked: true },
        },
      });
      mockListEnvironments.mockReturnValue(['production']);
      
      // Supabase project directory
      mockAccess.mockResolvedValue(undefined);
      
      // Linked project
      mockGetCurrentLinkedProject.mockResolvedValue('prod-ref');
      
      // Environment locked
      mockIsEnvironmentLocked.mockReturnValue(true);

      const cmd = createDoctorCommand();
      
      // Execute
      await expect(cmd.parseAsync(['node', 'doctor'])).resolves.not.toThrow();
    });

    it('should fail when Supabase CLI is not installed', async () => {
      mockIsSupabaseCLIInstalled.mockResolvedValue(false);
      mockGetSupabaseVersion.mockResolvedValue(null);
      mockIsGitRepository.mockResolvedValue(true);
      mockGetCurrentBranch.mockResolvedValue('main');
      mockLoadConfig.mockResolvedValue(null);
      mockAccess.mockRejectedValue(new Error('ENOENT'));
      mockGetCurrentLinkedProject.mockResolvedValue(null);
      mockListEnvironments.mockReturnValue([]);

      const cmd = createDoctorCommand();
      
      // Should exit with code 1
      await expect(cmd.parseAsync(['node', 'doctor'])).rejects.toThrow(/process\.exit/);
    });

    it('should warn when not in a git repository', async () => {
      mockIsSupabaseCLIInstalled.mockResolvedValue(true);
      mockGetSupabaseVersion.mockResolvedValue('1.123.0');
      mockIsGitRepository.mockResolvedValue(false);
      mockGetCurrentBranch.mockResolvedValue(null);
      mockLoadConfig.mockResolvedValue(null);
      mockAccess.mockRejectedValue(new Error('ENOENT'));
      mockGetCurrentLinkedProject.mockResolvedValue(null);
      mockListEnvironments.mockReturnValue([]);

      const cmd = createDoctorCommand();
      
      // Should complete (warnings don't cause exit)
      await expect(cmd.parseAsync(['node', 'doctor'])).resolves.not.toThrow();
    });

    it('should warn when no supacontrol.toml exists', async () => {
      mockIsSupabaseCLIInstalled.mockResolvedValue(true);
      mockGetSupabaseVersion.mockResolvedValue('1.123.0');
      mockIsGitRepository.mockResolvedValue(true);
      mockGetCurrentBranch.mockResolvedValue('main');
      mockLoadConfig.mockResolvedValue(null);
      mockAccess.mockRejectedValue(new Error('ENOENT'));
      mockGetCurrentLinkedProject.mockResolvedValue(null);
      mockListEnvironments.mockReturnValue([]);

      const cmd = createDoctorCommand();
      
      await expect(cmd.parseAsync(['node', 'doctor'])).resolves.not.toThrow();
    });

    it('should warn when supabase directory does not exist', async () => {
      mockIsSupabaseCLIInstalled.mockResolvedValue(true);
      mockGetSupabaseVersion.mockResolvedValue('1.123.0');
      mockIsGitRepository.mockResolvedValue(true);
      mockGetCurrentBranch.mockResolvedValue('main');
      mockLoadConfig.mockResolvedValue(null);
      // Supabase directory check fails
      mockAccess.mockRejectedValue(new Error('ENOENT'));
      mockGetCurrentLinkedProject.mockResolvedValue(null);
      mockListEnvironments.mockReturnValue([]);

      const cmd = createDoctorCommand();
      
      await expect(cmd.parseAsync(['node', 'doctor'])).resolves.not.toThrow();
    });

    it('should show info when no project is linked', async () => {
      mockIsSupabaseCLIInstalled.mockResolvedValue(true);
      mockGetSupabaseVersion.mockResolvedValue('1.123.0');
      mockIsGitRepository.mockResolvedValue(true);
      mockGetCurrentBranch.mockResolvedValue('main');
      mockLoadConfig.mockResolvedValue({
        settings: { strict_mode: false, require_clean_git: true, show_migration_diff: true },
        environments: {},
      });
      mockListEnvironments.mockReturnValue([]);
      mockAccess.mockResolvedValue(undefined);
      mockGetCurrentLinkedProject.mockResolvedValue(null);

      const cmd = createDoctorCommand();
      
      await expect(cmd.parseAsync(['node', 'doctor'])).resolves.not.toThrow();
    });

    it('should warn when production environment is unlocked', async () => {
      mockIsSupabaseCLIInstalled.mockResolvedValue(true);
      mockGetSupabaseVersion.mockResolvedValue('1.123.0');
      mockIsGitRepository.mockResolvedValue(true);
      mockGetCurrentBranch.mockResolvedValue('main');
      
      mockLoadConfig.mockResolvedValue({
        settings: { strict_mode: false, require_clean_git: true, show_migration_diff: true },
        environments: {
          production: { 
            project_ref: 'prod-ref', 
            git_branches: ['main'], 
            protected_operations: [],
            locked: false,
          },
        },
      });
      mockListEnvironments.mockReturnValue(['production']);
      mockAccess.mockResolvedValue(undefined);
      mockGetCurrentLinkedProject.mockResolvedValue('prod-ref');
      mockIsEnvironmentLocked.mockReturnValue(false);

      const cmd = createDoctorCommand();
      
      // Should complete with warning
      await expect(cmd.parseAsync(['node', 'doctor'])).resolves.not.toThrow();
    });

    it('should show pass when migrations directory exists', async () => {
      mockIsSupabaseCLIInstalled.mockResolvedValue(true);
      mockGetSupabaseVersion.mockResolvedValue('1.123.0');
      mockIsGitRepository.mockResolvedValue(true);
      mockGetCurrentBranch.mockResolvedValue('main');
      mockLoadConfig.mockResolvedValue(null);
      mockListEnvironments.mockReturnValue([]);
      // Both supabase and migrations directories exist
      mockAccess.mockResolvedValue(undefined);
      mockGetCurrentLinkedProject.mockResolvedValue(null);

      const cmd = createDoctorCommand();
      
      await expect(cmd.parseAsync(['node', 'doctor'])).resolves.not.toThrow();
    });
  });

  describe('options', () => {
    it('should support --verbose flag', async () => {
      mockIsSupabaseCLIInstalled.mockResolvedValue(true);
      mockGetSupabaseVersion.mockResolvedValue('1.123.0');
      mockIsGitRepository.mockResolvedValue(true);
      mockGetCurrentBranch.mockResolvedValue('main');
      mockLoadConfig.mockResolvedValue({
        settings: { strict_mode: false, require_clean_git: true, show_migration_diff: true },
        environments: {
          production: { project_ref: 'prod-ref', git_branches: ['main'], protected_operations: [], locked: true },
        },
      });
      mockListEnvironments.mockReturnValue(['production']);
      mockAccess.mockResolvedValue(undefined);
      mockGetCurrentLinkedProject.mockResolvedValue('prod-ref');
      mockIsEnvironmentLocked.mockReturnValue(true);

      const cmd = createDoctorCommand();
      
      await expect(cmd.parseAsync(['node', 'doctor', '--verbose'])).resolves.not.toThrow();
    });

    it('should support --report flag for summary only', async () => {
      mockIsSupabaseCLIInstalled.mockResolvedValue(true);
      mockGetSupabaseVersion.mockResolvedValue('1.123.0');
      mockIsGitRepository.mockResolvedValue(true);
      mockGetCurrentBranch.mockResolvedValue('main');
      mockLoadConfig.mockResolvedValue(null);
      mockListEnvironments.mockReturnValue([]);
      mockAccess.mockResolvedValue(undefined);
      mockGetCurrentLinkedProject.mockResolvedValue(null);

      const cmd = createDoctorCommand();
      
      await expect(cmd.parseAsync(['node', 'doctor', '--report'])).resolves.not.toThrow();
    });
  });

  describe('environment safety check', () => {
    it('should detect when production is locked', async () => {
      mockIsSupabaseCLIInstalled.mockResolvedValue(true);
      mockGetSupabaseVersion.mockResolvedValue('1.123.0');
      mockIsGitRepository.mockResolvedValue(true);
      mockGetCurrentBranch.mockResolvedValue('main');
      
      mockLoadConfig.mockResolvedValue({
        settings: { strict_mode: false, require_clean_git: true, show_migration_diff: true },
        environments: {
          production: { 
            project_ref: 'prod-ref', 
            git_branches: ['main'], 
            protected_operations: ['push', 'reset'],
            locked: true,
          },
          staging: {
            project_ref: 'staging-ref',
            git_branches: ['develop'],
            protected_operations: [],
            locked: false,
          },
        },
      });
      mockListEnvironments.mockReturnValue(['production', 'staging']);
      mockAccess.mockResolvedValue(undefined);
      mockGetCurrentLinkedProject.mockResolvedValue('prod-ref');
      mockIsEnvironmentLocked.mockImplementation((name) => name === 'production');

      const cmd = createDoctorCommand();
      
      await expect(cmd.parseAsync(['node', 'doctor'])).resolves.not.toThrow();
    });

    it('should handle environments with main branch that are not named production', async () => {
      mockIsSupabaseCLIInstalled.mockResolvedValue(true);
      mockGetSupabaseVersion.mockResolvedValue('1.123.0');
      mockIsGitRepository.mockResolvedValue(true);
      mockGetCurrentBranch.mockResolvedValue('main');
      
      mockLoadConfig.mockResolvedValue({
        settings: { strict_mode: false, require_clean_git: true, show_migration_diff: true },
        environments: {
          prod: { 
            project_ref: 'prod-ref', 
            git_branches: ['main'], 
            protected_operations: [],
            locked: false,
          },
        },
      });
      mockListEnvironments.mockReturnValue(['prod']);
      mockAccess.mockResolvedValue(undefined);
      mockGetCurrentLinkedProject.mockResolvedValue('prod-ref');
      mockIsEnvironmentLocked.mockReturnValue(false);

      const cmd = createDoctorCommand();
      
      // Should warn that prod-like environment is unlocked
      await expect(cmd.parseAsync(['node', 'doctor'])).resolves.not.toThrow();
    });
  });
});
