import { Command } from 'commander';
import pc from 'picocolors';
import { loadConfigOrExit } from '../config/loader.js';
import { getEnvironmentByName, listEnvironments } from '../config/resolver.js';
import { runSupabase, requireSupabaseCLI } from '../utils/supabase.js';
import { getCurrentLinkedProject, clearProjectCache } from '../guards/project-guard.js';

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
  } else {
    console.log();
    console.error(pc.red('\u2717'), 'Failed to link to project');
    console.error(pc.dim('  Make sure you are logged in: supabase login'));
    process.exit(result.exitCode);
  }
}
