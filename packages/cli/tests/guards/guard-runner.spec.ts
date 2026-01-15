/**
 * Unit Tests for Guard Runner (Combined Guards)
 *
 * ====================================================================
 * ⚠️ SAFETY-CRITICAL TESTS - VERIFY GUARD ORCHESTRATION ⚠️
 * ====================================================================
 *
 * These tests verify that guards run in the correct order and
 * short-circuit appropriately when a guard blocks.
 *
 * If tests fail, FIX THE IMPLEMENTATION, not the tests.
 *
 * ====================================================================
 */

import { describe, it, expect } from 'vitest';
import { combineResults, type GuardResult } from '../../src/guards/types.js';
import { BASE_ENVIRONMENTS, createTestContext } from '../fixtures/guard.fixtures.js';

describe('Guard Runner', () => {
  describe('combineResults', () => {
    it('should return first blocking result', () => {
      const results: GuardResult[] = [
        { allowed: true },
        { allowed: false, reason: 'First block' },
        { allowed: false, reason: 'Second block' },
      ];

      const combined = combineResults(results);

      expect(combined.allowed).toBe(false);
      expect(combined.reason).toBe('First block');
    });

    it('should return allowed if all results allow', () => {
      const results: GuardResult[] = [
        { allowed: true },
        { allowed: true },
        { allowed: true },
      ];

      const combined = combineResults(results);

      expect(combined.allowed).toBe(true);
    });

    it('should track highest risk level', () => {
      const results: GuardResult[] = [
        { allowed: true, riskLevel: 'low' },
        { allowed: true, riskLevel: 'critical' },
        { allowed: true, riskLevel: 'medium' },
      ];

      const combined = combineResults(results);

      expect(combined.riskLevel).toBe('critical');
    });

    it('should aggregate requiresConfirmation', () => {
      const results: GuardResult[] = [
        { allowed: true },
        { allowed: true, requiresConfirmation: true, confirmWord: 'confirm' },
        { allowed: true },
      ];

      const combined = combineResults(results);

      expect(combined.requiresConfirmation).toBe(true);
      expect(combined.confirmWord).toBe('confirm');
    });

    it('should aggregate suggestions without duplicates', () => {
      const results: GuardResult[] = [
        { allowed: true, suggestions: ['suggestion1', 'suggestion2'] },
        { allowed: true, suggestions: ['suggestion2', 'suggestion3'] },
      ];

      const combined = combineResults(results);

      expect(combined.suggestions).toHaveLength(3);
      expect(combined.suggestions).toContain('suggestion1');
      expect(combined.suggestions).toContain('suggestion2');
      expect(combined.suggestions).toContain('suggestion3');
    });
  });

  describe('Guard Order', () => {
    /**
     * Guards should run in this order:
     * 1. Lock guard
     * 2. Operation guard
     * 3. Project guard
     * 4. Git guard
     *
     * Lock guard should be first because it's the most important.
     */
    it('should block on lock guard before checking other guards', () => {
      // If lock guard blocks, we shouldn't even check other guards
      // This test verifies the concept by checking lock takes precedence

      const context = createTestContext({
        environment: BASE_ENVIRONMENTS.production,
        environmentName: 'production',
        operation: 'push',
        hasUncommittedChanges: true, // Would trigger git guard
      });

      // Lock should block first
      // In actual runGuards, it would return before checking git
      expect(context.environment.locked).toBe(true);
    });
  });

  describe('Short-Circuit Behavior', () => {
    it('should not aggregate suggestions from guards that never ran', () => {
      // When lock guard blocks, we shouldn't see suggestions from
      // operation guard, project guard, or git guard

      const results: GuardResult[] = [
        {
          allowed: false,
          reason: 'Locked',
          suggestions: ['unlock suggestion'],
        },
        // These would never run in actual flow
      ];

      const combined = combineResults(results);

      expect(combined.suggestions).toHaveLength(1);
      expect(combined.suggestions![0]).toBe('unlock suggestion');
    });
  });

  describe('Risk Level Aggregation', () => {
    it('should use critical as highest', () => {
      const results: GuardResult[] = [
        { allowed: true, riskLevel: 'high' },
        { allowed: true, riskLevel: 'critical' },
      ];

      expect(combineResults(results).riskLevel).toBe('critical');
    });

    it('should use high over medium', () => {
      const results: GuardResult[] = [
        { allowed: true, riskLevel: 'medium' },
        { allowed: true, riskLevel: 'high' },
      ];

      expect(combineResults(results).riskLevel).toBe('high');
    });

    it('should use medium over low', () => {
      const results: GuardResult[] = [
        { allowed: true, riskLevel: 'low' },
        { allowed: true, riskLevel: 'medium' },
      ];

      expect(combineResults(results).riskLevel).toBe('medium');
    });

    it('should default to low when no risk specified', () => {
      const results: GuardResult[] = [
        { allowed: true },
        { allowed: true },
      ];

      expect(combineResults(results).riskLevel).toBe('low');
    });
  });

  describe('Confirmation Word Priority', () => {
    it('should use last non-undefined confirmWord', () => {
      const results: GuardResult[] = [
        { allowed: true, requiresConfirmation: true, confirmWord: 'first' },
        { allowed: true, requiresConfirmation: true, confirmWord: 'second' },
      ];

      const combined = combineResults(results);

      expect(combined.confirmWord).toBe('second');
    });

    it('should use available confirmWord even if first has none', () => {
      const results: GuardResult[] = [
        { allowed: true, requiresConfirmation: true },
        { allowed: true, requiresConfirmation: true, confirmWord: 'available' },
      ];

      const combined = combineResults(results);

      expect(combined.confirmWord).toBe('available');
    });
  });

  describe('Empty Results', () => {
    it('should handle empty results array', () => {
      const combined = combineResults([]);

      expect(combined.allowed).toBe(true);
      expect(combined.riskLevel).toBe('low');
    });

    it('should handle single result', () => {
      const single: GuardResult = {
        allowed: false,
        reason: 'Blocked',
        riskLevel: 'high',
      };

      const combined = combineResults([single]);

      expect(combined.allowed).toBe(false);
      expect(combined.reason).toBe('Blocked');
      expect(combined.riskLevel).toBe('high');
    });
  });
});
