/**
 * Test Fixtures for Guard System
 *
 * ====================================================================
 * WARNING: DO NOT MODIFY THESE FIXTURES
 * ====================================================================
 *
 * These fixtures define SAFETY-CRITICAL test cases.
 * The guard system prevents accidental production data loss.
 *
 * If a test fails, FIX THE IMPLEMENTATION IN src/guards/, not these fixtures.
 *
 * ====================================================================
 */

import type { GuardContext, OperationType, RiskLevel } from '../../src/guards/types.js';
import type { Config, Environment } from '../../src/config/schema.js';

/**
 * Base environment configs for testing
 */
export const BASE_ENVIRONMENTS: Record<string, Environment> = {
  production: {
    project_ref: 'prod-project-ref',
    git_branches: ['main', 'master'],
    protected_operations: ['push', 'reset', 'seed'],
    confirm_word: 'production',
    locked: true,
  },

  staging: {
    project_ref: 'staging-project-ref',
    git_branches: ['staging', 'develop'],
    protected_operations: ['reset'],
    confirm_word: undefined,
    locked: false,
  },

  unlockedProduction: {
    project_ref: 'prod-project-ref',
    git_branches: ['main'],
    protected_operations: ['push', 'reset'],
    confirm_word: undefined,
    locked: false,
  },

  lockedStaging: {
    project_ref: 'staging-project-ref',
    git_branches: ['staging'],
    protected_operations: [],
    confirm_word: undefined,
    locked: true,
  },

  noProtections: {
    project_ref: 'dev-project-ref',
    git_branches: ['develop'],
    protected_operations: [],
    confirm_word: undefined,
    locked: undefined,
  },
} as const;

/**
 * Base config for testing
 */
export const BASE_CONFIG: Config = {
  settings: {
    strict_mode: false,
    require_clean_git: true,
    show_migration_diff: true,
  },
  environments: {
    production: BASE_ENVIRONMENTS.production,
    staging: BASE_ENVIRONMENTS.staging,
  },
};

/**
 * Helper to create a guard context for testing
 */
export function createTestContext(overrides: Partial<GuardContext> = {}): GuardContext {
  return {
    operation: 'push',
    environmentName: 'staging',
    environment: BASE_ENVIRONMENTS.staging,
    config: BASE_CONFIG,
    gitBranch: 'develop',
    isCI: false,
    hasUncommittedChanges: false,
    ...overrides,
  };
}

/**
 * Lock Guard Test Cases
 *
 * These tests verify that locked environments ALWAYS block operations.
 * This is the primary safety mechanism preventing accidental production changes.
 */
export const LOCK_GUARD_CASES: Array<{
  name: string;
  context: Partial<GuardContext>;
  expectedAllowed: boolean;
  expectedReason?: string;
}> = [
  // === CRITICAL: Locked environments MUST block ===
  {
    name: 'MUST block when locked=true',
    context: {
      environment: BASE_ENVIRONMENTS.production,
      environmentName: 'production',
      operation: 'push',
    },
    expectedAllowed: false,
    expectedReason: 'locked',
  },
  {
    name: 'MUST block reset on locked environment',
    context: {
      environment: BASE_ENVIRONMENTS.production,
      environmentName: 'production',
      operation: 'reset',
    },
    expectedAllowed: false,
    expectedReason: 'locked',
  },
  {
    name: 'should allow safe operations (diff) even when locked',
    context: {
      environment: BASE_ENVIRONMENTS.lockedStaging,
      environmentName: 'staging',
      operation: 'diff',
    },
    expectedAllowed: true,
    // Safe/read-only operations are allowed on locked environments
  },

  // === Unlocked environments should allow ===
  {
    name: 'should allow when locked=false',
    context: {
      environment: BASE_ENVIRONMENTS.staging,
      environmentName: 'staging',
      operation: 'push',
    },
    expectedAllowed: true,
  },
  {
    name: 'should allow when locked is undefined',
    context: {
      environment: BASE_ENVIRONMENTS.noProtections,
      environmentName: 'dev',
      operation: 'push',
    },
    expectedAllowed: true,
  },
];

/**
 * Operation Guard Test Cases
 *
 * These tests verify protected operations require confirmation.
 */
export const OPERATION_GUARD_CASES: Array<{
  name: string;
  context: Partial<GuardContext>;
  expectedAllowed: boolean;
  expectedRequiresConfirmation?: boolean;
  expectedConfirmWord?: string;
}> = [
  // Protected operations
  {
    name: 'should require confirmation for protected operation',
    context: {
      environment: BASE_ENVIRONMENTS.staging,
      environmentName: 'staging',
      operation: 'reset',
    },
    expectedAllowed: true,
    expectedRequiresConfirmation: true,
  },
  {
    name: 'should use confirm_word if specified',
    context: {
      environment: BASE_ENVIRONMENTS.production,
      environmentName: 'production',
      operation: 'reset',
    },
    expectedAllowed: true,
    expectedRequiresConfirmation: true,
    expectedConfirmWord: 'production',
  },

  // Non-protected operations
  {
    name: 'should not require confirmation for non-protected operation',
    context: {
      environment: BASE_ENVIRONMENTS.staging,
      environmentName: 'staging',
      operation: 'push', // not in staging's protected_operations
    },
    expectedAllowed: true,
    expectedRequiresConfirmation: false,
  },
  {
    name: 'should allow all operations when protected_operations is empty',
    context: {
      environment: BASE_ENVIRONMENTS.noProtections,
      environmentName: 'dev',
      operation: 'reset',
    },
    expectedAllowed: true,
    expectedRequiresConfirmation: false,
  },
];

