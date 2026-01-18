/**
 * Unit Tests for Pull Command
 *
 * These tests verify the pull command functionality.
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
import { runGuards, buildGuardContext, getCurrentLinkedProject } from '../../src/guards/index.js';
import { createPullCommand } from '../../src/commands/pull.js';

const mockLoadConfigOrExit = vi.mocked(loadConfigOrExit);
const mockResolveEnvironmentByProjectRef = vi.mocked(resolveEnvironmentByProjectRef);
const _mockGetEnvironmentByName = vi.mocked(getEnvironmentByName);
const mockGetCurrentBranch = vi.mocked(getCurrentBranch);
const mockHasUncommittedChanges = vi.mocked(hasUncommittedChanges);
const mockRunSupabase = vi.mocked(runSupabase);
const mockRequireSupabaseCLI = vi.mocked(requireSupabaseCLI);
const mockRunGuards = vi.mocked(runGuards);
const mockBuildGuardContext = vi.mocked(buildGuardContext);
const mockGetCurrentLinkedProject = vi.mocked(getCurrentLinkedProject);

describe('Pull Command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireSupabaseCLI.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createPullCommand', () => {
    it('should create a command with correct name and description', () => {
      const cmd = createPullCommand();
      
      expect(cmd.name()).toBe('pull');
      expect(cmd.description()).toContain('Pull remote schema');
    });

    it('should have force option', () => {
      const cmd = createPullCommand();
      const options = cmd.options.map(opt => opt.name());
      
      expect(options).toContain('force');
    });
  });

  describe('pull execution', () => {
    it('should fail when no project is linked', async () => {
      mockLoadConfigOrExit.mockResolvedValue({
        settings: { strict_mode: false, require_clean_git: true, show_migration_diff: true },
        environments: {},
      });
      mockGetCurrentBranch.mockResolvedValue('main');
      mockHasUncommittedChanges.mockResolvedValue(false);
      mockGetCurrentLinkedProject.mockResolvedValue(null);

      const cmd = createPullCommand();
      
      await expect(cmd.parseAsync(['node', 'pull'])).rejects.toThrow(/process\.exit/);
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

      const cmd = createPullCommand();
      
      await expect(cmd.parseAsync(['node', 'pull'])).rejects.toThrow(/process\.exit/);
    });

    // Note: Tests for --env (-e) flag are skipped because this flag is registered
    // on the parent program in src/index.ts, not on individual commands.
    // Commands access it via `this.optsWithGlobals()` which requires the full
    // program context. These scenarios are covered by integration tests.

    it('should run supabase db pull on success', async () => {
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
      mockRunGuards.mockResolvedValue({ allowed: true, cancelled: false });
      mockRunSupabase.mockResolvedValue({ success: true, exitCode: 0, stdout: '', stderr: '' });

      const cmd = createPullCommand();
      
      await expect(cmd.parseAsync(['node', 'pull'])).resolves.not.toThrow();
      
      expect(mockRunSupabase).toHaveBeenCalledWith(['db', 'pull'], { stream: true });
    });

    it('should bypass guards with --force flag', async () => {
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
      mockRunSupabase.mockResolvedValue({ success: true, exitCode: 0, stdout: '', stderr: '' });

      const cmd = createPullCommand();
      
      await expect(cmd.parseAsync(['node', 'pull', '--force'])).resolves.not.toThrow();
      
      // Guards should not be called
      expect(mockRunGuards).not.toHaveBeenCalled();
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

      const cmd = createPullCommand();
      
      await expect(cmd.parseAsync(['node', 'pull'])).rejects.toThrow(/process\.exit/);
    });

    it('should exit gracefully when guards are cancelled', async () => {
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
      mockRunGuards.mockResolvedValue({ allowed: false, cancelled: true });

      const cmd = createPullCommand();
      
      await expect(cmd.parseAsync(['node', 'pull'])).rejects.toThrow(/process\.exit/);
    });

    it('should handle pull failure', async () => {
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
      mockRunGuards.mockResolvedValue({ allowed: true, cancelled: false });
      mockRunSupabase.mockResolvedValue({ success: false, exitCode: 1, stdout: '', stderr: 'Error' });

      const cmd = createPullCommand();
      
      await expect(cmd.parseAsync(['node', 'pull'])).rejects.toThrow(/process\.exit/);
    });
  });
});
