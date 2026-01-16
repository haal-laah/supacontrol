import { Command } from 'commander';
import pc from 'picocolors';
import * as p from '@clack/prompts';
import { loadConfigOrExit } from '../config/loader.js';
import { getEnvironmentByName, listEnvironments } from '../config/resolver.js';
import { runSupabase, requireSupabaseCLI } from '../utils/supabase.js';
import { getCurrentLinkedProject, clearProjectCache } from '../guards/project-guard.js';
import { checkMigrationSync, syncMigrations } from '../utils/migrations.js';

/**
 * Create the switch command
 */
export function createSwitchCommand(): Command {
  return new Command('switch')
    .description('Switch to a different environment (link to its project)')
    .argument('<environment>', 'Target environment name')
    .action(async (envName: string) => {
      await runSwitch(envName);
    });
}

/**
 * Run the switch command
 */
async function runSwitch(envName: string): Promise<void> {
  // Clear project cache
  clearProjectCache();

  // Check supabase CLI is available
  await requireSupabaseCLI();

  // Load config
  const config = await loadConfigOrExit();

  // Get environment
  const resolved = getEnvironmentByName(envName, config);
  if (!resolved) {
    console.error(pc.red('\u2717'), `Environment '${envName}' not found in config`);
    console.error();
    console.error(pc.dim('Available environments:'));
    for (const name of listEnvironments(config)) {
      const env = config.environments[name];
      if (env) {
        console.error(pc.dim(`  - ${name}${env.project_ref ? ` (${env.project_ref})` : ''}`));
      }
    }
    process.exit(1);
  }

  const currentProject = await getCurrentLinkedProject();

  // Handle local environment (no project_ref)
  if (!resolved.projectRef) {
    if (envName === 'local') {
      console.log(pc.blue('\u2192'), 'Switching to local development');

      if (currentProject) {
        console.log(pc.dim('  Unlinking from remote project...'));
        const result = await runSupabase(['unlink'], { stream: false });
        if (result.success) {
          console.log(pc.green('\u2713'), 'Unlinked from remote project');
          console.log(pc.dim('  Now using local database'));
        } else {
          console.log(pc.yellow('\u26A0'), 'Could not unlink (may already be unlinked)');
        }
      } else {
        console.log(pc.green('\u2713'), 'Already using local database');
      }
      return;
    }

    console.error(pc.red('\u2717'), `Environment '${envName}' has no project_ref configured`);
    console.error(pc.dim(`  Add 'project_ref' to [environments.${envName}] in supacontrol.toml`));
    process.exit(1);
  }

  // Check if already linked to the right project
  if (currentProject === resolved.projectRef) {
    console.log(pc.green('\u2713'), `Already linked to ${pc.cyan(resolved.projectRef)}`);
    console.log(pc.dim(`  Environment: ${envName}`));
    return;
  }

  // Switch to the new project
  console.log(pc.blue('\u2192'), `Switching to ${pc.cyan(envName)}`);

  if (currentProject) {
    console.log(pc.dim(`  From: ${currentProject}`));
  }
  console.log(pc.dim(`  To: ${resolved.projectRef}`));
  console.log();

  const result = await runSupabase(
    ['link', '--project-ref', resolved.projectRef],
    { stream: true }
  );

  if (result.success) {
    console.log();
    console.log(pc.green('\u2713'), `Linked to ${pc.cyan(resolved.projectRef)}`);
    console.log(pc.dim(`  Environment: ${envName}`));
    
    // Check if we need to sync migrations
    console.log();
    await checkAndSyncMigrations();
  } else {
    console.log();
    console.error(pc.red('\u2717'), 'Failed to link to project');
    console.error(pc.dim('  Make sure you are logged in: supabase login'));
    process.exit(result.exitCode);
  }
}

/**
 * Check if remote has migrations we don't have locally, and offer to sync
 */
async function checkAndSyncMigrations(): Promise<void> {
  const syncStatus = await checkMigrationSync();
  
  if (syncStatus.needsSync && syncStatus.remoteMissing.length > 0) {
    console.log(pc.yellow('⚠'), `Remote has ${syncStatus.remoteMissing.length} migration(s) not in local`);
    
    for (const migration of syncStatus.remoteMissing) {
      console.log(pc.dim(`  - ${migration}`));
    }
    
    console.log();
    const shouldSync = await p.confirm({
      message: 'Pull remote migrations to sync local state?',
      initialValue: true,
    });
    
    if (p.isCancel(shouldSync)) {
      return;
    }
    
    if (shouldSync) {
      const success = await syncMigrations();
      if (success) {
        console.log(pc.green('✓'), 'Migrations synced');
      } else {
        console.log(pc.yellow('⚠'), 'Migration sync had issues - check output above');
      }
    } else {
      console.log(pc.dim('Skipped migration sync'));
      console.log(pc.dim('  Run `supabase db pull` manually to sync later'));
    }
  } else if (syncStatus.localMissing.length > 0) {
    // Local has migrations not on remote - this is normal, they need to push
    console.log(pc.blue('→'), `You have ${syncStatus.localMissing.length} local migration(s) to push`);
    console.log(pc.dim('  Run `spc push` when ready'));
  } else {
    console.log(pc.green('✓'), 'Migrations are in sync');
  }
}
