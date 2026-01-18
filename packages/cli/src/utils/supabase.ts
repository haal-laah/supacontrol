import { execa, type Options } from 'execa';
import pc from 'picocolors';

/**
 * Cache for supabase CLI availability
 */
let supabaseAvailable: boolean | undefined;

/**
 * Check if the Supabase CLI is installed and available
 */
export async function isSupabaseCLIInstalled(): Promise<boolean> {
  if (supabaseAvailable !== undefined) {
    return supabaseAvailable;
  }

  try {
    await execa('supabase', ['--version']);
    supabaseAvailable = true;
    return true;
  } catch {
    supabaseAvailable = false;
    return false;
  }
}

/**
 * Get the installed Supabase CLI version
 */
export async function getSupabaseVersion(): Promise<string | null> {
  try {
    const result = await execa('supabase', ['--version']);
    const stdout = typeof result.stdout === 'string' ? result.stdout : '';
    // Output is like "1.123.0" or "Supabase CLI 1.123.0"
    const match = stdout.match(/(\d+\.\d+\.\d+)/);
    if (match && match[1]) {
      return match[1];
    }
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Options for running supabase CLI
 */
export interface RunSupabaseOptions {
  /** Working directory */
  cwd?: string;
  /** Whether to stream output to terminal */
  stream?: boolean;
  /** Environment variables to pass */
  env?: Record<string, string>;
  /** Stdin input to pass to the command */
  input?: string;
}

/**
 * Result of running supabase CLI
 */
export interface SupabaseResult {
  /** Exit code */
  exitCode: number;
  /** Standard output */
  stdout: string;
  /** Standard error */
  stderr: string;
  /** Whether the command succeeded */
  success: boolean;
}

/**
 * Run a supabase CLI command
 *
 * @param args - Arguments to pass to supabase CLI
 * @param options - Execution options
 * @returns Result of the command
 */
export async function runSupabase(
  args: string[],
  options: RunSupabaseOptions = {}
): Promise<SupabaseResult> {
  const { cwd, stream = true, env } = options;

  // Check if supabase is installed
  const isInstalled = await isSupabaseCLIInstalled();
  if (!isInstalled) {
    console.error(pc.red('\u2717'), 'Supabase CLI is not installed');
    console.error(pc.dim('  Install it with: npm install -g supabase'));
    console.error(pc.dim('  Or: brew install supabase/tap/supabase'));
    return {
      exitCode: 1,
      stdout: '',
      stderr: 'Supabase CLI not installed',
      success: false,
    };
  }

  try {
    const execaOptions: Options = {
      reject: false,
      ...(cwd ? { cwd } : {}),
      ...(env ? { env } : {}),
      ...(stream ? { stdio: 'inherit' as const } : {}),
      ...(options.input ? { input: options.input } : {}),
    };

    const result = await execa('supabase', args, execaOptions);

    return {
      exitCode: result.exitCode ?? 0,
      stdout: typeof result.stdout === 'string' ? result.stdout : '',
      stderr: typeof result.stderr === 'string' ? result.stderr : '',
      success: result.exitCode === 0,
    };
  } catch (error) {
    // This shouldn't happen with reject: false, but handle it anyway
    const message = error instanceof Error ? error.message : String(error);
    return {
      exitCode: 1,
      stdout: '',
      stderr: message,
      success: false,
    };
  }
}

/**
 * Run supabase CLI and exit with its exit code
 * Useful for passthrough commands
 */
export async function runSupabaseAndExit(
  args: string[],
  options: RunSupabaseOptions = {}
): Promise<never> {
  const result = await runSupabase(args, options);
  process.exit(result.exitCode);
}

/**
 * Check supabase CLI installation and exit if not found
 */
export async function requireSupabaseCLI(): Promise<void> {
  const isInstalled = await isSupabaseCLIInstalled();
  if (!isInstalled) {
    console.error(pc.red('\u2717'), 'Supabase CLI is not installed');
    console.error();
    console.error(pc.dim('Install it with one of:'));
    console.error(pc.dim('  npm install -g supabase'));
    console.error(pc.dim('  brew install supabase/tap/supabase'));
    console.error(pc.dim('  scoop install supabase'));
    console.error();
    process.exit(1);
  }
}
