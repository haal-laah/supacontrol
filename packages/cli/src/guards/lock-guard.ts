import { isEnvironmentLocked } from '../config/schema.js';
import { blocked, allowed, type GuardContext, type GuardResult } from './types.js';

/**
 * Check if an environment is locked and block destructive operations
 *
 * Production environments are locked by default if not explicitly set.
 * Locked environments block ALL destructive operations.
 */
export function checkLock(context: GuardContext): GuardResult {
  const { environmentName, environment, operation } = context;

  // Check if this operation type is affected by locks
  // Read-only operations like 'diff' are always allowed
  const destructiveOperations = ['push', 'reset', 'seed', 'pull', 'migrate'];
  if (!destructiveOperations.includes(operation)) {
    return allowed();
  }

  const isLocked = isEnvironmentLocked(environmentName, environment);

  if (isLocked) {
    return blocked(
      `Environment '${environmentName}' is locked`,
      {
        suggestions: [
          `Set 'locked = false' in supacontrol.toml for [environments.${environmentName}]`,
          `Or use --force flag to override (not recommended for production)`,
        ],
        riskLevel: 'critical',
      }
    );
  }

  return allowed();
}

/**
 * Guard name for logging/debugging
 */
export const GUARD_NAME = 'lock-guard';
