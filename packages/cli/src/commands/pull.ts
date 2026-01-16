import { Command } from 'commander';
import pc from 'picocolors';
import { loadConfigOrExit } from '../config/loader.js';
import { resolveEnvironmentByProjectRef, getEnvironmentByName } from '../config/resolver.js';
import { getCurrentBranch, hasUncommittedChanges, clearGitCache } from '../utils/git.js';
import { runSupabase, requireSupabaseCLI } from '../utils/supabase.js';
import { runGuards, buildGuardContext, clearProjectCache, getCurrentLinkedProject } from '../guards/index.js';
import type { GlobalOptions } from '../index.js';

interface PullOptions extends GlobalOptions {
  force?: boolean;
}

/**
 * Create the pull command
 */
export function createPullCommand(): Command {
  return new Command('pull')
    .description('Pull remote schema changes to local migrations')
    .option('--force', 'Bypass safety guards', false)
    .action(async function (this: Command) {
      const opts = this.optsWithGlobals<PullOptions>();
      await runPull(opts);
    });
}

/**
 * Run the pull command
 */
async function runPull(options: PullOptions): Promise<void> {
  // Clear caches at start of command
  clearGitCache();
  clearProjectCache();

  // Check supabase CLI is available
  await requireSupabaseCLI();

  // Load config
  const config = await loadConfigOrExit();

  // Get current git state
  const gitBranch = await getCurrentBranch();
  const uncommittedChanges = await hasUncommittedChanges();

  // Resolve environment from linked project (not git branch)
  let resolved;
  if (options.env) {
    // Explicit --env flag takes precedence
    resolved = getEnvironmentByName(options.env, config);
    if (!resolved) {
      console.error(pc.red('\u2717'), `Environment '${options.env}' not found in config`);
      console.error(pc.dim('  Available environments:'), Object.keys(config.environments).join(', '));
      process.exit(1);
    }
  } else {
    // Resolve from currently linked Supabase project
    const linkedRef = await getCurrentLinkedProject();
    if (!linkedRef) {
      console.error(pc.red('\u2717'), 'No Supabase project linked');
      console.error(pc.dim('  Run: supacontrol switch <environment>'));
      process.exit(1);
    }
    
    resolved = resolveEnvironmentByProjectRef(linkedRef, config);
    if (!resolved) {
      console.error(pc.red('\u2717'), 'Linked project is not configured in supacontrol.toml');
      console.error(pc.dim(`  Linked to: ${linkedRef}`));
      console.error(pc.dim('  Run: supacontrol init or add this project to your config'));
      process.exit(1);
    }
  }

  // Force mode bypasses guards
  if (options.force) {
    console.log(pc.yellow('\u26A0'), 'Force mode: bypassing safety guards');
    console.log();
  } else {
    // Run guards
    const context = buildGuardContext({
      operation: 'pull',
      environmentName: resolved.name,
      environment: resolved.config,
      config,
      gitBranch,
      isCI: options.ci,
      hasUncommittedChanges: uncommittedChanges,
    });

    const guardResult = await runGuards(context);

    if (!guardResult.allowed) {
      if (guardResult.cancelled) {
        process.exit(0);
      }
      process.exit(1);
    }
  }

  // Execute pull
  console.log(pc.blue('\u2192'), 'Pulling schema from', pc.cyan(resolved.name));
  console.log();

  const result = await runSupabase(['db', 'pull'], { stream: true });

  if (result.success) {
    console.log();
    console.log(pc.green('\u2713'), 'Pull completed successfully');
    console.log(pc.dim('  Review the generated migrations in supabase/migrations/'));
  } else {
    console.log();
    console.error(pc.red('\u2717'), 'Pull failed');
    process.exit(result.exitCode);
  }
}
