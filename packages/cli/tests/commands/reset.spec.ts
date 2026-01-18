/**
 * Unit Tests for Reset Command
 *
 * These tests verify the reset command functionality.
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

// Mock config schema
vi.mock('../../src/config/schema.js', () => ({
  isEnvironmentLocked: vi.fn(),
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

// Mock @clack/prompts
vi.mock('@clack/prompts', () => ({
  note: vi.fn(),
  confirm: vi.fn(),
  text: vi.fn(),
  isCancel: vi.fn((value) => value === Symbol.for('cancel')),
  cancel: vi.fn(),
}));

import { loadConfigOrExit } from '../../src/config/loader.js';
import { resolveEnvironmentByProjectRef, getEnvironmentByName } from '../../src/config/resolver.js';
import { isEnvironmentLocked } from '../../src/config/schema.js';
import { getCurrentBranch, hasUncommittedChanges } from '../../src/utils/git.js';
import { runSupabase, requireSupabaseCLI } from '../../src/utils/supabase.js';
import { runGuards, buildGuardContext, getCurrentLinkedProject } from '../../src/guards/index.js';
import * as p from '@clack/prompts';
import { createResetCommand } from '../../src/commands/reset.js';

const mockLoadConfigOrExit = vi.mocked(loadConfigOrExit);
const mockResolveEnvironmentByProjectRef = vi.mocked(resolveEnvironmentByProjectRef);
const mockGetEnvironmentByName = vi.mocked(getEnvironmentByName);
const mockIsEnvironmentLocked = vi.mocked(isEnvironmentLocked);
const mockGetCurrentBranch = vi.mocked(getCurrentBranch);
const mockHasUncommittedChanges = vi.mocked(hasUncommittedChanges);
const mockRunSupabase = vi.mocked(runSupabase);
const mockRequireSupabaseCLI = vi.mocked(requireSupabaseCLI);
const mockRunGuards = vi.mocked(runGuards);
const mockBuildGuardContext = vi.mocked(buildGuardContext);
const mockGetCurrentLinkedProject = vi.mocked(getCurrentLinkedProject);
const mockConfirm = vi.mocked(p.confirm);
const mockText = vi.mocked(p.text);

describe('Reset Command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireSupabaseCLI.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createResetCommand', () => {
    it('should create a command with correct name and description', () => {
      const cmd = createResetCommand();
      
      expect(cmd.name()).toBe('reset');
      expect(cmd.description()).toContain('Reset database');
    });

    it('should have force and linked options', () => {
      const cmd = createResetCommand();
      const options = cmd.options.map(opt => opt.name());
      
      expect(options).toContain('force');
      expect(options).toContain('linked');
      expect(options).toContain('i-know-what-im-doing');
    });
  });

  describe('reset execution', () => {
    it('should fail when no project is linked', async () => {
      mockLoadConfigOrExit.mockResolvedValue({
        settings: { strict_mode: false, require_clean_git: true, show_migration_diff: true },
        environments: {},
      });
      mockGetCurrentBranch.mockResolvedValue('main');
      mockHasUncommittedChanges.mockResolvedValue(false);
      mockGetCurrentLinkedProject.mockResolvedValue(null);

      const cmd = createResetCommand();
      
      await expect(cmd.parseAsync(['node', 'reset'])).rejects.toThrow(/process\.exit/);
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

      const cmd = createResetCommand();
      
      await expect(cmd.parseAsync(['node', 'reset'])).rejects.toThrow(/process\.exit/);
    });

    it('should resolve environment from linked project', async () => {
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
         projectRef: 'staging-ref',
         matchType: 'exact' as const,
       });
      mockIsEnvironmentLocked.mockReturnValue(false);
      mockBuildGuardContext.mockReturnValue({} as any);
      mockRunGuards.mockResolvedValue({ allowed: true, cancelled: false });
      mockText.mockResolvedValue('staging');
      mockRunSupabase.mockResolvedValue({ success: true, exitCode: 0, stdout: '', stderr: '' });

      const cmd = createResetCommand();
      
      await expect(cmd.parseAsync(['node', 'reset'])).resolves.not.toThrow();
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

      const cmd = createResetCommand();
      
      await expect(cmd.parseAsync(['node', 'reset'])).rejects.toThrow(/process\.exit/);
    });

    it('should require confirmation in non-force mode', async () => {
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
         projectRef: 'staging-ref',
         matchType: 'exact' as const,
       });
      mockIsEnvironmentLocked.mockReturnValue(false);
      mockBuildGuardContext.mockReturnValue({} as any);
      mockRunGuards.mockResolvedValue({ allowed: true, cancelled: false });
      mockText.mockResolvedValue('staging');
      mockRunSupabase.mockResolvedValue({ success: true, exitCode: 0, stdout: '', stderr: '' });

      const cmd = createResetCommand();
      
      await expect(cmd.parseAsync(['node', 'reset'])).resolves.not.toThrow();
      
      // Should have called text for confirmation
      expect(mockText).toHaveBeenCalled();
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
         projectRef: 'staging-ref',
         matchType: 'exact' as const,
       });
      mockIsEnvironmentLocked.mockReturnValue(false);
      mockConfirm.mockResolvedValue(true);
      mockRunSupabase.mockResolvedValue({ success: true, exitCode: 0, stdout: '', stderr: '' });

      const cmd = createResetCommand();
      
      await expect(cmd.parseAsync(['node', 'reset', '--force'])).resolves.not.toThrow();
      
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
         projectRef: 'staging-ref',
         matchType: 'exact' as const,
       });
      mockIsEnvironmentLocked.mockReturnValue(false);
      mockBuildGuardContext.mockReturnValue({} as any);
      mockRunGuards.mockResolvedValue({ allowed: false, cancelled: false });

      const cmd = createResetCommand();
      
      await expect(cmd.parseAsync(['node', 'reset'])).rejects.toThrow(/process\.exit/);
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
         projectRef: 'staging-ref',
         matchType: 'exact' as const,
       });
      mockIsEnvironmentLocked.mockReturnValue(false);
      mockBuildGuardContext.mockReturnValue({} as any);
      mockRunGuards.mockResolvedValue({ allowed: false, cancelled: true });

      const cmd = createResetCommand();
      
      await expect(cmd.parseAsync(['node', 'reset'])).rejects.toThrow(/process\.exit/);
    });

    it('should exit when confirmation is cancelled', async () => {
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
         projectRef: 'staging-ref',
         matchType: 'exact' as const,
       });
      mockIsEnvironmentLocked.mockReturnValue(false);
      mockBuildGuardContext.mockReturnValue({} as any);
      mockRunGuards.mockResolvedValue({ allowed: true, cancelled: false });
      mockText.mockResolvedValue(Symbol.for('cancel') as any);

      const cmd = createResetCommand();
      
      await expect(cmd.parseAsync(['node', 'reset'])).rejects.toThrow(/process\.exit/);
    });

    it('should run supabase db reset with --linked flag', async () => {
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
         projectRef: 'staging-ref',
         matchType: 'exact' as const,
       });
      mockIsEnvironmentLocked.mockReturnValue(false);
      mockBuildGuardContext.mockReturnValue({} as any);
      mockRunGuards.mockResolvedValue({ allowed: true, cancelled: false });
      mockText.mockResolvedValue('staging');
      mockRunSupabase.mockResolvedValue({ success: true, exitCode: 0, stdout: '', stderr: '' });

      const cmd = createResetCommand();
      
      await expect(cmd.parseAsync(['node', 'reset', '--linked'])).resolves.not.toThrow();
      
      expect(mockRunSupabase).toHaveBeenCalledWith(['db', 'reset', '--linked'], { stream: true });
    });

    it('should handle reset failure', async () => {
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
         projectRef: 'staging-ref',
         matchType: 'exact' as const,
       });
      mockIsEnvironmentLocked.mockReturnValue(false);
      mockBuildGuardContext.mockReturnValue({} as any);
      mockRunGuards.mockResolvedValue({ allowed: true, cancelled: false });
      mockText.mockResolvedValue('staging');
      mockRunSupabase.mockResolvedValue({ success: false, exitCode: 1, stdout: '', stderr: 'Error' });

      const cmd = createResetCommand();
      
      await expect(cmd.parseAsync(['node', 'reset'])).rejects.toThrow(/process\.exit/);
    });
  });

  describe('CI mode', () => {
    it('should require --env flag in CI mode', async () => {
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
         projectRef: 'staging-ref',
         matchType: 'exact' as const,
       });

      const cmd = createResetCommand();
      
      await expect(cmd.parseAsync(['node', 'reset', '--ci'])).rejects.toThrow(/process\.exit/);
    });

    it('should require --i-know-what-im-doing flag in CI mode', async () => {
      mockLoadConfigOrExit.mockResolvedValue({
        settings: { strict_mode: false, require_clean_git: true, show_migration_diff: true },
        environments: {
          staging: { project_ref: 'staging-ref', git_branches: ['develop'], protected_operations: [] },
        },
      });
      mockGetCurrentBranch.mockResolvedValue('develop');
      mockHasUncommittedChanges.mockResolvedValue(false);
       mockGetEnvironmentByName.mockReturnValue({
         name: 'staging',
         config: { project_ref: 'staging-ref', git_branches: ['develop'], protected_operations: [] },
         projectRef: 'staging-ref',
         matchType: 'exact' as const,
       });
      mockIsEnvironmentLocked.mockReturnValue(false);

      const cmd = createResetCommand();
      
      await expect(cmd.parseAsync(['node', 'reset', '--ci', '-e', 'staging'])).rejects.toThrow(/process\.exit/);
    });
  });
});
