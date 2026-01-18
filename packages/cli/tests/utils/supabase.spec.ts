/**
 * Unit Tests for Supabase CLI Utilities
 *
 * These tests verify Supabase CLI interaction utilities.
 * We mock execa to avoid requiring actual Supabase CLI.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock execa before importing the module
vi.mock('execa', () => ({
  execa: vi.fn(),
}));

import { execa } from 'execa';

// Need to reset module cache to clear the supabaseAvailable cache
let supabaseModule: typeof import('../../src/utils/supabase.js');

const mockExeca = vi.mocked(execa);

describe('Supabase CLI Utilities', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Reset the module to clear the cache
    vi.resetModules();
    // Re-mock execa after module reset
    vi.doMock('execa', () => ({
      execa: mockExeca,
    }));
    // Re-import the module
    supabaseModule = await import('../../src/utils/supabase.js');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isSupabaseCLIInstalled', () => {
    it('should return true when Supabase CLI is installed', async () => {
      mockExeca.mockResolvedValueOnce({
        stdout: '1.123.0',
        stderr: '',
        exitCode: 0,
        failed: false,
        command: 'supabase --version',
        escapedCommand: '',
        timedOut: false,
        killed: false,
      } as any);

      const result = await supabaseModule.isSupabaseCLIInstalled();

      expect(result).toBe(true);
      expect(mockExeca).toHaveBeenCalledWith('supabase', ['--version']);
    });

    it('should return false when Supabase CLI is not installed', async () => {
      mockExeca.mockRejectedValueOnce(new Error('command not found: supabase'));

      const result = await supabaseModule.isSupabaseCLIInstalled();

      expect(result).toBe(false);
    });

    it('should cache the result', async () => {
      mockExeca.mockResolvedValueOnce({
        stdout: '1.123.0',
        stderr: '',
        exitCode: 0,
        failed: false,
        command: 'supabase --version',
        escapedCommand: '',
        timedOut: false,
        killed: false,
      } as any);

      await supabaseModule.isSupabaseCLIInstalled();
      await supabaseModule.isSupabaseCLIInstalled();
      await supabaseModule.isSupabaseCLIInstalled();

      // Should only call execa once due to caching
      expect(mockExeca).toHaveBeenCalledTimes(1);
    });
  });

  describe('getSupabaseVersion', () => {
    it('should return the version number', async () => {
      mockExeca.mockResolvedValueOnce({
        stdout: '1.123.0',
        stderr: '',
        exitCode: 0,
        failed: false,
        command: 'supabase --version',
        escapedCommand: '',
        timedOut: false,
        killed: false,
      } as any);

      const result = await supabaseModule.getSupabaseVersion();

      expect(result).toBe('1.123.0');
    });

    it('should extract version from "Supabase CLI x.x.x" format', async () => {
      mockExeca.mockResolvedValueOnce({
        stdout: 'Supabase CLI 2.45.6',
        stderr: '',
        exitCode: 0,
        failed: false,
        command: 'supabase --version',
        escapedCommand: '',
        timedOut: false,
        killed: false,
      } as any);

      const result = await supabaseModule.getSupabaseVersion();

      expect(result).toBe('2.45.6');
    });

    it('should return null when Supabase CLI is not installed', async () => {
      mockExeca.mockRejectedValueOnce(new Error('command not found'));

      const result = await supabaseModule.getSupabaseVersion();

      expect(result).toBeNull();
    });

    it('should handle empty output', async () => {
      mockExeca.mockResolvedValueOnce({
        stdout: '',
        stderr: '',
        exitCode: 0,
        failed: false,
        command: 'supabase --version',
        escapedCommand: '',
        timedOut: false,
        killed: false,
      } as any);

      const result = await supabaseModule.getSupabaseVersion();

      expect(result).toBeNull();
    });

    it('should return trimmed output if no version pattern found', async () => {
      mockExeca.mockResolvedValueOnce({
        stdout: 'some-weird-output',
        stderr: '',
        exitCode: 0,
        failed: false,
        command: 'supabase --version',
        escapedCommand: '',
        timedOut: false,
        killed: false,
      } as any);

      const result = await supabaseModule.getSupabaseVersion();

      expect(result).toBe('some-weird-output');
    });
  });

  describe('runSupabase', () => {
    it('should run supabase command successfully', async () => {
      // First call for isSupabaseCLIInstalled check
      mockExeca.mockResolvedValueOnce({
        stdout: '1.123.0',
        stderr: '',
        exitCode: 0,
        failed: false,
        command: 'supabase --version',
        escapedCommand: '',
        timedOut: false,
        killed: false,
      } as any);

      // Second call for actual command
      mockExeca.mockResolvedValueOnce({
        stdout: 'output',
        stderr: '',
        exitCode: 0,
        failed: false,
        command: 'supabase db push',
        escapedCommand: '',
        timedOut: false,
        killed: false,
      } as any);

      const result = await supabaseModule.runSupabase(['db', 'push']);

      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
    });

    it('should return error when Supabase CLI is not installed', async () => {
      mockExeca.mockRejectedValueOnce(new Error('command not found'));

      const result = await supabaseModule.runSupabase(['db', 'push']);

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('not installed');
    });

    it('should handle command failure with exit code', async () => {
      mockExeca.mockResolvedValueOnce({
        stdout: '1.123.0',
        stderr: '',
        exitCode: 0,
        failed: false,
        command: 'supabase --version',
        escapedCommand: '',
        timedOut: false,
        killed: false,
      } as any);

      mockExeca.mockResolvedValueOnce({
        stdout: '',
        stderr: 'Error: something went wrong',
        exitCode: 1,
        failed: true,
        command: 'supabase db push',
        escapedCommand: '',
        timedOut: false,
        killed: false,
      } as any);

      const result = await supabaseModule.runSupabase(['db', 'push']);

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('something went wrong');
    });

    it('should pass cwd option', async () => {
      mockExeca.mockResolvedValueOnce({
        stdout: '1.123.0',
        stderr: '',
        exitCode: 0,
        failed: false,
        command: 'supabase --version',
        escapedCommand: '',
        timedOut: false,
        killed: false,
      } as any);

      mockExeca.mockResolvedValueOnce({
        stdout: 'output',
        stderr: '',
        exitCode: 0,
        failed: false,
        command: 'supabase status',
        escapedCommand: '',
        timedOut: false,
        killed: false,
      } as any);

      await supabaseModule.runSupabase(['status'], { cwd: '/custom/path' });

      expect(mockExeca).toHaveBeenLastCalledWith(
        'supabase',
        ['status'],
        expect.objectContaining({ cwd: '/custom/path' })
      );
    });

    it('should pass env option', async () => {
      mockExeca.mockResolvedValueOnce({
        stdout: '1.123.0',
        stderr: '',
        exitCode: 0,
        failed: false,
        command: 'supabase --version',
        escapedCommand: '',
        timedOut: false,
        killed: false,
      } as any);

      mockExeca.mockResolvedValueOnce({
        stdout: 'output',
        stderr: '',
        exitCode: 0,
        failed: false,
        command: 'supabase status',
        escapedCommand: '',
        timedOut: false,
        killed: false,
      } as any);

      const customEnv = { SUPABASE_ACCESS_TOKEN: 'test-token' };
      await supabaseModule.runSupabase(['status'], { env: customEnv });

      expect(mockExeca).toHaveBeenLastCalledWith(
        'supabase',
        ['status'],
        expect.objectContaining({ env: customEnv })
      );
    });

    it('should handle exceptions gracefully', async () => {
      mockExeca.mockResolvedValueOnce({
        stdout: '1.123.0',
        stderr: '',
        exitCode: 0,
        failed: false,
        command: 'supabase --version',
        escapedCommand: '',
        timedOut: false,
        killed: false,
      } as any);

      mockExeca.mockRejectedValueOnce(new Error('Network error'));

      const result = await supabaseModule.runSupabase(['db', 'push']);

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Network error');
    });
  });

  describe('requireSupabaseCLI', () => {
    it('should not throw when Supabase CLI is installed', async () => {
      mockExeca.mockResolvedValueOnce({
        stdout: '1.123.0',
        stderr: '',
        exitCode: 0,
        failed: false,
        command: 'supabase --version',
        escapedCommand: '',
        timedOut: false,
        killed: false,
      } as any);

      await expect(supabaseModule.requireSupabaseCLI()).resolves.not.toThrow();
    });

    it('should exit when Supabase CLI is not installed', async () => {
      mockExeca.mockRejectedValueOnce(new Error('command not found'));

      // process.exit is mocked in setup.ts to throw
      await expect(supabaseModule.requireSupabaseCLI()).rejects.toThrow(/process\.exit/);
    });
  });
});
