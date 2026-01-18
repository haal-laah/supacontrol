/**
 * Unit Tests for Init Command
 *
 * These tests verify the init command functionality.
 * We mock external dependencies to test in isolation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock node:fs/promises
vi.mock('node:fs/promises', () => ({
  access: vi.fn(),
  constants: { F_OK: 0 },
}));

// Mock the config writer
vi.mock('../../src/config/writer.js', () => ({
  configExists: vi.fn(),
  writeConfig: vi.fn(),
}));

// Mock auth credentials
vi.mock('../../src/auth/credentials.js', () => ({
  getOrPromptForToken: vi.fn(),
  getAccessToken: vi.fn(),
}));

// Mock supabase client
vi.mock('../../src/api/supabase-client.js', () => ({
  createSupabaseClient: vi.fn(),
}));

// Mock project selector
vi.mock('../../src/api/project-selector.js', () => ({
  displayProjectSummary: vi.fn(),
}));

// Mock supabase utils
vi.mock('../../src/utils/supabase.js', () => ({
  runSupabase: vi.fn(),
}));

// Mock @clack/prompts
vi.mock('@clack/prompts', () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  note: vi.fn(),
  spinner: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    message: vi.fn(),
  })),
  confirm: vi.fn(),
  select: vi.fn(),
  text: vi.fn(),
  isCancel: vi.fn((value) => value === Symbol.for('cancel')),
  cancel: vi.fn(),
}));

// Mock the index module for program opts
vi.mock('../../src/index.js', () => ({
  program: {
    opts: vi.fn(() => ({ ci: false, env: undefined, verbose: false })),
  },
  withErrorHandling: vi.fn((fn) => fn),
  GlobalOptions: {},
}));

import { access } from 'node:fs/promises';
import { configExists, writeConfig } from '../../src/config/writer.js';
import { getOrPromptForToken, getAccessToken } from '../../src/auth/credentials.js';
import { createSupabaseClient } from '../../src/api/supabase-client.js';
import { runSupabase } from '../../src/utils/supabase.js';
import * as p from '@clack/prompts';
import { createInitCommand } from '../../src/commands/init.js';

const mockAccess = vi.mocked(access);
const mockConfigExists = vi.mocked(configExists);
const mockWriteConfig = vi.mocked(writeConfig);
const mockGetAccessToken = vi.mocked(getAccessToken);
const mockGetOrPromptForToken = vi.mocked(getOrPromptForToken);
const mockCreateSupabaseClient = vi.mocked(createSupabaseClient);
const _mockRunSupabase = vi.mocked(runSupabase);
const mockSpinner = vi.mocked(p.spinner);
const mockConfirm = vi.mocked(p.confirm);
const mockSelect = vi.mocked(p.select);
const _mockText = vi.mocked(p.text);
const _mockNote = vi.mocked(p.note);
const mockIntro = vi.mocked(p.intro);
const _mockOutro = vi.mocked(p.outro);
const mockCancel = vi.mocked(p.cancel);

describe('Init Command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Default spinner mock
    mockSpinner.mockReturnValue({
      start: vi.fn(),
      stop: vi.fn(),
      message: vi.fn(),
    } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createInitCommand', () => {
    it('should create a command with correct name and description', () => {
      const cmd = createInitCommand();
      
      expect(cmd.name()).toBe('init');
      expect(cmd.description()).toBe('Initialize SupaControl in your project');
    });
  });

  describe('checkSupabaseInit detection', () => {
    it('should detect when supabase is initialized', async () => {
      // Supabase config exists
      mockAccess.mockResolvedValueOnce(undefined);
      // SupaControl config doesn't exist
      mockConfigExists.mockResolvedValueOnce(false);
      // User selects local only
      mockSelect.mockResolvedValueOnce('local');
      // Write config succeeds
      mockWriteConfig.mockResolvedValueOnce('supacontrol.toml');

      const cmd = createInitCommand();
      
      // Execute the command action
      await expect(cmd.parseAsync(['node', 'init'])).resolves.not.toThrow();
      
      // Should have shown intro
      expect(mockIntro).toHaveBeenCalled();
    });

    it('should fail when supabase is not initialized', async () => {
      // Supabase config doesn't exist
      mockAccess.mockRejectedValueOnce(new Error('ENOENT'));

      const cmd = createInitCommand();
      
      // Should exit with error
      await expect(cmd.parseAsync(['node', 'init'])).rejects.toThrow(/process\.exit/);
    });
  });

  describe('existing config handling', () => {
    it('should prompt to overwrite when config exists', async () => {
      // Supabase exists
      mockAccess.mockResolvedValueOnce(undefined);
      // Config exists
      mockConfigExists.mockResolvedValueOnce(true);
      // User confirms overwrite
      mockConfirm.mockResolvedValueOnce(true);
      // User selects local only
      mockSelect.mockResolvedValueOnce('local');
      // Write config succeeds
      mockWriteConfig.mockResolvedValueOnce('supacontrol.toml');

      const cmd = createInitCommand();
      await cmd.parseAsync(['node', 'init']);
      
      expect(mockConfirm).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Overwrite'),
        })
      );
    });

    it('should cancel when user declines overwrite', async () => {
      // Supabase exists
      mockAccess.mockResolvedValueOnce(undefined);
      // Config exists
      mockConfigExists.mockResolvedValueOnce(true);
      // User declines overwrite
      mockConfirm.mockResolvedValueOnce(false);

      const cmd = createInitCommand();
      
      await expect(cmd.parseAsync(['node', 'init'])).rejects.toThrow(/process\.exit/);
      expect(mockCancel).toHaveBeenCalled();
    });
  });

  describe('environment preset selection', () => {
    it('should create local-only config', async () => {
      // Supabase exists
      mockAccess.mockResolvedValueOnce(undefined);
      // No existing config
      mockConfigExists.mockResolvedValueOnce(false);
      // User selects local only
      mockSelect.mockResolvedValueOnce('local');
      // Write config succeeds
      mockWriteConfig.mockResolvedValueOnce('supacontrol.toml');

      const cmd = createInitCommand();
      await cmd.parseAsync(['node', 'init']);
      
      expect(mockWriteConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          settings: expect.any(Object),
          environments: {},
        })
      );
    });

    it('should create local-staging config with token', async () => {
      // Supabase exists
      mockAccess.mockResolvedValueOnce(undefined);
      // No existing config
      mockConfigExists.mockResolvedValueOnce(false);
      // User selects local-staging
      mockSelect.mockResolvedValueOnce('local-staging');
      // Token exists
      mockGetAccessToken.mockResolvedValueOnce('test-token');
      
      // Mock client
      const mockClient = {
        authenticate: vi.fn().mockResolvedValue(true),
        getProjects: vi.fn().mockResolvedValue([
          { id: 'proj-1', name: 'Staging Project', status: 'ACTIVE_HEALTHY', region: 'us-east-1' },
        ]),
        getBranches: vi.fn().mockResolvedValue([]),
        checkBranchingCapability: vi.fn().mockResolvedValue({ available: false }),
      };
      mockCreateSupabaseClient.mockReturnValue(mockClient as any);
      
      // User selects project for staging
      mockSelect.mockResolvedValueOnce('proj-1');
      
      // Write config succeeds
      mockWriteConfig.mockResolvedValueOnce('supacontrol.toml');

      const cmd = createInitCommand();
      await cmd.parseAsync(['node', 'init']);
      
      expect(mockWriteConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          environments: expect.objectContaining({
            staging: expect.objectContaining({
              project_ref: 'proj-1',
            }),
          }),
        })
      );
    });

    it('should cancel when user cancels preset selection', async () => {
      // Supabase exists
      mockAccess.mockResolvedValueOnce(undefined);
      // No existing config
      mockConfigExists.mockResolvedValueOnce(false);
      // User cancels
      mockSelect.mockResolvedValueOnce(Symbol.for('cancel'));

      const cmd = createInitCommand();
      
      await expect(cmd.parseAsync(['node', 'init'])).rejects.toThrow(/process\.exit/);
    });
  });

  describe('token handling', () => {
    it('should use existing token when available', async () => {
      // Supabase exists
      mockAccess.mockResolvedValueOnce(undefined);
      // No existing config
      mockConfigExists.mockResolvedValueOnce(false);
      // User selects local-staging
      mockSelect.mockResolvedValueOnce('local-staging');
      // Token exists
      mockGetAccessToken.mockResolvedValueOnce('existing-token');
      
      // Mock client
      const mockClient = {
        authenticate: vi.fn().mockResolvedValue(true),
        getProjects: vi.fn().mockResolvedValue([]),
        getBranches: vi.fn().mockResolvedValue([]),
        checkBranchingCapability: vi.fn().mockResolvedValue({ available: false }),
      };
      mockCreateSupabaseClient.mockReturnValue(mockClient as any);
      
      // Skip project selection (no projects)
      mockWriteConfig.mockResolvedValueOnce('supacontrol.toml');

      const cmd = createInitCommand();
      await cmd.parseAsync(['node', 'init']);
      
      // Should not prompt for token
      expect(mockGetOrPromptForToken).not.toHaveBeenCalled();
      expect(mockCreateSupabaseClient).toHaveBeenCalledWith('existing-token');
    });

    it('should prompt for token when not available', async () => {
      // Supabase exists
      mockAccess.mockResolvedValueOnce(undefined);
      // No existing config
      mockConfigExists.mockResolvedValueOnce(false);
      // User selects local-staging
      mockSelect.mockResolvedValueOnce('local-staging');
      // No existing token
      mockGetAccessToken.mockResolvedValueOnce(null);
      // Token prompted
      mockGetOrPromptForToken.mockResolvedValueOnce('new-token');
      
      // Mock client
      const mockClient = {
        authenticate: vi.fn().mockResolvedValue(true),
        getProjects: vi.fn().mockResolvedValue([]),
        getBranches: vi.fn().mockResolvedValue([]),
        checkBranchingCapability: vi.fn().mockResolvedValue({ available: false }),
      };
      mockCreateSupabaseClient.mockReturnValue(mockClient as any);
      
      mockWriteConfig.mockResolvedValueOnce('supacontrol.toml');

      const cmd = createInitCommand();
      await cmd.parseAsync(['node', 'init']);
      
      expect(mockGetOrPromptForToken).toHaveBeenCalledWith({ saveToken: true });
    });

    it('should cancel when token prompt returns null', async () => {
      // Supabase exists
      mockAccess.mockResolvedValueOnce(undefined);
      // No existing config
      mockConfigExists.mockResolvedValueOnce(false);
      // User selects local-staging
      mockSelect.mockResolvedValueOnce('local-staging');
      // No existing token
      mockGetAccessToken.mockResolvedValueOnce(null);
      // Token cancelled
      mockGetOrPromptForToken.mockResolvedValueOnce(null);

      const cmd = createInitCommand();
      
      await expect(cmd.parseAsync(['node', 'init'])).rejects.toThrow(/process\.exit/);
    });

    it('should fail when token is invalid', async () => {
      // Supabase exists
      mockAccess.mockResolvedValueOnce(undefined);
      // No existing config
      mockConfigExists.mockResolvedValueOnce(false);
      // User selects local-staging
      mockSelect.mockResolvedValueOnce('local-staging');
      // Token exists
      mockGetAccessToken.mockResolvedValueOnce('invalid-token');
      
      // Mock client with invalid auth
      const mockClient = {
        authenticate: vi.fn().mockResolvedValue(false),
        getProjects: vi.fn().mockResolvedValue([]),
      };
      mockCreateSupabaseClient.mockReturnValue(mockClient as any);

      const cmd = createInitCommand();
      
      await expect(cmd.parseAsync(['node', 'init'])).rejects.toThrow(/process\.exit/);
    });
  });

  describe('config generation', () => {
    it('should generate correct default settings', async () => {
      // Supabase exists
      mockAccess.mockResolvedValueOnce(undefined);
      // No existing config
      mockConfigExists.mockResolvedValueOnce(false);
      // User selects local only
      mockSelect.mockResolvedValueOnce('local');
      // Write config succeeds
      mockWriteConfig.mockResolvedValueOnce('supacontrol.toml');

      const cmd = createInitCommand();
      await cmd.parseAsync(['node', 'init']);
      
      expect(mockWriteConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          settings: {
            strict_mode: false,
            require_clean_git: false,
            show_migration_diff: true,
          },
        })
      );
    });

    it('should create staging environment with correct defaults', async () => {
      // Supabase exists
      mockAccess.mockResolvedValueOnce(undefined);
      // No existing config
      mockConfigExists.mockResolvedValueOnce(false);
      // User selects local-staging
      mockSelect.mockResolvedValueOnce('local-staging');
      // Token exists
      mockGetAccessToken.mockResolvedValueOnce('test-token');
      
      // Mock client
      const mockClient = {
        authenticate: vi.fn().mockResolvedValue(true),
        getProjects: vi.fn().mockResolvedValue([
          { id: 'staging-proj', name: 'Staging', status: 'ACTIVE_HEALTHY', region: 'us-east-1' },
        ]),
        getBranches: vi.fn().mockResolvedValue([]),
        checkBranchingCapability: vi.fn().mockResolvedValue({ available: false }),
      };
      mockCreateSupabaseClient.mockReturnValue(mockClient as any);
      
      // User selects project
      mockSelect.mockResolvedValueOnce('staging-proj');
      
      mockWriteConfig.mockResolvedValueOnce('supacontrol.toml');

      const cmd = createInitCommand();
      await cmd.parseAsync(['node', 'init']);
      
      expect(mockWriteConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          environments: {
            staging: expect.objectContaining({
              project_ref: 'staging-proj',
              git_branches: ['develop', 'staging'],
              protected_operations: ['reset'],
            }),
          },
        })
      );
    });
  });

   describe('project selection', () => {
     it('should allow skipping project selection', async () => {
       // Supabase exists
       mockAccess.mockResolvedValueOnce(undefined);
       // No existing config
       mockConfigExists.mockResolvedValueOnce(false);
       // User selects local-staging
       mockSelect.mockResolvedValueOnce('local-staging');
       // Token exists
       mockGetAccessToken.mockResolvedValueOnce('test-token');
       
       // Mock client
       const mockClient = {
         authenticate: vi.fn().mockResolvedValue(true),
         getProjects: vi.fn().mockResolvedValue([
           { id: 'proj-1', name: 'Project 1', status: 'ACTIVE_HEALTHY', region: 'us-east-1' },
         ]),
         getBranches: vi.fn().mockResolvedValue([]),
         checkBranchingCapability: vi.fn().mockResolvedValue({ available: false }),
       };
       mockCreateSupabaseClient.mockReturnValue(mockClient as any);
       
       // User skips project selection
       mockSelect.mockResolvedValueOnce('__skip__');
       
       mockWriteConfig.mockResolvedValueOnce('supacontrol.toml');

       const cmd = createInitCommand();
       await cmd.parseAsync(['node', 'init']);
       
       expect(mockWriteConfig).toHaveBeenCalledWith(
         expect.objectContaining({
           environments: {
             staging: expect.objectContaining({
               project_ref: undefined,
             }),
           },
         })
       );
     });

     it('should handle no projects available', async () => {
       // Supabase exists
       mockAccess.mockResolvedValueOnce(undefined);
       // No existing config
       mockConfigExists.mockResolvedValueOnce(false);
       // User selects local-staging
       mockSelect.mockResolvedValueOnce('local-staging');
       // Token exists
       mockGetAccessToken.mockResolvedValueOnce('test-token');
       
       // Mock client with no projects
       const mockClient = {
         authenticate: vi.fn().mockResolvedValue(true),
         getProjects: vi.fn().mockResolvedValue([]),
         getBranches: vi.fn().mockResolvedValue([]),
         checkBranchingCapability: vi.fn().mockResolvedValue({ available: false }),
       };
       mockCreateSupabaseClient.mockReturnValue(mockClient as any);
       
       mockWriteConfig.mockResolvedValueOnce('supacontrol.toml');

       const cmd = createInitCommand();
       await cmd.parseAsync(['node', 'init']);
       
       // Should write config with empty environments
       expect(mockWriteConfig).toHaveBeenCalled();
     });
   });

   describe('production environment setup (local-staging-production)', () => {
     it('should handle local-staging-production preset selection', async () => {
       // Supabase exists
       mockAccess.mockResolvedValueOnce(undefined);
       // No existing config
       mockConfigExists.mockResolvedValueOnce(false);
       // User selects local-staging-production
       mockSelect.mockResolvedValueOnce('local-staging-production');
       // Token exists
       mockGetAccessToken.mockResolvedValueOnce('test-token');
       
       // Mock client with no projects (will trigger branching gate)
       const mockClient = {
         authenticate: vi.fn().mockResolvedValue(true),
         getProjects: vi.fn().mockResolvedValue([]),
         checkBranchingCapability: vi.fn().mockResolvedValue({ available: false }),
       };
       mockCreateSupabaseClient.mockReturnValue(mockClient as any);
       
       // User chooses to downgrade to local-staging
       mockSelect.mockResolvedValueOnce('local-staging');
       // User confirms fallback
       mockSelect.mockResolvedValueOnce('local-staging');
       
       mockWriteConfig.mockResolvedValueOnce('supacontrol.toml');

       const cmd = createInitCommand();
       await cmd.parseAsync(['node', 'init']);
       
       // Should write config
       expect(mockWriteConfig).toHaveBeenCalled();
     });
   });

   describe('branching capability checks', () => {
     it('should check branching capability for active projects', async () => {
       // Supabase exists
       mockAccess.mockResolvedValueOnce(undefined);
       // No existing config
       mockConfigExists.mockResolvedValueOnce(false);
       // User selects local-staging-production
       mockSelect.mockResolvedValueOnce('local-staging-production');
       // Token exists
       mockGetAccessToken.mockResolvedValueOnce('test-token');
       
       // Mock client with multiple projects
       const mockClient = {
         authenticate: vi.fn().mockResolvedValue(true),
         getProjects: vi.fn().mockResolvedValue([
           { id: 'proj-1', name: 'Project 1', status: 'ACTIVE_HEALTHY', region: 'us-east-1' },
           { id: 'proj-2', name: 'Project 2', status: 'PAUSED', region: 'us-east-1' },
           { id: 'proj-3', name: 'Project 3', status: 'ACTIVE_HEALTHY', region: 'eu-west-1' },
         ]),
         checkBranchingCapability: vi.fn()
           .mockResolvedValueOnce({ available: false })
           .mockResolvedValueOnce({ available: false }),
       };
       mockCreateSupabaseClient.mockReturnValue(mockClient as any);
       
       // User chooses separate projects
       mockSelect.mockResolvedValueOnce('separate-projects');
       // User selects production project
       mockSelect.mockResolvedValueOnce('proj-1');
       // User selects staging project
       mockSelect.mockResolvedValueOnce('proj-3');
       
       mockWriteConfig.mockResolvedValueOnce('supacontrol.toml');

       const cmd = createInitCommand();
       await cmd.parseAsync(['node', 'init']);
       
       // Should have checked branching capability for active projects only
       expect(mockClient.checkBranchingCapability).toHaveBeenCalled();
     });
   });

   describe('CI mode', () => {
     it('should fail when token is not set in CI mode', async () => {
       // Supabase exists
       mockAccess.mockResolvedValueOnce(undefined);
       // No existing config
       mockConfigExists.mockResolvedValueOnce(false);
       // User selects local-staging
       mockSelect.mockResolvedValueOnce('local-staging');
       // No token available
       mockGetAccessToken.mockResolvedValueOnce(null);

       // Mock program.opts to return CI mode
       const { program } = await import('../../src/index.js');
       vi.mocked(program.opts).mockReturnValueOnce({ ci: true, env: undefined, verbose: false } as any);

       const cmd = createInitCommand();
       
       await expect(cmd.parseAsync(['node', 'init'])).rejects.toThrow(/process\.exit/);
     });
   });

   describe('error handling', () => {
     it('should handle all projects already selected', async () => {
       // Supabase exists
       mockAccess.mockResolvedValueOnce(undefined);
       // No existing config
       mockConfigExists.mockResolvedValueOnce(false);
       // User selects local-staging-production
       mockSelect.mockResolvedValueOnce('local-staging-production');
       // Token exists
       mockGetAccessToken.mockResolvedValueOnce('test-token');
       
       // Mock client with only one project
       const mockClient = {
         authenticate: vi.fn().mockResolvedValue(true),
         getProjects: vi.fn().mockResolvedValue([
           { id: 'proj-1', name: 'Project 1', status: 'ACTIVE_HEALTHY', region: 'us-east-1' },
         ]),
         checkBranchingCapability: vi.fn().mockResolvedValue({ available: false }),
       };
       mockCreateSupabaseClient.mockReturnValue(mockClient as any);
       
       // User chooses separate projects
       mockSelect.mockResolvedValueOnce('separate-projects');
       // User selects project for production
       mockSelect.mockResolvedValueOnce('proj-1');
       // User confirms skip for staging (all projects used)
       mockConfirm.mockResolvedValueOnce(true);
       
       mockWriteConfig.mockResolvedValueOnce('supacontrol.toml');

       const cmd = createInitCommand();
       await cmd.parseAsync(['node', 'init']);
       
       expect(mockWriteConfig).toHaveBeenCalled();
     });
   });

   describe('environment config generation', () => {
     it('should generate staging environment with correct git branches', async () => {
       // Supabase exists
       mockAccess.mockResolvedValueOnce(undefined);
       // No existing config
       mockConfigExists.mockResolvedValueOnce(false);
       // User selects local-staging
       mockSelect.mockResolvedValueOnce('local-staging');
       // Token exists
       mockGetAccessToken.mockResolvedValueOnce('test-token');
       
       // Mock client
       const mockClient = {
         authenticate: vi.fn().mockResolvedValue(true),
         getProjects: vi.fn().mockResolvedValue([
           { id: 'staging-proj', name: 'Staging', status: 'ACTIVE_HEALTHY', region: 'us-east-1' },
         ]),
         checkBranchingCapability: vi.fn().mockResolvedValue({ available: false }),
       };
       mockCreateSupabaseClient.mockReturnValue(mockClient as any);
       
       // User selects project
       mockSelect.mockResolvedValueOnce('staging-proj');
       
       mockWriteConfig.mockResolvedValueOnce('supacontrol.toml');

       const cmd = createInitCommand();
       await cmd.parseAsync(['node', 'init']);
       
       // Verify config was written
       expect(mockWriteConfig).toHaveBeenCalled();
       const config = mockWriteConfig.mock.calls[0][0];
       expect(config.environments.staging).toBeDefined();
       expect(config.environments.staging.git_branches).toEqual(['develop', 'staging']);
       expect(config.environments.staging.protected_operations).toEqual(['reset']);
     });

     it('should generate production environment with locked status', async () => {
       // Supabase exists
       mockAccess.mockResolvedValueOnce(undefined);
       // No existing config
       mockConfigExists.mockResolvedValueOnce(false);
       // User selects local-staging-production
       mockSelect.mockResolvedValueOnce('local-staging-production');
       // Token exists
       mockGetAccessToken.mockResolvedValueOnce('test-token');
       
       // Mock client
       const mockClient = {
         authenticate: vi.fn().mockResolvedValue(true),
         getProjects: vi.fn().mockResolvedValue([
           { id: 'prod-proj', name: 'Production', status: 'ACTIVE_HEALTHY', region: 'us-east-1' },
           { id: 'staging-proj', name: 'Staging', status: 'ACTIVE_HEALTHY', region: 'us-east-1' },
         ]),
         checkBranchingCapability: vi.fn()
           .mockResolvedValueOnce({ available: false })
           .mockResolvedValueOnce({ available: false }),
       };
       mockCreateSupabaseClient.mockReturnValue(mockClient as any);
       
       // User chooses separate projects
       mockSelect.mockResolvedValueOnce('separate-projects');
       // User selects production project
       mockSelect.mockResolvedValueOnce('prod-proj');
       // User selects staging project
       mockSelect.mockResolvedValueOnce('staging-proj');
       
       mockWriteConfig.mockResolvedValueOnce('supacontrol.toml');

       const cmd = createInitCommand();
       await cmd.parseAsync(['node', 'init']);
       
       // Verify config was written
       expect(mockWriteConfig).toHaveBeenCalled();
       const config = mockWriteConfig.mock.calls[0][0];
       expect(config.environments.production).toBeDefined();
       expect(config.environments.production.locked).toBe(true);
       expect(config.environments.production.confirm_word).toBe('production');
       expect(config.environments.production.protected_operations).toEqual(['push', 'reset', 'seed']);
     });
   });

   describe('project status handling', () => {
     it('should sort projects by status (active first)', async () => {
       // Supabase exists
       mockAccess.mockResolvedValueOnce(undefined);
       // No existing config
       mockConfigExists.mockResolvedValueOnce(false);
       // User selects local-staging
       mockSelect.mockResolvedValueOnce('local-staging');
       // Token exists
       mockGetAccessToken.mockResolvedValueOnce('test-token');
       
       // Mock client with mixed project statuses
       const mockClient = {
         authenticate: vi.fn().mockResolvedValue(true),
         getProjects: vi.fn().mockResolvedValue([
           { id: 'paused-proj', name: 'Paused Project', status: 'PAUSED', region: 'us-east-1' },
           { id: 'active-proj', name: 'Active Project', status: 'ACTIVE_HEALTHY', region: 'us-east-1' },
           { id: 'error-proj', name: 'Error Project', status: 'ACTIVE_UNHEALTHY', region: 'us-east-1' },
         ]),
         checkBranchingCapability: vi.fn().mockResolvedValue({ available: false }),
       };
       mockCreateSupabaseClient.mockReturnValue(mockClient as any);
       
       // User selects active project
       mockSelect.mockResolvedValueOnce('active-proj');
       
       mockWriteConfig.mockResolvedValueOnce('supacontrol.toml');

       const cmd = createInitCommand();
       await cmd.parseAsync(['node', 'init']);
       
       expect(mockWriteConfig).toHaveBeenCalled();
     });
   });
});
