/**
 * Unit Tests for Git Utilities
 *
 * These tests verify git-related utility functions.
 * We mock execa to avoid requiring a real git repository.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock execa before importing the module
vi.mock('execa', () => ({
  execa: vi.fn(),
}));

import { execa } from 'execa';
import {
  clearGitCache,
  isGitRepository,
  getCurrentBranch,
  hasUncommittedChanges,
  getGitRoot,
  getCurrentCommitHash,
} from '../../src/utils/git.js';

const mockExeca = vi.mocked(execa);

describe('Git Utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear the cache before each test
    clearGitCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('clearGitCache', () => {
    it('should reset all cached values', async () => {
      // First, populate the cache
      mockExeca.mockResolvedValueOnce({
        stdout: 'true',
        stderr: '',
        exitCode: 0,
        failed: false,
        command: 'git rev-parse --is-inside-work-tree',
        escapedCommand: '',
        timedOut: false,
        killed: false,
      } as any);

      await isGitRepository();

      // Clear the cache
      clearGitCache();

      // Next call should hit execa again
      mockExeca.mockResolvedValueOnce({
        stdout: 'true',
        stderr: '',
        exitCode: 0,
        failed: false,
        command: 'git rev-parse --is-inside-work-tree',
        escapedCommand: '',
        timedOut: false,
        killed: false,
      } as any);

      await isGitRepository();

      // execa should have been called twice (once before clear, once after)
      expect(mockExeca).toHaveBeenCalledTimes(2);
    });
  });

  describe('isGitRepository', () => {
    it('should return true when inside a git repo', async () => {
      mockExeca.mockResolvedValueOnce({
        stdout: 'true',
        stderr: '',
        exitCode: 0,
        failed: false,
        command: 'git rev-parse --is-inside-work-tree',
        escapedCommand: '',
        timedOut: false,
        killed: false,
      } as any);

      const result = await isGitRepository();

      expect(result).toBe(true);
      expect(mockExeca).toHaveBeenCalledWith('git', ['rev-parse', '--is-inside-work-tree']);
    });

    it('should return false when not in a git repo', async () => {
      mockExeca.mockRejectedValueOnce(new Error('fatal: not a git repository'));

      const result = await isGitRepository();

      expect(result).toBe(false);
    });

    it('should cache the result', async () => {
      mockExeca.mockResolvedValueOnce({
        stdout: 'true',
        stderr: '',
        exitCode: 0,
        failed: false,
        command: 'git rev-parse --is-inside-work-tree',
        escapedCommand: '',
        timedOut: false,
        killed: false,
      } as any);

      await isGitRepository();
      await isGitRepository();
      await isGitRepository();

      // Should only call execa once due to caching
      expect(mockExeca).toHaveBeenCalledTimes(1);
    });

    it('should pass cwd option when provided', async () => {
      mockExeca.mockResolvedValueOnce({
        stdout: 'true',
        stderr: '',
        exitCode: 0,
        failed: false,
        command: 'git rev-parse --is-inside-work-tree',
        escapedCommand: '',
        timedOut: false,
        killed: false,
      } as any);

      await isGitRepository('/custom/path');

      expect(mockExeca).toHaveBeenCalledWith('git', ['rev-parse', '--is-inside-work-tree'], {
        cwd: '/custom/path',
      });
    });
  });

  describe('getCurrentBranch', () => {
    it('should return the current branch name', async () => {
      // First call checks if we're in a repo
      mockExeca.mockResolvedValueOnce({
        stdout: 'true',
        stderr: '',
        exitCode: 0,
        failed: false,
        command: 'git rev-parse --is-inside-work-tree',
        escapedCommand: '',
        timedOut: false,
        killed: false,
      } as any);

      // Second call gets the branch
      mockExeca.mockResolvedValueOnce({
        stdout: 'main\n',
        stderr: '',
        exitCode: 0,
        failed: false,
        command: 'git symbolic-ref --short HEAD',
        escapedCommand: '',
        timedOut: false,
        killed: false,
      } as any);

      const result = await getCurrentBranch();

      expect(result).toBe('main');
    });

    it('should return null when not in a git repo', async () => {
      mockExeca.mockRejectedValueOnce(new Error('not a git repository'));

      const result = await getCurrentBranch();

      expect(result).toBeNull();
    });

    it('should return null on detached HEAD', async () => {
      // First call checks if we're in a repo
      mockExeca.mockResolvedValueOnce({
        stdout: 'true',
        stderr: '',
        exitCode: 0,
        failed: false,
        command: 'git rev-parse --is-inside-work-tree',
        escapedCommand: '',
        timedOut: false,
        killed: false,
      } as any);

      // Second call fails on detached HEAD
      mockExeca.mockRejectedValueOnce(new Error('fatal: ref HEAD is not a symbolic ref'));

      const result = await getCurrentBranch();

      expect(result).toBeNull();
    });

    it('should cache the branch name', async () => {
      mockExeca.mockResolvedValueOnce({
        stdout: 'true',
        stderr: '',
        exitCode: 0,
        failed: false,
        command: 'git rev-parse --is-inside-work-tree',
        escapedCommand: '',
        timedOut: false,
        killed: false,
      } as any);

      mockExeca.mockResolvedValueOnce({
        stdout: 'develop',
        stderr: '',
        exitCode: 0,
        failed: false,
        command: 'git symbolic-ref --short HEAD',
        escapedCommand: '',
        timedOut: false,
        killed: false,
      } as any);

      const result1 = await getCurrentBranch();
      const result2 = await getCurrentBranch();

      expect(result1).toBe('develop');
      expect(result2).toBe('develop');
      // isGitRepository is called once, then symbolic-ref once
      expect(mockExeca).toHaveBeenCalledTimes(2);
    });

    it('should trim whitespace from branch name', async () => {
      mockExeca.mockResolvedValueOnce({
        stdout: 'true',
        stderr: '',
        exitCode: 0,
        failed: false,
        command: 'git rev-parse --is-inside-work-tree',
        escapedCommand: '',
        timedOut: false,
        killed: false,
      } as any);

      mockExeca.mockResolvedValueOnce({
        stdout: '  feature/test-branch  \n',
        stderr: '',
        exitCode: 0,
        failed: false,
        command: 'git symbolic-ref --short HEAD',
        escapedCommand: '',
        timedOut: false,
        killed: false,
      } as any);

      const result = await getCurrentBranch();

      expect(result).toBe('feature/test-branch');
    });
  });

  describe('hasUncommittedChanges', () => {
    it('should return true when there are uncommitted changes', async () => {
      mockExeca.mockResolvedValueOnce({
        stdout: 'true',
        stderr: '',
        exitCode: 0,
        failed: false,
        command: 'git rev-parse --is-inside-work-tree',
        escapedCommand: '',
        timedOut: false,
        killed: false,
      } as any);

      mockExeca.mockResolvedValueOnce({
        stdout: 'M  src/index.ts\nA  src/new-file.ts\n',
        stderr: '',
        exitCode: 0,
        failed: false,
        command: 'git status --porcelain',
        escapedCommand: '',
        timedOut: false,
        killed: false,
      } as any);

      const result = await hasUncommittedChanges();

      expect(result).toBe(true);
    });

    it('should return false when working directory is clean', async () => {
      mockExeca.mockResolvedValueOnce({
        stdout: 'true',
        stderr: '',
        exitCode: 0,
        failed: false,
        command: 'git rev-parse --is-inside-work-tree',
        escapedCommand: '',
        timedOut: false,
        killed: false,
      } as any);

      mockExeca.mockResolvedValueOnce({
        stdout: '',
        stderr: '',
        exitCode: 0,
        failed: false,
        command: 'git status --porcelain',
        escapedCommand: '',
        timedOut: false,
        killed: false,
      } as any);

      const result = await hasUncommittedChanges();

      expect(result).toBe(false);
    });

    it('should return false when not in a git repo', async () => {
      mockExeca.mockRejectedValueOnce(new Error('not a git repository'));

      const result = await hasUncommittedChanges();

      expect(result).toBe(false);
    });

    it('should return true on error (safe default)', async () => {
      mockExeca.mockResolvedValueOnce({
        stdout: 'true',
        stderr: '',
        exitCode: 0,
        failed: false,
        command: 'git rev-parse --is-inside-work-tree',
        escapedCommand: '',
        timedOut: false,
        killed: false,
      } as any);

      mockExeca.mockRejectedValueOnce(new Error('git status failed'));

      const result = await hasUncommittedChanges();

      expect(result).toBe(true);
    });

    it('should cache the result', async () => {
      mockExeca.mockResolvedValueOnce({
        stdout: 'true',
        stderr: '',
        exitCode: 0,
        failed: false,
        command: 'git rev-parse --is-inside-work-tree',
        escapedCommand: '',
        timedOut: false,
        killed: false,
      } as any);

      mockExeca.mockResolvedValueOnce({
        stdout: '',
        stderr: '',
        exitCode: 0,
        failed: false,
        command: 'git status --porcelain',
        escapedCommand: '',
        timedOut: false,
        killed: false,
      } as any);

      await hasUncommittedChanges();
      await hasUncommittedChanges();

      expect(mockExeca).toHaveBeenCalledTimes(2);
    });
  });

  describe('getGitRoot', () => {
    it('should return the git root directory', async () => {
      mockExeca.mockResolvedValueOnce({
        stdout: 'true',
        stderr: '',
        exitCode: 0,
        failed: false,
        command: 'git rev-parse --is-inside-work-tree',
        escapedCommand: '',
        timedOut: false,
        killed: false,
      } as any);

      mockExeca.mockResolvedValueOnce({
        stdout: '/home/user/project\n',
        stderr: '',
        exitCode: 0,
        failed: false,
        command: 'git rev-parse --show-toplevel',
        escapedCommand: '',
        timedOut: false,
        killed: false,
      } as any);

      const result = await getGitRoot();

      expect(result).toBe('/home/user/project');
    });

    it('should return null when not in a git repo', async () => {
      mockExeca.mockRejectedValueOnce(new Error('not a git repository'));

      const result = await getGitRoot();

      expect(result).toBeNull();
    });

    it('should return null on error', async () => {
      mockExeca.mockResolvedValueOnce({
        stdout: 'true',
        stderr: '',
        exitCode: 0,
        failed: false,
        command: 'git rev-parse --is-inside-work-tree',
        escapedCommand: '',
        timedOut: false,
        killed: false,
      } as any);

      mockExeca.mockRejectedValueOnce(new Error('git rev-parse failed'));

      const result = await getGitRoot();

      expect(result).toBeNull();
    });
  });

  describe('getCurrentCommitHash', () => {
    it('should return the short commit hash', async () => {
      mockExeca.mockResolvedValueOnce({
        stdout: 'true',
        stderr: '',
        exitCode: 0,
        failed: false,
        command: 'git rev-parse --is-inside-work-tree',
        escapedCommand: '',
        timedOut: false,
        killed: false,
      } as any);

      mockExeca.mockResolvedValueOnce({
        stdout: 'abc1234\n',
        stderr: '',
        exitCode: 0,
        failed: false,
        command: 'git rev-parse --short HEAD',
        escapedCommand: '',
        timedOut: false,
        killed: false,
      } as any);

      const result = await getCurrentCommitHash();

      expect(result).toBe('abc1234');
    });

    it('should return null when not in a git repo', async () => {
      mockExeca.mockRejectedValueOnce(new Error('not a git repository'));

      const result = await getCurrentCommitHash();

      expect(result).toBeNull();
    });

    it('should return null on error', async () => {
      mockExeca.mockResolvedValueOnce({
        stdout: 'true',
        stderr: '',
        exitCode: 0,
        failed: false,
        command: 'git rev-parse --is-inside-work-tree',
        escapedCommand: '',
        timedOut: false,
        killed: false,
      } as any);

      mockExeca.mockRejectedValueOnce(new Error('no commits yet'));

      const result = await getCurrentCommitHash();

      expect(result).toBeNull();
    });
  });
});
