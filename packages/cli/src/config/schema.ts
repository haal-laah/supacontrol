import { z } from 'zod';

/**
 * Operations that can be protected in an environment
 */
export const ProtectedOperation = z.enum([
  'push',
  'reset',
  'pull',
  'seed',
  'link',
  'unlink',
]);

export type ProtectedOperation = z.infer<typeof ProtectedOperation>;

/**
 * Settings that apply globally to the CLI
 */
export const SettingsSchema = z.object({
  /** Fail on any guard warning, not just errors */
  strict_mode: z.boolean().default(false),
  /** Require clean git working tree before destructive operations */
  require_clean_git: z.boolean().default(true),
  /** Show migration diff before push */
  show_migration_diff: z.boolean().default(true),
});

export type Settings = z.infer<typeof SettingsSchema>;

/**
 * Configuration for a single environment (staging, production, etc.)
 */
export const EnvironmentSchema = z.object({
  /** Supabase project reference (optional, can be auto-detected) */
  project_ref: z.string().optional(),
  /** Git branches that map to this environment */
  git_branches: z.array(z.string()).default([]),
  /** Operations that require confirmation in this environment */
  protected_operations: z.array(ProtectedOperation).default([]),
  /** Custom confirmation word (defaults to environment name) */
  confirm_word: z.string().optional(),
  /** Lock environment to prevent all destructive operations */
  locked: z.boolean().optional(), // undefined = use default (true for production)
});

export type Environment = z.infer<typeof EnvironmentSchema>;

/**
 * Root configuration schema for supacontrol.toml
 */
export const ConfigSchema = z.object({
  settings: SettingsSchema.default({
    strict_mode: false,
    require_clean_git: true,
    show_migration_diff: true,
  }),
  environments: z.record(z.string(), EnvironmentSchema).default({}),
});

export type Config = z.infer<typeof ConfigSchema>;

/**
 * Raw TOML structure before transformation
 * TOML uses [environments.production] syntax which creates nested objects
 */
export const RawConfigSchema = z.object({
  settings: SettingsSchema.optional(),
  environments: z.record(z.string(), EnvironmentSchema).optional(),
});

export type RawConfig = z.infer<typeof RawConfigSchema>;

/**
 * Check if an environment is effectively locked
 * Production is locked by default if not explicitly set
 */
export function isEnvironmentLocked(
  envName: string,
  env: Environment
): boolean {
  if (env.locked !== undefined) {
    return env.locked;
  }

  // Production-like environments are locked by default
  const isProduction =
    envName === 'production' ||
    env.git_branches.includes('main') ||
    env.git_branches.includes('master');

  return isProduction;
}

/**
 * Default settings if none provided
 */
export const DEFAULT_SETTINGS: Settings = {
  strict_mode: false,
  require_clean_git: true,
  show_migration_diff: true,
};
