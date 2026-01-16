import { Command } from 'commander';
import pc from 'picocolors';
import * as p from '@clack/prompts';
import { loadConfigOrExit } from '../config/loader.js';
import { resolveEnvironmentByProjectRef, getEnvironmentByName } from '../config/resolver.js';
import { isEnvironmentLocked } from '../config/schema.js';
import { getCurrentBranch, hasUncommittedChanges, clearGitCache } from '../utils/git.js';
import { runSupabase, requireSupabaseCLI } from '../utils/supabase.js';
import { runGuards, buildGuardContext, clearProjectCache, getCurrentLinkedProject } from '../guards/index.js';
import type { GlobalOptions } from '../index.js';

interface ResetOptions extends GlobalOptions {
  force?: boolean;
  linked?: boolean;
  iKnowWhatImDoing?: boolean;
}

/**
 * Create the reset command
 */
export function createResetCommand(): Command {
  return new Command('reset')
    .description('Reset database to match local migrations (DESTRUCTIVE)')
    .option('--force', 'Bypass all safety guards (DANGEROUS)', false)
    .option('--linked', 'Reset the linked remote database instead of local', false)
    .option(
      '--i-know-what-im-doing',
      'Required flag for this operation in CI mode',
      false
    )
    .action(async function (this: Command) {
      const opts = this.optsWithGlobals<ResetOptions>();
      await runReset(opts);
    });
}

/**
 * Run the reset command
 */
async function runReset(options: ResetOptions): Promise<void> {
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

  const isLocked = isEnvironmentLocked(resolved.name, resolved.config);

  // CI mode requires explicit flags
  if (options.ci) {
    if (!options.env) {
      console.error(pc.red('\u2717'), 'CI mode requires explicit --env flag for reset');
      process.exit(1);
    }
    if (!options.iKnowWhatImDoing) {
      console.error(pc.red('\u2717'), 'CI mode requires --i-know-what-im-doing flag for reset');
      process.exit(1);
    }
  }

  // Show critical warning
  console.log();
  p.note(
    [
      pc.bold(pc.red('CRITICAL WARNING')),
      '',
      `This will ${pc.red('DROP ALL TABLES')} and recreate the database`,
      `from your local migrations.`,
      '',
      `Environment: ${pc.cyan(resolved.name)}`,
      options.linked ? `Target: ${pc.red('REMOTE DATABASE')}` : `Target: ${pc.yellow('Local database')}`,
      isLocked ? `\n${pc.red('\u{1F512} Environment is LOCKED')}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    pc.red('\u26A0\uFE0F Database Reset')
  );

  // Force mode bypasses guards (with additional warning)
  if (options.force) {
    console.log();
    console.log(pc.red('\u26A0'), pc.bold('FORCE MODE ENABLED'));
    console.log(pc.red('  All safety guards are being bypassed!'));
    console.log();

    if (!options.ci) {
      const forceConfirm = await p.confirm({
        message: pc.red('Are you absolutely sure you want to proceed?'),
        initialValue: false,
      });

      if (p.isCancel(forceConfirm) || !forceConfirm) {
        p.cancel('Operation cancelled');
        process.exit(0);
      }
    }
  } else {
    // Run guards
    const context = buildGuardContext({
      operation: 'reset',
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

  // Additional confirmation for critical operation
  if (!options.ci && !options.force) {
    const confirmWord = resolved.config.confirm_word ?? resolved.name;

    console.log();
    const finalConfirm = await p.text({
      message: `Type '${pc.bold(pc.red(confirmWord))}' to confirm database reset:`,
      validate(value) {
        if (value !== confirmWord) {
          return `Please type exactly '${confirmWord}' to confirm`;
        }
        return undefined;
      },
    });

    if (p.isCancel(finalConfirm)) {
      p.cancel('Operation cancelled');
      process.exit(0);
    }

    if (finalConfirm !== confirmWord) {
      console.error(pc.red('\u2717'), 'Confirmation failed');
      process.exit(1);
    }
  }

  // Build reset command args
  const resetArgs = ['db', 'reset'];
  if (options.linked) {
    resetArgs.push('--linked');
  }

  // Execute reset
  console.log();
  console.log(pc.blue('\u2192'), 'Resetting database for', pc.cyan(resolved.name));
  console.log();

  const result = await runSupabase(resetArgs, { stream: true });

  if (result.success) {
    console.log();
    console.log(pc.green('\u2713'), 'Database reset completed successfully');
  } else {
    console.log();
    console.error(pc.red('\u2717'), 'Database reset failed');
    process.exit(result.exitCode);
  }
}
