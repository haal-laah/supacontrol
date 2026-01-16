import { z } from 'zod';

/**
 * Supabase Management API base URL
 */
const API_BASE = 'https://api.supabase.com/v1';

/**
 * Rate limit: 120 requests per minute
 */
const RATE_LIMIT_PER_MINUTE = 120;

/**
 * Project status enum
 */
export const ProjectStatus = z.enum([
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
]);

export type ProjectStatus = z.infer<typeof ProjectStatus>;

/**
 * Organization plan types
 * - free: No branching capability
 * - pro/team/enterprise: Branching available
 */
export const OrganizationPlan = z.enum(['free', 'pro', 'team', 'enterprise', 'platform']);
export type OrganizationPlan = z.infer<typeof OrganizationPlan>;

/**
 * Organization schema (from GET /v1/organizations/{slug})
 */
export const OrganizationSchema = z.object({
  id: z.string(),
  name: z.string(),
  plan: OrganizationPlan.optional(),
  // Additional fields from detail endpoint
  allowed_release_channels: z.array(z.string()).optional(),
  opt_in_tags: z.array(z.string()).optional(),
});

export type Organization = z.infer<typeof OrganizationSchema>;

/**
 * Supabase project schema
 */
export const ProjectSchema = z.object({
  id: z.string(),
  organization_id: z.string(),
  organization_slug: z.string().optional(),
  name: z.string(),
  region: z.string(),
  created_at: z.string(),
  database: z.object({
    host: z.string(),
    version: z.string(),
  }).optional(),
  status: ProjectStatus,
  // Branching support (Pro plan feature)
  is_branch_enabled: z.boolean().optional(),
  preview_branch_refs: z.array(z.string()).optional(),
});

export type Project = z.infer<typeof ProjectSchema>;

/**
 * Branch schema
 */
export const BranchSchema = z.object({
  id: z.string(),
  name: z.string(),
  project_ref: z.string(),
  parent_project_ref: z.string(),
  is_default: z.boolean(),
  status: z.string(),
  created_at: z.string().optional(),
});

export type Branch = z.infer<typeof BranchSchema>;

/**
 * API error response
 */
export class SupabaseAPIError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly response?: unknown
  ) {
    super(message);
    this.name = 'SupabaseAPIError';
  }
}

/**
 * Supabase Management API client
 */
