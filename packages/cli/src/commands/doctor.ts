import { Command } from 'commander';
import pc from 'picocolors';
import { access, constants } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadConfig } from '../config/loader.js';
import { listEnvironments } from '../config/resolver.js';
import { isEnvironmentLocked } from '../config/schema.js';
import { isSupabaseCLIInstalled, getSupabaseVersion } from '../utils/supabase.js';
import { isGitRepository, getCurrentBranch } from '../utils/git.js';
import { getCurrentLinkedProject } from '../guards/project-guard.js';

interface DoctorOptions {
  verbose?: boolean;
  report?: boolean;
}

interface CheckResult {
  name: string;
  status: 'pass' | 'warn' | 'fail' | 'info';
  message: string;
  details?: string[];
  fix?: string;
}

/**
 * Create the doctor command
 */
export function createDoctorCommand(): Command {
  return new Command('doctor')
    .description('Check for common issues and misconfigurations')
    .option('--verbose', 'Show detailed output', false)
    .option('--report', 'Show summary only', false)
    .action(async (options: DoctorOptions) => {
      await runDoctor(options);
    });
}

/**
 * Run all health checks
 */
async function runDoctor(options: DoctorOptions): Promise<void> {
  console.log();
  console.log(pc.bold('SupaControl Doctor'));
  console.log(pc.dim('Checking your project setup...'));
  console.log();

  const results: CheckResult[] = [];

  // Run all checks
  results.push(await checkSupabaseCLI());
  results.push(await checkGitRepository());
  results.push(await checkSupacontrolConfig());
  results.push(await checkSupabaseProject());
  results.push(await checkLinkedProject());
  results.push(await checkEnvironmentSafety());
  results.push(await checkMigrationsFolder());

  // Count results
  const passes = results.filter((r) => r.status === 'pass').length;
  const warns = results.filter((r) => r.status === 'warn').length;
  const fails = results.filter((r) => r.status === 'fail').length;

  // Print results
  if (!options.report) {
    for (const result of results) {
      printResult(result, options.verbose);
    }
    console.log();
  }

  // Summary
  console.log(pc.bold('Summary'));
  console.log(pc.dim('─'.repeat(40)));
  console.log(`  ${pc.green('\u2713')} ${passes} passed`);
  if (warns > 0) {
    console.log(`  ${pc.yellow('\u26A0')} ${warns} warnings`);
  }
  if (fails > 0) {
    console.log(`  ${pc.red('\u2717')} ${fails} failed`);
  }
  console.log();

  // Tips
  if (warns > 0 || fails > 0) {
    console.log(pc.dim('Fix the issues above to improve your setup.'));
    console.log();
  }

  // Exit with error code if any failures
  if (fails > 0) {
    process.exit(1);
  }
}

/**
 * Print a check result
 */
function printResult(result: CheckResult, verbose?: boolean): void {
  const icon =
    result.status === 'pass'
      ? pc.green('\u2713')
      : result.status === 'warn'
        ? pc.yellow('\u26A0')
        : result.status === 'fail'
          ? pc.red('\u2717')
          : pc.blue('\u2139');

  console.log(`${icon} ${result.name}`);
  console.log(pc.dim(`  ${result.message}`));

  if (verbose && result.details) {
    for (const detail of result.details) {
      console.log(pc.dim(`    - ${detail}`));
    }
  }

  if (result.fix && (result.status === 'warn' || result.status === 'fail')) {
    console.log(pc.dim(`  Fix: ${result.fix}`));
  }

  console.log();
}

/**
 * Check: Supabase CLI installed
 */
async function checkSupabaseCLI(): Promise<CheckResult> {
  const installed = await isSupabaseCLIInstalled();
  if (!installed) {
    return {
      name: 'Supabase CLI',
      status: 'fail',
      message: 'Supabase CLI is not installed',
      fix: 'npm install -g supabase',
    };
  }

  const version = await getSupabaseVersion();
  return {
    name: 'Supabase CLI',
    status: 'pass',
    message: `Installed${version ? ` (v${version})` : ''}`,
  };
}

/**
 * Check: Git repository
 */
