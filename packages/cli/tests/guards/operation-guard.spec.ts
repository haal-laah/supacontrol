/**
 * Unit Tests for Operation Guard
 *
 * ====================================================================
 * ⚠️ SAFETY-CRITICAL TESTS - PREVENT ACCIDENTAL OPERATIONS ⚠️
 * ====================================================================
 *
 * These tests verify that protected operations require confirmation.
 *
 * If tests fail, FIX THE IMPLEMENTATION, not the tests.
 *
 * ====================================================================
 */

import { describe, it, expect } from 'vitest';
import { checkOperation, getOperationRiskLevel } from '../../src/guards/operation-guard.js';
import { OPERATION_GUARD_CASES, BASE_ENVIRONMENTS, createTestContext } from '../fixtures/guard.fixtures.js';
import type { OperationType, RiskLevel } from '../../src/guards/types.js';

describe('Operation Guard', () => {
  describe('Protected Operations', () => {
    it('should require confirmation for protected operation', () => {
      const context = createTestContext({
        environment: BASE_ENVIRONMENTS.staging,
        environmentName: 'staging',
        operation: 'reset', // 'reset' is in staging's protected_operations
      });

      const result = checkOperation(context);

      expect(result.allowed).toBe(true); // Allowed but needs confirmation
      expect(result.requiresConfirmation).toBe(true);
    });

    it('should use environment name as default confirm word', () => {
      // Staging has no confirm_word, so should use 'staging'
      const context = createTestContext({
        environment: {
          ...BASE_ENVIRONMENTS.staging,
          confirm_word: undefined,
        },
        environmentName: 'staging',
        operation: 'reset',
      });

      const result = checkOperation(context);

      expect(result.confirmWord).toBe('staging');
    });

    it('should use custom confirm_word if specified', () => {
      const context = createTestContext({
        environment: BASE_ENVIRONMENTS.production,
        environmentName: 'production',
        operation: 'reset',
      });

      const result = checkOperation(context);

      expect(result.confirmWord).toBe('production');
    });
  });

  describe('Non-Protected Operations', () => {
    it('should not require confirmation for non-protected operation', () => {
      const context = createTestContext({
        environment: BASE_ENVIRONMENTS.staging,
        environmentName: 'staging',
        operation: 'push', // 'push' is NOT in staging's protected_operations
      });

      const result = checkOperation(context);

      expect(result.allowed).toBe(true);
      expect(result.requiresConfirmation).toBeUndefined();
    });

    it('should allow all operations when protected_operations is empty', () => {
      const operations: OperationType[] = ['push', 'reset', 'seed', 'pull'];

      for (const operation of operations) {
        const context = createTestContext({
          environment: BASE_ENVIRONMENTS.noProtections,
          environmentName: 'dev',
          operation,
        });

        const result = checkOperation(context);

        expect(result.allowed).toBe(true);
        expect(result.requiresConfirmation).toBeUndefined();
      }
    });
  });

  describe('Risk Levels', () => {
    it('should return correct risk level for each operation', () => {
      const expectedRisks: Record<OperationType, RiskLevel> = {
        diff: 'low',
        pull: 'low',
        push: 'medium',
        migrate: 'medium',
        seed: 'high',
        reset: 'critical',
        link: 'low',
        unlink: 'medium',
      };

      for (const [operation, expectedRisk] of Object.entries(expectedRisks)) {
        const risk = getOperationRiskLevel(operation as OperationType);
        expect(risk).toBe(expectedRisk);
      }
    });

    it('should include risk level in result', () => {
      const context = createTestContext({
        environment: BASE_ENVIRONMENTS.staging,
        environmentName: 'staging',
        operation: 'reset',
      });

      const result = checkOperation(context);

      expect(result.riskLevel).toBe('critical');
    });
  });

  describe('CI Mode Behavior', () => {
    it('should require confirmation in CI mode for protected operations', () => {
      const context = createTestContext({
        environment: BASE_ENVIRONMENTS.staging,
        environmentName: 'staging',
        operation: 'reset',
        isCI: true,
      });

      const result = checkOperation(context);

      expect(result.requiresConfirmation).toBe(true);
    });

    it('should include operation name in CI reason', () => {
      const context = createTestContext({
        environment: BASE_ENVIRONMENTS.staging,
        environmentName: 'staging',
        operation: 'reset',
        isCI: true,
      });

      const result = checkOperation(context);

      expect(result.reason).toContain('reset');
    });
  });

  describe('Fixture-Driven Tests', () => {
    for (const testCase of OPERATION_GUARD_CASES) {
      it(testCase.name, () => {
        const context = createTestContext(testCase.context);
        const result = checkOperation(context);

        expect(result.allowed).toBe(testCase.expectedAllowed);

        if (testCase.expectedRequiresConfirmation !== undefined) {
          if (testCase.expectedRequiresConfirmation) {
            expect(result.requiresConfirmation).toBe(true);
          } else {
            expect(result.requiresConfirmation).toBeUndefined();
          }
        }

        if (testCase.expectedConfirmWord !== undefined) {
          expect(result.confirmWord).toBe(testCase.expectedConfirmWord);
        }
      });
    }
  });
});
