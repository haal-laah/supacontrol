/**
 * Integration Tests for CLI Commands
 *
 * These tests verify the end-to-end behavior of CLI commands,
 * including guard integration and output formatting.
 *
 * Note: These tests mock the Supabase CLI execution but test
 * the full command pipeline including config loading and guards.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Mock modules before importing commands
vi.mock('../../src/utils/supabase.js', () => ({
  isSupabaseCLIInstalled: vi.fn().mockResolvedValue(true),
  getSupabaseVersion: vi.fn().mockResolvedValue('1.150.0'),
  requireSupabaseCLI: vi.fn().mockResolvedValue(undefined),
  runSupabase: vi.fn().mockResolvedValue({ success: true, exitCode: 0, stdout: '', stderr: '' }),
}));

vi.mock('../../src/utils/git.js', () => ({
  getCurrentBranch: vi.fn().mockResolvedValue('develop'),
  hasUncommittedChanges: vi.fn().mockResolvedValue(false),
  clearGitCache: vi.fn(),
}));

vi.mock('../../src/guards/project-guard.js', () => ({
  getCurrentLinkedProject: vi.fn().mockResolvedValue('staging-project-ref'),
  clearProjectCache: vi.fn(),
  checkProjectMatch: vi.fn().mockResolvedValue({ allowed: true }),
  GUARD_NAME: 'project-guard',
}));

// Import after mocks
import { loadConfig } from '../../src/config/loader.js';
import { resolveEnvironment, getEnvironmentByName } from '../../src/config/resolver.js';
import { checkLock } from '../../src/guards/lock-guard.js';
import { checkOperation } from '../../src/guards/operation-guard.js';
import { buildGuardContext, combineResults } from '../../src/guards/index.js';

describe('CLI Commands Integration', () => {
  let testDir: string;
  let capturedOutput: string[];
  let capturedErrors: string[];
  let originalConsoleLog: typeof console.log;
  let originalConsoleError: typeof console.error;

  beforeEach(async () => {
    // Create temp directory
    testDir = join(tmpdir(), `supacontrol-cmd-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });

    // Capture console output
    capturedOutput = [];
    capturedErrors = [];
    originalConsoleLog = console.log;
    originalConsoleError = console.error;
    console.log = (...args: unknown[]) => capturedOutput.push(args.map(String).join(' '));
    console.error = (...args: unknown[]) => capturedErrors.push(args.map(String).join(' '));
  });

  afterEach(async () => {
    // Restore console
    console.log = originalConsoleLog;
    console.error = originalConsoleError;

    // Clean up
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }

    vi.clearAllMocks();
  });

  /**
   * Helper to write config
   */
  async function writeConfig(content: string): Promise<void> {
    await writeFile(join(testDir, 'supacontrol.toml'), content, 'utf-8');
  }

  /**
   * Standard test config
   */
  const STANDARD_CONFIG = `
[settings]
strict_mode = false
require_clean_git = true
show_migration_diff = true

[environments.staging]
project_ref = "staging-project-ref"
git_branches = ["develop", "staging"]
protected_operations = ["reset"]

[environments.production]
project_ref = "prod-project-ref"
git_branches = ["main", "master"]
protected_operations = ["push", "reset", "seed"]
confirm_word = "production"
locked = true
`;

  describe('Guard Integration', () => {
    it('should block push on locked production environment', async () => {
      await writeConfig(STANDARD_CONFIG);
      const config = await loadConfig(testDir);
      expect(config).not.toBeNull();

      const resolved = getEnvironmentByName('production', config!);
      expect(resolved).not.toBeNull();

      const context = buildGuardContext({
        operation: 'push',
        environmentName: resolved!.name,
        environment: resolved!.config,
        config: config!,
        gitBranch: 'main',
        isCI: false,
        hasUncommittedChanges: false,
      });

      const lockResult = checkLock(context);
      expect(lockResult.allowed).toBe(false);
      expect(lockResult.reason).toContain('locked');
    });

    it('should allow push on unlocked staging environment', async () => {
      await writeConfig(STANDARD_CONFIG);
      const config = await loadConfig(testDir);
      expect(config).not.toBeNull();

      const resolved = getEnvironmentByName('staging', config!);
      expect(resolved).not.toBeNull();

      const context = buildGuardContext({
        operation: 'push',
        environmentName: resolved!.name,
        environment: resolved!.config,
        config: config!,
        gitBranch: 'develop',
        isCI: false,
        hasUncommittedChanges: false,
      });

      const lockResult = checkLock(context);
      expect(lockResult.allowed).toBe(true);

      const operationResult = checkOperation(context);
      expect(operationResult.allowed).toBe(true);
      // push is not in staging's protected_operations
      expect(operationResult.requiresConfirmation).toBeUndefined();
    });

    it('should require confirmation for reset on staging', async () => {
      await writeConfig(STANDARD_CONFIG);
      const config = await loadConfig(testDir);
      expect(config).not.toBeNull();

      const resolved = getEnvironmentByName('staging', config!);
      expect(resolved).not.toBeNull();

      const context = buildGuardContext({
        operation: 'reset',
        environmentName: resolved!.name,
        environment: resolved!.config,
        config: config!,
        gitBranch: 'develop',
        isCI: false,
        hasUncommittedChanges: false,
      });

      const lockResult = checkLock(context);
      expect(lockResult.allowed).toBe(true);

      const operationResult = checkOperation(context);
      expect(operationResult.allowed).toBe(true);
      expect(operationResult.requiresConfirmation).toBe(true);
    });
  });

  describe('Environment Resolution', () => {
    it('should resolve staging for develop branch', async () => {
      await writeConfig(STANDARD_CONFIG);
      const config = await loadConfig(testDir);
      expect(config).not.toBeNull();

      const resolved = resolveEnvironment('develop', config!);
      expect(resolved).not.toBeNull();
      expect(resolved!.name).toBe('staging');
    });

    it('should resolve production for main branch', async () => {
      await writeConfig(STANDARD_CONFIG);
      const config = await loadConfig(testDir);
      expect(config).not.toBeNull();

      const resolved = resolveEnvironment('main', config!);
      expect(resolved).not.toBeNull();
      expect(resolved!.name).toBe('production');
    });

    it('should allow --env override', async () => {
      await writeConfig(STANDARD_CONFIG);
      const config = await loadConfig(testDir);
      expect(config).not.toBeNull();

      // Even on develop branch, can target production with --env
      const resolved = getEnvironmentByName('production', config!);
      expect(resolved).not.toBeNull();
      expect(resolved!.name).toBe('production');
    });

    it('should return null for unknown environment name', async () => {
      await writeConfig(STANDARD_CONFIG);
      const config = await loadConfig(testDir);
      expect(config).not.toBeNull();

      const resolved = getEnvironmentByName('nonexistent', config!);
      expect(resolved).toBeNull();
    });
  });

  describe('CI Mode Behavior', () => {
    it('should still require confirmation in CI mode for protected operations', async () => {
      await writeConfig(STANDARD_CONFIG);
      const config = await loadConfig(testDir);
      expect(config).not.toBeNull();

      const resolved = getEnvironmentByName('staging', config!);
      expect(resolved).not.toBeNull();

      const context = buildGuardContext({
        operation: 'reset',
        environmentName: resolved!.name,
        environment: resolved!.config,
        config: config!,
        gitBranch: 'develop',
        isCI: true, // CI mode
        hasUncommittedChanges: false,
      });

      const operationResult = checkOperation(context);
      expect(operationResult.requiresConfirmation).toBe(true);
      // In CI mode, this requires --i-know-what-im-doing flag
    });

    it('should block production operations in CI without explicit unlock', async () => {
      await writeConfig(STANDARD_CONFIG);
      const config = await loadConfig(testDir);
      expect(config).not.toBeNull();

      const resolved = getEnvironmentByName('production', config!);
      expect(resolved).not.toBeNull();

      const context = buildGuardContext({
        operation: 'push',
        environmentName: resolved!.name,
        environment: resolved!.config,
        config: config!,
        gitBranch: 'main',
        isCI: true,
        hasUncommittedChanges: false,
      });

      const lockResult = checkLock(context);
      expect(lockResult.allowed).toBe(false);
      // Production is locked, CI mode doesn't bypass lock
    });
  });

  describe('Guard Combination', () => {
    it('should combine multiple guard results correctly', async () => {
      const results = [
        { allowed: true, riskLevel: 'medium' as const },
        { allowed: true, requiresConfirmation: true, confirmWord: 'staging' },
        { allowed: true, suggestions: ['suggestion1'] },
      ];

      const combined = combineResults(results);

      expect(combined.allowed).toBe(true);
      expect(combined.riskLevel).toBe('medium');
      expect(combined.requiresConfirmation).toBe(true);
      expect(combined.confirmWord).toBe('staging');
      expect(combined.suggestions).toContain('suggestion1');
    });

    it('should stop at first blocking result', async () => {
      const results = [
        { allowed: false, reason: 'Locked', riskLevel: 'critical' as const },
        { allowed: true }, // Should never reach this
      ];

      const combined = combineResults(results);

      expect(combined.allowed).toBe(false);
      expect(combined.reason).toBe('Locked');
    });
  });

  describe('Risk Level Assessment', () => {
    it('should report critical risk for reset operation', async () => {
      await writeConfig(STANDARD_CONFIG);
      const config = await loadConfig(testDir);
      expect(config).not.toBeNull();

      const resolved = getEnvironmentByName('staging', config!);
      expect(resolved).not.toBeNull();

      const context = buildGuardContext({
        operation: 'reset',
        environmentName: resolved!.name,
        environment: resolved!.config,
        config: config!,
        gitBranch: 'develop',
        isCI: false,
        hasUncommittedChanges: false,
      });

      const operationResult = checkOperation(context);
      expect(operationResult.riskLevel).toBe('critical');
    });

    it('should report medium risk for push operation', async () => {
      await writeConfig(STANDARD_CONFIG);
      const config = await loadConfig(testDir);
      expect(config).not.toBeNull();

      const resolved = getEnvironmentByName('staging', config!);
      expect(resolved).not.toBeNull();

      const context = buildGuardContext({
        operation: 'push',
        environmentName: resolved!.name,
        environment: resolved!.config,
        config: config!,
        gitBranch: 'develop',
        isCI: false,
        hasUncommittedChanges: false,
      });

      const operationResult = checkOperation(context);
      expect(operationResult.riskLevel).toBe('medium');
    });
  });

  describe('Config Loading Integration', () => {
    it('should load and parse config correctly', async () => {
      await writeConfig(STANDARD_CONFIG);
      const config = await loadConfig(testDir);

      expect(config).not.toBeNull();
      expect(config!.settings.strict_mode).toBe(false);
      expect(config!.settings.require_clean_git).toBe(true);
      expect(Object.keys(config!.environments)).toHaveLength(2);
    });

    it('should return null for missing config', async () => {
      const config = await loadConfig(testDir);
      expect(config).toBeNull();
    });
  });

  describe('Wildcard Branch Patterns', () => {
    it('should match feature branches with wildcard pattern', async () => {
      await writeConfig(`
[settings]
strict_mode = false
require_clean_git = true
show_migration_diff = true

[environments.preview]
git_branches = ["feature/*", "pr/*"]
protected_operations = []

[environments.production]
git_branches = ["main"]
locked = true
`);

      const config = await loadConfig(testDir);
      expect(config).not.toBeNull();

      const resolved = resolveEnvironment('feature/add-auth', config!);
      expect(resolved).not.toBeNull();
      expect(resolved!.name).toBe('preview');
      expect(resolved!.matchType).toBe('wildcard');
    });
  });
});
