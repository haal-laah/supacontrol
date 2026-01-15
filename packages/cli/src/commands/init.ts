import { Command } from 'commander';
import { access, constants } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { type GlobalOptions, program, withErrorHandling } from '../index.js';
import { configExists, writeConfig } from '../config/writer.js';
import type { Config } from '../config/schema.js';
import { getOrPromptForToken, getAccessToken } from '../auth/credentials.js';
import { createSupabaseClient, type Project } from '../api/supabase-client.js';
import { displayProjectSummary } from '../api/project-selector.js';

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
  const preset = await p.select({
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
    // At this point, token is guaranteed to be non-null (exit paths above)
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

    // Step 5: Select projects for each environment
    const envsToSetup = preset === 'local-staging' ? ['staging'] : ['staging', 'production'];

    for (const envName of envsToSetup) {
      console.log();
      console.log(pc.bold(`Configure ${pc.cyan(envName)} environment:`));

      if (projects.length === 0) {
        console.log(pc.yellow('⚠'), 'No projects found in your account');
        console.log(pc.dim('  You can add the project_ref manually to supacontrol.toml'));
        continue;
      }

      const selectedRef = await selectProjectFromList(projects, envName);
      if (selectedRef) {
        projectRefs[envName] = selectedRef;
        const project = projects.find((p) => p.id === selectedRef);
        if (project) {
          displayProjectSummary(project);
        }
      } else {
        console.log(pc.dim(`  Skipped - configure ${envName}.project_ref in supacontrol.toml`));
      }
    }

    // Show branching tip
    showBranchingTip();
  }

  // Step 6: Generate and write config
  const config: Config = {
    settings: {
      strict_mode: false,
      require_clean_git: true,
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
 */
async function selectProjectFromList(
  projects: Project[],
  envName: string
): Promise<string | null> {
  const sortedProjects = [...projects].sort((a, b) => {
    if (a.status === 'ACTIVE_HEALTHY' && b.status !== 'ACTIVE_HEALTHY') return -1;
    if (b.status === 'ACTIVE_HEALTHY' && a.status !== 'ACTIVE_HEALTHY') return 1;
    return a.name.localeCompare(b.name);
  });

  const options = [
    ...sortedProjects.map((project) => ({
      value: project.id,
      label: `${project.status === 'ACTIVE_HEALTHY' ? pc.green('●') : pc.yellow('○')} ${project.name} ${pc.dim(`(${project.region})`)}`,
      hint: `ref: ${project.id}`,
    })),
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

  if (p.isCancel(selected) || selected === '__skip__') {
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