async function checkGitRepository(): Promise<CheckResult> {
  const isRepo = await isGitRepository();
  if (!isRepo) {
    return {
      name: 'Git Repository',
      status: 'warn',
      message: 'Not a git repository',
      details: ['Git branch detection will not work', 'Auto-environment switching disabled'],
      fix: 'git init',
    };
  }

  const branch = await getCurrentBranch();
  return {
    name: 'Git Repository',
    status: 'pass',
    message: branch ? `On branch '${branch}'` : 'Repository detected',
  };
}

/**
 * Check: supacontrol.toml exists
 */
async function checkSupacontrolConfig(): Promise<CheckResult> {
  const config = await loadConfig();
  if (!config) {
    return {
      name: 'SupaControl Config',
      status: 'warn',
      message: 'No supacontrol.toml found',
      details: ['Create a config to enable environment protection'],
      fix: 'supacontrol init',
    };
  }

  const envCount = listEnvironments(config).length;
  return {
    name: 'SupaControl Config',
    status: 'pass',
    message: `Loaded with ${envCount} environment${envCount !== 1 ? 's' : ''}`,
  };
}

/**
 * Check: supabase project folder exists
 */
async function checkSupabaseProject(): Promise<CheckResult> {
  const supabasePath = resolve(process.cwd(), 'supabase');

  try {
    await access(supabasePath, constants.F_OK);
    return {
      name: 'Supabase Project',
      status: 'pass',
      message: 'supabase/ directory found',
    };
  } catch {
    return {
      name: 'Supabase Project',
      status: 'warn',
      message: 'No supabase/ directory found',
      details: ['Initialize a Supabase project to use database features'],
      fix: 'supabase init',
    };
  }
}

/**
 * Check: Project is linked
 */
async function checkLinkedProject(): Promise<CheckResult> {
  const linkedProject = await getCurrentLinkedProject();

  if (!linkedProject) {
    return {
      name: 'Linked Project',
      status: 'info',
      message: 'No project linked (using local database)',
      details: ['Link a project to push migrations to remote'],
    };
  }

  return {
    name: 'Linked Project',
    status: 'pass',
    message: `Linked to ${linkedProject}`,
  };
}

/**
 * Check: Environment safety configuration
 */
async function checkEnvironmentSafety(): Promise<CheckResult> {
  const config = await loadConfig();
  if (!config) {
    return {
      name: 'Environment Safety',
      status: 'info',
      message: 'No config to check',
    };
  }

  const envs = listEnvironments(config);
  const lockedEnvs: string[] = [];
  const unlockedProdEnvs: string[] = [];

  for (const name of envs) {
    const env = config.environments[name];
    if (!env) continue;

    const isLocked = isEnvironmentLocked(name, env);
    if (isLocked) {
      lockedEnvs.push(name);
    } else {
      // Check if this looks like production but isn't locked
      const isProdLike =
        name === 'production' ||
        env.git_branches.includes('main') ||
        env.git_branches.includes('master');
      if (isProdLike) {
        unlockedProdEnvs.push(name);
      }
    }
  }

  if (unlockedProdEnvs.length > 0) {
    return {
      name: 'Environment Safety',
      status: 'warn',
      message: `Production environment(s) unlocked: ${unlockedProdEnvs.join(', ')}`,
      details: ['Consider locking production to prevent accidental changes'],
      fix: `supacontrol lock ${unlockedProdEnvs[0]}`,
    };
  }

  if (lockedEnvs.length > 0) {
    return {
      name: 'Environment Safety',
      status: 'pass',
      message: `${lockedEnvs.length} environment${lockedEnvs.length !== 1 ? 's' : ''} locked`,
      details: lockedEnvs.map((e) => `${e} is locked`),
    };
  }

  return {
    name: 'Environment Safety',
    status: 'info',
    message: 'No locked environments',
  };
}

/**
 * Check: Migrations folder exists
 */
async function checkMigrationsFolder(): Promise<CheckResult> {
  const migrationsPath = resolve(process.cwd(), 'supabase/migrations');

  try {
    await access(migrationsPath, constants.F_OK);
    return {
      name: 'Migrations',
      status: 'pass',
      message: 'Migrations directory found',
    };
  } catch {
    return {
      name: 'Migrations',
      status: 'info',
      message: 'No migrations directory',
      details: ['Create migrations with `supabase migration new <name>`'],
    };
  }
}
