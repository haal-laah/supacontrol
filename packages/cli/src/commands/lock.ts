import { Command } from 'commander';
import pc from 'picocolors';
import * as p from '@clack/prompts';
import { loadConfig, loadConfigOrExit } from '../config/loader.js';
import { resolveEnvironmentByProjectRef, getEnvironmentByName, listEnvironments } from '../config/resolver.js';
import { isEnvironmentLocked } from '../config/schema.js';
import { writeConfig } from '../config/writer.js';
import { getCurrentBranch, clearGitCache } from '../utils/git.js';
import { getCurrentLinkedProject, clearProjectCache } from '../guards/project-guard.js';
import type { GlobalOptions } from '../index.js';

/**
 * Create the lock command
 */
export function createLockCommand(): Command {
  return new Command('lock')
    .description('Lock an environment to prevent destructive operations')
    .argument('[environment]', 'Environment to lock (defaults to current)')
    .action(async function (this: Command, envName?: string) {
      const opts = this.optsWithGlobals<GlobalOptions>();
      await runLock(envName, opts);
    });
}

/**
 * Create the unlock command
 */
export function createUnlockCommand(): Command {
  return new Command('unlock')
    .description('Unlock an environment to allow destructive operations')
    .argument('[environment]', 'Environment to unlock (defaults to current)')
    .action(async function (this: Command, envName?: string) {
      const opts = this.optsWithGlobals<GlobalOptions>();
      await runUnlock(envName, opts);
    });
}

/**
 * Run the lock command
 */
async function runLock(envName: string | undefined, _options: GlobalOptions): Promise<void> {
  clearGitCache();

  const config = await loadConfigOrExit();
  const targetEnv = await resolveTargetEnvironment(envName, config);

  if (!targetEnv) {
    process.exit(1);
  }

  const env = config.environments[targetEnv];
  if (!env) {
    console.error(pc.red('\u2717'), `Environment '${targetEnv}' not found`);
    process.exit(1);
  }

  const isAlreadyLocked = isEnvironmentLocked(targetEnv, env);
  if (isAlreadyLocked) {
    console.log(pc.green('\u2713'), `Environment '${targetEnv}' is already locked`);
    return;
  }

  // Update config
  env.locked = true;
  await writeConfig(config);

  console.log(pc.green('\u2713'), `Locked environment '${pc.cyan(targetEnv)}'`);
  console.log(pc.dim('  Destructive operations are now blocked'));
}

/**
 * Run the unlock command
 */
async function runUnlock(envName: string | undefined, options: GlobalOptions): Promise<void> {
  clearGitCache();

  const config = await loadConfigOrExit();
  const targetEnv = await resolveTargetEnvironment(envName, config);

  if (!targetEnv) {
    process.exit(1);
  }

  const env = config.environments[targetEnv];
  if (!env) {
    console.error(pc.red('\u2717'), `Environment '${targetEnv}' not found`);
    process.exit(1);
  }

  const isLocked = isEnvironmentLocked(targetEnv, env);
  if (!isLocked) {
    console.log(pc.green('\u2713'), `Environment '${targetEnv}' is already unlocked`);
    return;
  }

  // Check if this is a production environment
  const isProduction =
    targetEnv === 'production' ||
    env.git_branches.includes('main') ||
    env.git_branches.includes('master');

  if (isProduction && !options.ci) {
    console.log();
    p.note(
      [
        pc.yellow('Warning: Unlocking production environment'),
        '',
        'This will allow destructive operations like:',
        '  - db push',
        '  - db reset',
        '  - db seed',
      ].join('\n'),
      pc.yellow('\u26A0 Production Unlock')
    );

    const confirmed = await p.confirm({
      message: `Are you sure you want to unlock '${targetEnv}'?`,
      initialValue: false,
    });

    if (p.isCancel(confirmed) || !confirmed) {
      p.cancel('Operation cancelled');
      process.exit(0);
    }
  }

  // Update config
  env.locked = false;
  await writeConfig(config);

  console.log(pc.yellow('\u26A0'), `Unlocked environment '${pc.cyan(targetEnv)}'`);
  console.log(pc.dim('  Destructive operations are now allowed'));
  console.log(pc.dim(`  Run 'supacontrol lock ${targetEnv}' to re-lock`));
}

/**
 * Resolve target environment from argument or current branch
 */
async function resolveTargetEnvironment(
  envName: string | undefined,
  config: Awaited<ReturnType<typeof loadConfig>>
): Promise<string | null> {
  if (!config) {
    return null;
  }

  if (envName) {
    const env = getEnvironmentByName(envName, config);
    if (!env) {
      console.error(pc.red('\u2717'), `Environment '${envName}' not found in config`);
      console.error();
      console.error(pc.dim('Available environments:'));
      for (const name of listEnvironments(config)) {
        console.error(pc.dim(`  - ${name}`));
      }
      return null;
    }
    return envName;
  }

  // Resolve from linked project
  clearProjectCache();
  const linkedRef = await getCurrentLinkedProject();
  
  if (!linkedRef) {
    console.error(pc.red('\u2717'), 'No Supabase project linked');
    console.error(pc.dim('  Specify environment: supacontrol lock <environment>'));
    console.error(pc.dim('  Or run: supacontrol switch <environment>'));
    return null;
  }
  
  const resolved = resolveEnvironmentByProjectRef(linkedRef, config);

  if (!resolved) {
    console.error(pc.red('\u2717'), 'Linked project is not configured in supacontrol.toml');
    console.error(pc.dim('  Specify environment: supacontrol lock <environment>'));
    return null;
  }

  return resolved.name;
}
