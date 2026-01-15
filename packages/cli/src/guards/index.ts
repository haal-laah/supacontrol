import pc from 'picocolors';
import { checkLock } from './lock-guard.js';
import { checkOperation, getOperationRiskLevel } from './operation-guard.js';
import { checkProjectMatch } from './project-guard.js';
import { checkCleanGit } from './git-guard.js';
import { requestConfirmation, showOperationSummary } from './confirm.js';
import {
  combineResults,
  type GuardContext,
  type GuardResult,
  type OperationType,
} from './types.js';

// Re-export types and utilities
export * from './types.js';
export { requestConfirmation, showOperationSummary } from './confirm.js';
export { getCurrentLinkedProject, clearProjectCache } from './project-guard.js';
export { getOperationRiskLevel } from './operation-guard.js';

/**
 * Result of running all guards
 */
export interface GuardRunResult extends GuardResult {
  /** Whether confirmation was given (if required) */
  confirmed?: boolean;
  /** Whether user cancelled the operation */
  cancelled?: boolean;
}

/**
 * Run all guards in sequence and optionally request confirmation
 *
 * Order of guards:
 * 1. Lock guard - environment must not be locked
 * 2. Operation guard - check if operation is protected
 * 3. Project guard - verify linked project matches
 * 4. Git guard - verify clean working directory
 *
 * If all guards pass and confirmation is required, prompts the user.
 */
export async function runGuards(context: GuardContext): Promise<GuardRunResult> {
  const results: GuardResult[] = [];

  // 1. Lock guard - most important, check first
  const lockResult = checkLock(context);
  if (!lockResult.allowed) {
    printGuardError(lockResult);
    return lockResult;
  }
  results.push(lockResult);

  // 2. Operation guard - check if this op is protected
  const operationResult = checkOperation(context);
  if (!operationResult.allowed) {
    printGuardError(operationResult);
    return operationResult;
  }
  results.push(operationResult);

  // 3. Project guard - verify we're on the right project
  const projectResult = await checkProjectMatch(context);
  if (!projectResult.allowed) {
    printGuardError(projectResult);
    return projectResult;
  }
  results.push(projectResult);

  // 4. Git guard - verify clean working directory
  const gitResult = checkCleanGit(context);
  if (!gitResult.allowed) {
    printGuardError(gitResult);
    return gitResult;
  }
  results.push(gitResult);

  // Combine all results
  const combined = combineResults(results);

  // If confirmation is required, prompt the user
  if (combined.requiresConfirmation) {
    const riskLevel = combined.riskLevel ?? getOperationRiskLevel(context.operation);

    const { confirmed, cancelled } = await requestConfirmation({
      environmentName: context.environmentName,
      operation: context.operation,
      riskLevel,
      confirmWord: combined.confirmWord,
      isCI: context.isCI,
      reason: combined.reason,
    });

    if (cancelled) {
      return {
        ...combined,
        allowed: false,
        cancelled: true,
      };
    }

    if (!confirmed) {
      return {
        ...combined,
        allowed: false,
        reason: 'Confirmation declined',
      };
    }

    return {
      ...combined,
      allowed: true,
      confirmed: true,
    };
  }

  // Show summary even when no confirmation needed
  showOperationSummary(
    context.operation,
    context.environmentName,
    context.environment.project_ref,
    combined.riskLevel ?? 'low'
  );

  return combined;
}

/**
 * Print guard error with formatting
 */
function printGuardError(result: GuardResult): void {
  console.error();
  console.error(pc.red('\u2717'), result.reason ?? 'Operation blocked');

  if (result.suggestions && result.suggestions.length > 0) {
    console.error();
    console.error(pc.dim('Suggestions:'));
    for (const suggestion of result.suggestions) {
      console.error(pc.dim(`  \u2022 ${suggestion}`));
    }
  }

  console.error();
}

/**
 * Build guard context from common parameters
 */
export function buildGuardContext(params: {
  operation: OperationType;
  environmentName: string;
  environment: GuardContext['environment'];
  config: GuardContext['config'];
  gitBranch: string | null;
  isCI: boolean;
  hasUncommittedChanges: boolean;
}): GuardContext {
  return params;
}
