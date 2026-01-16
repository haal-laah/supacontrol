import { Command } from 'commander';
import pc from 'picocolors';
import { loadConfigOrExit } from '../config/loader.js';
import { resolveEnvironmentByProjectRef, getEnvironmentByName } from '../config/resolver.js';
import { getCurrentBranch, hasUncommittedChanges, clearGitCache } from '../utils/git.js';
import { runSupabase, requireSupabaseCLI } from '../utils/supabase.js';
import { runGuards, buildGuardContext, clearProjectCache, getCurrentLinkedProject } from '../guards/index.js';
import { interactiveMigrationSync } from '../utils/migrations.js';
import type { GlobalOptions } from '../index.js';

interface PushOptions extends GlobalOptions {
  force?: boolean;
  dryRun?: boolean;
  iKnowWhatImDoing?: boolean;
}

/**
 * Create the push command
 */
export function createPushCommand(): Command {
  return new Command('push')
    .description('Push local migrations to the remote database')
    .option('--force', 'Bypass all safety guards (use with caution)', false)
    .option('--dry-run', 'Show what would be pushed without executing', false)
    .option(
      '--i-know-what-im-doing',
      'Required flag for production operations in CI mode',
      false
    )
    .action(async function (this: Command) {
      const opts = this.optsWithGlobals<PushOptions>();
      await runPush(opts);
    });
}

/**
 * Run the push command
 */
async function runPush(options: PushOptions): Promise<void> {
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
    console.log(pc.yellow('\u26A0'), 'Force mode: bypassing all safety guards');
    console.log();
  } else {
    // Run guards
    const context = buildGuardContext({
      operation: 'push',
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

    // In CI mode with confirmation needed, require --i-know-what-im-doing
    if (options.ci && guardResult.requiresConfirmation && !options.iKnowWhatImDoing) {
      console.error(pc.red('\u2717'), 'CI mode requires --i-know-what-im-doing flag for this operation');
      process.exit(1);
    }
  }

  // Check migration sync before pushing
  if (!options.force) {
    const syncResult = await interactiveMigrationSync();
    if (!syncResult.success) {
      if (syncResult.cancelled) {
        process.exit(0);
      }
      console.log();
      console.log(pc.dim('Use --force to push anyway (not recommended)'));
      process.exit(1);
    }
  }

  // Show migration diff if configured
  if (config.settings.show_migration_diff && !options.dryRun) {
    console.log(pc.blue('\u2192'), 'Checking for pending migrations...');
    console.log();

    const diffResult = await runSupabase(['db', 'diff'], { stream: true });
    if (!diffResult.success && diffResult.exitCode !== 0) {
      console.log(pc.dim('  No pending migrations or diff unavailable'));
    }
    console.log();
  }

  // Dry run mode
  if (options.dryRun) {
    console.log(pc.yellow('\u26A0'), 'Dry run mode: no changes will be made');
    console.log();
    console.log('Would execute:');
    console.log(pc.dim('  supabase db push'));
    console.log();
    return;
  }

  // Execute push
  console.log(pc.blue('\u2192'), 'Pushing migrations to', pc.cyan(resolved.name));
  console.log();

  const result = await runSupabase(['db', 'push'], { stream: true });

  if (result.success) {
    console.log();
    console.log(pc.green('\u2713'), 'Push completed successfully');
  } else {
    console.log();
    console.error(pc.red('\u2717'), 'Push failed');
    process.exit(result.exitCode);
  }
}
