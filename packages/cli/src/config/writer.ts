import { writeFile, access, constants } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Config, Environment, Settings } from './schema.js';

/**
 * Default config file name
 */
const CONFIG_FILENAME = 'supacontrol.toml';

/**
 * Generate TOML string from settings object
 */
function settingsToToml(settings: Settings): string {
  const lines: string[] = [
    '[settings]',
    '# Fail on any guard warning, not just errors',
    `strict_mode = ${settings.strict_mode}`,
    '',
    '# Require clean git working tree before destructive operations',
    `require_clean_git = ${settings.require_clean_git}`,
    '',
    '# Show migration diff before push',
    `show_migration_diff = ${settings.show_migration_diff}`,
  ];
  return lines.join('\n');
}

/**
 * Generate TOML string for a single environment
 */
function environmentToToml(name: string, env: Environment): string {
  const lines: string[] = [`[environments.${name}]`];

  if (env.project_ref !== undefined) {
    lines.push(`# Supabase project reference`);
    lines.push(`project_ref = "${env.project_ref}"`);
  }

  if (env.git_branches.length > 0) {
    lines.push(`# Git branches that map to this environment`);
    lines.push(`git_branches = [${env.git_branches.map((b) => `"${b}"`).join(', ')}]`);
  }

  if (env.protected_operations.length > 0) {
    lines.push(`# Operations that require confirmation`);
    lines.push(
      `protected_operations = [${env.protected_operations.map((o) => `"${o}"`).join(', ')}]`
    );
  }

  if (env.confirm_word !== undefined) {
    lines.push(`# Custom confirmation word (type this to confirm)`);
    lines.push(`confirm_word = "${env.confirm_word}"`);
  }

  if (env.locked !== undefined) {
    lines.push(`# Lock environment to prevent all destructive operations`);
    lines.push(`locked = ${env.locked}`);
  }

  return lines.join('\n');
}

/**
 * Convert a Config object to TOML string with comments
 */
export function configToToml(config: Config): string {
  const sections: string[] = [
    '# SupaControl Configuration',
    '# https://github.com/your-org/supacontrol',
    '',
    settingsToToml(config.settings),
  ];

  const envNames = Object.keys(config.environments);
  if (envNames.length > 0) {
    sections.push('');
    for (const name of envNames) {
      const env = config.environments[name];
      if (env) {
        sections.push(environmentToToml(name, env));
        sections.push('');
      }
    }
  }

  return sections.join('\n').trimEnd() + '\n';
}

/**
 * Generate a default/example config
 */
export function generateDefaultConfig(): Config {
  return {
    settings: {
      strict_mode: false,
      require_clean_git: true,
      show_migration_diff: true,
    },
    environments: {
      staging: {
        project_ref: undefined,
        git_branches: ['develop', 'staging'],
        protected_operations: ['reset'],
        confirm_word: undefined,
        locked: undefined,
      },
      production: {
        project_ref: undefined,
        git_branches: ['main', 'master'],
        protected_operations: ['push', 'reset', 'seed'],
        confirm_word: 'production',
        locked: true,
      },
    },
  };
}

/**
 * Generate example TOML config string
 */
export function generateExampleToml(): string {
  return configToToml(generateDefaultConfig());
}

/**
 * Check if config file already exists
 */
export async function configExists(cwd?: string): Promise<boolean> {
  const searchDir = cwd ?? process.cwd();
  const configPath = resolve(searchDir, CONFIG_FILENAME);

  try {
    await access(configPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Write config to supacontrol.toml
 *
 * @param config - Config object to write
 * @param cwd - Directory to write to (defaults to process.cwd())
 * @returns Path to written config file
 */
export async function writeConfig(config: Config, cwd?: string): Promise<string> {
  const searchDir = cwd ?? process.cwd();
  const configPath = resolve(searchDir, CONFIG_FILENAME);
  const toml = configToToml(config);

  await writeFile(configPath, toml, 'utf-8');
  return configPath;
}