/**
 * Git Guard Test Cases
 *
 * These tests verify git state requirements.
 */
export const GIT_GUARD_CASES: Array<{
  name: string;
  context: Partial<GuardContext>;
  config: Partial<Config>;
  expectedAllowed: boolean;
  expectedReason?: string;
}> = [
  // Uncommitted changes with require_clean_git=true
  {
    name: 'should block when require_clean_git=true and has uncommitted changes',
    context: {
      hasUncommittedChanges: true,
      operation: 'push',
    },
    config: {
      settings: { ...BASE_CONFIG.settings, require_clean_git: true },
    },
    expectedAllowed: false,
    expectedReason: 'uncommitted',
  },

  // Uncommitted changes with require_clean_git=false
  {
    name: 'should allow when require_clean_git=false even with uncommitted changes',
    context: {
      hasUncommittedChanges: true,
      operation: 'push',
    },
    config: {
      settings: { ...BASE_CONFIG.settings, require_clean_git: false },
    },
    expectedAllowed: true,
  },

  // Clean state
  {
    name: 'should allow when git state is clean',
    context: {
      hasUncommittedChanges: false,
      operation: 'push',
    },
    config: {
      settings: { ...BASE_CONFIG.settings, require_clean_git: true },
    },
    expectedAllowed: true,
  },
];

/**
 * Project Guard Test Cases
 *
 * These tests verify project reference validation.
 */
export const PROJECT_GUARD_CASES: Array<{
  name: string;
  context: Partial<GuardContext>;
  linkedProjectRef: string | null;
  expectedAllowed: boolean;
  expectedReason?: string;
}> = [
  // Matching project refs
  {
    name: 'should allow when linked project matches config',
    context: {
      environment: BASE_ENVIRONMENTS.staging,
      environmentName: 'staging',
    },
    linkedProjectRef: 'staging-project-ref',
    expectedAllowed: true,
  },

  // Mismatched project refs
  {
    name: 'MUST block when linked project does not match config',
    context: {
      environment: BASE_ENVIRONMENTS.production,
      environmentName: 'production',
    },
    linkedProjectRef: 'wrong-project-ref',
    expectedAllowed: false,
    expectedReason: 'mismatch',
  },

  // No linked project
  {
    name: 'should warn when no project is linked',
    context: {
      environment: BASE_ENVIRONMENTS.staging,
      environmentName: 'staging',
    },
    linkedProjectRef: null,
    expectedAllowed: false,
    expectedReason: 'not linked',
  },

  // No project_ref in config (local environment)
  {
    name: 'should allow when environment has no project_ref configured',
    context: {
      environment: {
        ...BASE_ENVIRONMENTS.noProtections,
        project_ref: undefined,
      },
      environmentName: 'local',
    },
    linkedProjectRef: null,
    expectedAllowed: true,
  },
];

/**
 * Risk Level Expectations
 *
 * Operations have different risk levels based on context.
 */
export const RISK_LEVEL_CASES: Array<{
  operation: OperationType;
  environment: 'production' | 'staging' | 'dev';
  expectedRisk: RiskLevel;
}> = [
  // Production operations
  { operation: 'reset', environment: 'production', expectedRisk: 'critical' },
  { operation: 'push', environment: 'production', expectedRisk: 'high' },
  { operation: 'seed', environment: 'production', expectedRisk: 'high' },
  { operation: 'diff', environment: 'production', expectedRisk: 'low' },

  // Staging operations
  { operation: 'reset', environment: 'staging', expectedRisk: 'high' },
  { operation: 'push', environment: 'staging', expectedRisk: 'medium' },
  { operation: 'seed', environment: 'staging', expectedRisk: 'medium' },

  // Dev operations (lower risk)
  { operation: 'reset', environment: 'dev', expectedRisk: 'medium' },
  { operation: 'push', environment: 'dev', expectedRisk: 'low' },
];

/**
 * Combined Guard Test Cases
 *
 * These test the full guard pipeline with multiple guards running together.
 */
export const COMBINED_GUARD_CASES: Array<{
  name: string;
  context: Partial<GuardContext>;
  config?: Partial<Config>;
  expectedFinalAllowed: boolean;
  expectedReason?: string;
}> = [
  {
    name: 'should block if ANY guard blocks (lock takes precedence)',
    context: {
      environment: BASE_ENVIRONMENTS.production,
      environmentName: 'production',
      operation: 'push',
      hasUncommittedChanges: false,
    },
    expectedFinalAllowed: false,
    expectedReason: 'locked',
  },
  {
    name: 'should allow if all guards pass',
    context: {
      environment: BASE_ENVIRONMENTS.staging,
      environmentName: 'staging',
      operation: 'diff',
      hasUncommittedChanges: false,
    },
    expectedFinalAllowed: true,
  },
  {
    name: 'git guard should block even if environment is unlocked',
    context: {
      environment: BASE_ENVIRONMENTS.staging,
      environmentName: 'staging',
      operation: 'push',
      hasUncommittedChanges: true,
    },
    config: {
      settings: { ...BASE_CONFIG.settings, require_clean_git: true },
    },
    expectedFinalAllowed: false,
    expectedReason: 'uncommitted',
  },
];
