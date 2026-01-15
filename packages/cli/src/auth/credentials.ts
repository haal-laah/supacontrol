import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import * as p from '@clack/prompts';
import pc from 'picocolors';

/**
 * Environment variable for access token
 */
const TOKEN_ENV_VAR = 'SUPABASE_ACCESS_TOKEN';

/**
 * Config directory name
 */
const CONFIG_DIR = '.supacontrol';

/**
 * Credentials file name
 */
const CREDENTIALS_FILE = 'credentials';

/**
 * URL for generating access tokens
 */
const TOKEN_URL = 'https://supabase.com/dashboard/account/tokens';

/**
 * Get the path to the credentials file
 */
function getCredentialsPath(): string {
  return join(homedir(), CONFIG_DIR, CREDENTIALS_FILE);
}

/**
 * Get the config directory path
 */
function getConfigDir(): string {
  return join(homedir(), CONFIG_DIR);
}

/**
 * Get access token from environment or file
 *
 * @returns Access token, or null if not found
 */
export async function getAccessToken(): Promise<string | null> {
  // Check environment variable first
  const envToken = process.env[TOKEN_ENV_VAR];
  if (envToken) {
    return envToken;
  }

  // Check credentials file
  try {
    const credentialsPath = getCredentialsPath();
    const content = await readFile(credentialsPath, 'utf-8');
    const token = content.trim();
    if (token) {
      return token;
    }
  } catch {
    // File doesn't exist or can't be read
  }

  return null;
}

/**
 * Save access token to credentials file
 *
 * @param token - Access token to save
 */
export async function saveAccessToken(token: string): Promise<void> {
  const configDir = getConfigDir();
  const credentialsPath = getCredentialsPath();

  // Ensure config directory exists
  await mkdir(configDir, { recursive: true });

  // Write token to file
  await writeFile(credentialsPath, token, 'utf-8');

  // Set restrictive permissions (owner read/write only)
  // Note: chmod doesn't work the same on Windows, but we'll call it anyway
  try {
    await chmod(credentialsPath, 0o600);
  } catch {
    // Ignore permission errors on Windows
  }
}

/**
 * Prompt user for access token
 *
 * @returns Access token, or null if cancelled
 */
export async function promptForToken(): Promise<string | null> {
  console.log();
  p.note(
    [
      'To fetch your Supabase projects, we need an access token.',
      '',
      `Generate one at: ${pc.cyan(TOKEN_URL)}`,
      '',
      'Select "Generate new token" and copy the token.',
    ].join('\n'),
    'Authentication Required'
  );

  const token = await p.password({
    message: 'Paste your Supabase access token:',
    validate(value) {
      if (!value || value.length < 10) {
        return 'Please enter a valid access token';
      }
      return undefined;
    },
  });

  if (p.isCancel(token)) {
    return null;
  }

  return token;
}

/**
 * Get access token, prompting if needed
 *
 * @param options - Options for token retrieval
 * @returns Access token, or null if not available
 */
export async function getOrPromptForToken(options?: {
  skipPrompt?: boolean;
  saveToken?: boolean;
}): Promise<string | null> {
  const { skipPrompt = false, saveToken = true } = options ?? {};

  // Try to get existing token
  const existingToken = await getAccessToken();
  if (existingToken) {
    return existingToken;
  }

  // Don't prompt if skipPrompt is true (e.g., CI mode)
  if (skipPrompt) {
    return null;
  }

  // Prompt for token
  const token = await promptForToken();
  if (!token) {
    return null;
  }

  // Offer to save token
  if (saveToken) {
    const shouldSave = await p.confirm({
      message: 'Save token for future use?',
      initialValue: true,
    });

    if (!p.isCancel(shouldSave) && shouldSave) {
      await saveAccessToken(token);
      console.log(pc.dim(`  Saved to ${getCredentialsPath()}`));
    }
  }

  return token;
}

/**
 * Check if we have a stored access token
 */
export async function hasStoredToken(): Promise<boolean> {
  const token = await getAccessToken();
  return token !== null;
}

/**
 * Clear stored access token
 */
export async function clearStoredToken(): Promise<void> {
  const credentialsPath = getCredentialsPath();
  try {
    await writeFile(credentialsPath, '', 'utf-8');
  } catch {
    // Ignore errors
  }
}
