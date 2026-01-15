import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { blocked, allowed, type GuardContext, type GuardResult } from './types.js';

/**
 * Path to Supabase project ref file (relative to project root)
 */
const PROJECT_REF_PATH = 'supabase/.temp/project-ref';

/**
 * Cache for current linked project
 */
let linkedProjectCache: string | null | undefined;

/**
 * Clear the project cache
 */
export function clearProjectCache(): void {
  linkedProjectCache = undefined;
}

/**
 * Get the currently linked Supabase project ref
 *
 * @param cwd - Directory to search from (defaults to process.cwd())
 * @returns Project ref string, or null if not linked
 */
export async function getCurrentLinkedProject(cwd?: string): Promise<string | null> {
  if (linkedProjectCache !== undefined) {
    return linkedProjectCache;
  }

  const searchDir = cwd ?? process.cwd();
  const refPath = resolve(searchDir, PROJECT_REF_PATH);

  try {
    const content = await readFile(refPath, 'utf-8');
    linkedProjectCache = content.trim();
    return linkedProjectCache;
  } catch (error) {
    // File not found or not readable
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      linkedProjectCache = null;
      return null;
    }
    // Other error - assume not linked
    linkedProjectCache = null;
    return null;
  }
}

/**
 * Check if the currently linked project matches the expected environment
 */
export async function checkProjectMatch(context: GuardContext): Promise<GuardResult> {
  const { environment, environmentName } = context;

  // If no project_ref is configured, skip this check
  if (!environment.project_ref) {
    return allowed({
      suggestions: [
        `Consider adding 'project_ref' to [environments.${environmentName}] for extra safety`,
      ],
    });
  }

  const linkedProject = await getCurrentLinkedProject();

  // If no project is linked, warn but don't block
  if (linkedProject === null) {
    return allowed({
      suggestions: [
        'No Supabase project is currently linked',
        `Run 'supabase link --project-ref ${environment.project_ref}' to link`,
      ],
    });
  }

  // Check if the linked project matches
  if (linkedProject !== environment.project_ref) {
    return blocked(
      `Project mismatch: linked to '${linkedProject}' but '${environmentName}' expects '${environment.project_ref}'`,
      {
        suggestions: [
          `Run 'supabase link --project-ref ${environment.project_ref}' to switch`,
          `Or update [environments.${environmentName}].project_ref in supacontrol.toml`,
        ],
        riskLevel: 'high',
      }
    );
  }

  return allowed();
}

/**
 * Guard name for logging/debugging
 */
export const GUARD_NAME = 'project-guard';
