import { Command } from 'commander';
import pc from 'picocolors';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const packageJson = require('../package.json') as { version: string; description: string };

// Global state for CLI options
export interface GlobalOptions {
  verbose: boolean;
  ci: boolean;
  env?: string;
}

const program = new Command();

program
  .name('supacontrol')
  .description(packageJson.description)
  .version(packageJson.version, '-v, --version', 'Show version number')
  .option('--verbose', 'Enable verbose output', false)
  .option('--ci', 'Run in CI mode (non-interactive, strict)', false)
  .option('-e, --env <environment>', 'Target environment')
  .configureHelp({
    sortSubcommands: true,
    sortOptions: true,
  });

// Error handling wrapper
function withErrorHandling<T extends (...args: unknown[]) => Promise<void>>(
  fn: T
): (...args: Parameters<T>) => Promise<void> {
  return async (...args: Parameters<T>) => {
    try {
      await fn(...args);
    } catch (error) {
      const opts = program.opts<GlobalOptions>();
      
      if (error instanceof Error) {
        console.error(pc.red('\u2717'), error.message);
        if (opts.verbose && error.stack) {
          console.error(pc.dim(error.stack));
        }
      } else {
        console.error(pc.red('\u2717'), 'An unexpected error occurred');
        if (opts.verbose) {
          console.error(pc.dim(String(error)));
        }
      }
      
      process.exit(1);
    }
  };
}

// Export for use in commands
export { program, withErrorHandling };

// Parse and execute
program.parse();
