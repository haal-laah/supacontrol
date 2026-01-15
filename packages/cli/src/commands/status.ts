import { Command } from 'commander';
import pc from 'picocolors';
import { loadConfig } from '../config/loader.js';
import { resolveEnvironment } from '../config/resolver.js';
import { isEnvironmentLocked } from '../config/schema.js';
import { getCurrentBranch, hasUncommittedChanges } from '../utils/git.js';
import { getCurrentLinkedProject } from '../guards/project-guard.js';
import { isSupabaseCLIInstalled, getSupabaseVersion } from '../utils/supabase.js';

/**
 * Create the status command
 */
export function createStatusCommand(): Command {
  return new Command('status')
    .description('Show current environment and project status')
    .action(async () => {
      await runStatus();
    });
}

/**
 * Run the status command
 */
async function runStatus(): Promise<void> {
  console.log();
  console.log(pc.bold('SupaControl Status'));
  console.log(pc.dim('─'.repeat(40)));
  console.log();

  // Git info
  const branch = await getCurrentBranch();
  const dirty = await hasUncommittedChanges();

  console.log(pc.bold('Git'));
  if (branch) {
    console.log(`  Branch: ${pc.cyan(branch)}${dirty ? pc.yellow(' (uncommitted changes)') : ''}`);
  } else {
    console.log(`  Branch: ${pc.dim('Not in a git repository')}`);
  }
  console.log();

  // Supabase CLI
  const supabaseInstalled = await isSupabaseCLIInstalled();
  console.log(pc.bold('Supabase CLI'));
  if (supabaseInstalled) {
    const version = await getSupabaseVersion();
    console.log(`  Status: ${pc.green('\u2713 Installed')}${version ? ` (v${version})` : ''}`);

    const linkedProject = await getCurrentLinkedProject();
    if (linkedProject) {
      console.log(`  Linked: ${pc.cyan(linkedProject)}`);
    } else {
      console.log(`  Linked: ${pc.dim('No project linked')}`);
    }
  } else {
    console.log(`  Status: ${pc.red('\u2717 Not installed')}`);
    console.log(pc.dim('    Install: npm install -g supabase'));
  }
  console.log();

  // Config
  const config = await loadConfig();
  console.log(pc.bold('Configuration'));
  if (!config) {
    console.log(`  Status: ${pc.yellow('\u26A0 No supacontrol.toml found')}`);
    console.log(pc.dim('    Run: supacontrol init'));
    console.log();
    return;
  }

  console.log(`  Status: ${pc.green('\u2713 Loaded')}`);

  // Settings
  console.log(`  Strict Mode: ${config.settings.strict_mode ? pc.yellow('enabled') : pc.dim('disabled')}`);
  console.log(`  Require Clean Git: ${config.settings.require_clean_git ? pc.green('yes') : pc.dim('no')}`);
  console.log();

  // Environment resolution
  const resolved = resolveEnvironment(branch, config);
  console.log(pc.bold('Environment'));
  if (resolved) {
    const isLocked = isEnvironmentLocked(resolved.name, resolved.config);
    const lockIcon = isLocked ? pc.red('\u{1F512}') : pc.green('\u{1F513}');

    console.log(`  Current: ${pc.cyan(resolved.name)} ${lockIcon}`);
    console.log(`  Match Type: ${pc.dim(resolved.matchType)}`);

    if (resolved.projectRef) {
      console.log(`  Project Ref: ${pc.cyan(resolved.projectRef)}`);
    }

    if (resolved.config.protected_operations.length > 0) {
      console.log(`  Protected Ops: ${pc.yellow(resolved.config.protected_operations.join(', '))}`);
    }

    if (isLocked) {
      console.log(`  ${pc.red('Environment is LOCKED - destructive operations blocked')}`);
    }
  } else {
    console.log(`  Current: ${pc.dim('No environment matches current branch')}`);
    if (branch) {
      console.log(pc.dim(`    Branch '${branch}' not mapped to any environment`));
    }
  }
  console.log();

  // List all environments
  const envNames = Object.keys(config.environments);
  if (envNames.length > 0) {
    console.log(pc.bold('All Environments'));
    for (const name of envNames) {
      const env = config.environments[name];
      if (!env) continue;

      const isLocked = isEnvironmentLocked(name, env);
      const lockIcon = isLocked ? pc.red('\u{1F512}') : pc.green('\u{1F513}');
      const isCurrent = resolved?.name === name;

      console.log(
        `  ${isCurrent ? pc.cyan('\u25B6') : ' '} ${name} ${lockIcon}` +
          (env.git_branches.length > 0 ? pc.dim(` (${env.git_branches.join(', ')})`) : '')
      );
    }
    console.log();
  }
}
