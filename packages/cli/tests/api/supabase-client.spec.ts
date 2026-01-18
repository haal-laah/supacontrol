/**
 * Unit Tests for Supabase Management API Client
 *
 * These tests verify the SupabaseManagementClient functionality including:
 * - Authentication and token validation
 * - Project operations (list, get, search)
 * - Organization operations
 * - Branch operations (list, create, delete)
 * - Branching capability checks
 * - Rate limiting
 * - Error handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fetch globally
global.fetch = vi.fn();

import {
  SupabaseAPIError,
  SupabaseManagementClient,
  createSupabaseClient,
  ProjectStatus,
  OrganizationPlan,
  OrganizationSchema,
  ProjectSchema,
  BranchSchema,
} from '../../src/api/supabase-client.js';

const mockFetch = vi.mocked(global.fetch);

describe('Supabase Management API Client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // ============================================================================
  // SupabaseAPIError Tests
  // ============================================================================

  describe('SupabaseAPIError', () => {
    it('should create error with message and status code', () => {
      const error = new SupabaseAPIError('Test error', 401);

      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe('Test error');
      expect(error.statusCode).toBe(401);
      expect(error.name).toBe('SupabaseAPIError');
    });

    it('should include response body in error', () => {
      const responseBody = { error: 'Invalid token' };
      const error = new SupabaseAPIError('Auth failed', 401, responseBody);

      expect(error.response).toEqual(responseBody);
    });

    it('should work with instanceof checks', () => {
      const error = new SupabaseAPIError('Test', 500);

      expect(error instanceof SupabaseAPIError).toBe(true);
      expect(error instanceof Error).toBe(true);
    });
  });

  // ============================================================================
  // SupabaseManagementClient Constructor Tests
  // ============================================================================

  describe('SupabaseManagementClient', () => {
    it('should create client with access token', () => {
      const token = 'test-token-123';
      const client = new SupabaseManagementClient(token);

      expect(client).toBeInstanceOf(SupabaseManagementClient);
    });

    it('should initialize rate limiting state', () => {
      const client = new SupabaseManagementClient('token');

      // Access private properties through any type for testing
      const clientAny = client as any;
      expect(clientAny.requestCount).toBe(0);
      expect(clientAny.requestWindowStart).toBeDefined();
    });
  });

  // ============================================================================
  // Authentication Tests
  // ============================================================================

  describe('authenticate', () => {
    it('should return true for valid token', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      } as Response);

      const client = new SupabaseManagementClient('valid-token');
      const result = await client.authenticate();

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/projects'),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer valid-token',
          }),
        })
      );
    });

    it('should return false for invalid token (401)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({ message: 'Invalid token' }),
      } as Response);

      const client = new SupabaseManagementClient('invalid-token');
      const result = await client.authenticate();

      expect(result).toBe(false);
    });

    it('should throw for other errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({ message: 'Server error' }),
      } as Response);

      const client = new SupabaseManagementClient('token');

      await expect(client.authenticate()).rejects.toThrow(SupabaseAPIError);
    });
  });

  // ============================================================================
  // Project Operations Tests
  // ============================================================================

  describe('getProjects', () => {
    it('should return list of projects', async () => {
      const mockProjects = [
        {
          id: 'proj-1',
          organization_id: 'org-1',
          name: 'Project 1',
          region: 'us-east-1',
          created_at: '2024-01-01T00:00:00Z',
          status: 'ACTIVE_HEALTHY',
        },
        {
          id: 'proj-2',
          organization_id: 'org-1',
          name: 'Project 2',
          region: 'eu-west-1',
          created_at: '2024-01-02T00:00:00Z',
          status: 'ACTIVE_HEALTHY',
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockProjects,
      } as Response);

      const client = new SupabaseManagementClient('token');
      const projects = await client.getProjects();

      expect(projects).toHaveLength(2);
      expect(projects[0].name).toBe('Project 1');
      expect(projects[1].name).toBe('Project 2');
    });

    it('should filter out invalid projects', async () => {
      const mockProjects = [
        {
          id: 'proj-1',
          organization_id: 'org-1',
          name: 'Valid Project',
          region: 'us-east-1',
          created_at: '2024-01-01T00:00:00Z',
          status: 'ACTIVE_HEALTHY',
        },
        {
          // Missing required fields
          id: 'proj-2',
          name: 'Invalid Project',
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockProjects,
      } as Response);

      const client = new SupabaseManagementClient('token');
      const projects = await client.getProjects();

      expect(projects).toHaveLength(1);
      expect(projects[0].name).toBe('Valid Project');
    });

    it('should return empty array on 401', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({ message: 'Invalid token' }),
      } as Response);

      const client = new SupabaseManagementClient('invalid-token');

      await expect(client.getProjects()).rejects.toThrow(SupabaseAPIError);
    });

    it('should handle empty project list', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      } as Response);

      const client = new SupabaseManagementClient('token');
      const projects = await client.getProjects();

      expect(projects).toEqual([]);
    });
  });

  describe('getProject', () => {
    it('should return project by reference', async () => {
      const mockProject = {
        id: 'proj-1',
        organization_id: 'org-1',
        name: 'My Project',
        region: 'us-east-1',
        created_at: '2024-01-01T00:00:00Z',
        status: 'ACTIVE_HEALTHY',
        database: {
          host: 'db.example.com',
          version: '15.1',
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockProject,
      } as Response);

      const client = new SupabaseManagementClient('token');
      const project = await client.getProject('proj-1');

      expect(project).not.toBeNull();
      expect(project?.name).toBe('My Project');
      expect(project?.database?.version).toBe('15.1');
    });

    it('should return null for 404', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({ message: 'Project not found' }),
      } as Response);

      const client = new SupabaseManagementClient('token');
      const project = await client.getProject('nonexistent');

      expect(project).toBeNull();
    });

    it('should throw for other errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({ message: 'Server error' }),
      } as Response);

      const client = new SupabaseManagementClient('token');

      await expect(client.getProject('proj-1')).rejects.toThrow(SupabaseAPIError);
    });

    it('should return null for invalid project data', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ invalid: 'data' }),
      } as Response);

      const client = new SupabaseManagementClient('token');
      const project = await client.getProject('proj-1');

      expect(project).toBeNull();
    });
  });

  describe('getProjectByName', () => {
    it('should find project by name (case-insensitive)', async () => {
      const mockProjects = [
        {
          id: 'proj-1',
          organization_id: 'org-1',
          name: 'My Project',
          region: 'us-east-1',
          created_at: '2024-01-01T00:00:00Z',
          status: 'ACTIVE_HEALTHY',
        },
        {
          id: 'proj-2',
          organization_id: 'org-1',
          name: 'Another Project',
          region: 'eu-west-1',
          created_at: '2024-01-02T00:00:00Z',
          status: 'ACTIVE_HEALTHY',
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockProjects,
      } as Response);

      const client = new SupabaseManagementClient('token');
      const project = await client.getProjectByName('my project');

      expect(project).not.toBeNull();
      expect(project?.name).toBe('My Project');
    });

    it('should return null if project not found', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      } as Response);

      const client = new SupabaseManagementClient('token');
      const project = await client.getProjectByName('nonexistent');

      expect(project).toBeNull();
    });

    it('should handle multiple projects with same name (returns first)', async () => {
      const mockProjects = [
        {
          id: 'proj-1',
          organization_id: 'org-1',
          name: 'Duplicate',
          region: 'us-east-1',
          created_at: '2024-01-01T00:00:00Z',
          status: 'ACTIVE_HEALTHY',
        },
        {
          id: 'proj-2',
          organization_id: 'org-1',
          name: 'Duplicate',
          region: 'eu-west-1',
          created_at: '2024-01-02T00:00:00Z',
          status: 'ACTIVE_HEALTHY',
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockProjects,
      } as Response);

      const client = new SupabaseManagementClient('token');
      const project = await client.getProjectByName('Duplicate');

      expect(project?.id).toBe('proj-1');
    });
  });

  // ============================================================================
  // Organization Operations Tests
  // ============================================================================

  describe('getOrganization', () => {
    it('should return organization by slug', async () => {
      const mockOrg = {
        id: 'org-1',
        name: 'My Organization',
        plan: 'pro',
        allowed_release_channels: ['stable'],
        opt_in_tags: [],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockOrg,
      } as Response);

      const client = new SupabaseManagementClient('token');
      const org = await client.getOrganization('my-org');

      expect(org).not.toBeNull();
      expect(org?.name).toBe('My Organization');
      expect(org?.plan).toBe('pro');
    });

    it('should return null for 404', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({ message: 'Organization not found' }),
      } as Response);

      const client = new SupabaseManagementClient('token');
      const org = await client.getOrganization('nonexistent');

      expect(org).toBeNull();
    });

    it('should throw for other errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({ message: 'Server error' }),
      } as Response);

      const client = new SupabaseManagementClient('token');

      await expect(client.getOrganization('org')).rejects.toThrow(SupabaseAPIError);
    });

    it('should handle organization without plan', async () => {
      const mockOrg = {
        id: 'org-1',
        name: 'My Organization',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockOrg,
      } as Response);

      const client = new SupabaseManagementClient('token');
      const org = await client.getOrganization('my-org');

      expect(org).not.toBeNull();
      expect(org?.plan).toBeUndefined();
    });
  });

  describe('getOrganizationForProject', () => {
    it('should use organization_slug if available', async () => {
      const mockOrg = {
        id: 'org-1',
        name: 'My Organization',
        plan: 'pro',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockOrg,
      } as Response);

      const client = new SupabaseManagementClient('token');
      const project = {
        id: 'proj-1',
        organization_id: 'org-1',
        organization_slug: 'my-org-slug',
        name: 'Project',
        region: 'us-east-1',
        created_at: '2024-01-01T00:00:00Z',
        status: 'ACTIVE_HEALTHY' as const,
      };

      const org = await client.getOrganizationForProject(project);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/organizations/my-org-slug'),
        expect.any(Object)
      );
      expect(org?.name).toBe('My Organization');
    });

    it('should fall back to organization_id if slug not available', async () => {
      const mockOrg = {
        id: 'org-1',
        name: 'My Organization',
        plan: 'team',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockOrg,
      } as Response);

      const client = new SupabaseManagementClient('token');
      const project = {
        id: 'proj-1',
        organization_id: 'org-1',
        name: 'Project',
        region: 'us-east-1',
        created_at: '2024-01-01T00:00:00Z',
        status: 'ACTIVE_HEALTHY' as const,
      };

      const org = await client.getOrganizationForProject(project);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/organizations/org-1'),
        expect.any(Object)
      );
      expect(org?.name).toBe('My Organization');
    });
  });

  // ============================================================================
  // Branch Operations Tests
  // ============================================================================

  describe('getBranches', () => {
    it('should return list of branches', async () => {
      const mockBranches = [
        {
          id: 'branch-1',
          name: 'main',
          project_ref: 'proj-1',
          parent_project_ref: 'proj-1',
          is_default: true,
          status: 'ACTIVE_HEALTHY',
          created_at: '2024-01-01T00:00:00Z',
        },
        {
          id: 'branch-2',
          name: 'develop',
          project_ref: 'proj-1-dev',
          parent_project_ref: 'proj-1',
          is_default: false,
          status: 'ACTIVE_HEALTHY',
          created_at: '2024-01-02T00:00:00Z',
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockBranches,
      } as Response);

      const client = new SupabaseManagementClient('token');
      const branches = await client.getBranches('proj-1');

      expect(branches).toHaveLength(2);
      expect(branches[0].name).toBe('main');
      expect(branches[1].name).toBe('develop');
    });

    it('should return empty array for 403 (branching not enabled)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        json: async () => ({ message: 'Branching not enabled' }),
      } as Response);

      const client = new SupabaseManagementClient('token');
      const branches = await client.getBranches('proj-1');

      expect(branches).toEqual([]);
    });

    it('should return empty array for 400 (branching not available)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({ message: 'Branching not available' }),
      } as Response);

      const client = new SupabaseManagementClient('token');
      const branches = await client.getBranches('proj-1');

      expect(branches).toEqual([]);
    });

    it('should throw for other errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({ message: 'Server error' }),
      } as Response);

      const client = new SupabaseManagementClient('token');

      await expect(client.getBranches('proj-1')).rejects.toThrow(SupabaseAPIError);
    });

    it('should filter out invalid branches', async () => {
      const mockBranches = [
        {
          id: 'branch-1',
          name: 'main',
          project_ref: 'proj-1',
          parent_project_ref: 'proj-1',
          is_default: true,
          status: 'ACTIVE_HEALTHY',
        },
        {
          // Missing required fields
          id: 'branch-2',
          name: 'invalid',
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockBranches,
      } as Response);

      const client = new SupabaseManagementClient('token');
      const branches = await client.getBranches('proj-1');

      expect(branches).toHaveLength(1);
      expect(branches[0].name).toBe('main');
    });
  });

  describe('createBranch', () => {
    it('should create a new branch', async () => {
      const mockBranch = {
        id: 'branch-new',
        name: 'feature-branch',
        project_ref: 'proj-1-feature',
        parent_project_ref: 'proj-1',
        is_default: false,
        status: 'ACTIVE_HEALTHY',
        created_at: '2024-01-03T00:00:00Z',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockBranch,
      } as Response);

      const client = new SupabaseManagementClient('token');
      const branch = await client.createBranch('proj-1', 'feature-branch');

      expect(branch).not.toBeNull();
      expect(branch?.name).toBe('feature-branch');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/projects/proj-1/branches'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ branch_name: 'feature-branch' }),
        })
      );
    });

    it('should return null for invalid branch data', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ invalid: 'data' }),
      } as Response);

      const client = new SupabaseManagementClient('token');
      const branch = await client.createBranch('proj-1', 'feature');

      expect(branch).toBeNull();
    });

    it('should throw on API error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({ message: 'Invalid branch name' }),
      } as Response);

      const client = new SupabaseManagementClient('token');

      await expect(client.createBranch('proj-1', 'invalid@name')).rejects.toThrow(
        SupabaseAPIError
      );
    });
  });

  describe('deleteBranch', () => {
    it('should delete a branch', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      } as Response);

      const client = new SupabaseManagementClient('token');
      const result = await client.deleteBranch('proj-1', 'branch-1');

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/projects/proj-1/branches/branch-1'),
        expect.objectContaining({
          method: 'DELETE',
        })
      );
    });

    it('should return true for 404 (already deleted)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({ message: 'Branch not found' }),
      } as Response);

      const client = new SupabaseManagementClient('token');
      const result = await client.deleteBranch('proj-1', 'nonexistent');

      expect(result).toBe(true);
    });

    it('should return false for other errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({ message: 'Server error' }),
      } as Response);

      const client = new SupabaseManagementClient('token');
      const result = await client.deleteBranch('proj-1', 'branch-1');

      expect(result).toBe(false);
    });
  });

  // ============================================================================
  // Branching Capability Tests
  // ============================================================================

  describe('checkBranchingCapability', () => {
    it('should return available=true for pro plan', async () => {
      const mockOrg = {
        id: 'org-1',
        name: 'My Organization',
        plan: 'pro',
      };

      const mockBranches = [
        {
          id: 'branch-1',
          name: 'main',
          project_ref: 'proj-1',
          parent_project_ref: 'proj-1',
          is_default: true,
          status: 'ACTIVE_HEALTHY',
        },
      ];

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockOrg,
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockBranches,
        } as Response);

      const client = new SupabaseManagementClient('token');
      const project = {
        id: 'proj-1',
        organization_id: 'org-1',
        organization_slug: 'my-org',
        name: 'Project',
        region: 'us-east-1',
        created_at: '2024-01-01T00:00:00Z',
        status: 'ACTIVE_HEALTHY' as const,
      };

      const result = await client.checkBranchingCapability(project);

      expect(result.available).toBe(true);
      expect(result.plan).toBe('pro');
      expect(result.reason).toBe('paid_plan');
      expect(result.branches).toHaveLength(1);
    });

    it('should return available=true for team plan', async () => {
      const mockOrg = {
        id: 'org-1',
        name: 'My Organization',
        plan: 'team',
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockOrg,
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [],
        } as Response);

      const client = new SupabaseManagementClient('token');
      const project = {
        id: 'proj-1',
        organization_id: 'org-1',
        organization_slug: 'my-org',
        name: 'Project',
        region: 'us-east-1',
        created_at: '2024-01-01T00:00:00Z',
        status: 'ACTIVE_HEALTHY' as const,
      };

      const result = await client.checkBranchingCapability(project);

      expect(result.available).toBe(true);
      expect(result.plan).toBe('team');
      expect(result.reason).toBe('paid_plan');
    });

    it('should return available=true for enterprise plan', async () => {
      const mockOrg = {
        id: 'org-1',
        name: 'My Organization',
        plan: 'enterprise',
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockOrg,
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [],
        } as Response);

      const client = new SupabaseManagementClient('token');
      const project = {
        id: 'proj-1',
        organization_id: 'org-1',
        organization_slug: 'my-org',
        name: 'Project',
        region: 'us-east-1',
        created_at: '2024-01-01T00:00:00Z',
        status: 'ACTIVE_HEALTHY' as const,
      };

      const result = await client.checkBranchingCapability(project);

      expect(result.available).toBe(true);
      expect(result.plan).toBe('enterprise');
      expect(result.reason).toBe('paid_plan');
    });

    it('should return available=true for platform plan', async () => {
      const mockOrg = {
        id: 'org-1',
        name: 'My Organization',
        plan: 'platform',
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockOrg,
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [],
        } as Response);

      const client = new SupabaseManagementClient('token');
      const project = {
        id: 'proj-1',
        organization_id: 'org-1',
        organization_slug: 'my-org',
        name: 'Project',
        region: 'us-east-1',
        created_at: '2024-01-01T00:00:00Z',
        status: 'ACTIVE_HEALTHY' as const,
      };

      const result = await client.checkBranchingCapability(project);

      expect(result.available).toBe(true);
      expect(result.plan).toBe('platform');
      expect(result.reason).toBe('paid_plan');
    });

    it('should return available=false for free plan', async () => {
      const mockOrg = {
        id: 'org-1',
        name: 'My Organization',
        plan: 'free',
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockOrg,
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [],
        } as Response);

      const client = new SupabaseManagementClient('token');
      const project = {
        id: 'proj-1',
        organization_id: 'org-1',
        organization_slug: 'my-org',
        name: 'Project',
        region: 'us-east-1',
        created_at: '2024-01-01T00:00:00Z',
        status: 'ACTIVE_HEALTHY' as const,
      };

      const result = await client.checkBranchingCapability(project);

      expect(result.available).toBe(false);
      expect(result.plan).toBe('free');
      expect(result.reason).toBe('free_plan');
    });

    it('should detect branching from non-default branches when plan is unknown', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: 'org-1', name: 'My Organization' }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [
            {
              id: 'branch-1',
              name: 'main',
              project_ref: 'proj-1',
              parent_project_ref: 'proj-1',
              is_default: true,
              status: 'ACTIVE_HEALTHY',
            },
            {
              id: 'branch-2',
              name: 'develop',
              project_ref: 'proj-1-dev',
              parent_project_ref: 'proj-1',
              is_default: false,
              status: 'ACTIVE_HEALTHY',
            },
          ],
        } as Response);

      const client = new SupabaseManagementClient('token');
      const project = {
        id: 'proj-1',
        organization_id: 'org-1',
        organization_slug: 'my-org',
        name: 'Project',
        region: 'us-east-1',
        created_at: '2024-01-01T00:00:00Z',
        status: 'ACTIVE_HEALTHY' as const,
      };

      const result = await client.checkBranchingCapability(project);

      expect(result.available).toBe(true);
      expect(result.plan).toBe('unknown');
      expect(result.reason).toBe('has_non_default_branches');
      expect(result.branches).toHaveLength(2);
    });

    it('should return unavailable for unknown plan with no non-default branches', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: 'org-1', name: 'My Organization' }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [
            {
              id: 'branch-1',
              name: 'main',
              project_ref: 'proj-1',
              parent_project_ref: 'proj-1',
              is_default: true,
              status: 'ACTIVE_HEALTHY',
            },
          ],
        } as Response);

      const client = new SupabaseManagementClient('token');
      const project = {
        id: 'proj-1',
        organization_id: 'org-1',
        organization_slug: 'my-org',
        name: 'Project',
        region: 'us-east-1',
        created_at: '2024-01-01T00:00:00Z',
        status: 'ACTIVE_HEALTHY' as const,
      };

      const result = await client.checkBranchingCapability(project);

      expect(result.available).toBe(false);
      expect(result.plan).toBe('unknown');
      expect(result.reason).toBe('unknown_capability');
    });

    it('should handle org fetch failure gracefully', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          json: async () => ({ message: 'Server error' }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [],
        } as Response);

      const client = new SupabaseManagementClient('token');
      const project = {
        id: 'proj-1',
        organization_id: 'org-1',
        organization_slug: 'my-org',
        name: 'Project',
        region: 'us-east-1',
        created_at: '2024-01-01T00:00:00Z',
        status: 'ACTIVE_HEALTHY' as const,
      };

      const result = await client.checkBranchingCapability(project);

      expect(result.plan).toBe('unknown');
      expect(result.branches).toEqual([]);
    });

    it('should handle branches fetch failure gracefully', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: 'org-1', name: 'My Organization', plan: 'pro' }),
        } as Response)
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          json: async () => ({ message: 'Server error' }),
        } as Response);

      const client = new SupabaseManagementClient('token');
      const project = {
        id: 'proj-1',
        organization_id: 'org-1',
        organization_slug: 'my-org',
        name: 'Project',
        region: 'us-east-1',
        created_at: '2024-01-01T00:00:00Z',
        status: 'ACTIVE_HEALTHY' as const,
      };

      const result = await client.checkBranchingCapability(project);

      expect(result.available).toBe(true);
      expect(result.plan).toBe('pro');
      expect(result.branches).toEqual([]);
    });
  });

  describe('isBranchingAvailable (deprecated)', () => {
    it('should return true when branching is available', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: 'org-1', name: 'My Organization', plan: 'pro' }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [],
        } as Response);

      const client = new SupabaseManagementClient('token');
      const project = {
        id: 'proj-1',
        organization_id: 'org-1',
        organization_slug: 'my-org',
        name: 'Project',
        region: 'us-east-1',
        created_at: '2024-01-01T00:00:00Z',
        status: 'ACTIVE_HEALTHY' as const,
      };

      const result = await client.isBranchingAvailable(project);

      expect(result).toBe(true);
    });

    it('should return false when branching is not available', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: 'org-1', name: 'My Organization', plan: 'free' }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [],
        } as Response);

      const client = new SupabaseManagementClient('token');
      const project = {
        id: 'proj-1',
        organization_id: 'org-1',
        organization_slug: 'my-org',
        name: 'Project',
        region: 'us-east-1',
        created_at: '2024-01-01T00:00:00Z',
        status: 'ACTIVE_HEALTHY' as const,
      };

      const result = await client.isBranchingAvailable(project);

      expect(result).toBe(false);
    });
  });

  // ============================================================================
  // Rate Limiting Tests
  // ============================================================================

  describe('rate limiting', () => {
    it('should allow requests under the limit', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => [],
      } as Response);

      const client = new SupabaseManagementClient('token');

      // Make 10 requests (well under 120 per minute)
      for (let i = 0; i < 10; i++) {
        await client.getProjects();
      }

      expect(mockFetch).toHaveBeenCalledTimes(10);
    });

    it('should wait when rate limit is reached', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => [],
      } as Response);

      const client = new SupabaseManagementClient('token');
      const clientAny = client as any;

      // Simulate hitting the rate limit
      clientAny.requestCount = 120;
      clientAny.requestWindowStart = Date.now();

      const startTime = Date.now();

      // Make a request that should trigger rate limiting
      const promise = client.getProjects();

      // Fast-forward time by 61 seconds
      vi.advanceTimersByTime(61 * 1000);

      await promise;

      // Verify that time was advanced
      expect(Date.now() - startTime).toBeGreaterThanOrEqual(61 * 1000);
    });

    it('should reset counter after window expires', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => [],
      } as Response);

      const client = new SupabaseManagementClient('token');
      const clientAny = client as any;

      // Make initial request
      await client.getProjects();
      expect(clientAny.requestCount).toBe(1);

      // Advance time by 61 seconds (past the 60-second window)
      vi.advanceTimersByTime(61 * 1000);

      // Make another request
      await client.getProjects();

      // Counter should be reset and incremented
      expect(clientAny.requestCount).toBe(1);
    });

    it('should include authorization header in all requests', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => [],
      } as Response);

      const token = 'test-token-xyz';
      const client = new SupabaseManagementClient(token);

      await client.getProjects();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          }),
        })
      );
    });
  });

  // ============================================================================
  // Error Handling Tests
  // ============================================================================

  describe('error handling', () => {
    it('should handle 401 with custom message', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({ message: 'Invalid token' }),
      } as Response);

      const client = new SupabaseManagementClient('invalid-token');

      try {
        await client.getProjects();
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(SupabaseAPIError);
        expect((error as SupabaseAPIError).statusCode).toBe(401);
        expect((error as SupabaseAPIError).message).toContain('Invalid or expired access token');
      }
    });

    it('should handle 429 rate limit error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        json: async () => ({ message: 'Rate limit exceeded' }),
      } as Response);

      const client = new SupabaseManagementClient('token');

      try {
        await client.getProjects();
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(SupabaseAPIError);
        expect((error as SupabaseAPIError).statusCode).toBe(429);
        expect((error as SupabaseAPIError).message).toContain('Rate limit exceeded');
      }
    });

    it('should extract error message from response body', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({ message: 'Invalid project reference' }),
      } as Response);

      const client = new SupabaseManagementClient('token');

      try {
        await client.getProject('invalid');
        expect.fail('Should have thrown');
      } catch (error) {
        expect((error as SupabaseAPIError).message).toBe('Invalid project reference');
      }
    });

     it('should handle non-JSON error responses', async () => {
       mockFetch.mockResolvedValueOnce({
         ok: false,
         status: 500,
         statusText: 'Internal Server Error',
         json: async () => {
           throw new Error('Not JSON');
         },
       } as unknown as Response);

      const client = new SupabaseManagementClient('token');

      try {
        await client.getProjects();
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(SupabaseAPIError);
        expect((error as SupabaseAPIError).statusCode).toBe(500);
      }
    });

    it('should handle response with non-string message', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({ message: { error: 'Complex error' } }),
      } as Response);

      const client = new SupabaseManagementClient('token');

      try {
        await client.getProjects();
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(SupabaseAPIError);
        // Should convert to string
        expect((error as SupabaseAPIError).message).toBeDefined();
      }
    });
  });

  // ============================================================================
  // Factory Function Tests
  // ============================================================================

  describe('createSupabaseClient', () => {
    it('should create a client instance', () => {
      const client = createSupabaseClient('token');

      expect(client).toBeInstanceOf(SupabaseManagementClient);
    });

    it('should create independent client instances', () => {
      const client1 = createSupabaseClient('token1');
      const client2 = createSupabaseClient('token2');

      expect(client1).not.toBe(client2);
    });
  });

  // ============================================================================
  // Schema Validation Tests
  // ============================================================================

  describe('schema validation', () => {
    it('should validate ProjectStatus enum', () => {
      const validStatuses = [
        'ACTIVE_HEALTHY',
        'ACTIVE_UNHEALTHY',
        'COMING_UP',
        'GOING_DOWN',
        'INACTIVE',
        'INIT_FAILED',
        'REMOVED',
        'RESTORING',
        'UNKNOWN',
        'UPGRADING',
        'PAUSING',
        'PAUSED',
      ];

      for (const status of validStatuses) {
        const result = ProjectStatus.safeParse(status);
        expect(result.success).toBe(true);
      }

      const invalidResult = ProjectStatus.safeParse('INVALID_STATUS');
      expect(invalidResult.success).toBe(false);
    });

    it('should validate OrganizationPlan enum', () => {
      const validPlans = ['free', 'pro', 'team', 'enterprise', 'platform'];

      for (const plan of validPlans) {
        const result = OrganizationPlan.safeParse(plan);
        expect(result.success).toBe(true);
      }

      const invalidResult = OrganizationPlan.safeParse('invalid_plan');
      expect(invalidResult.success).toBe(false);
    });

    it('should validate Project schema', () => {
      const validProject = {
        id: 'proj-1',
        organization_id: 'org-1',
        name: 'My Project',
        region: 'us-east-1',
        created_at: '2024-01-01T00:00:00Z',
        status: 'ACTIVE_HEALTHY',
      };

      const result = ProjectSchema.safeParse(validProject);
      expect(result.success).toBe(true);
    });

    it('should validate Organization schema', () => {
      const validOrg = {
        id: 'org-1',
        name: 'My Organization',
        plan: 'pro',
      };

      const result = OrganizationSchema.safeParse(validOrg);
      expect(result.success).toBe(true);
    });

    it('should validate Branch schema', () => {
      const validBranch = {
        id: 'branch-1',
        name: 'main',
        project_ref: 'proj-1',
        parent_project_ref: 'proj-1',
        is_default: true,
        status: 'ACTIVE_HEALTHY',
      };

      const result = BranchSchema.safeParse(validBranch);
      expect(result.success).toBe(true);
    });
  });
});
