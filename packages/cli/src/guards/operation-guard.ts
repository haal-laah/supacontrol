import type { ProtectedOperation } from '../config/schema.js';
import {
  allowed,
  requiresConfirmation,
  type GuardContext,
  type GuardResult,
  type RiskLevel,
  type OperationType,
} from './types.js';

/**
 * Risk levels for each operation type
 */
const OPERATION_RISK: Record<OperationType, RiskLevel> = {
  diff: 'low',
  pull: 'low',
  push: 'medium',
  migrate: 'medium',
  seed: 'high',
  reset: 'critical',
  link: 'low',
  unlink: 'medium',
};

/**
 * Check if an operation is protected and requires confirmation
 */
export function checkOperation(context: GuardContext): GuardResult {
  const { operation, environment, environmentName, isCI } = context;

  const riskLevel = OPERATION_RISK[operation] ?? 'medium';

  // Check if this operation is in the protected list
  const isProtected = environment.protected_operations.includes(
    operation as ProtectedOperation
  );

  if (!isProtected) {
    // Not protected, but still include risk level
    return allowed({ riskLevel });
  }

  // Operation is protected - requires confirmation
  const confirmWord = environment.confirm_word ?? environmentName;

  // In CI mode, we need explicit flag instead of interactive confirmation
  if (isCI) {
    return requiresConfirmation(confirmWord, {
      reason: `Operation '${operation}' on '${environmentName}' requires confirmation`,
      riskLevel,
    });
  }

  return requiresConfirmation(confirmWord, {
    reason: `This operation is protected. Type '${confirmWord}' to confirm.`,
    riskLevel,
  });
}

/**
 * Get the risk level for an operation
 */
export function getOperationRiskLevel(operation: OperationType): RiskLevel {
  return OPERATION_RISK[operation] ?? 'medium';
}

/**
 * Guard name for logging/debugging
 */
export const GUARD_NAME = 'operation-guard';
