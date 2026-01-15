import { execa } from 'execa';

/**
 * Cache for git results within a single command execution
 */
let branchCache: string | null = null;
let dirtyCache: boolean | null = null;
let isRepoCache: boolean | null = null;

/**
 * Clear the git cache (call at start of each CLI command)
 */
export function clearGitCache(): void {
  branchCache = null;
  dirtyCache = null;
  isRepoCache = null;
}

/**
 * Run git command with optional cwd
 */
async function runGit(args: string[], cwd?: string): Promise<string> {
  const result = cwd
    ? await execa('git', args, { cwd })
    : await execa('git', args);
  return typeof result.stdout === 'string' ? result.stdout : '';
}

/**
 * Check if the current directory is inside a git repository
 */
export async function isGitRepository(cwd?: string): Promise<boolean> {
  if (isRepoCache !== null) {
    return isRepoCache;
  }

  try {
    await runGit(['rev-parse', '--is-inside-work-tree'], cwd);
    isRepoCache = true;
    return true;
  } catch {
    isRepoCache = false;
    return false;
  }
}

/**
 * Get the current git branch name
 *
 * @returns Branch name, or null if not in a git repo or detached HEAD
 */
export async function getCurrentBranch(cwd?: string): Promise<string | null> {
  if (branchCache !== null) {
    return branchCache;
  }

  try {
    // First check if we're in a git repo
    const isRepo = await isGitRepository(cwd);
    if (!isRepo) {
      return null;
    }

    // Try to get the symbolic ref (branch name)
    const stdout = await runGit(['symbolic-ref', '--short', 'HEAD'], cwd);
    branchCache = stdout.trim();
    return branchCache;
  } catch {
    // Could be detached HEAD or other error
    branchCache = null;
    return null;
  }
}

/**
 * Check if there are uncommitted changes in the working directory
 *
 * @returns true if there are uncommitted changes
 */
export async function hasUncommittedChanges(cwd?: string): Promise<boolean> {
  if (dirtyCache !== null) {
    return dirtyCache;
  }

  try {
    const isRepo = await isGitRepository(cwd);
    if (!isRepo) {
      // Not a git repo, consider it "clean" for our purposes
      dirtyCache = false;
      return false;
    }

    // Check for staged and unstaged changes
    const stdout = await runGit(['status', '--porcelain'], cwd);
    dirtyCache = stdout.trim().length > 0;
    return dirtyCache;
  } catch {
    // Error checking status, assume dirty to be safe
    dirtyCache = true;
    return true;
  }
}

/**
 * Get the git root directory
 *
 * @returns Root directory path, or null if not in a git repo
 */
export async function getGitRoot(cwd?: string): Promise<string | null> {
  try {
    const isRepo = await isGitRepository(cwd);
    if (!isRepo) {
      return null;
    }

    const stdout = await runGit(['rev-parse', '--show-toplevel'], cwd);
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Get the short hash of the current commit
 *
 * @returns Short commit hash, or null if not in a git repo
 */
export async function getCurrentCommitHash(cwd?: string): Promise<string | null> {
  try {
    const isRepo = await isGitRepository(cwd);
    if (!isRepo) {
      return null;
    }

    const stdout = await runGit(['rev-parse', '--short', 'HEAD'], cwd);
    return stdout.trim();
  } catch {
    return null;
  }
}
