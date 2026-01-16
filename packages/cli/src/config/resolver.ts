import type { Config, Environment } from './schema.js';

/**
 * Result of resolving an environment from git branch
 */
export interface ResolvedEnvironment {
  /** Environment name (e.g., 'staging', 'production') */
  name: string;
  /** Environment configuration */
  config: Environment;
  /** Supabase project reference (if configured) */
  projectRef: string | undefined;
  /** Whether this was an exact match or wildcard/fallback */
  matchType: 'exact' | 'wildcard' | 'fallback';
}

/**
 * Check if a branch matches a pattern (supports wildcards)
 *
 * Patterns:
 * - 'main' - exact match
 * - 'feature/*' - matches 'feature/foo', 'feature/bar/baz'
 * - '*' - matches anything
 */
function matchBranchPattern(branch: string, pattern: string): boolean {
  // Exact match
  if (pattern === branch) {
    return true;
  }

  // Convert glob pattern to regex
  // Escape regex special chars except * and ?
  const regexPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');

  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(branch);
}

/**
 * Resolve which environment a git branch maps to
 *
 * @param branch - Current git branch name (or null if unknown)
 * @param config - Parsed supacontrol config
 * @returns Resolved environment, or null if no match found
 */
export function resolveEnvironment(
  branch: string | null,
  config: Config
): ResolvedEnvironment | null {
  const environments = Object.entries(config.environments);

  if (environments.length === 0) {
    return null;
  }

  // If we don't know the branch, we can't auto-resolve
  if (branch === null) {
    // Check if there's a 'local' environment as fallback
    const localEnv = config.environments['local'];
    if (localEnv) {
      return {
        name: 'local',
        config: localEnv,
        projectRef: localEnv.project_ref,
        matchType: 'fallback',
      };
    }
    return null;
  }

  // First pass: look for exact matches
  for (const [name, env] of environments) {
    if (!env) continue;
    if (env.git_branches.includes(branch)) {
      return {
        name,
        config: env,
        projectRef: env.project_ref,
        matchType: 'exact',
      };
    }
  }

  // Second pass: look for wildcard matches
  for (const [name, env] of environments) {
    if (!env) continue;
    for (const pattern of env.git_branches) {
      if (pattern.includes('*') || pattern.includes('?')) {
        if (matchBranchPattern(branch, pattern)) {
          return {
            name,
            config: env,
            projectRef: env.project_ref,
            matchType: 'wildcard',
          };
        }
      }
    }
  }

  // No match found - check for 'local' fallback
  const localEnv = config.environments['local'];
  if (localEnv) {
    return {
      name: 'local',
      config: localEnv,
      projectRef: localEnv.project_ref,
      matchType: 'fallback',
    };
  }

  return null;
}

/**
 * Get environment by explicit name
 *
 * @param envName - Environment name to look up
 * @param config - Parsed supacontrol config
 * @returns Environment config, or null if not found
 */
export function getEnvironmentByName(
  envName: string,
  config: Config
): ResolvedEnvironment | null {
  const env = config.environments[envName];
  if (!env) {
    return null;
  }

  return {
    name: envName,
    config: env,
    projectRef: env.project_ref,
    matchType: 'exact',
  };
}

/**
 * List all configured environments
 */
export function listEnvironments(config: Config): string[] {
  return Object.keys(config.environments);
}

/**
 * Check if an environment name exists in the config
 */
export function hasEnvironment(envName: string, config: Config): boolean {
  return envName in config.environments;
}

/**
 * Resolve which environment a project ref belongs to
 * 
 * This is the PRIMARY way to determine active environment - based on what
 * Supabase project/branch is currently linked, not the git branch.
 *
 * @param linkedRef - Currently linked Supabase project ref
 * @param config - Parsed supacontrol config
 * @returns Resolved environment, or null if no match found
 */
export function resolveEnvironmentByProjectRef(
  linkedRef: string | null,
  config: Config
): ResolvedEnvironment | null {
  if (!linkedRef) {
    return null;
  }

  const environments = Object.entries(config.environments);

  for (const [name, env] of environments) {
    if (!env) continue;
    if (env.project_ref === linkedRef) {
      return {
        name,
        config: env,
        projectRef: env.project_ref,
        matchType: 'exact',
      };
    }
  }

  return null;
}
