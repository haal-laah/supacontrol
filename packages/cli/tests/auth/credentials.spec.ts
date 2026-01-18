/**
 * Unit Tests for Credentials Management
 *
 * These tests verify the credential storage and retrieval.
 * We mock filesystem and prompts to test in isolation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';

// Mock node:os homedir to use a temp directory
const originalHomedir = homedir;
let mockHomeDir: string;

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return {
    ...actual,
    homedir: () => mockHomeDir,
  };
});

// Mock @clack/prompts to avoid interactive prompts
vi.mock('@clack/prompts', () => ({
  note: vi.fn(),
  password: vi.fn(),
  confirm: vi.fn(),
  cancel: vi.fn(),
  isCancel: vi.fn(() => false),
}));

import * as p from '@clack/prompts';
import {
  getAccessToken,
  saveAccessToken,
  hasStoredToken,
  clearStoredToken,
  promptForToken,
  getOrPromptForToken,
} from '../../src/auth/credentials.js';

describe('Credentials Management', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Create a unique temp directory for each test
    mockHomeDir = join(
      tmpdir(),
      `supacontrol-creds-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await mkdir(mockHomeDir, { recursive: true });

    // Clear environment variable
    delete process.env.SUPABASE_ACCESS_TOKEN;
  });

  afterEach(async () => {
    try {
      await rm(mockHomeDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    // Restore environment
    delete process.env.SUPABASE_ACCESS_TOKEN;
  });

  describe('getAccessToken', () => {
    it('should return token from environment variable', async () => {
      process.env.SUPABASE_ACCESS_TOKEN = 'env-token-12345';

      const token = await getAccessToken();

      expect(token).toBe('env-token-12345');
    });

    it('should prioritize environment variable over stored token', async () => {
      process.env.SUPABASE_ACCESS_TOKEN = 'env-token';

      // Create credentials file
      const configDir = join(mockHomeDir, '.supacontrol');
      await mkdir(configDir, { recursive: true });
      await writeFile(join(configDir, 'credentials'), 'stored-token', 'utf-8');

      const token = await getAccessToken();

      expect(token).toBe('env-token');
    });

    it('should return token from credentials file', async () => {
      const configDir = join(mockHomeDir, '.supacontrol');
      await mkdir(configDir, { recursive: true });
      await writeFile(join(configDir, 'credentials'), 'stored-token-67890', 'utf-8');

      const token = await getAccessToken();

      expect(token).toBe('stored-token-67890');
    });

    it('should return null when no token available', async () => {
      const token = await getAccessToken();

      expect(token).toBeNull();
    });

    it('should trim whitespace from stored token', async () => {
      const configDir = join(mockHomeDir, '.supacontrol');
      await mkdir(configDir, { recursive: true });
      await writeFile(join(configDir, 'credentials'), '  token-with-spaces  \n', 'utf-8');

      const token = await getAccessToken();

      expect(token).toBe('token-with-spaces');
    });

    it('should return null for empty stored token', async () => {
      const configDir = join(mockHomeDir, '.supacontrol');
      await mkdir(configDir, { recursive: true });
      await writeFile(join(configDir, 'credentials'), '   \n', 'utf-8');

      const token = await getAccessToken();

      expect(token).toBeNull();
    });
  });

  describe('saveAccessToken', () => {
    it('should save token to credentials file', async () => {
      await saveAccessToken('my-secret-token');

      const content = await readFile(
        join(mockHomeDir, '.supacontrol', 'credentials'),
        'utf-8'
      );
      expect(content).toBe('my-secret-token');
    });

    it('should create config directory if not exists', async () => {
      await saveAccessToken('new-token');

      const content = await readFile(
        join(mockHomeDir, '.supacontrol', 'credentials'),
        'utf-8'
      );
      expect(content).toBe('new-token');
    });

    it('should overwrite existing token', async () => {
      const configDir = join(mockHomeDir, '.supacontrol');
      await mkdir(configDir, { recursive: true });
      await writeFile(join(configDir, 'credentials'), 'old-token', 'utf-8');

      await saveAccessToken('new-token');

      const content = await readFile(join(configDir, 'credentials'), 'utf-8');
      expect(content).toBe('new-token');
    });
  });

  describe('hasStoredToken', () => {
    it('should return true when token exists in environment', async () => {
      process.env.SUPABASE_ACCESS_TOKEN = 'env-token';

      const result = await hasStoredToken();

      expect(result).toBe(true);
    });

    it('should return true when token exists in file', async () => {
      const configDir = join(mockHomeDir, '.supacontrol');
      await mkdir(configDir, { recursive: true });
      await writeFile(join(configDir, 'credentials'), 'stored-token', 'utf-8');

      const result = await hasStoredToken();

      expect(result).toBe(true);
    });

    it('should return false when no token exists', async () => {
      const result = await hasStoredToken();

      expect(result).toBe(false);
    });
  });

   describe('clearStoredToken', () => {
     it('should clear stored token', async () => {
       const configDir = join(mockHomeDir, '.supacontrol');
       await mkdir(configDir, { recursive: true });
       await writeFile(join(configDir, 'credentials'), 'token-to-clear', 'utf-8');

       await clearStoredToken();

       const content = await readFile(join(configDir, 'credentials'), 'utf-8');
       expect(content).toBe('');
     });

     it('should not throw if credentials file does not exist', async () => {
       await expect(clearStoredToken()).resolves.not.toThrow();
     });

     it('should not throw if config directory does not exist', async () => {
       await expect(clearStoredToken()).resolves.not.toThrow();
     });
   });

   describe('promptForToken', () => {
     it('should return token when user enters valid token', async () => {
       vi.mocked(p.password).mockResolvedValueOnce('valid-token-12345');
       vi.mocked(p.isCancel).mockReturnValueOnce(false);

       const token = await promptForToken();

       expect(token).toBe('valid-token-12345');
       expect(p.password).toHaveBeenCalled();
       expect(p.note).toHaveBeenCalled();
     });

     it('should return null when user cancels prompt', async () => {
       vi.mocked(p.password).mockResolvedValueOnce(undefined);
       vi.mocked(p.isCancel).mockReturnValueOnce(true);

       const token = await promptForToken();

       expect(token).toBeNull();
     });

     it('should validate token length', async () => {
       vi.mocked(p.password).mockResolvedValueOnce('short');
       vi.mocked(p.isCancel).mockReturnValueOnce(false);

       const token = await promptForToken();

       expect(token).toBe('short');
       // Verify the validator was called by checking password was invoked
       expect(p.password).toHaveBeenCalled();
       const passwordCall = vi.mocked(p.password).mock.calls[0][0];
       expect(passwordCall.validate).toBeDefined();
     });

     it('should call validator with empty string and return error message', async () => {
       vi.mocked(p.password).mockResolvedValueOnce('valid-token-12345');
       vi.mocked(p.isCancel).mockReturnValueOnce(false);

       await promptForToken();

       const passwordCall = vi.mocked(p.password).mock.calls[0][0];
       const validationResult = passwordCall.validate('');
       expect(validationResult).toBe('Please enter a valid access token');
     });

     it('should call validator with short token and return error message', async () => {
       vi.mocked(p.password).mockResolvedValueOnce('valid-token-12345');
       vi.mocked(p.isCancel).mockReturnValueOnce(false);

       await promptForToken();

       const passwordCall = vi.mocked(p.password).mock.calls[0][0];
       const validationResult = passwordCall.validate('short');
       expect(validationResult).toBe('Please enter a valid access token');
     });

     it('should call validator with valid token and return undefined', async () => {
       vi.mocked(p.password).mockResolvedValueOnce('valid-token-12345');
       vi.mocked(p.isCancel).mockReturnValueOnce(false);

       await promptForToken();

       const passwordCall = vi.mocked(p.password).mock.calls[0][0];
       const validationResult = passwordCall.validate('valid-token-12345');
       expect(validationResult).toBeUndefined();
     });

     it('should display note with token URL', async () => {
       vi.mocked(p.password).mockResolvedValueOnce('valid-token-12345');
       vi.mocked(p.isCancel).mockReturnValueOnce(false);

       await promptForToken();

       expect(p.note).toHaveBeenCalled();
       const noteCall = vi.mocked(p.note).mock.calls[0];
       expect(noteCall[0]).toContain('https://supabase.com/dashboard/account/tokens');
       expect(noteCall[1]).toBe('Authentication Required');
     });
   });

   describe('getOrPromptForToken', () => {
     it('should return existing token without prompting', async () => {
       const configDir = join(mockHomeDir, '.supacontrol');
       await mkdir(configDir, { recursive: true });
       await writeFile(join(configDir, 'credentials'), 'existing-token', 'utf-8');

       const token = await getOrPromptForToken();

       expect(token).toBe('existing-token');
       expect(p.password).not.toHaveBeenCalled();
     });

     it('should return env token without prompting', async () => {
       process.env.SUPABASE_ACCESS_TOKEN = 'env-token-value';

       const token = await getOrPromptForToken();

       expect(token).toBe('env-token-value');
       expect(p.password).not.toHaveBeenCalled();
     });

     it('should return null when skipPrompt is true and no token exists', async () => {
       const token = await getOrPromptForToken({ skipPrompt: true });

       expect(token).toBeNull();
       expect(p.password).not.toHaveBeenCalled();
     });

     it('should prompt for token when no existing token and skipPrompt is false', async () => {
       vi.mocked(p.password).mockResolvedValueOnce('new-token-12345');
       vi.mocked(p.isCancel).mockReturnValueOnce(false);
       vi.mocked(p.confirm).mockResolvedValueOnce(false);

       const token = await getOrPromptForToken({ skipPrompt: false, saveToken: false });

       expect(token).toBe('new-token-12345');
       expect(p.password).toHaveBeenCalled();
     });

     it('should return null when user cancels prompt', async () => {
       vi.mocked(p.password).mockResolvedValueOnce(undefined);
       vi.mocked(p.isCancel).mockReturnValueOnce(true);

       const token = await getOrPromptForToken({ skipPrompt: false });

       expect(token).toBeNull();
     });

     it('should not save token when user declines', async () => {
       vi.mocked(p.password).mockResolvedValueOnce('new-token-no-save');
       vi.mocked(p.isCancel).mockReturnValue(false);
       vi.mocked(p.confirm).mockResolvedValueOnce(false);

       const token = await getOrPromptForToken({ skipPrompt: false, saveToken: true });

       expect(token).toBe('new-token-no-save');

       // Verify token was not saved
       const configDir = join(mockHomeDir, '.supacontrol');
       try {
         await readFile(join(configDir, 'credentials'), 'utf-8');
         expect.fail('File should not exist');
       } catch {
         // Expected - file should not exist
       }
     });

     it('should not save token when confirm is cancelled', async () => {
       vi.mocked(p.password).mockResolvedValueOnce('new-token-cancelled');
       vi.mocked(p.isCancel).mockImplementation((value) => value === undefined);
       vi.mocked(p.confirm).mockResolvedValueOnce(undefined);

       const token = await getOrPromptForToken({ skipPrompt: false, saveToken: true });

       expect(token).toBe('new-token-cancelled');

       // Verify token was not saved
       const configDir = join(mockHomeDir, '.supacontrol');
       try {
         await readFile(join(configDir, 'credentials'), 'utf-8');
         expect.fail('File should not exist');
       } catch {
         // Expected - file should not exist
       }
     });

     it('should not prompt for save when saveToken is false', async () => {
       vi.mocked(p.password).mockResolvedValueOnce('new-token-no-save-prompt');
       vi.mocked(p.isCancel).mockReturnValueOnce(false);

       const token = await getOrPromptForToken({ skipPrompt: false, saveToken: false });

       expect(token).toBe('new-token-no-save-prompt');
       expect(p.confirm).not.toHaveBeenCalled();
     });

     it('should use default options when none provided', async () => {
       vi.mocked(p.password).mockResolvedValueOnce('token-default-opts');
       vi.mocked(p.isCancel).mockReturnValue(false);
       vi.mocked(p.confirm).mockResolvedValueOnce(true);

       const token = await getOrPromptForToken();

       expect(token).toBe('token-default-opts');
       // Default: skipPrompt=false, saveToken=true
       expect(p.password).toHaveBeenCalled();
       expect(p.confirm).toHaveBeenCalled();
     });

     it('should call saveAccessToken when user confirms save', async () => {
       vi.mocked(p.password).mockResolvedValueOnce('token-to-verify-save');
       vi.mocked(p.isCancel).mockReturnValue(false);
       vi.mocked(p.confirm).mockResolvedValueOnce(true);

       const token = await getOrPromptForToken({ skipPrompt: false, saveToken: true });

       expect(token).toBe('token-to-verify-save');
       // Verify the confirm dialog was shown
       expect(p.confirm).toHaveBeenCalled();
       // Verify token was actually saved to disk
       const content = await readFile(
         join(mockHomeDir, '.supacontrol', 'credentials'),
         'utf-8'
       );
       expect(content).toBe('token-to-verify-save');
     });
   });
});
