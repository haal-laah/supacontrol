/**
 * Unit Tests for Git Guard
 *
 * These tests verify the git clean state guard.
 */

import { describe, it, expect } from 'vitest';
import { checkCleanGit, GUARD_NAME } from '../../src/guards/git-guard.js';
import { createTestContext, BASE_CONFIG, BASE_ENVIRONMENTS } from '../fixtures/guard.fixtures.js';
import { GIT_GUARD_CASES } from '../fixtures/guard.fixtures.js';
import type { OperationType } from '../../src/guards/types.js';

describe('Git Guard', () => {
  describe('When require_clean_git is enabled', () => {
    it('should block when there are uncommitted changes', () => {
      const context = createTestContext({
        hasUncommittedChanges: true,
        operation: 'push',
        config: {
          ...BASE_CONFIG,
          settings: { ...BASE_CONFIG.settings, require_clean_git: true },
        },
      });

      const result = checkCleanGit(context);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('uncommitted');
    });

    it('should allow when working directory is clean', () => {
      const context = createTestContext({
        hasUncommittedChanges: false,
        operation: 'push',
        config: {
          ...BASE_CONFIG,
          settings: { ...BASE_CONFIG.settings, require_clean_git: true },
        },
      });

      const result = checkCleanGit(context);

      expect(result.allowed).toBe(true);
    });

    it('should block for all destructive operations with uncommitted changes', () => {
      const destructiveOps: OperationType[] = ['push', 'reset', 'seed', 'migrate', 'pull'];

      for (const operation of destructiveOps) {
        const context = createTestContext({
          hasUncommittedChanges: true,
          operation,
          config: {
            ...BASE_CONFIG,
            settings: { ...BASE_CONFIG.settings, require_clean_git: true },
          },
        });

        const result = checkCleanGit(context);

        expect(result.allowed).toBe(false);
      }
    });
  });

  describe('When require_clean_git is disabled', () => {
    it('should allow even with uncommitted changes', () => {
      const context = createTestContext({
        hasUncommittedChanges: true,
        operation: 'push',
        config: {
          ...BASE_CONFIG,
          settings: { ...BASE_CONFIG.settings, require_clean_git: false },
        },
      });

      const result = checkCleanGit(context);

      expect(result.allowed).toBe(true);
    });

    it('should allow when clean', () => {
      const context = createTestContext({
        hasUncommittedChanges: false,
        operation: 'push',
        config: {
          ...BASE_CONFIG,
          settings: { ...BASE_CONFIG.settings, require_clean_git: false },
        },
      });

      const result = checkCleanGit(context);

      expect(result.allowed).toBe(true);
    });
  });

  describe('Safe operations', () => {
    it('should allow diff even with uncommitted changes', () => {
      const context = createTestContext({
        hasUncommittedChanges: true,
        operation: 'diff',
        config: {
          ...BASE_CONFIG,
          settings: { ...BASE_CONFIG.settings, require_clean_git: true },
        },
      });

      const result = checkCleanGit(context);

      expect(result.allowed).toBe(true);
    });

    it('should allow link even with uncommitted changes', () => {
      const context = createTestContext({
        hasUncommittedChanges: true,
        operation: 'link',
        config: {
          ...BASE_CONFIG,
          settings: { ...BASE_CONFIG.settings, require_clean_git: true },
        },
      });

      const result = checkCleanGit(context);

      expect(result.allowed).toBe(true);
    });

    it('should allow unlink even with uncommitted changes', () => {
      const context = createTestContext({
        hasUncommittedChanges: true,
        operation: 'unlink',
        config: {
          ...BASE_CONFIG,
          settings: { ...BASE_CONFIG.settings, require_clean_git: true },
        },
      });

      const result = checkCleanGit(context);

      expect(result.allowed).toBe(true);
    });
  });

  describe('Error messages and suggestions', () => {
    it('should provide helpful suggestions when blocked', () => {
      const context = createTestContext({
        hasUncommittedChanges: true,
        operation: 'push',
        config: {
          ...BASE_CONFIG,
          settings: { ...BASE_CONFIG.settings, require_clean_git: true },
        },
      });

      const result = checkCleanGit(context);

      expect(result.suggestions).toBeDefined();
      expect(result.suggestions!.length).toBeGreaterThan(0);
      expect(result.suggestions!.some((s) => s.includes('stash'))).toBe(true);
      expect(result.suggestions!.some((s) => s.includes('commit'))).toBe(true);
    });

    it('should set risk level to medium', () => {
      const context = createTestContext({
        hasUncommittedChanges: true,
        operation: 'push',
        config: {
          ...BASE_CONFIG,
          settings: { ...BASE_CONFIG.settings, require_clean_git: true },
        },
      });

      const result = checkCleanGit(context);

      expect(result.riskLevel).toBe('medium');
    });
  });

  describe('Guard name', () => {
    it('should export guard name', () => {
      expect(GUARD_NAME).toBe('git-guard');
    });
  });

  describe('Fixture-Driven Tests', () => {
    for (const testCase of GIT_GUARD_CASES) {
      it(testCase.name, () => {
        const context = createTestContext({
          ...testCase.context,
          config: {
            ...BASE_CONFIG,
            ...testCase.config,
          },
        });

        const result = checkCleanGit(context);

        expect(result.allowed).toBe(testCase.expectedAllowed);

        if (testCase.expectedReason) {
          expect(result.reason?.toLowerCase()).toContain(testCase.expectedReason.toLowerCase());
        }
      });
    }
  });
});
