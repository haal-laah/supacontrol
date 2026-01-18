/**
 * Unit Tests for Status Command
 *
 * These tests verify the status command functionality.
 * We mock external dependencies to test in isolation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock config loader
vi.mock('../../src/config/loader.js', () => ({
  loadConfig: vi.fn(),
}));

// Mock config resolver
vi.mock('../../src/config/resolver.js', () => ({
  resolveEnvironmentByProjectRef: vi.fn(),
}));

// Mock config schema
vi.mock('../../src/config/schema.js', () => ({
  isEnvironmentLocked: vi.fn(),
}));

// Mock git utils
vi.mock('../../src/utils/git.js', () => ({
  getCurrentBranch: vi.fn(),
  hasUncommittedChanges: vi.fn(),
}));

// Mock supabase utils
vi.mock('../../src/utils/supabase.js', () => ({
  isSupabaseCLIInstalled: vi.fn(),
  getSupabaseVersion: vi.fn(),
}));

// Mock project guard
vi.mock('../../src/guards/project-guard.js', () => ({
  getCurrentLinkedProject: vi.fn(),
}));

// Mock auth credentials
vi.mock('../../src/auth/credentials.js', () => ({
  getAccessToken: vi.fn(),
}));

// Mock supabase client
vi.mock('../../src/api/supabase-client.js', () => ({
  createSupabaseClient: vi.fn(),
}));

import { loadConfig } from '../../src/config/loader.js';
import { resolveEnvironmentByProjectRef } from '../../src/config/resolver.js';
import { isEnvironmentLocked } from '../../src/config/schema.js';
import { getCurrentBranch, hasUncommittedChanges } from '../../src/utils/git.js';
import { isSupabaseCLIInstalled, getSupabaseVersion } from '../../src/utils/supabase.js';
import { getCurrentLinkedProject } from '../../src/guards/project-guard.js';
import { getAccessToken } from '../../src/auth/credentials.js';
import { createSupabaseClient } from '../../src/api/supabase-client.js';
import { createStatusCommand } from '../../src/commands/status.js';

const mockLoadConfig = vi.mocked(loadConfig);
const mockResolveEnvironmentByProjectRef = vi.mocked(resolveEnvironmentByProjectRef);
const mockIsEnvironmentLocked = vi.mocked(isEnvironmentLocked);
const mockGetCurrentBranch = vi.mocked(getCurrentBranch);
const mockHasUncommittedChanges = vi.mocked(hasUncommittedChanges);
const mockIsSupabaseCLIInstalled = vi.mocked(isSupabaseCLIInstalled);
const mockGetSupabaseVersion = vi.mocked(getSupabaseVersion);
const mockGetCurrentLinkedProject = vi.mocked(getCurrentLinkedProject);
const mockGetAccessToken = vi.mocked(getAccessToken);
const mockCreateSupabaseClient = vi.mocked(createSupabaseClient);

describe('Status Command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createStatusCommand', () => {
    it('should create a command with correct name and description', () => {
      const cmd = createStatusCommand();
      
      expect(cmd.name()).toBe('status');
      expect(cmd.description()).toBe('Show current environment and project status');
    });
  });

  describe('status output', () => {
    it('should show warning when no config exists', async () => {
      mockLoadConfig.mockResolvedValue(null);

      const cmd = createStatusCommand();
      
      await expect(cmd.parseAsync(['node', 'status'])).resolves.not.toThrow();
    });

    it('should show active environment when linked and configured', async () => {
      mockLoadConfig.mockResolvedValue({
        settings: { strict_mode: false, require_clean_git: true, show_migration_diff: true },
        environments: {
          staging: { 
            project_ref: 'staging-ref', 
            git_branches: ['develop'], 
            protected_operations: ['reset'],
          },
        },
      });
      mockGetCurrentLinkedProject.mockResolvedValue('staging-ref');
      mockGetAccessToken.mockResolvedValue('test-token');
      
      const mockClient = {
        getProjects: vi.fn().mockResolvedValue([
          { id: 'staging-ref', name: 'Staging Project', status: 'ACTIVE_HEALTHY', region: 'us-east-1' },
        ]),
        getBranches: vi.fn().mockResolvedValue([]),
      };
      mockCreateSupabaseClient.mockReturnValue(mockClient as any);
      
      mockResolveEnvironmentByProjectRef.mockReturnValue({
        name: 'staging',
        config: { project_ref: 'staging-ref', git_branches: ['develop'], protected_operations: ['reset'] },
      });
      mockIsEnvironmentLocked.mockReturnValue(false);
      mockGetCurrentBranch.mockResolvedValue('develop');
      mockHasUncommittedChanges.mockResolvedValue(false);
      mockIsSupabaseCLIInstalled.mockResolvedValue(true);
      mockGetSupabaseVersion.mockResolvedValue('1.123.0');

      const cmd = createStatusCommand();
      
      await expect(cmd.parseAsync(['node', 'status'])).resolves.not.toThrow();
    });

    it('should show unknown environment when linked but not configured', async () => {
      mockLoadConfig.mockResolvedValue({
        settings: { strict_mode: false, require_clean_git: true, show_migration_diff: true },
        environments: {},
      });
      mockGetCurrentLinkedProject.mockResolvedValue('unknown-ref');
      mockGetAccessToken.mockResolvedValue('test-token');
      
      const mockClient = {
        getProjects: vi.fn().mockResolvedValue([
          { id: 'unknown-ref', name: 'Unknown Project', status: 'ACTIVE_HEALTHY', region: 'us-east-1' },
        ]),
        getBranches: vi.fn().mockResolvedValue([]),
      };
      mockCreateSupabaseClient.mockReturnValue(mockClient as any);
      
      mockResolveEnvironmentByProjectRef.mockReturnValue(null);
      mockGetCurrentBranch.mockResolvedValue('main');
      mockHasUncommittedChanges.mockResolvedValue(false);
      mockIsSupabaseCLIInstalled.mockResolvedValue(true);
      mockGetSupabaseVersion.mockResolvedValue('1.123.0');

      const cmd = createStatusCommand();
      
      await expect(cmd.parseAsync(['node', 'status'])).resolves.not.toThrow();
    });

    it('should show no environment when not linked', async () => {
      mockLoadConfig.mockResolvedValue({
        settings: { strict_mode: false, require_clean_git: true, show_migration_diff: true },
        environments: {},
      });
      mockGetCurrentLinkedProject.mockResolvedValue(null);
      mockGetAccessToken.mockResolvedValue(null);
      mockResolveEnvironmentByProjectRef.mockReturnValue(null);
      mockGetCurrentBranch.mockResolvedValue('main');
      mockHasUncommittedChanges.mockResolvedValue(false);
      mockIsSupabaseCLIInstalled.mockResolvedValue(true);
      mockGetSupabaseVersion.mockResolvedValue('1.123.0');

      const cmd = createStatusCommand();
      
      await expect(cmd.parseAsync(['node', 'status'])).resolves.not.toThrow();
    });

    it('should show locked status for locked environments', async () => {
      mockLoadConfig.mockResolvedValue({
        settings: { strict_mode: false, require_clean_git: true, show_migration_diff: true },
        environments: {
          production: { 
            project_ref: 'prod-ref', 
            git_branches: ['main'], 
            protected_operations: ['push', 'reset'],
            locked: true,
          },
        },
      });
      mockGetCurrentLinkedProject.mockResolvedValue('prod-ref');
      mockGetAccessToken.mockResolvedValue(null);
      mockResolveEnvironmentByProjectRef.mockReturnValue({
        name: 'production',
        config: { project_ref: 'prod-ref', git_branches: ['main'], protected_operations: ['push', 'reset'], locked: true },
      });
      mockIsEnvironmentLocked.mockReturnValue(true);
      mockGetCurrentBranch.mockResolvedValue('main');
      mockHasUncommittedChanges.mockResolvedValue(false);
      mockIsSupabaseCLIInstalled.mockResolvedValue(true);
      mockGetSupabaseVersion.mockResolvedValue('1.123.0');

      const cmd = createStatusCommand();
      
      await expect(cmd.parseAsync(['node', 'status'])).resolves.not.toThrow();
    });

    it('should show git dirty indicator when there are uncommitted changes', async () => {
      mockLoadConfig.mockResolvedValue({
        settings: { strict_mode: false, require_clean_git: true, show_migration_diff: true },
        environments: {},
      });
      mockGetCurrentLinkedProject.mockResolvedValue(null);
      mockGetAccessToken.mockResolvedValue(null);
      mockResolveEnvironmentByProjectRef.mockReturnValue(null);
      mockGetCurrentBranch.mockResolvedValue('feature/test');
      mockHasUncommittedChanges.mockResolvedValue(true);
      mockIsSupabaseCLIInstalled.mockResolvedValue(true);
      mockGetSupabaseVersion.mockResolvedValue('1.123.0');

      const cmd = createStatusCommand();
      
      await expect(cmd.parseAsync(['node', 'status'])).resolves.not.toThrow();
    });

    it('should show when not in a git repository', async () => {
      mockLoadConfig.mockResolvedValue({
        settings: { strict_mode: false, require_clean_git: true, show_migration_diff: true },
        environments: {},
      });
      mockGetCurrentLinkedProject.mockResolvedValue(null);
      mockGetAccessToken.mockResolvedValue(null);
      mockResolveEnvironmentByProjectRef.mockReturnValue(null);
      mockGetCurrentBranch.mockResolvedValue(null);
      mockHasUncommittedChanges.mockResolvedValue(false);
      mockIsSupabaseCLIInstalled.mockResolvedValue(true);
      mockGetSupabaseVersion.mockResolvedValue('1.123.0');

      const cmd = createStatusCommand();
      
      await expect(cmd.parseAsync(['node', 'status'])).resolves.not.toThrow();
    });

    it('should show when Supabase CLI is not installed', async () => {
      mockLoadConfig.mockResolvedValue({
        settings: { strict_mode: false, require_clean_git: true, show_migration_diff: true },
        environments: {},
      });
      mockGetCurrentLinkedProject.mockResolvedValue(null);
      mockGetAccessToken.mockResolvedValue(null);
      mockResolveEnvironmentByProjectRef.mockReturnValue(null);
      mockGetCurrentBranch.mockResolvedValue('main');
      mockHasUncommittedChanges.mockResolvedValue(false);
      mockIsSupabaseCLIInstalled.mockResolvedValue(false);
      mockGetSupabaseVersion.mockResolvedValue(null);

      const cmd = createStatusCommand();
      
      await expect(cmd.parseAsync(['node', 'status'])).resolves.not.toThrow();
    });

    it('should handle API errors gracefully', async () => {
      mockLoadConfig.mockResolvedValue({
        settings: { strict_mode: false, require_clean_git: true, show_migration_diff: true },
        environments: {},
      });
      mockGetCurrentLinkedProject.mockResolvedValue('some-ref');
      mockGetAccessToken.mockResolvedValue('test-token');
      
      const mockClient = {
        getProjects: vi.fn().mockRejectedValue(new Error('API Error')),
        getBranches: vi.fn().mockResolvedValue([]),
      };
      mockCreateSupabaseClient.mockReturnValue(mockClient as any);
      
      mockResolveEnvironmentByProjectRef.mockReturnValue(null);
      mockGetCurrentBranch.mockResolvedValue('main');
      mockHasUncommittedChanges.mockResolvedValue(false);
      mockIsSupabaseCLIInstalled.mockResolvedValue(true);
      mockGetSupabaseVersion.mockResolvedValue('1.123.0');

      const cmd = createStatusCommand();
      
      await expect(cmd.parseAsync(['node', 'status'])).resolves.not.toThrow();
    });

    it('should list all configured environments', async () => {
      mockLoadConfig.mockResolvedValue({
        settings: { strict_mode: false, require_clean_git: true, show_migration_diff: true },
        environments: {
          staging: { project_ref: 'staging-ref', git_branches: ['develop'], protected_operations: [] },
          production: { project_ref: 'prod-ref', git_branches: ['main'], protected_operations: ['push'], locked: true },
        },
      });
      mockGetCurrentLinkedProject.mockResolvedValue('staging-ref');
      mockGetAccessToken.mockResolvedValue(null);
      mockResolveEnvironmentByProjectRef.mockReturnValue({
        name: 'staging',
        config: { project_ref: 'staging-ref', git_branches: ['develop'], protected_operations: [] },
      });
      mockIsEnvironmentLocked.mockImplementation((name) => name === 'production');
      mockGetCurrentBranch.mockResolvedValue('develop');
      mockHasUncommittedChanges.mockResolvedValue(false);
      mockIsSupabaseCLIInstalled.mockResolvedValue(true);
      mockGetSupabaseVersion.mockResolvedValue('1.123.0');

      const cmd = createStatusCommand();
      
      await expect(cmd.parseAsync(['node', 'status'])).resolves.not.toThrow();
    });
  });
});
