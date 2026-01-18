import { Command } from 'commander';
import { access, constants } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { type GlobalOptions, program, withErrorHandling } from '../index.js';
import { configExists, writeConfig } from '../config/writer.js';
import type { Config } from '../config/schema.js';
import { getOrPromptForToken, getAccessToken } from '../auth/credentials.js';
import { createSupabaseClient, type Project, type Branch, type SupabaseManagementClient } from '../api/supabase-client.js';
import { displayProjectSummary } from '../api/project-selector.js';
import { runSupabase } from '../utils/supabase.js';

/**
 * Check if Supabase is initialized in the project
 */
async function checkSupabaseInit(): Promise<boolean> {
  const configPath = resolve(process.cwd(), 'supabase', 'config.toml');
  try {
    await access(configPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Environment preset options
 */
type EnvPreset = 'local' | 'local-staging' | 'local-staging-production';

const ENV_PRESETS: Record<EnvPreset, { label: string; hint: string }> = {
  local: {
    label: 'Local only',
    hint: 'Just local development with Supabase CLI',
  },
  'local-staging': {
    label: 'Local + Staging',
    hint: 'Local dev + one remote staging environment',
  },
  'local-staging-production': {
    label: 'Local + Staging + Production',
    hint: 'Full setup with staging and production',
  },
};

/**
 * Create environment config based on preset
 */
function createEnvironmentConfig(
  preset: EnvPreset,
  projectRefs: Record<string, string | undefined>
): Config['environments'] {
  const environments: Config['environments'] = {};

  // Local environment is always included but never in config
  // (local is auto-detected)

  if (preset === 'local-staging' || preset === 'local-staging-production') {
    environments['staging'] = {
      project_ref: projectRefs['staging'],
      git_branches: ['develop', 'staging'],
      protected_operations: ['reset'],
      confirm_word: undefined,
      locked: undefined,
    };
  }

  if (preset === 'local-staging-production') {
    environments['production'] = {
      project_ref: projectRefs['production'],
      git_branches: ['main', 'master'],
      protected_operations: ['push', 'reset', 'seed'],
      confirm_word: 'production',
      locked: true,
    };
  }

  return environments;
}

/**
 * Show branching education tip
 */
function showBranchingTip(): void {
  p.note(
    [
      `${pc.bold('Supabase Branching')} is now available!`,
      '',
      'With branching, you can have isolated database environments',
      'for each Git branch or PR, without managing multiple projects.',
      '',
      `Learn more: ${pc.cyan('https://supabase.com/docs/guides/platform/branching')}`,
    ].join('\n'),
    'Pro Tip'
  );
}

/**
 * Result of the branching gate check
 */
type BranchingGateResult = 
  | { canProceed: true; useBranching: false }
  | { canProceed: true; useBranching: true; parentProject: Project; branches: Branch[] }
  | { canProceed: false };

/**
 * Check if user can set up staging + production with their current resources.
 * This gate runs BEFORE environment selection when user picks "Local + Staging + Production".
 * 
 * ALWAYS offers the choice between separate projects or branching.
 */
async function checkBranchingGate(
  client: SupabaseManagementClient,
  projects: Project[]
): Promise<BranchingGateResult> {
  // No projects at all
  if (projects.length === 0) {
    p.note(
      [
        `${pc.red('No Supabase projects found in your account.')}`,
        '',
        'To set up staging + production environments, you need either:',
        '',
        `${pc.cyan('1.')} Two separate Supabase projects`,
        `   ${pc.dim('Create projects at: https://supabase.com/dashboard/projects')}`,
        '',
        `${pc.cyan('2.')} One project with Supabase Branching enabled (Pro plan)`,
        `   ${pc.dim('Your main project = production')}`,
        `   ${pc.dim('A branch = staging')}`,
        `   ${pc.dim('Learn more: https://supabase.com/docs/guides/platform/branching')}`,
      ].join('\n'),
      `${pc.yellow('⚠')} Cannot set up staging + production`
    );

    const fallback = await p.select({
      message: 'What would you like to do?',
      options: [
        { value: 'local-staging', label: 'Continue with Local + Staging only', hint: 'Single remote environment' },
        { value: 'local', label: 'Continue with Local only', hint: 'No remote environments' },
        { value: 'cancel', label: 'Cancel setup', hint: 'Create projects first' },
      ],
    });

    if (p.isCancel(fallback) || fallback === 'cancel') {
      p.cancel('Setup cancelled');
      process.exit(0);
    }

    return { canProceed: false };
  }

  // Check which projects have REAL branching capability
  // This does a proper preflight check, not just trusting is_branch_enabled
  const spinner = p.spinner();
  spinner.start('Checking branching capability...');

  const projectsWithBranching: Array<{ project: Project; branches: Branch[] }> = [];
  
  // Filter to active projects only
  const activeProjects = projects.filter(proj => proj.status === 'ACTIVE_HEALTHY');
  
  // Process in batches to avoid rate limiting (120 req/min)
  const BATCH_SIZE = 10;
  const BATCH_DELAY_MS = 500;
  
  for (let i = 0; i < activeProjects.length; i += BATCH_SIZE) {
    const batch = activeProjects.slice(i, i + BATCH_SIZE);
    
    // Process batch in parallel
    const results = await Promise.all(
      batch.map(async (proj) => {
        const capability = await client.checkBranchingCapability(proj);
        return { proj, capability };
      })
    );
    
    // Collect successful results
    for (const { proj, capability } of results) {
      if (capability.available) {
        projectsWithBranching.push({ 
          project: proj, 
          branches: capability.branches,
        });
      }
    }
    
    // Add delay between batches if more to process (avoid rate limits)
    if (i + BATCH_SIZE < activeProjects.length) {
      await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }

  spinner.stop(
    projectsWithBranching.length > 0
      ? `Found ${projectsWithBranching.length} project${projectsWithBranching.length > 1 ? 's' : ''} with branching`
      : 'No projects with branching capability'
  );

  // Build the choice prompt
  console.log();
  
  const hasMultipleProjects = projects.length >= 2;
  const hasBranchingProjects = projectsWithBranching.length > 0;

  // Always show the strategy selection
  type StrategyChoice = 'separate-projects' | 'use-branching' | 'cancel';
  
  const strategyOptions: Array<{ value: StrategyChoice; label: string; hint: string }> = [];

  if (hasMultipleProjects) {
    strategyOptions.push({
      value: 'separate-projects',
      label: `Use separate Supabase projects (${projects.length} available)`,
      hint: 'Each environment uses its own project',
    });
  }

  if (hasBranchingProjects) {
    const branchingCount = projectsWithBranching.length;
    strategyOptions.push({
      value: 'use-branching',
      label: `Use Supabase Branching (${branchingCount} project${branchingCount > 1 ? 's' : ''} with branching)`,
      hint: 'Main project = production, branch = staging',
    });
  }

  // If neither option is available
  if (strategyOptions.length === 0) {
    const firstProject = projects[0];
    if (!firstProject) {
      p.cancel('No projects found.');
      process.exit(1);
    }
    p.note(
      [
        `${pc.yellow('⚠')} You have 1 project without branching enabled.`,
        '',
        `Project: ${pc.cyan(firstProject.name)}`,
        '',
        'To set up staging + production, you need either:',
        '',
        `${pc.cyan('1.')} Enable Supabase Branching (Pro plan required)`,
        `   ${pc.dim(`https://supabase.com/dashboard/project/${firstProject.id}/settings/general`)}`,
        `   → Main project = production`,
        `   → Branch = staging`,
        '',
        `${pc.cyan('2.')} Create a second Supabase project`,
        `   ${pc.dim('https://supabase.com/dashboard/projects')}`,
      ].join('\n'),
      'Additional Setup Required'
    );

    const choice = await p.select({
      message: 'What would you like to do?',
      options: [
        { value: 'open-branching', label: 'Open branching settings in browser', hint: 'Enable branching, then re-run init' },
        { value: 'open-projects', label: 'Open Supabase dashboard to create project', hint: 'Create second project, then re-run init' },
        { value: 'local-staging', label: 'Continue with Local + Staging only', hint: 'Use single project for staging' },
        { value: 'cancel', label: 'Cancel setup' },
      ],
    });

    if (p.isCancel(choice) || choice === 'cancel') {
      p.cancel('Setup cancelled');
      process.exit(0);
    }

    if (choice === 'open-branching') {
      const url = `https://supabase.com/dashboard/project/${firstProject.id}/settings/general`;
      console.log();
      console.log(pc.cyan('→'), `Open this URL to enable branching:`);
      console.log(pc.dim(`  ${url}`));
      console.log();
      console.log(pc.dim('After enabling branching, run `supacontrol init` again.'));
      process.exit(0);
    }

    if (choice === 'open-projects') {
      const url = 'https://supabase.com/dashboard/projects';
      console.log();
      console.log(pc.cyan('→'), `Open this URL to create a new project:`);
      console.log(pc.dim(`  ${url}`));
      console.log();
      console.log(pc.dim('After creating a project, run `supacontrol init` again.'));
      process.exit(0);
    }

    return { canProceed: false };
  }

  strategyOptions.push({
    value: 'cancel',
    label: pc.dim('Cancel setup'),
    hint: '',
  });

  // Show strategy selection
  p.note(
    [
      'You selected Local + Staging + Production.',
      '',
      `${pc.bold('Separate projects:')} Each environment uses its own Supabase project.`,
      `${pc.dim('  Best for: Complete isolation between environments')}`,
      '',
      `${pc.bold('Supabase Branching:')} Production uses main project, staging uses a branch.`,
      `${pc.dim('  Best for: Easier schema sync, single billing, team workflows')}`,
    ].join('\n'),
    'Environment Strategy'
  );

  const strategy = await p.select({
    message: 'How would you like to configure your environments?',
    options: strategyOptions,
  });

  if (p.isCancel(strategy) || strategy === 'cancel') {
    p.cancel('Setup cancelled');
    process.exit(0);
  }

  if (strategy === 'use-branching') {
    // Let user pick which project to use for branching (if multiple have it)
    let selectedBranchingProject = projectsWithBranching[0];
    if (!selectedBranchingProject) {
      p.cancel('No projects with branching found.');
      process.exit(1);
    }

    if (projectsWithBranching.length > 1) {
      const projectChoice = await p.select({
        message: 'Which project should be your production environment?',
        options: projectsWithBranching.map(({ project: proj, branches }) => ({
          value: proj.id,
          label: `${proj.name} ${pc.dim(`(${proj.region})`)} ${pc.green('[Active]')}`,
          hint: branches.length > 0 ? `${branches.length} existing branch${branches.length > 1 ? 'es' : ''}` : 'No branches yet',
        })),
      });

      if (p.isCancel(projectChoice)) {
        p.cancel('Setup cancelled');
        process.exit(0);
      }

      const found = projectsWithBranching.find(item => item.project.id === projectChoice);
      if (found) {
        selectedBranchingProject = found;
      }
    }

    return {
      canProceed: true,
      useBranching: true,
      parentProject: selectedBranchingProject.project,
      branches: selectedBranchingProject.branches,
    };
  }

  // User chose separate projects
  return { canProceed: true, useBranching: false };
}

/**
 * Select or create a branch for staging environment
 * 
 * Handles three scenarios:
 * 1. No non-default branches exist → Create "staging" automatically
 * 2. One non-default branch exists → Ask user if they want to use it or create new
 * 3. Multiple non-default branches → Let user choose which one to use or create new
 */
async function selectOrCreateBranch(
  client: SupabaseManagementClient,
  parentProject: Project,
  existingBranches: Branch[]
): Promise<string> {
  // Get non-default branches (these are the actual "feature" branches)
  const nonDefaultBranches = existingBranches.filter((b) => !b.is_default);
  
  // Check if a "staging" branch already exists
  const existingStagingBranch = nonDefaultBranches.find(
    (b) => b.name.toLowerCase() === 'staging'
  );

  // SCENARIO 1: No non-default branches - create "staging" automatically
  if (nonDefaultBranches.length === 0) {
    console.log(pc.dim('No existing branches found. Creating "staging" branch...'));
    return createNewBranch(client, parentProject, existingBranches, 'staging');
  }

  // SCENARIO 2: Exactly one non-default branch - ask user about it
  if (nonDefaultBranches.length === 1) {
    const singleBranch = nonDefaultBranches[0];
    if (!singleBranch) {
      p.cancel('No branches found.');
      process.exit(1);
    }
    const isStagingNamed = singleBranch.name.toLowerCase() === 'staging';
    
    console.log(pc.green('✓'), `Found existing branch: "${singleBranch.name}"`);
    
    // Show branch details
    p.note(
      [
        `${pc.bold('Branch details:')}`,
        `  Name: ${pc.cyan(singleBranch.name)}`,
        `  Ref: ${pc.dim(singleBranch.project_ref)}`,
        `  Status: ${singleBranch.status}`,
        '',
        isStagingNamed 
          ? pc.dim('This branch is named "staging" - likely intended for staging environment.')
          : pc.yellow('This branch has a custom name. Please confirm its intended use.'),
      ].join('\n'),
      'Existing Branch Found'
    );

    type BranchChoice = 'use' | 'create' | 'cancel';
    const branchOptions: Array<{ value: BranchChoice; label: string; hint?: string }> = [];
    
    branchOptions.push({ 
      value: 'use', 
      label: `Use "${singleBranch.name}" as staging environment`,
    });
    if (isStagingNamed && branchOptions[0]) {
      branchOptions[0].hint = 'Recommended';
    }
    
    branchOptions.push({ 
      value: 'create', 
      label: 'Create a new "staging" branch instead',
      hint: 'This branch may be for another purpose',
    });
    branchOptions.push({ 
      value: 'cancel', 
      label: pc.dim('Cancel setup'),
      hint: 'Let me check this first',
    });

    const choice = await p.select({
      message: `What would you like to do with this branch?`,
      options: branchOptions,
    });

    if (p.isCancel(choice) || choice === 'cancel') {
      p.cancel('Setup cancelled');
      process.exit(0);
    }

    if (choice === 'use') {
      return singleBranch.project_ref;
    }

    // User chose to create a new branch
    const suggestedName = existingStagingBranch ? 'staging-env' : 'staging';
    return createNewBranch(client, parentProject, existingBranches, suggestedName);
  }

  // SCENARIO 3: Multiple non-default branches - let user choose
  console.log(pc.green('✓'), `Found ${nonDefaultBranches.length} existing branches`);
  
  p.note(
    [
      `${pc.bold('Existing branches:')}`,
      ...nonDefaultBranches.map((b) => `  • ${b.name} ${pc.dim(`(ref: ${b.project_ref})`)}`),
      '',
      pc.yellow('Please select which branch to use for staging, or create a new one.'),
    ].join('\n'),
    'Multiple Branches Found'
  );

  const options: Array<{ value: string; label: string; hint?: string }> = [];

  // Add existing branches - prioritize "staging" if it exists
  const sortedBranches = [...nonDefaultBranches].sort((a, b) => {
    // Put "staging" first
    if (a.name.toLowerCase() === 'staging') return -1;
    if (b.name.toLowerCase() === 'staging') return 1;
    return a.name.localeCompare(b.name);
  });

  for (const branch of sortedBranches) {
    const isStagingNamed = branch.name.toLowerCase() === 'staging';
    options.push({
      value: branch.project_ref,
      label: `"${branch.name}"`,
      hint: isStagingNamed ? 'Recommended - named "staging"' : `ref: ${branch.project_ref}`,
    });
  }

  // Add create new branch option
  options.push({
    value: '__create__',
    label: pc.cyan('+ Create a new branch'),
    hint: 'Creates a new branch for staging',
  });

  // Add cancel option
  options.push({
    value: '__cancel__',
    label: pc.dim('Cancel setup'),
    hint: 'Let me check these branches first',
  });

  const selected = await p.select({
    message: 'Select a branch for staging environment:',
    options,
  });

  if (p.isCancel(selected) || selected === '__cancel__') {
    p.cancel('Setup cancelled');
    process.exit(0);
  }

  if (selected === '__create__') {
    const suggestedName = existingStagingBranch ? 'staging-env' : 'staging';
    return createNewBranch(client, parentProject, existingBranches, suggestedName);
  }

  return selected as string;
}

/**
 * Create a new branch for staging environment
 */
async function createNewBranch(
  client: SupabaseManagementClient,
  parentProject: Project,
  existingBranches: Branch[],
  suggestedName: string
): Promise<string> {
  const branchName = await p.text({
    message: 'Enter a name for the new branch:',
    placeholder: suggestedName,
    defaultValue: suggestedName,
    validate: (value) => {
      if (!value || value.trim().length === 0) {
        return 'Branch name is required';
      }
      if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
        return 'Branch name can only contain letters, numbers, hyphens, and underscores';
      }
      if (existingBranches.some((b) => b.name.toLowerCase() === value.toLowerCase())) {
        return 'A branch with this name already exists';
      }
      return undefined;
    },
  });

  if (p.isCancel(branchName)) {
    p.cancel('Setup cancelled');
    process.exit(0);
  }

  const spinner = p.spinner();
  spinner.start(`Creating branch "${branchName}"...`);

  try {
    const newBranch = await client.createBranch(parentProject.id, branchName as string);

    if (!newBranch) {
      spinner.stop('Failed to create branch');
      p.cancel('Could not parse branch response. Please try again.');
      process.exit(1);
    }

    spinner.stop(`Branch "${branchName}" created`);
    console.log(pc.green('✓'), `Branch ref: ${pc.dim(newBranch.project_ref)}`);

    // Auto-link and pull migrations from the new branch
    await syncMigrationsFromBranch(newBranch.project_ref);

    return newBranch.project_ref;
  } catch (error) {
    spinner.stop('Failed to create branch');
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(pc.red('✗'), errorMessage);
    
    // Provide helpful guidance based on common errors
    if (errorMessage.includes('branch limit') || errorMessage.includes('limit')) {
      console.log();
      console.log(pc.yellow('This may be a plan limitation:'));
      console.log(pc.dim('  • Check your branch limit at:'));
      console.log(pc.dim(`    https://supabase.com/dashboard/project/${parentProject.id}/settings/general`));
    }
    
    console.log();
    p.cancel('Could not create branch.');
    process.exit(1);
  }
}

/**
 * Link to a branch and pull its migrations to sync local state
 * This ensures we have the initial migration that Supabase creates automatically
 */
async function syncMigrationsFromBranch(branchRef: string): Promise<void> {
  const spinner = p.spinner();
  
  // First, link to the branch
  spinner.start('Linking to branch...');
  const linkResult = await runSupabase(['link', '--project-ref', branchRef], { stream: false });
  
  if (!linkResult.success) {
    spinner.stop('Failed to link');
    console.log(pc.yellow('⚠'), 'Could not link to branch automatically');
    console.log(pc.dim(`  Run manually: supabase link --project-ref ${branchRef}`));
    return;
  }
  spinner.stop('Linked to branch');

  // Now pull migrations to sync
  spinner.start('Syncing migrations from remote...');
  const pullResult = await runSupabase(['db', 'pull'], { stream: false });
  
  if (pullResult.success) {
    spinner.stop('Migrations synced');
    console.log(pc.green('✓'), 'Remote migrations pulled to local');
  } else {
    spinner.stop('Migration sync skipped');
    // This is okay - might mean no remote migrations yet
    console.log(pc.dim('  No remote migrations to sync (this is normal for new branches)'));
  }
}

/**
 * Show next steps after init
 */
function showNextSteps(preset: EnvPreset): void {
  const steps = [
    `${pc.cyan('1.')} Review ${pc.bold('supacontrol.toml')} and adjust as needed`,
  ];

  if (preset !== 'local') {
    steps.push(`${pc.cyan('2.')} Run ${pc.bold('supacontrol switch <env>')} to link a project`);
    steps.push(`${pc.cyan('3.')} Run ${pc.bold('supacontrol status')} to verify setup`);
  } else {
    steps.push(`${pc.cyan('2.')} Run ${pc.bold('supacontrol status')} to verify setup`);
  }

  steps.push(`${pc.cyan(steps.length + 1 + '.')} Run ${pc.bold('supacontrol push')} to push migrations`);

  console.log();
  console.log(pc.bold('Next steps:'));
  for (const step of steps) {
    console.log(`  ${step}`);
  }
  console.log();
}

/**
 * Init command action
 */
async function initAction(): Promise<void> {
  const opts = program.opts<GlobalOptions>();

  p.intro(pc.bgCyan(pc.black(' SupaControl Setup ')));

  // Step 1: Check for supabase init
  const hasSupabase = await checkSupabaseInit();
  if (!hasSupabase) {
    p.cancel('Supabase not initialized');
    console.error(pc.red('✗'), 'No supabase/config.toml found');
    console.error(pc.dim('  Run `supabase init` first to initialize Supabase'));
    process.exit(1);
  }
  console.log(pc.green('✓'), 'Supabase project detected');

  // Step 2: Check for existing supacontrol.toml
  const hasConfig = await configExists();
  if (hasConfig) {
    const overwrite = await p.confirm({
      message: 'supacontrol.toml already exists. Overwrite?',
      initialValue: false,
    });

    if (p.isCancel(overwrite) || !overwrite) {
      p.cancel('Setup cancelled');
      process.exit(0);
    }
  }

  // Step 3: Ask about environment setup
  let preset = await p.select({
    message: 'How many environments do you need?',
    options: [
      { value: 'local' as EnvPreset, ...ENV_PRESETS.local },
      { value: 'local-staging' as EnvPreset, ...ENV_PRESETS['local-staging'] },
      {
        value: 'local-staging-production' as EnvPreset,
        ...ENV_PRESETS['local-staging-production'],
      },
    ],
  });

  if (p.isCancel(preset)) {
    p.cancel('Setup cancelled');
    process.exit(0);
  }

  const projectRefs: Record<string, string | undefined> = {};
  let branchingContext: { parentProject: Project; branches: Branch[] } | null = null;

  // Step 4: If remote environments, get access token and fetch projects
  if (preset !== 'local') {
    // Check for existing token first
    let token = await getAccessToken();

    if (!token) {
      // CI mode: require token to be set
      if (opts.ci) {
        p.cancel('No access token found');
        console.error(pc.red('✗'), 'SUPABASE_ACCESS_TOKEN not set');
        console.error(pc.dim('  Set the environment variable or run interactively'));
        process.exit(1);
      }

      token = await getOrPromptForToken({ saveToken: true });
      if (!token) {
        p.cancel('Setup cancelled');
        process.exit(0);
      }
    } else {
      console.log(pc.green('✓'), 'Using saved access token');
    }

    // Create API client and validate token
    const client = createSupabaseClient(token as string);

    const spinner = p.spinner();
    spinner.start('Validating access token...');

    const isValid = await client.authenticate();
    if (!isValid) {
      spinner.stop('Invalid token');
      p.cancel('Invalid or expired access token');
      console.error(pc.dim('  Generate a new token at https://supabase.com/dashboard/account/tokens'));
      process.exit(1);
    }
    spinner.stop('Token validated');

    // Fetch projects once
    const projects = await client.getProjects();

    // Step 4.5: BRANCHING GATE - Check if user can set up staging + production
    if (preset === 'local-staging-production') {
      const gateResult = await checkBranchingGate(client, projects);

      if (!gateResult.canProceed) {
        // User chose to downgrade to local-staging or local
        // Re-prompt for their choice
        const fallbackPreset = await p.select({
          message: 'Continue with a different setup?',
          options: [
            { value: 'local-staging' as EnvPreset, label: 'Local + Staging', hint: 'Single remote environment' },
            { value: 'local' as EnvPreset, label: 'Local only', hint: 'No remote environments' },
            { value: 'cancel', label: 'Cancel setup' },
          ],
        });

        if (p.isCancel(fallbackPreset) || fallbackPreset === 'cancel') {
          p.cancel('Setup cancelled');
          process.exit(0);
        }

        preset = fallbackPreset as EnvPreset;
      } else if (gateResult.useBranching) {
        // User wants to use branching
        branchingContext = {
          parentProject: gateResult.parentProject,
          branches: gateResult.branches,
        };
      }
    }

    // Step 5: Select projects/branches for each environment
    if (preset === 'local-staging-production' && branchingContext) {
      // BRANCHING FLOW: main project = production, branch = staging
      console.log();
      console.log(pc.bold(`Configure ${pc.cyan('production')} environment:`));
      console.log(pc.green('✓'), `Using main project: ${pc.cyan(branchingContext.parentProject.name)}`);
      projectRefs['production'] = branchingContext.parentProject.id;
      displayProjectSummary(branchingContext.parentProject);

      console.log();
      console.log(pc.bold(`Configure ${pc.cyan('staging')} environment:`));
      const stagingRef = await selectOrCreateBranch(client, branchingContext.parentProject, branchingContext.branches);
      projectRefs['staging'] = stagingRef;
    } else if (preset !== 'local') {
      // STANDARD FLOW: select separate projects
      const envsToSetup = preset === 'local-staging' ? ['staging'] : ['production', 'staging'];

      for (const envName of envsToSetup) {
        console.log();
        console.log(pc.bold(`Configure ${pc.cyan(envName)} environment:`));

        if (projects.length === 0) {
          console.log(pc.yellow('⚠'), 'No projects found in your account');
          console.log(pc.dim('  You can add the project_ref manually to supacontrol.toml'));
          continue;
        }

        // Get list of already-selected project refs to exclude
        const alreadySelectedRefs = Object.values(projectRefs).filter(
          (ref): ref is string => ref !== undefined
        );

        const selectedRef = await selectProjectFromList(projects, envName, alreadySelectedRefs);
        if (selectedRef) {
          projectRefs[envName] = selectedRef;
          const project = projects.find((proj) => proj.id === selectedRef);
          if (project) {
            displayProjectSummary(project);
          }
        } else {
          console.log(pc.dim(`  Skipped - configure ${envName}.project_ref in supacontrol.toml`));
        }
      }
    }

    // Show branching tip only if they didn't use branching
    if (!branchingContext) {
      showBranchingTip();
    }
  }

  // Step 6: Generate and write config
  const config: Config = {
    settings: {
      strict_mode: false,
      require_clean_git: false,
      show_migration_diff: true,
    },
    environments: createEnvironmentConfig(preset, projectRefs),
  };

  await writeConfig(config);
  console.log(pc.green('✓'), `Created ${pc.bold('supacontrol.toml')}`);

  // Step 7: Show next steps
  showNextSteps(preset);

  p.outro(pc.green('Setup complete!'));
}

/**
 * Select a project from the list using @clack/prompts
 * 
 * @param projects - List of available projects
 * @param envName - Environment name being configured
 * @param alreadySelectedRefs - Project refs already selected for other environments (will be excluded)
 */
async function selectProjectFromList(
  projects: Project[],
  envName: string,
  alreadySelectedRefs: string[] = []
): Promise<string | null> {
  // Filter out already-selected projects
  const availableProjects = projects.filter(
    (project) => !alreadySelectedRefs.includes(project.id)
  );

  // Check if we have any projects left after filtering
  if (availableProjects.length === 0 && alreadySelectedRefs.length > 0) {
    // All projects are already used - show hard stop
    p.note(
      [
        `${pc.red('All your Supabase projects are already assigned to other environments.')}`,
        '',
        'Each environment MUST have a unique project_ref to prevent',
        'accidentally running operations on the wrong database.',
        '',
        `${pc.bold('Options:')}`,
        '',
        `${pc.cyan('1.')} Create a new Supabase project for ${envName}:`,
        `   ${pc.dim('https://supabase.com/dashboard/projects')}`,
        '',
        `${pc.cyan('2.')} Use Supabase Branching (recommended for teams):`,
        `   ${pc.dim('https://supabase.com/docs/guides/platform/branching')}`,
        `   Branching creates isolated environments from a single project.`,
        '',
        `${pc.cyan('3.')} Skip ${envName} for now and configure manually later.`,
      ].join('\n'),
      `${pc.yellow('⚠')} No available projects for ${envName}`
    );

    const skipConfirm = await p.confirm({
      message: `Skip ${envName} configuration for now?`,
      initialValue: true,
    });

    if (p.isCancel(skipConfirm)) {
      p.cancel('Setup cancelled');
      process.exit(0);
    }

    if (skipConfirm) {
      return null;
    }

    // User said no to skipping - cancel setup entirely
    p.cancel('Setup cancelled - create additional projects and try again');
    process.exit(0);
  }

  const sortedProjects = [...availableProjects].sort((a, b) => {
    if (a.status === 'ACTIVE_HEALTHY' && b.status !== 'ACTIVE_HEALTHY') return -1;
    if (b.status === 'ACTIVE_HEALTHY' && a.status !== 'ACTIVE_HEALTHY') return 1;
    return a.name.localeCompare(b.name);
  });

  const options = [
    ...sortedProjects.map((project) => {
      const statusLabel = project.status === 'ACTIVE_HEALTHY'
        ? pc.green('[Active]')
        : project.status === 'PAUSED'
          ? pc.yellow('[Paused]')
          : pc.red(`[${project.status}]`);
      return {
        value: project.id,
        label: `${project.name} ${pc.dim(`(${project.region})`)} ${statusLabel}`,
        hint: `ref: ${project.id}`,
      };
    }),
    {
      value: '__skip__',
      label: pc.dim('Skip (configure manually later)'),
      hint: `Set ${envName}.project_ref in supacontrol.toml`,
    },
  ];

  const selected = await p.select({
    message: `Select project for ${envName}:`,
    options,
  });

  if (p.isCancel(selected)) {
    p.cancel('Setup cancelled');
    process.exit(0);
  }

  if (selected === '__skip__') {
    return null;
  }

  return selected as string;
}

/**
 * Create the init command
 */
export function createInitCommand(): Command {
  const cmd = new Command('init')
    .description('Initialize SupaControl in your project')
    .action(withErrorHandling(initAction));

  return cmd;
}
