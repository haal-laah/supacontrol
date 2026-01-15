/**
 * Test Fixtures for Configuration System
 *
 * ====================================================================
 * WARNING: DO NOT MODIFY THESE FIXTURES
 * ====================================================================
 *
 * These fixtures have SHA256 checksums validated before each test run.
 * If a test fails, FIX THE IMPLEMENTATION IN src/, not these fixtures.
 *
 * To regenerate checksums after intentional changes:
 * pnpm verify-fixtures --update
 *
 * ====================================================================
 */

/**
 * Valid TOML configurations for testing
 */
export const VALID_CONFIGS = {
  /**
   * Minimal valid configuration
   */
  minimal: `
[settings]
strict_mode = false
require_clean_git = true
show_migration_diff = true

[environments.production]
project_ref = "abcdefghijklmnop"
git_branches = ["main"]
protected_operations = ["push", "reset"]
`,

  /**
   * Full configuration with all options
   */
  full: `
[settings]
strict_mode = true
require_clean_git = true
show_migration_diff = true

[environments.staging]
project_ref = "staging-project-ref"
git_branches = ["develop", "staging"]
protected_operations = ["reset"]

[environments.production]
project_ref = "prod-project-ref"
git_branches = ["main", "master"]
protected_operations = ["push", "reset", "seed"]
confirm_word = "production"
locked = true
`,

  /**
   * Configuration with wildcard branch patterns
   */
  wildcards: `
[settings]
strict_mode = false
require_clean_git = false
show_migration_diff = true

[environments.preview]
git_branches = ["preview/*", "feature/*"]
protected_operations = ["reset"]

[environments.production]
project_ref = "prod-ref"
git_branches = ["main"]
protected_operations = ["push", "reset"]
locked = true
`,

  /**
   * Configuration without project_ref (local-only setup)
   */
  localOnly: `
[settings]
strict_mode = false
require_clean_git = true
show_migration_diff = true
`,

  /**
   * Configuration with multiple environments
   */
  multiEnv: `
[settings]
strict_mode = false
require_clean_git = true
show_migration_diff = true

[environments.dev]
project_ref = "dev-project"
git_branches = ["develop"]
protected_operations = []

[environments.staging]
project_ref = "staging-project"
git_branches = ["staging"]
protected_operations = ["reset"]

[environments.production]
project_ref = "prod-project"
git_branches = ["main", "master"]
protected_operations = ["push", "reset", "seed"]
confirm_word = "PRODUCTION"
locked = true
`,
} as const;

/**
 * Invalid TOML configurations for error testing
 */
export const INVALID_CONFIGS = {
  /**
   * Malformed TOML syntax
   */
  malformedToml: `
[settings
strict_mode = false
`,

  /**
   * Missing required settings fields
   */
  missingSettings: `
[environments.production]
project_ref = "abc"
`,

  /**
   * Invalid type for strict_mode
   */
  wrongType: `
[settings]
strict_mode = "yes"
require_clean_git = true
show_migration_diff = true
`,

  /**
   * Invalid operation name
   */
  invalidOperation: `
[settings]
strict_mode = false
require_clean_git = true
show_migration_diff = true

[environments.production]
protected_operations = ["invalid_operation"]
`,

  /**
   * Empty config file
   */
  empty: '',

  /**
   * Only whitespace
   */
  whitespace: '   \n\n   \t\t   \n   ',
} as const;

/**
 * Expected parsed config objects
 */
export const EXPECTED_PARSED = {
  minimal: {
    settings: {
      strict_mode: false,
      require_clean_git: true,
      show_migration_diff: true,
    },
    environments: {
      production: {
        project_ref: 'abcdefghijklmnop',
        git_branches: ['main'],
        protected_operations: ['push', 'reset'],
        confirm_word: undefined,
        locked: undefined,
      },
    },
  },

  full: {
    settings: {
      strict_mode: true,
      require_clean_git: true,
      show_migration_diff: true,
    },
    environments: {
      staging: {
        project_ref: 'staging-project-ref',
        git_branches: ['develop', 'staging'],
        protected_operations: ['reset'],
        confirm_word: undefined,
        locked: undefined,
      },
      production: {
        project_ref: 'prod-project-ref',
        git_branches: ['main', 'master'],
        protected_operations: ['push', 'reset', 'seed'],
        confirm_word: 'production',
        locked: true,
      },
    },
  },
} as const;

/**
 * Type exports for test type safety
 */
export type ValidConfigKey = keyof typeof VALID_CONFIGS;
export type InvalidConfigKey = keyof typeof INVALID_CONFIGS;
export type ExpectedParsedKey = keyof typeof EXPECTED_PARSED;
