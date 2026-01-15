import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { parse } from 'smol-toml';
import { ZodError } from 'zod';
import pc from 'picocolors';
import { ConfigSchema, RawConfigSchema, type Config } from './schema.js';

/**
 * Default config file paths to search (in order)
 */
const CONFIG_PATHS = ['supacontrol.toml', 'config/supacontrol.toml'];

/**
 * Error thrown when config file is invalid
 */
export class ConfigError extends Error {
  public readonly filePath: string | undefined;

  constructor(
    message: string,
    filePath?: string,
    cause?: Error
  ) {
    super(message, { cause });
    this.name = 'ConfigError';
    this.filePath = filePath;
  }
}

/**
 * Result of finding a config file
 */
interface ConfigFileResult {
  content: string;
  path: string;
}

/**
 * Try to find and read a config file from the search paths
 */
async function findConfigFile(cwd: string): Promise<ConfigFileResult | null> {
  for (const configPath of CONFIG_PATHS) {
    const fullPath = resolve(cwd, configPath);
    try {
      const content = await readFile(fullPath, 'utf-8');
      return { content, path: fullPath };
    } catch (error) {
      // File not found, try next path
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        continue;
      }
      // Other error (permission denied, etc.)
      throw new ConfigError(
        `Failed to read config file: ${fullPath}`,
        fullPath,
        error instanceof Error ? error : undefined
      );
    }
  }
  return null;
}

/**
 * Format Zod validation errors into readable messages
 */
function formatZodError(error: ZodError): string {
  const issues = error.issues.map((issue) => {
    const path = issue.path.join('.');
    return `  ${pc.dim(path ? `${path}: ` : '')}${issue.message}`;
  });
  return issues.join('\n');
}

/**
 * Load and validate supacontrol.toml configuration
 *
 * @param cwd - Directory to search for config (defaults to process.cwd())
 * @returns Validated config object, or null if no config file found
 * @throws ConfigError if config file exists but is invalid
 */
export async function loadConfig(cwd?: string): Promise<Config | null> {
  const searchDir = cwd ?? process.cwd();
  const result = await findConfigFile(searchDir);

  if (!result) {
    return null;
  }

  // Parse TOML
  let rawData: unknown;
  try {
    rawData = parse(result.content);
  } catch (error) {
    throw new ConfigError(
      `Invalid TOML syntax in ${result.path}:\n  ${error instanceof Error ? error.message : String(error)}`,
      result.path,
      error instanceof Error ? error : undefined
    );
  }

  // Validate raw structure first
  const rawResult = RawConfigSchema.safeParse(rawData);
  if (!rawResult.success) {
    throw new ConfigError(
      `Invalid config in ${result.path}:\n${formatZodError(rawResult.error)}`,
      result.path
    );
  }

  // Validate and transform with full schema (applies defaults)
  const configResult = ConfigSchema.safeParse(rawData);
  if (!configResult.success) {
    throw new ConfigError(
      `Invalid config in ${result.path}:\n${formatZodError(configResult.error)}`,
      result.path
    );
  }

  return configResult.data;
}

/**
 * Load config or exit with error
 * Convenience function for CLI commands that require config
 */
export async function loadConfigOrExit(cwd?: string): Promise<Config> {
  try {
    const config = await loadConfig(cwd);
    if (!config) {
      console.error(pc.red('\u2717'), 'No supacontrol.toml found');
      console.error(pc.dim('  Run `supacontrol init` to create one'));
      process.exit(1);
    }
    return config;
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(pc.red('\u2717'), error.message);
      process.exit(1);
    }
    throw error;
  }
}

/**
 * Get the directory containing the config file (useful for resolving relative paths)
 */
export async function getConfigDir(cwd?: string): Promise<string | null> {
  const searchDir = cwd ?? process.cwd();
  const result = await findConfigFile(searchDir);
  return result ? dirname(result.path) : null;
}
