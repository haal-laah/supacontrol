import { Command } from 'commander';
import pc from 'picocolors';
import { loadConfig } from '../config/loader.js';
import { resolveEnvironmentByProjectRef } from '../config/resolver.js';
import { isEnvironmentLocked } from '../config/schema.js';
import { getCurrentBranch, hasUncommittedChanges } from '../utils/git.js';
import { getCurrentLinkedProject } from '../guards/project-guard.js';
import { isSupabaseCLIInstalled, getSupabaseVersion } from '../utils/supabase.js';
import { getAccessToken } from '../auth/credentials.js';
import { createSupabaseClient, type Project } from '../api/supabase-client.js';

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
 * Info about the linked project/branch
 */
interface LinkedInfo {
  ref: string;
  type: 'project' | 'branch' | 'unknown';
  name?: string;
  parentProjectName?: string;
  parentProjectRef?: string;
}

/**
 * Resolve a project ref to human-readable info
 */
async function resolveLinkedRef(
  linkedRef: string,
  projects: Project[],
  client: ReturnType<typeof createSupabaseClient>
): Promise<LinkedInfo> {
  // Check if it's a direct project match
  const directMatch = projects.find(p => p.id === linkedRef);
  if (directMatch) {
    return {
      ref: linkedRef,
      type: 'project',
      name: directMatch.name,
    };
  }

  // Not a direct project - check if it's a branch
  for (const project of projects) {
    if (project.status !== 'ACTIVE_HEALTHY') continue;
    
    try {
      const branches = await client.getBranches(project.id);
      const matchingBranch = branches.find(b => b.project_ref === linkedRef);
      
      if (matchingBranch) {
        return {
          ref: linkedRef,
          type: 'branch',
          name: matchingBranch.name,
          parentProjectName: project.name,
          parentProjectRef: project.id,
        };
      }
    } catch {
      // Ignore errors
    }
  }

  return { ref: linkedRef, type: 'unknown' };
}

/**
 * Run the status command
 */
async function runStatus(): Promise<void> {
  console.log();
  console.log(pc.bold('SupaControl Status'));
  console.log(pc.dim('─'.repeat(50)));

  // Load config first - we need it for everything
  const config = await loadConfig();
  
  if (!config) {
    console.log();
    console.log(pc.yellow('⚠'), 'No supacontrol.toml found');
    console.log(pc.dim('  Run: supacontrol init'));
    console.log();
    return;
  }

  // Get linked project
  const linkedRef = await getCurrentLinkedProject();
  
  // Try to resolve linked ref to human-readable info
  let linkedInfo: LinkedInfo | null = null;
  const token = await getAccessToken();
  
  if (linkedRef && token) {
    try {
      const client = createSupabaseClient(token);
      const projects = await client.getProjects();
      linkedInfo = await resolveLinkedRef(linkedRef, projects, client);
    } catch {
      // Silently fail - show raw ref
    }
  }

  // Resolve active environment from linked project ref
  const activeEnv = resolveEnvironmentByProjectRef(linkedRef, config);

  // === ACTIVE ENVIRONMENT (Primary info) ===
  console.log();
  
  if (activeEnv) {
    const isLocked = isEnvironmentLocked(activeEnv.name, activeEnv.config);
    const lockIcon = isLocked ? pc.red('🔒') : pc.green('🔓');
    const statusText = isLocked ? pc.red('LOCKED') : pc.green('unlocked');

    console.log(pc.bold(`Active Environment: ${pc.cyan(activeEnv.name)} ${lockIcon}`));
    
    // Show project info
    if (linkedInfo?.type === 'project') {
      console.log(`  Project: ${linkedInfo.name}`);
    } else if (linkedInfo?.type === 'branch') {
      console.log(`  Project: ${linkedInfo.parentProjectName} ${pc.dim(`(${linkedInfo.name} branch)`)}`);
    } else if (linkedRef) {
      console.log(`  Project: ${linkedRef}`);
    }
    
    console.log(`  Status: ${statusText}`);
    
    if (activeEnv.config.protected_operations.length > 0) {
      console.log(`  Protected: ${pc.yellow(activeEnv.config.protected_operations.join(', '))}`);
    }
  } else if (linkedRef) {
    // Linked to something, but not in config
    console.log(pc.bold(`Active Environment: ${pc.yellow('unknown')}`));
    
    if (linkedInfo?.type === 'project') {
      console.log(`  Linked to: ${linkedInfo.name} ${pc.dim(`(${linkedRef})`)}`);
    } else if (linkedInfo?.type === 'branch') {
      console.log(`  Linked to: ${linkedInfo.name} branch ${pc.dim(`(${linkedRef})`)}`);
      console.log(`  Parent: ${linkedInfo.parentProjectName}`);
    } else {
      console.log(`  Linked to: ${linkedRef}`);
    }
    
    console.log();
    console.log(pc.yellow('  ⚠ This project is not configured in supacontrol.toml'));
    console.log(pc.dim('    Add it to an environment or run: supacontrol init'));
  } else {
    console.log(pc.bold(`Active Environment: ${pc.dim('none')}`));
    console.log(pc.dim('  No Supabase project linked'));
    console.log(pc.dim('  Run: supacontrol switch <environment>'));
  }

  // === GIT INFO (Secondary) ===
  console.log();
  const branch = await getCurrentBranch();
  const dirty = await hasUncommittedChanges();
  
  if (branch) {
    const dirtyIndicator = dirty ? pc.yellow(' *') : '';
    console.log(`Git: ${pc.cyan(branch)}${dirtyIndicator}`);
  } else {
    console.log(`Git: ${pc.dim('not a git repository')}`);
  }

  // === ENVIRONMENTS LIST ===
  const envNames = Object.keys(config.environments);
  
  if (envNames.length > 0) {
    console.log();
    console.log(pc.bold('Environments'));
    
    for (const name of envNames) {
      const env = config.environments[name];
      if (!env) continue;

      const isLocked = isEnvironmentLocked(name, env);
      const lockIcon = isLocked ? pc.red('🔒') : pc.green('🔓');
      const isActive = activeEnv?.name === name;
      
      // Show marker for active environment
      const marker = isActive ? pc.cyan('→') : ' ';
      const activeLabel = isActive ? pc.cyan(' ← active') : '';
      
      console.log(`  ${marker} ${name} ${lockIcon}${activeLabel}`);
    }
  }

  // === SUPABASE CLI INFO (Footer) ===
  console.log();
  const supabaseInstalled = await isSupabaseCLIInstalled();
  if (supabaseInstalled) {
    const version = await getSupabaseVersion();
    console.log(pc.dim(`Supabase CLI v${version}`));
  } else {
    console.log(pc.red('Supabase CLI not installed'));
  }
  
  console.log();
}
