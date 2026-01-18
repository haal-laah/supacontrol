import { blocked, allowed, DESTRUCTIVE_OPERATIONS, type GuardContext, type GuardResult } from './types.js';

/**
 * Check if git working directory is clean when required
 *
 * This guard enforces the require_clean_git setting from config.
 * If enabled, blocks operations when there are uncommitted changes.
 */
export function checkCleanGit(context: GuardContext): GuardResult {
  const { config, hasUncommittedChanges, operation } = context;

  // If setting is disabled, skip this check
  if (!config.settings.require_clean_git) {
    return allowed();
  }

  // Only check for destructive operations
  if (!DESTRUCTIVE_OPERATIONS.includes(operation)) {
    return allowed();
  }

  if (hasUncommittedChanges) {
    return blocked(
      'Git working directory has uncommitted changes',
      {
        suggestions: [
          'Run `git stash` to temporarily store changes',
          'Or run `git commit` to commit your changes',
          'Or set `require_clean_git = false` in supacontrol.toml',
        ],
        riskLevel: 'medium',
      }
    );
  }

  return allowed();
}

/**
 * Guard name for logging/debugging
 */
export const GUARD_NAME = 'git-guard';
