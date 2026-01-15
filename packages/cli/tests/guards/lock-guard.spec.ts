/**
 * Unit Tests for Lock Guard
 *
 * ====================================================================
 * ⚠️ SAFETY-CRITICAL TESTS - PREVENT PRODUCTION DATA LOSS ⚠️
 * ====================================================================
 *
 * These tests verify that locked environments ALWAYS block operations.
 * This is the PRIMARY safety mechanism preventing accidental production changes.
 *
 * If tests fail, FIX THE IMPLEMENTATION, not the tests.
 * NEVER modify these tests to make them pass.
 *
 * ====================================================================
 */

import { describe, it, expect } from 'vitest';
import { checkLock } from '../../src/guards/lock-guard.js';
import { isEnvironmentLocked } from '../../src/config/schema.js';
import { LOCK_GUARD_CASES, BASE_ENVIRONMENTS, createTestContext } from '../fixtures/guard.fixtures.js';
import type { OperationType } from '../../src/guards/types.js';

describe('Lock Guard', () => {
  describe('CRITICAL: Locked environments MUST block', () => {
    /**
     * This is the most important test in the entire codebase.
     * If this fails, production databases are at risk.
     */
    it('MUST block when locked=true', () => {
      const context = createTestContext({
        environment: BASE_ENVIRONMENTS.production,
        environmentName: 'production',
        operation: 'push',
      });

      const result = checkLock(context);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('locked');
    });

    it('MUST block reset on locked environment', () => {
      const context = createTestContext({
        environment: BASE_ENVIRONMENTS.production,
        environmentName: 'production',
        operation: 'reset',
      });

      const result = checkLock(context);

      expect(result.allowed).toBe(false);
    });

    it('MUST block seed on locked environment', () => {
      const context = createTestContext({
        environment: BASE_ENVIRONMENTS.production,
        environmentName: 'production',
        operation: 'seed',
      });

      const result = checkLock(context);

      expect(result.allowed).toBe(false);
    });

    it('MUST block pull on locked environment', () => {
      const context = createTestContext({
        environment: BASE_ENVIRONMENTS.production,
        environmentName: 'production',
        operation: 'pull',
      });

      const result = checkLock(context);

      expect(result.allowed).toBe(false);
    });

    it('MUST block migrate on locked environment', () => {
      const context = createTestContext({
        environment: BASE_ENVIRONMENTS.production,
        environmentName: 'production',
        operation: 'migrate',
      });

      const result = checkLock(context);

      expect(result.allowed).toBe(false);
    });
  });

  describe('Production Default Behavior', () => {
    /**
     * Production environments should be locked by default.
     * This catches cases where someone forgets to set locked=true.
     */
    it('MUST lock production by default when locked is undefined', () => {
      const productionEnv = {
        ...BASE_ENVIRONMENTS.staging,
        locked: undefined,
        git_branches: ['main'], // Having 'main' branch makes it production-like
      };

      // Test using isEnvironmentLocked directly
      expect(isEnvironmentLocked('production', productionEnv)).toBe(true);
    });

    it('MUST lock environments named "production" even without main/master branch', () => {
      const productionEnv = {
        ...BASE_ENVIRONMENTS.staging,
        locked: undefined,
        git_branches: ['prod-branch'], // Not main/master
      };

      expect(isEnvironmentLocked('production', productionEnv)).toBe(true);
    });

    it('MUST lock environments with "main" branch even if not named production', () => {
      const envWithMain = {
        ...BASE_ENVIRONMENTS.staging,
        locked: undefined,
        git_branches: ['main'],
      };

      expect(isEnvironmentLocked('some-other-name', envWithMain)).toBe(true);
    });

    it('MUST lock environments with "master" branch even if not named production', () => {
      const envWithMaster = {
        ...BASE_ENVIRONMENTS.staging,
        locked: undefined,
        git_branches: ['master'],
      };

      expect(isEnvironmentLocked('some-other-name', envWithMaster)).toBe(true);
    });
  });

  describe('Unlocked Environments', () => {
    it('should allow when locked=false', () => {
      const context = createTestContext({
        environment: BASE_ENVIRONMENTS.staging,
        environmentName: 'staging',
        operation: 'push',
      });

      const result = checkLock(context);

      expect(result.allowed).toBe(true);
    });

    it('should allow non-production environments when locked is undefined', () => {
      const context = createTestContext({
        environment: BASE_ENVIRONMENTS.noProtections,
        environmentName: 'dev',
        operation: 'push',
      });

      const result = checkLock(context);

      expect(result.allowed).toBe(true);
    });

    it('should allow all operations on unlocked environments', () => {
      const operations: OperationType[] = ['push', 'reset', 'seed', 'pull', 'migrate'];

      for (const operation of operations) {
        const context = createTestContext({
          environment: BASE_ENVIRONMENTS.staging,
          environmentName: 'staging',
          operation,
        });

        const result = checkLock(context);
        expect(result.allowed).toBe(true);
      }
    });
  });

  describe('Safe Operations', () => {
    /**
     * Read-only operations should be allowed even on locked environments.
     */
    it('should allow diff on locked environment', () => {
      const context = createTestContext({
        environment: BASE_ENVIRONMENTS.production,
        environmentName: 'production',
        operation: 'diff',
      });

      const result = checkLock(context);

      expect(result.allowed).toBe(true);
    });
  });

  describe('Error Messages and Suggestions', () => {
    it('should include environment name in error message', () => {
      const context = createTestContext({
        environment: BASE_ENVIRONMENTS.production,
        environmentName: 'production',
        operation: 'push',
      });

      const result = checkLock(context);

      expect(result.reason).toContain('production');
    });

    it('should provide helpful suggestions', () => {
      const context = createTestContext({
        environment: BASE_ENVIRONMENTS.production,
        environmentName: 'production',
        operation: 'push',
      });

      const result = checkLock(context);

      expect(result.suggestions).toBeDefined();
      expect(result.suggestions!.length).toBeGreaterThan(0);
    });

    it('should indicate critical risk level for locked blocks', () => {
      const context = createTestContext({
        environment: BASE_ENVIRONMENTS.production,
        environmentName: 'production',
        operation: 'push',
      });

      const result = checkLock(context);

      expect(result.riskLevel).toBe('critical');
    });
  });

  describe('Fixture-Driven Tests', () => {
    /**
     * Run all lock guard test cases from fixtures.
     * This ensures consistency between test files.
     */
    for (const testCase of LOCK_GUARD_CASES) {
      it(testCase.name, () => {
        const context = createTestContext(testCase.context);
        const result = checkLock(context);

        expect(result.allowed).toBe(testCase.expectedAllowed);

        if (testCase.expectedReason) {
          expect(result.reason?.toLowerCase()).toContain(testCase.expectedReason.toLowerCase());
        }
      });
    }
  });
});
