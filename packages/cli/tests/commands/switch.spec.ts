/**
 * Unit Tests for Switch Command
 *
 * These tests verify the switch command functionality.
 * We mock external dependencies to test in isolation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock config loader
vi.mock('../../src/config/loader.js', () => ({
  loadConfigOrExit: vi.fn(),
}));

// Mock config resolver
vi.mock('../../src/config/resolver.js', () => ({
  getEnvironmentByName: vi.fn(),
  listEnvironments: vi.fn(),
}));

// Mock supabase utils
vi.mock('../../src/utils/supabase.js', () => ({
  runSupabase: vi.fn(),
  requireSupabaseCLI: vi.fn(),
}));

// Mock migrations utils
vi.mock('../../src/utils/migrations.js', () => ({
  checkMigrationSync: vi.fn(),
  syncMigrations: vi.fn(),
}));

// Mock project guard
vi.mock('../../src/guards/project-guard.js', () => ({
  getCurrentLinkedProject: vi.fn(),
  clearProjectCache: vi.fn(),
}));

// Mock @clack/prompts
vi.mock('@clack/prompts', () => ({
  confirm: vi.fn(),
  isCancel: vi.fn((value) => value === Symbol.for('cancel')),
}));

import { loadConfigOrExit } from '../../src/config/loader.js';
import { getEnvironmentByName, listEnvironments } from '../../src/config/resolver.js';
import { runSupabase, requireSupabaseCLI } from '../../src/utils/supabase.js';
import { checkMigrationSync, syncMigrations } from '../../src/utils/migrations.js';
import { getCurrentLinkedProject } from '../../src/guards/project-guard.js';
import * as p from '@clack/prompts';
import { createSwitchCommand } from '../../src/commands/switch.js';

const mockLoadConfigOrExit = vi.mocked(loadConfigOrExit);
const mockGetEnvironmentByName = vi.mocked(getEnvironmentByName);
const mockListEnvironments = vi.mocked(listEnvironments);
const mockRunSupabase = vi.mocked(runSupabase);
const mockRequireSupabaseCLI = vi.mocked(requireSupabaseCLI);
const mockCheckMigrationSync = vi.mocked(checkMigrationSync);
const mockSyncMigrations = vi.mocked(syncMigrations);
const mockGetCurrentLinkedProject = vi.mocked(getCurrentLinkedProject);
const mockConfirm = vi.mocked(p.confirm);

describe('Switch Command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireSupabaseCLI.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createSwitchCommand', () => {
    it('should create a command with correct name and description', () => {
      const cmd = createSwitchCommand();
      
      expect(cmd.name()).toBe('switch');
      expect(cmd.description()).toContain('Switch to a different environment');
    });
  });

  describe('switch execution', () => {
    it('should fail when environment not found', async () => {
      mockLoadConfigOrExit.mockResolvedValue({
        settings: { strict_mode: false, require_clean_git: true, show_migration_diff: true },
        environments: {},
      });
      mockGetEnvironmentByName.mockReturnValue(null);
      mockListEnvironments.mockReturnValue([]);

      const cmd = createSwitchCommand();
      
      await expect(cmd.parseAsync(['node', 'switch', 'nonexistent'])).rejects.toThrow(/process\.exit/);
    });

    it('should switch to environment with project_ref', async () => {
      mockLoadConfigOrExit.mockResolvedValue({
        settings: { strict_mode: false, require_clean_git: true, show_migration_diff: true },
        environments: {
          staging: { project_ref: 'staging-ref', git_branches: ['develop'], protected_operations: [] },
        },
      });
      mockGetEnvironmentByName.mockReturnValue({
        name: 'staging',
        config: { project_ref: 'staging-ref', git_branches: ['develop'], protected_operations: [] },
        projectRef: 'staging-ref',
      });
      mockGetCurrentLinkedProject.mockResolvedValue('other-ref');
      mockRunSupabase.mockResolvedValue({ success: true, exitCode: 0, stdout: '', stderr: '' });
      mockCheckMigrationSync.mockResolvedValue({ needsSync: false, remoteMissing: [], localMissing: [] });

      const cmd = createSwitchCommand();
      
      await expect(cmd.parseAsync(['node', 'switch', 'staging'])).resolves.not.toThrow();
      
      expect(mockRunSupabase).toHaveBeenCalledWith(
        ['link', '--project-ref', 'staging-ref'],
        { stream: true }
      );
    });

    it('should do nothing when already linked to correct project', async () => {
      mockLoadConfigOrExit.mockResolvedValue({
        settings: { strict_mode: false, require_clean_git: true, show_migration_diff: true },
        environments: {
          staging: { project_ref: 'staging-ref', git_branches: ['develop'], protected_operations: [] },
        },
      });
      mockGetEnvironmentByName.mockReturnValue({
        name: 'staging',
        config: { project_ref: 'staging-ref', git_branches: ['develop'], protected_operations: [] },
        projectRef: 'staging-ref',
      });
      mockGetCurrentLinkedProject.mockResolvedValue('staging-ref');

      const cmd = createSwitchCommand();
      
      await expect(cmd.parseAsync(['node', 'switch', 'staging'])).resolves.not.toThrow();
      
      // Should not call link
      expect(mockRunSupabase).not.toHaveBeenCalledWith(
        ['link', '--project-ref', expect.any(String)],
        expect.any(Object)
      );
    });

    it('should handle local environment switch', async () => {
      mockLoadConfigOrExit.mockResolvedValue({
        settings: { strict_mode: false, require_clean_git: true, show_migration_diff: true },
        environments: {
          local: { project_ref: undefined, git_branches: [], protected_operations: [] },
        },
      });
      mockGetEnvironmentByName.mockReturnValue({
        name: 'local',
        config: { project_ref: undefined, git_branches: [], protected_operations: [] },
        projectRef: undefined,
      });
      mockGetCurrentLinkedProject.mockResolvedValue('some-ref');
      mockRunSupabase.mockResolvedValue({ success: true, exitCode: 0, stdout: '', stderr: '' });

      const cmd = createSwitchCommand();
      
      await expect(cmd.parseAsync(['node', 'switch', 'local'])).resolves.not.toThrow();
      
      // Should unlink
      expect(mockRunSupabase).toHaveBeenCalledWith(['unlink'], { stream: false });
    });

    it('should fail when environment has no project_ref', async () => {
      mockLoadConfigOrExit.mockResolvedValue({
        settings: { strict_mode: false, require_clean_git: true, show_migration_diff: true },
        environments: {
          staging: { project_ref: undefined, git_branches: ['develop'], protected_operations: [] },
        },
      });
      mockGetEnvironmentByName.mockReturnValue({
        name: 'staging',
        config: { project_ref: undefined, git_branches: ['develop'], protected_operations: [] },
        projectRef: undefined,
      });
      mockGetCurrentLinkedProject.mockResolvedValue(null);

      const cmd = createSwitchCommand();
      
      await expect(cmd.parseAsync(['node', 'switch', 'staging'])).rejects.toThrow(/process\.exit/);
    });

    it('should handle link failure', async () => {
      mockLoadConfigOrExit.mockResolvedValue({
        settings: { strict_mode: false, require_clean_git: true, show_migration_diff: true },
        environments: {
          staging: { project_ref: 'staging-ref', git_branches: ['develop'], protected_operations: [] },
        },
      });
      mockGetEnvironmentByName.mockReturnValue({
        name: 'staging',
        config: { project_ref: 'staging-ref', git_branches: ['develop'], protected_operations: [] },
        projectRef: 'staging-ref',
      });
      mockGetCurrentLinkedProject.mockResolvedValue(null);
      mockRunSupabase.mockResolvedValue({ success: false, exitCode: 1, stdout: '', stderr: 'Error' });

      const cmd = createSwitchCommand();
      
      await expect(cmd.parseAsync(['node', 'switch', 'staging'])).rejects.toThrow(/process\.exit/);
    });

    it('should offer migration sync when remote has new migrations', async () => {
      mockLoadConfigOrExit.mockResolvedValue({
        settings: { strict_mode: false, require_clean_git: true, show_migration_diff: true },
        environments: {
          staging: { project_ref: 'staging-ref', git_branches: ['develop'], protected_operations: [] },
        },
      });
      mockGetEnvironmentByName.mockReturnValue({
        name: 'staging',
        config: { project_ref: 'staging-ref', git_branches: ['develop'], protected_operations: [] },
        projectRef: 'staging-ref',
      });
      mockGetCurrentLinkedProject.mockResolvedValue(null);
      mockRunSupabase.mockResolvedValue({ success: true, exitCode: 0, stdout: '', stderr: '' });
      mockCheckMigrationSync.mockResolvedValue({ 
        needsSync: true, 
        remoteMissing: ['20260116000044'], 
        localMissing: [] 
      });
      mockConfirm.mockResolvedValue(true);
      mockSyncMigrations.mockResolvedValue(true);

      const cmd = createSwitchCommand();
      
      await expect(cmd.parseAsync(['node', 'switch', 'staging'])).resolves.not.toThrow();
      
      expect(mockConfirm).toHaveBeenCalled();
      expect(mockSyncMigrations).toHaveBeenCalled();
    });

    it('should skip migration sync when user declines', async () => {
      mockLoadConfigOrExit.mockResolvedValue({
        settings: { strict_mode: false, require_clean_git: true, show_migration_diff: true },
        environments: {
          staging: { project_ref: 'staging-ref', git_branches: ['develop'], protected_operations: [] },
        },
      });
      mockGetEnvironmentByName.mockReturnValue({
        name: 'staging',
        config: { project_ref: 'staging-ref', git_branches: ['develop'], protected_operations: [] },
        projectRef: 'staging-ref',
      });
      mockGetCurrentLinkedProject.mockResolvedValue(null);
      mockRunSupabase.mockResolvedValue({ success: true, exitCode: 0, stdout: '', stderr: '' });
      mockCheckMigrationSync.mockResolvedValue({ 
        needsSync: true, 
        remoteMissing: ['20260116000044'], 
        localMissing: [] 
      });
      mockConfirm.mockResolvedValue(false);

      const cmd = createSwitchCommand();
      
      await expect(cmd.parseAsync(['node', 'switch', 'staging'])).resolves.not.toThrow();
      
      expect(mockSyncMigrations).not.toHaveBeenCalled();
    });

    it('should show local migrations ready to push', async () => {
      mockLoadConfigOrExit.mockResolvedValue({
        settings: { strict_mode: false, require_clean_git: true, show_migration_diff: true },
        environments: {
          staging: { project_ref: 'staging-ref', git_branches: ['develop'], protected_operations: [] },
        },
      });
      mockGetEnvironmentByName.mockReturnValue({
        name: 'staging',
        config: { project_ref: 'staging-ref', git_branches: ['develop'], protected_operations: [] },
        projectRef: 'staging-ref',
      });
      mockGetCurrentLinkedProject.mockResolvedValue(null);
      mockRunSupabase.mockResolvedValue({ success: true, exitCode: 0, stdout: '', stderr: '' });
      mockCheckMigrationSync.mockResolvedValue({ 
        needsSync: false, 
        remoteMissing: [], 
        localMissing: ['20260117000000'] 
      });

      const cmd = createSwitchCommand();
      
      await expect(cmd.parseAsync(['node', 'switch', 'staging'])).resolves.not.toThrow();
      
      // Should not prompt for sync when only local migrations exist
      expect(mockConfirm).not.toHaveBeenCalled();
    });
  });
});
