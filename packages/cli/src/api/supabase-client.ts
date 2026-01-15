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
 * Supabase project schema
 */
export const ProjectSchema = z.object({
  id: z.string(),
  organization_id: z.string(),
  name: z.string(),
  region: z.string(),
  created_at: z.string(),
  database: z.object({
    host: z.string(),
    version: z.string(),
  }).optional(),
  status: ProjectStatus,
});

export type Project = z.infer<typeof ProjectSchema>;

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
}

/**
 * Create a client with the given access token
 */
export function createSupabaseClient(accessToken: string): SupabaseManagementClient {
  return new SupabaseManagementClient(accessToken);
}
