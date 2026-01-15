import type { Config, Environment, ProtectedOperation } from '../config/schema.js';

/**
 * Operations that can be guarded
 */
export type OperationType = ProtectedOperation | 'migrate' | 'diff';

/**
 * Risk level of an operation in the current context
 */
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

/**
 * Result of running a guard check
 */
export interface GuardResult {
  /** Whether the operation is allowed to proceed */
  allowed: boolean;
  /** Human-readable reason if not allowed */
  reason?: string;
  /** Suggestions for how to proceed */
  suggestions?: string[];
  /** Risk level of this operation */
  riskLevel?: RiskLevel;
  /** Whether user confirmation is required (even if allowed) */
  requiresConfirmation?: boolean;
  /** Word the user must type to confirm */
  confirmWord?: string;
}

/**
 * Context passed to guard functions
 */
export interface GuardContext {
  /** The operation being attempted */
  operation: OperationType;
  /** Name of the target environment */
  environmentName: string;
  /** Environment configuration */
  environment: Environment;
  /** Full config */
  config: Config;
  /** Current git branch (null if unknown) */
  gitBranch: string | null;
  /** Whether running in CI mode */
  isCI: boolean;
  /** Whether there are uncommitted changes */
  hasUncommittedChanges: boolean;
}

/**
 * A guard function that checks if an operation should be allowed
 */
export type GuardFn = (context: GuardContext) => GuardResult;

/**
 * Helper to create an allowed result
 */
export function allowed(options?: Partial<GuardResult>): GuardResult {
  return {
    allowed: true,
    ...options,
  };
}

/**
 * Helper to create a blocked result
 */
export function blocked(
  reason: string,
  options?: { suggestions?: string[]; riskLevel?: RiskLevel }
): GuardResult {
  return {
    allowed: false,
    reason,
    ...options,
  };
}

/**
 * Helper to create a result that requires confirmation
 */
export function requiresConfirmation(
  confirmWord: string,
  options?: { reason?: string; riskLevel?: RiskLevel }
): GuardResult {
  return {
    allowed: true,
    requiresConfirmation: true,
    confirmWord,
    ...options,
  };
}

/**
 * Combine multiple guard results
 * Returns the first blocking result, or the highest risk allowed result
 */
export function combineResults(results: GuardResult[]): GuardResult {
  // Check for any blocking results first
  for (const result of results) {
    if (!result.allowed) {
      return result;
    }
  }

  // Find highest risk level and any confirmation requirements
  const riskOrder: RiskLevel[] = ['low', 'medium', 'high', 'critical'];
  let highestRisk: RiskLevel = 'low';
  let needsConfirmation = false;
  let confirmWord: string | undefined;
  const suggestions: string[] = [];

  for (const result of results) {
    if (result.riskLevel) {
      const currentIndex = riskOrder.indexOf(highestRisk);
      const newIndex = riskOrder.indexOf(result.riskLevel);
      if (newIndex > currentIndex) {
        highestRisk = result.riskLevel;
      }
    }

    if (result.requiresConfirmation) {
      needsConfirmation = true;
      if (result.confirmWord) {
        confirmWord = result.confirmWord;
      }
    }

    if (result.suggestions) {
      suggestions.push(...result.suggestions);
    }
  }

  const result: GuardResult = {
    allowed: true,
    riskLevel: highestRisk,
    requiresConfirmation: needsConfirmation,
  };

  if (confirmWord !== undefined) {
    result.confirmWord = confirmWord;
  }

  if (suggestions.length > 0) {
    result.suggestions = [...new Set(suggestions)];
  }

  return result;
}
