/**
 * Unit Tests for Push Command
 *
 * These tests verify the push command functionality.
 * We mock external dependencies to test in isolation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock config loader
vi.mock('../../src/config/loader.js', () => ({
  loadConfigOrExit: vi.fn(),
}));

// Mock config resolver
vi.mock('../../src/config/resolver.js', () => ({
  resolveEnvironmentByProjectRef: vi.fn(),
  getEnvironmentByName: vi.fn(),
}));

// Mock git utils
vi.mock('../../src/utils/git.js', () => ({
  getCurrentBranch: vi.fn(),
  hasUncommittedChanges: vi.fn(),
  clearGitCache: vi.fn(),
}));

// Mock supabase utils
vi.mock('../../src/utils/supabase.js', () => ({
  runSupabase: vi.fn(),
  requireSupabaseCLI: vi.fn(),
}));

// Mock migrations utils
vi.mock('../../src/utils/migrations.js', () => ({
  interactiveMigrationSync: vi.fn(),
}));

// Mock guards
vi.mock('../../src/guards/index.js', () => ({
  runGuards: vi.fn(),
  buildGuardContext: vi.fn(),
  clearProjectCache: vi.fn(),
  getCurrentLinkedProject: vi.fn(),
}));

import { loadConfigOrExit } from '../../src/config/loader.js';
import { resolveEnvironmentByProjectRef, getEnvironmentByName } from '../../src/config/resolver.js';
import { getCurrentBranch, hasUncommittedChanges } from '../../src/utils/git.js';
import { runSupabase, requireSupabaseCLI } from '../../src/utils/supabase.js';
import { interactiveMigrationSync } from '../../src/utils/migrations.js';
import { runGuards, buildGuardContext, getCurrentLinkedProject } from '../../src/guards/index.js';
import { createPushCommand } from '../../src/commands/push.js';

const mockLoadConfigOrExit = vi.mocked(loadConfigOrExit);
const mockResolveEnvironmentByProjectRef = vi.mocked(resolveEnvironmentByProjectRef);
const _mockGetEnvironmentByName = vi.mocked(getEnvironmentByName);
const mockGetCurrentBranch = vi.mocked(getCurrentBranch);
const mockHasUncommittedChanges = vi.mocked(hasUncommittedChanges);
const mockRunSupabase = vi.mocked(runSupabase);
const mockRequireSupabaseCLI = vi.mocked(requireSupabaseCLI);
const mockInteractiveMigrationSync = vi.mocked(interactiveMigrationSync);
const mockRunGuards = vi.mocked(runGuards);
const mockBuildGuardContext = vi.mocked(buildGuardContext);
const mockGetCurrentLinkedProject = vi.mocked(getCurrentLinkedProject);

describe('Push Command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireSupabaseCLI.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createPushCommand', () => {
    it('should create a command with correct name and description', () => {
      const cmd = createPushCommand();
      
      expect(cmd.name()).toBe('push');
      expect(cmd.description()).toContain('Push local migrations');
    });

    it('should have force and dry-run options', () => {
      const cmd = createPushCommand();
      const options = cmd.options.map(opt => opt.name());
      
      expect(options).toContain('force');
      expect(options).toContain('dry-run');
      expect(options).toContain('i-know-what-im-doing');
    });
  });

  describe('push execution', () => {
    it('should fail when no project is linked', async () => {
      mockLoadConfigOrExit.mockResolvedValue({
        settings: { strict_mode: false, require_clean_git: true, show_migration_diff: true },
        environments: {},
      });
      mockGetCurrentBranch.mockResolvedValue('main');
      mockHasUncommittedChanges.mockResolvedValue(false);
      mockGetCurrentLinkedProject.mockResolvedValue(null);

      const cmd = createPushCommand();
      
      await expect(cmd.parseAsync(['node', 'push'])).rejects.toThrow(/process\.exit/);
    });

    it('should fail when linked project is not configured', async () => {
      mockLoadConfigOrExit.mockResolvedValue({
        settings: { strict_mode: false, require_clean_git: true, show_migration_diff: true },
        environments: {},
      });
      mockGetCurrentBranch.mockResolvedValue('main');
      mockHasUncommittedChanges.mockResolvedValue(false);
      mockGetCurrentLinkedProject.mockResolvedValue('unknown-ref');
      mockResolveEnvironmentByProjectRef.mockReturnValue(null);

      const cmd = createPushCommand();
      
      await expect(cmd.parseAsync(['node', 'push'])).rejects.toThrow(/process\.exit/);
    });

    it('should resolve environment from linked project', async () => {
      mockLoadConfigOrExit.mockResolvedValue({
        settings: { strict_mode: false, require_clean_git: true, show_migration_diff: false },
        environments: {
          staging: { project_ref: 'staging-ref', git_branches: ['develop'], protected_operations: [] },
        },
      });
      mockGetCurrentBranch.mockResolvedValue('develop');
      mockHasUncommittedChanges.mockResolvedValue(false);
      mockGetCurrentLinkedProject.mockResolvedValue('staging-ref');
      mockResolveEnvironmentByProjectRef.mockReturnValue({
        name: 'staging',
        config: { project_ref: 'staging-ref', git_branches: ['develop'], protected_operations: [] },
      });
      mockBuildGuardContext.mockReturnValue({} as any);
      mockRunGuards.mockResolvedValue({ allowed: true, cancelled: false, requiresConfirmation: false });
      mockInteractiveMigrationSync.mockResolvedValue({ success: true });
      mockRunSupabase.mockResolvedValue({ success: true, exitCode: 0, stdout: '', stderr: '' });

      const cmd = createPushCommand();
      
      await expect(cmd.parseAsync(['node', 'push'])).resolves.not.toThrow();
    });

    it('should fail when environment not found for linked project', async () => {
      mockLoadConfigOrExit.mockResolvedValue({
        settings: { strict_mode: false, require_clean_git: true, show_migration_diff: true },
        environments: {},
      });
      mockGetCurrentBranch.mockResolvedValue('main');
      mockHasUncommittedChanges.mockResolvedValue(false);
      mockGetCurrentLinkedProject.mockResolvedValue('unknown-ref');
      mockResolveEnvironmentByProjectRef.mockReturnValue(null);

      const cmd = createPushCommand();
      
      await expect(cmd.parseAsync(['node', 'push'])).rejects.toThrow(/process\.exit/);
    });

    it('should run migration sync before push', async () => {
      mockLoadConfigOrExit.mockResolvedValue({
        settings: { strict_mode: false, require_clean_git: true, show_migration_diff: false },
        environments: {
          staging: { project_ref: 'staging-ref', git_branches: ['develop'], protected_operations: [] },
        },
      });
      mockGetCurrentBranch.mockResolvedValue('develop');
      mockHasUncommittedChanges.mockResolvedValue(false);
      mockGetCurrentLinkedProject.mockResolvedValue('staging-ref');
      mockResolveEnvironmentByProjectRef.mockReturnValue({
        name: 'staging',
        config: { project_ref: 'staging-ref', git_branches: ['develop'], protected_operations: [] },
      });
      mockBuildGuardContext.mockReturnValue({} as any);
      mockRunGuards.mockResolvedValue({ allowed: true, cancelled: false, requiresConfirmation: false });
      mockInteractiveMigrationSync.mockResolvedValue({ success: true });
      mockRunSupabase.mockResolvedValue({ success: true, exitCode: 0, stdout: '', stderr: '' });

      const cmd = createPushCommand();
      
      await expect(cmd.parseAsync(['node', 'push'])).resolves.not.toThrow();
      
      expect(mockInteractiveMigrationSync).toHaveBeenCalled();
    });

    it('should fail when migration sync fails', async () => {
      mockLoadConfigOrExit.mockResolvedValue({
        settings: { strict_mode: false, require_clean_git: true, show_migration_diff: false },
        environments: {
          staging: { project_ref: 'staging-ref', git_branches: ['develop'], protected_operations: [] },
        },
      });
      mockGetCurrentBranch.mockResolvedValue('develop');
      mockHasUncommittedChanges.mockResolvedValue(false);
      mockGetCurrentLinkedProject.mockResolvedValue('staging-ref');
      mockResolveEnvironmentByProjectRef.mockReturnValue({
        name: 'staging',
        config: { project_ref: 'staging-ref', git_branches: ['develop'], protected_operations: [] },
      });
      mockBuildGuardContext.mockReturnValue({} as any);
      mockRunGuards.mockResolvedValue({ allowed: true, cancelled: false, requiresConfirmation: false });
      mockInteractiveMigrationSync.mockResolvedValue({ success: false });

      const cmd = createPushCommand();
      
      await expect(cmd.parseAsync(['node', 'push'])).rejects.toThrow(/process\.exit/);
    });

    it('should bypass guards and sync with --force flag', async () => {
      mockLoadConfigOrExit.mockResolvedValue({
        settings: { strict_mode: false, require_clean_git: true, show_migration_diff: false },
        environments: {
          staging: { project_ref: 'staging-ref', git_branches: ['develop'], protected_operations: [] },
        },
      });
      mockGetCurrentBranch.mockResolvedValue('develop');
      mockHasUncommittedChanges.mockResolvedValue(false);
      mockGetCurrentLinkedProject.mockResolvedValue('staging-ref');
      mockResolveEnvironmentByProjectRef.mockReturnValue({
        name: 'staging',
        config: { project_ref: 'staging-ref', git_branches: ['develop'], protected_operations: [] },
      });
      mockRunSupabase.mockResolvedValue({ success: true, exitCode: 0, stdout: '', stderr: '' });

      const cmd = createPushCommand();
      
      await expect(cmd.parseAsync(['node', 'push', '--force'])).resolves.not.toThrow();
      
      // Guards and sync should not be called
      expect(mockRunGuards).not.toHaveBeenCalled();
      expect(mockInteractiveMigrationSync).not.toHaveBeenCalled();
    });

    it('should only show what would be pushed in --dry-run mode', async () => {
      mockLoadConfigOrExit.mockResolvedValue({
        settings: { strict_mode: false, require_clean_git: true, show_migration_diff: false },
        environments: {
          staging: { project_ref: 'staging-ref', git_branches: ['develop'], protected_operations: [] },
        },
      });
      mockGetCurrentBranch.mockResolvedValue('develop');
      mockHasUncommittedChanges.mockResolvedValue(false);
      mockGetCurrentLinkedProject.mockResolvedValue('staging-ref');
      mockResolveEnvironmentByProjectRef.mockReturnValue({
        name: 'staging',
        config: { project_ref: 'staging-ref', git_branches: ['develop'], protected_operations: [] },
      });
      mockBuildGuardContext.mockReturnValue({} as any);
      mockRunGuards.mockResolvedValue({ allowed: true, cancelled: false, requiresConfirmation: false });
      mockInteractiveMigrationSync.mockResolvedValue({ success: true });

      const cmd = createPushCommand();
      
      await expect(cmd.parseAsync(['node', 'push', '--dry-run'])).resolves.not.toThrow();
      
      // Should not actually push
      expect(mockRunSupabase).not.toHaveBeenCalledWith(['db', 'push', '--yes'], expect.any(Object));
    });

    it('should exit when guards fail', async () => {
      mockLoadConfigOrExit.mockResolvedValue({
        settings: { strict_mode: false, require_clean_git: true, show_migration_diff: true },
        environments: {
          staging: { project_ref: 'staging-ref', git_branches: ['develop'], protected_operations: [] },
        },
      });
      mockGetCurrentBranch.mockResolvedValue('develop');
      mockHasUncommittedChanges.mockResolvedValue(false);
      mockGetCurrentLinkedProject.mockResolvedValue('staging-ref');
      mockResolveEnvironmentByProjectRef.mockReturnValue({
        name: 'staging',
        config: { project_ref: 'staging-ref', git_branches: ['develop'], protected_operations: [] },
      });
      mockBuildGuardContext.mockReturnValue({} as any);
      mockRunGuards.mockResolvedValue({ allowed: false, cancelled: false });

      const cmd = createPushCommand();
      
      await expect(cmd.parseAsync(['node', 'push'])).rejects.toThrow(/process\.exit/);
    });

    it('should show migration diff when configured', async () => {
      mockLoadConfigOrExit.mockResolvedValue({
        settings: { strict_mode: false, require_clean_git: true, show_migration_diff: true },
        environments: {
          staging: { project_ref: 'staging-ref', git_branches: ['develop'], protected_operations: [] },
        },
      });
      mockGetCurrentBranch.mockResolvedValue('develop');
      mockHasUncommittedChanges.mockResolvedValue(false);
      mockGetCurrentLinkedProject.mockResolvedValue('staging-ref');
      mockResolveEnvironmentByProjectRef.mockReturnValue({
        name: 'staging',
        config: { project_ref: 'staging-ref', git_branches: ['develop'], protected_operations: [] },
      });
      mockBuildGuardContext.mockReturnValue({} as any);
      mockRunGuards.mockResolvedValue({ allowed: true, cancelled: false, requiresConfirmation: false });
      mockInteractiveMigrationSync.mockResolvedValue({ success: true });
      // First call for diff, second for push
      mockRunSupabase
        .mockResolvedValueOnce({ success: true, exitCode: 0, stdout: 'create table test', stderr: '' })
        .mockResolvedValueOnce({ success: true, exitCode: 0, stdout: '', stderr: '' });

      const cmd = createPushCommand();
      
      await expect(cmd.parseAsync(['node', 'push'])).resolves.not.toThrow();
      
      // Should have called for diff
      expect(mockRunSupabase).toHaveBeenCalledWith(['db', 'diff'], { stream: false });
    });

    it('should handle push failure', async () => {
      mockLoadConfigOrExit.mockResolvedValue({
        settings: { strict_mode: false, require_clean_git: true, show_migration_diff: false },
        environments: {
          staging: { project_ref: 'staging-ref', git_branches: ['develop'], protected_operations: [] },
        },
      });
      mockGetCurrentBranch.mockResolvedValue('develop');
      mockHasUncommittedChanges.mockResolvedValue(false);
      mockGetCurrentLinkedProject.mockResolvedValue('staging-ref');
      mockResolveEnvironmentByProjectRef.mockReturnValue({
        name: 'staging',
        config: { project_ref: 'staging-ref', git_branches: ['develop'], protected_operations: [] },
      });
      mockBuildGuardContext.mockReturnValue({} as any);
      mockRunGuards.mockResolvedValue({ allowed: true, cancelled: false, requiresConfirmation: false });
      mockInteractiveMigrationSync.mockResolvedValue({ success: true });
      mockRunSupabase.mockResolvedValue({ success: false, exitCode: 1, stdout: '', stderr: 'Error' });

      const cmd = createPushCommand();
      
      await expect(cmd.parseAsync(['node', 'push'])).rejects.toThrow(/process\.exit/);
    });
  });

  describe('push success', () => {
    it('should run supabase db push with --yes flag', async () => {
      mockLoadConfigOrExit.mockResolvedValue({
        settings: { strict_mode: false, require_clean_git: true, show_migration_diff: false },
        environments: {
          staging: { project_ref: 'staging-ref', git_branches: ['develop'], protected_operations: [] },
        },
      });
      mockGetCurrentBranch.mockResolvedValue('develop');
      mockHasUncommittedChanges.mockResolvedValue(false);
      mockGetCurrentLinkedProject.mockResolvedValue('staging-ref');
      mockResolveEnvironmentByProjectRef.mockReturnValue({
        name: 'staging',
        config: { project_ref: 'staging-ref', git_branches: ['develop'], protected_operations: [] },
      });
      mockBuildGuardContext.mockReturnValue({} as any);
      mockRunGuards.mockResolvedValue({ allowed: true, cancelled: false, requiresConfirmation: false });
      mockInteractiveMigrationSync.mockResolvedValue({ success: true });
      mockRunSupabase.mockResolvedValue({ success: true, exitCode: 0, stdout: '', stderr: '' });

      const cmd = createPushCommand();
      
      await expect(cmd.parseAsync(['node', 'push'])).resolves.not.toThrow();
      
      // Should call push with --yes
      expect(mockRunSupabase).toHaveBeenCalledWith(['db', 'push', '--yes'], { stream: true });
    });
  });
});