export class SupabaseManagementClient {
  private accessToken: string;
  private requestCount = 0;
  private requestWindowStart = Date.now();

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  /**
   * Make an authenticated API request
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    // Simple rate limiting check
    await this.checkRateLimit();

    const url = `${API_BASE}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    this.requestCount++;

    if (!response.ok) {
      let errorMessage = `API request failed: ${response.status} ${response.statusText}`;
      let responseBody: unknown;

      try {
        responseBody = await response.json();
        if (typeof responseBody === 'object' && responseBody !== null && 'message' in responseBody) {
          errorMessage = String((responseBody as { message: unknown }).message);
        }
      } catch {
        // Ignore JSON parse errors
      }

      if (response.status === 401) {
        throw new SupabaseAPIError(
          'Invalid or expired access token. Run `supabase login` to re-authenticate.',
          response.status,
          responseBody
        );
      }

      if (response.status === 429) {
        throw new SupabaseAPIError(
          'Rate limit exceeded. Please wait a moment and try again.',
          response.status,
          responseBody
        );
      }

      throw new SupabaseAPIError(errorMessage, response.status, responseBody);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Check and enforce rate limiting
   */
  private async checkRateLimit(): Promise<void> {
    const now = Date.now();
    const windowDuration = 60 * 1000; // 1 minute

    // Reset counter if window has passed
    if (now - this.requestWindowStart > windowDuration) {
      this.requestCount = 0;
      this.requestWindowStart = now;
    }

    // If we've hit the limit, wait for the window to reset
    if (this.requestCount >= RATE_LIMIT_PER_MINUTE) {
      const waitTime = windowDuration - (now - this.requestWindowStart);
      if (waitTime > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitTime));
        this.requestCount = 0;
        this.requestWindowStart = Date.now();
      }
    }
  }

  /**
   * Validate that the access token works
   */
  async authenticate(): Promise<boolean> {
    try {
      await this.getProjects();
      return true;
    } catch (error) {
      if (error instanceof SupabaseAPIError && error.statusCode === 401) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Get all projects for the authenticated user
   */
  async getProjects(): Promise<Project[]> {
    const response = await this.request<unknown[]>('/projects');
    
    // Validate and filter valid projects
    const projects: Project[] = [];
    for (const item of response) {
      const result = ProjectSchema.safeParse(item);
      if (result.success) {
        projects.push(result.data);
      }
    }

    return projects;
  }

  /**
   * Get a single project by reference ID
   */
  async getProject(projectRef: string): Promise<Project | null> {
    try {
      const response = await this.request<unknown>(`/projects/${projectRef}`);
      const result = ProjectSchema.safeParse(response);
      return result.success ? result.data : null;
    } catch (error) {
      if (error instanceof SupabaseAPIError && error.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Get project by name (searches all projects)
   */
  async getProjectByName(name: string): Promise<Project | null> {
    const projects = await this.getProjects();
    return projects.find((p) => p.name.toLowerCase() === name.toLowerCase()) ?? null;
  }

  /**
   * Get organization details by slug
   * The detail endpoint includes the 'plan' field which is not in the list endpoint
   */
  async getOrganization(slug: string): Promise<Organization | null> {
    try {
      const response = await this.request<unknown>(`/organizations/${slug}`);
      const result = OrganizationSchema.safeParse(response);
      return result.success ? result.data : null;
    } catch (error) {
      if (error instanceof SupabaseAPIError && error.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Get organization for a project
   * Fetches the organization details using the project's organization_slug or organization_id
   */
  async getOrganizationForProject(project: Project): Promise<Organization | null> {
    // Prefer organization_slug if available (from /v1/projects response)
    const slug = project.organization_slug || project.organization_id;
    return this.getOrganization(slug);
  }

  /**
   * Get branches for a project
   * Returns empty array if branching is not enabled (403)
   */
  async getBranches(projectRef: string): Promise<Branch[]> {
    try {
      const response = await this.request<unknown[]>(`/projects/${projectRef}/branches`);
      
      const branches: Branch[] = [];
      for (const item of response) {
        const result = BranchSchema.safeParse(item);
        if (result.success) {
          branches.push(result.data);
        }
      }
      return branches;
    } catch (error) {
      // 403 = branching not enabled, 400 = not available
      if (error instanceof SupabaseAPIError && (error.statusCode === 403 || error.statusCode === 400)) {
        return [];
      }
      throw error;
    }
  }

  /**
   * Create a new branch for a project
   * @param projectRef - Parent project reference
   * @param branchName - Name for the new branch
   * @returns The created branch
   * @throws SupabaseAPIError if branch creation fails
   */
  async createBranch(projectRef: string, branchName: string): Promise<Branch | null> {
    const response = await this.request<unknown>(`/projects/${projectRef}/branches`, {
      method: 'POST',
      body: JSON.stringify({ branch_name: branchName }),
    });
    
    const result = BranchSchema.safeParse(response);
    return result.success ? result.data : null;
  }

  /**
   * Delete a branch
   * @param projectRef - Parent project reference
   * @param branchId - Branch ID to delete
   */
  async deleteBranch(projectRef: string, branchId: string): Promise<boolean> {
    try {
      await this.request<void>(`/projects/${projectRef}/branches/${branchId}`, {
        method: 'DELETE',
      });
      return true;
    } catch (error) {
      if (error instanceof SupabaseAPIError && error.statusCode === 404) {
        // Branch already deleted or doesn't exist
        return true;
      }
      return false;
    }
  }

  /**
   * Check if branching is available for a project.
   * 
   * IMPORTANT: This method uses READ-ONLY operations only:
   * 1. Fetches organization details to check the plan (free vs pro/team/enterprise)
   * 2. Fetches existing branches for the UX flow
   * 
   * Branching is available on Pro, Team, and Enterprise plans only.
   * Free plan projects cannot use branching.
   * 
   * @returns Object with availability status, plan info, and existing branches
   */
  async checkBranchingCapability(project: Project): Promise<{
    available: boolean;
    plan: OrganizationPlan | 'unknown';
    branches: Branch[];
    reason: string;
  }> {
    // Step 1: Get organization to check the plan
    let plan: OrganizationPlan | 'unknown' = 'unknown';
    
    try {
      const org = await this.getOrganizationForProject(project);
      if (org?.plan) {
        plan = org.plan;
      }
    } catch {
      // If we can't fetch org, continue with unknown plan
    }

    // Step 2: Determine availability based on plan
    // - free: No branching
    // - pro/team/enterprise/platform: Branching available
    // - unknown: Fall back to checking for existing branches
    const paidPlans: OrganizationPlan[] = ['pro', 'team', 'enterprise', 'platform'];
    const isPaidPlan = plan !== 'unknown' && paidPlans.includes(plan as OrganizationPlan);
    const isFreePlan = plan === 'free';

    // Step 3: Fetch existing branches (needed for UX flow regardless of plan)
    let branches: Branch[] = [];
    try {
      branches = await this.getBranches(project.id);
    } catch {
      // If we can't fetch branches, continue with empty array
    }

    // Step 4: Return result based on plan
    if (isFreePlan) {
      return {
        available: false,
        plan,
        branches,
        reason: 'free_plan',
      };
    }

    if (isPaidPlan) {
      return {
        available: true,
        plan,
        branches,
        reason: 'paid_plan',
      };
    }

    // Plan is unknown - fall back to heuristic based on existing branches
    // If there are non-default branches, branching must be available
    const nonDefaultBranches = branches.filter(b => !b.is_default);
    if (nonDefaultBranches.length > 0) {
      return {
        available: true,
        plan,
        branches,
        reason: 'has_non_default_branches',
      };
    }

    // Unknown plan and no non-default branches - we can't determine capability
    // Report as unavailable but the init flow can still offer to try
    return {
      available: false,
      plan,
      branches,
      reason: 'unknown_capability',
    };
  }

  /**
   * @deprecated Use checkBranchingCapability instead for accurate results
   */
  async isBranchingAvailable(project: Project): Promise<boolean> {
    const result = await this.checkBranchingCapability(project);
    return result.available;
  }
}

/**
 * Create a client with the given access token
 */
export function createSupabaseClient(accessToken: string): SupabaseManagementClient {
  return new SupabaseManagementClient(accessToken);
}
