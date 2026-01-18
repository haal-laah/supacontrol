/**
 * Unit Tests for Guard Runner
 *
 * These tests verify the guard orchestration (runGuards, buildGuardContext).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock @clack/prompts
vi.mock('@clack/prompts', () => ({
  note: vi.fn(),
  text: vi.fn(),
  confirm: vi.fn(),
  cancel: vi.fn(),
  isCancel: vi.fn(() => false),
}));

// Mock project-guard to avoid real fs operations
vi.mock('../../src/guards/project-guard.js', () => ({
  checkProjectMatch: vi.fn().mockResolvedValue({ allowed: true }),
  getCurrentLinkedProject: vi.fn().mockResolvedValue('test-project-ref'),
  clearProjectCache: vi.fn(),
}));

import * as p from '@clack/prompts';
import { runGuards, buildGuardContext } from '../../src/guards/index.js';
import { checkProjectMatch } from '../../src/guards/project-guard.js';
import { BASE_ENVIRONMENTS, BASE_CONFIG, createTestContext } from '../fixtures/guard.fixtures.js';
import type { GuardContext } from '../../src/guards/types.js';

const mockConfirm = vi.mocked(p.confirm);
const mockText = vi.mocked(p.text);
const mockIsCancel = vi.mocked(p.isCancel);
const mockCheckProjectMatch = vi.mocked(checkProjectMatch);

describe('Guard Runner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsCancel.mockReturnValue(false);
    mockCheckProjectMatch.mockResolvedValue({ allowed: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('runGuards', () => {
    describe('Lock Guard Integration', () => {
      it('should block when environment is locked', async () => {
        const context = createTestContext({
          environment: BASE_ENVIRONMENTS.production,
          environmentName: 'production',
          operation: 'push',
        });

        const result = await runGuards(context);

        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('locked');
      });

      it('should pass when environment is unlocked', async () => {
        mockConfirm.mockResolvedValueOnce(true);

        const context = createTestContext({
          environment: BASE_ENVIRONMENTS.staging,
          environmentName: 'staging',
          operation: 'push',
          hasUncommittedChanges: false,
        });

        const result = await runGuards(context);

        expect(result.allowed).toBe(true);
      });
    });

    describe('Project Guard Integration', () => {
      it('should block when project mismatch', async () => {
        mockCheckProjectMatch.mockResolvedValueOnce({
          allowed: false,
          reason: 'Project mismatch',
        });

        const context = createTestContext({
          environment: BASE_ENVIRONMENTS.staging,
          environmentName: 'staging',
          operation: 'push',
        });

        const result = await runGuards(context);

        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('mismatch');
      });
    });

    describe('Git Guard Integration', () => {
      it('should block when uncommitted changes with require_clean_git=true', async () => {
        const context = createTestContext({
          environment: BASE_ENVIRONMENTS.staging,
          environmentName: 'staging',
          operation: 'push',
          hasUncommittedChanges: true,
          config: {
            ...BASE_CONFIG,
            settings: { ...BASE_CONFIG.settings, require_clean_git: true },
          },
        });

        const result = await runGuards(context);

        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('uncommitted');
      });
    });

    describe('Confirmation Flow', () => {
      it('should request confirmation for protected operations', async () => {
        // reset is 'critical' risk, so it requires typing confirmation word
        mockText.mockResolvedValueOnce('staging');

        const context = createTestContext({
          environment: BASE_ENVIRONMENTS.staging,
          environmentName: 'staging',
          operation: 'reset', // protected in staging, critical risk
          hasUncommittedChanges: false,
        });

        const result = await runGuards(context);

        expect(result.allowed).toBe(true);
        expect(result.confirmed).toBe(true);
      });

      it('should block when confirmation declined', async () => {
        // For critical operations, user must type the word correctly
        // If they type wrong word, confirmation fails
        mockText.mockResolvedValueOnce('wrong-word');

        const context = createTestContext({
          environment: BASE_ENVIRONMENTS.staging,
          environmentName: 'staging',
          operation: 'reset',
          hasUncommittedChanges: false,
        });

        const result = await runGuards(context);

        expect(result.allowed).toBe(false);
      });

      it('should handle user cancellation', async () => {
        mockText.mockResolvedValueOnce(Symbol.for('cancel') as any);
        mockIsCancel.mockReturnValueOnce(true);

        const context = createTestContext({
          environment: BASE_ENVIRONMENTS.staging,
          environmentName: 'staging',
          operation: 'reset',
          hasUncommittedChanges: false,
        });

        const result = await runGuards(context);

        expect(result.allowed).toBe(false);
        expect(result.cancelled).toBe(true);
      });

      it('should fail confirmation in CI mode for protected operations', async () => {
        const context = createTestContext({
          environment: BASE_ENVIRONMENTS.staging,
          environmentName: 'staging',
          operation: 'reset',
          hasUncommittedChanges: false,
          isCI: true,
        });

        const result = await runGuards(context);

        expect(result.allowed).toBe(false);
      });
    });

    describe('Guard Order', () => {
      it('should check lock guard first', async () => {
        // Even with project mismatch, lock should be checked first
        mockCheckProjectMatch.mockResolvedValueOnce({
          allowed: false,
          reason: 'Project mismatch',
        });

        const context = createTestContext({
          environment: BASE_ENVIRONMENTS.production,
          environmentName: 'production',
          operation: 'push',
        });

        const result = await runGuards(context);

        // Lock guard blocks before project guard can run
        expect(result.reason).toContain('locked');
        expect(result.reason).not.toContain('mismatch');
      });
    });
  });

  describe('buildGuardContext', () => {
    it('should create context with all required fields', () => {
      const context = buildGuardContext({
        operation: 'push',
        environmentName: 'staging',
        environment: BASE_ENVIRONMENTS.staging,
        config: BASE_CONFIG,
        gitBranch: 'develop',
        isCI: false,
        hasUncommittedChanges: false,
      });

      expect(context.operation).toBe('push');
      expect(context.environmentName).toBe('staging');
      expect(context.environment).toBe(BASE_ENVIRONMENTS.staging);
      expect(context.config).toBe(BASE_CONFIG);
      expect(context.gitBranch).toBe('develop');
      expect(context.isCI).toBe(false);
      expect(context.hasUncommittedChanges).toBe(false);
    });

    it('should handle null git branch', () => {
      const context = buildGuardContext({
        operation: 'push',
        environmentName: 'staging',
        environment: BASE_ENVIRONMENTS.staging,
        config: BASE_CONFIG,
        gitBranch: null,
        isCI: false,
        hasUncommittedChanges: false,
      });

      expect(context.gitBranch).toBeNull();
    });

    it('should handle CI mode', () => {
      const context = buildGuardContext({
        operation: 'push',
        environmentName: 'production',
        environment: BASE_ENVIRONMENTS.production,
        config: BASE_CONFIG,
        gitBranch: 'main',
        isCI: true,
        hasUncommittedChanges: false,
      });

      expect(context.isCI).toBe(true);
    });
  });
});
