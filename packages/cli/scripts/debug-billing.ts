#!/usr/bin/env npx tsx
/**
 * Debug script to inspect Supabase billing/subscription endpoints.
 * 
 * This explores organization-level subscription data to determine
 * if we can detect plan tier (Free, Pro, Team, Enterprise) for
 * branching capability detection.
 * 
 * Usage:
 *   npx tsx scripts/debug-billing.ts
 * 
 * Requires:
 *   - Saved access token (~/.supacontrol/credentials) OR
 *   - SUPABASE_ACCESS_TOKEN environment variable
 * 
 * Endpoints explored:
 *   - GET /v1/organizations (list orgs with basic info)
 *   - GET /v1/organizations/{slug} (org detail)
 *   - GET /platform/organizations/{slug}/billing/subscription (subscription info - may require different auth)
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';

const API_BASE = 'https://api.supabase.com';

// ANSI colors for output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
};

function log(message: string) {
  console.log(message);
}

function header(title: string) {
  console.log();
  console.log(`${colors.bright}${colors.cyan}${'='.repeat(60)}${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}  ${title}${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}${'='.repeat(60)}${colors.reset}`);
  console.log();
}

function subheader(title: string) {
  console.log();
  console.log(`${colors.yellow}--- ${title} ---${colors.reset}`);
}

function success(message: string) {
  console.log(`${colors.green}✓${colors.reset} ${message}`);
}

function error(message: string) {
  console.log(`${colors.red}✗${colors.reset} ${message}`);
}

function warning(message: string) {
  console.log(`${colors.yellow}⚠${colors.reset} ${message}`);
}

function dim(message: string) {
  console.log(`${colors.dim}${message}${colors.reset}`);
}

function json(obj: unknown) {
  console.log(JSON.stringify(obj, null, 2));
}

function highlight(label: string, value: unknown, important = false) {
  const color = important ? colors.green : colors.cyan;
  const valueStr = value !== undefined && value !== null 
    ? `${color}${JSON.stringify(value)}${colors.reset}`
    : `${colors.dim}(not present)${colors.reset}`;
  console.log(`  ${label}: ${valueStr}`);
}

/**
 * Get access token from env or file
 */
async function getToken(): Promise<string | null> {
  // Check env first
  if (process.env.SUPABASE_ACCESS_TOKEN) {
    return process.env.SUPABASE_ACCESS_TOKEN;
  }

  // Check credentials file
  try {
    const credPath = join(homedir(), '.supacontrol', 'credentials');
    const content = await readFile(credPath, 'utf-8');
    return content.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Make API request and return raw response
 */
async function apiRequest(
  token: string,
  endpoint: string,
  baseUrl = API_BASE
): Promise<{ status: number; data: unknown; headers: Record<string, string> }> {
  const url = `${baseUrl}${endpoint}`;
  
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  return { status: response.status, data, headers };
}

/**
 * Main debug routine
 */
async function main() {
  header('Supabase Billing/Subscription Debug Inspector');
  
  // Get token
  const token = await getToken();
  if (!token) {
    error('No access token found!');
    log('Set SUPABASE_ACCESS_TOKEN env var or run `spc init` to save a token.');
    process.exit(1);
  }
  success('Access token found');
  dim(`Token preview: ${token.substring(0, 10)}...${token.substring(token.length - 5)}`);

  // ============================================================
  // 1. GET /v1/organizations - List all organizations
  // ============================================================
  header('1. GET /v1/organizations (List)');
  
  const orgsResponse = await apiRequest(token, '/v1/organizations');
  log(`Status: ${orgsResponse.status}`);
  
  if (orgsResponse.status !== 200) {
    error('Failed to fetch organizations');
    json(orgsResponse.data);
    process.exit(1);
  }

  const orgs = orgsResponse.data as Record<string, unknown>[];
  success(`Found ${orgs.length} organization(s)`);
  
  subheader('Organization Summary');
  for (let i = 0; i < orgs.length; i++) {
    const org = orgs[i];
    console.log(`${colors.bright}[${i + 1}] ${org.name}${colors.reset}`);
    highlight('id (deprecated)', org.id);
    highlight('slug', org.slug, true);
    highlight('billing_email', org.billing_email);
    
    // Look for any tier/plan/subscription fields in list response
    console.log(`  ${colors.magenta}Potential billing fields:${colors.reset}`);
    const billingFields = [
      'plan', 'tier', 'subscription_tier', 'billing_tier',
      'subscription_id', 'stripe_customer_id', 'subscription_status',
      'is_owner', 'plan_id', 'pricing_tier'
    ];
    for (const field of billingFields) {
      if (field in org) {
        highlight(`  ${field}`, org[field], true);
      }
    }
    
    console.log(`  ${colors.dim}All fields: ${Object.keys(org).join(', ')}${colors.reset}`);
    console.log();
  }

  subheader('Raw Response (first org)');
  if (orgs.length > 0) {
    json(orgs[0]);
  }

  // ============================================================
  // 2. GET /v1/organizations/{slug} - Organization detail
  // ============================================================
  header('2. GET /v1/organizations/{slug} (Detail)');
  
  for (const org of orgs) {
    const slug = org.slug as string;
    const name = org.name as string;
    
    subheader(`Organization: ${name} (${slug})`);
    
    const detailResponse = await apiRequest(token, `/v1/organizations/${slug}`);
    log(`Status: ${detailResponse.status}`);
    
    if (detailResponse.status === 200) {
      const detail = detailResponse.data as Record<string, unknown>;
      
      // Compare with list response
      const listKeys = Object.keys(org).sort();
      const detailKeys = Object.keys(detail).sort();
      
      const newFields = detailKeys.filter(k => !listKeys.includes(k));
      
      if (newFields.length > 0) {
        console.log(`${colors.green}Additional fields in detail (not in list):${colors.reset}`);
        for (const field of newFields) {
          highlight(field, detail[field], true);
        }
      } else {
        dim('No additional fields compared to list response');
      }
      
      // Show all fields
      console.log(`${colors.dim}All fields: ${detailKeys.join(', ')}${colors.reset}`);
    } else {
      error(`Failed to fetch detail for ${name}`);
      json(detailResponse.data);
    }
  }

  // ============================================================
  // 3. GET /platform/organizations/{slug}/billing/subscription
  // ============================================================
  header('3. GET /platform/organizations/{slug}/billing/subscription');
  log('Note: This is a platform endpoint used by Supabase Studio.');
  log('It may require different auth or not be publicly available.');
  console.log();
  
  for (const org of orgs) {
    const slug = org.slug as string;
    const name = org.name as string;
    
    subheader(`Subscription for: ${name} (${slug})`);
    
    // Try the platform endpoint (used by Supabase Studio)
    const subResponse = await apiRequest(token, `/platform/organizations/${slug}/billing/subscription`);
    log(`Status: ${subResponse.status}`);
    
    if (subResponse.status === 200) {
      const sub = subResponse.data as Record<string, unknown>;
      success('Subscription data retrieved!');
      
      // Highlight the important billing fields
      console.log(`${colors.magenta}Key subscription fields:${colors.reset}`);
      highlight('plan', sub.plan, true);
      highlight('billing_cycle_anchor', sub.billing_cycle_anchor);
      highlight('current_period_start', sub.current_period_start);
      highlight('current_period_end', sub.current_period_end);
      highlight('payment_method_type', sub.payment_method_type);
      highlight('addons', sub.addons);
      highlight('project_addons', sub.project_addons);
      
      // Look for the plan object which should have id: 'free' | 'pro' | 'team' | 'enterprise'
      if (typeof sub.plan === 'object' && sub.plan !== null) {
        const plan = sub.plan as Record<string, unknown>;
        console.log(`${colors.green}Plan details:${colors.reset}`);
        highlight('  plan.id', plan.id, true);
        highlight('  plan.name', plan.name, true);
      }
      
      subheader('Raw subscription response');
      json(sub);
    } else if (subResponse.status === 401 || subResponse.status === 403) {
      warning('Access denied - this endpoint may require different auth');
      dim('The /platform/ endpoints are internal Supabase Studio APIs');
      json(subResponse.data);
    } else if (subResponse.status === 404) {
      warning('Endpoint not found - may not be publicly available');
      json(subResponse.data);
    } else {
      error(`Unexpected status: ${subResponse.status}`);
      json(subResponse.data);
    }
  }

  // ============================================================
  // 4. GET /v1/projects (check for org relationship)
  // ============================================================
  header('4. GET /v1/projects (Check org_slug field)');
  log('Checking if projects include organization_slug for cross-reference...');
  console.log();
  
  const projectsResponse = await apiRequest(token, '/v1/projects');
  
  if (projectsResponse.status === 200) {
    const projects = projectsResponse.data as Record<string, unknown>[];
    success(`Found ${projects.length} projects`);
    
    // Group projects by organization
    const projectsByOrg: Record<string, Array<Record<string, unknown>>> = {};
    
    for (const project of projects) {
      const orgSlug = (project.organization_slug as string) || 'unknown';
      if (!projectsByOrg[orgSlug]) {
        projectsByOrg[orgSlug] = [];
      }
      projectsByOrg[orgSlug].push(project);
    }
    
    for (const [orgSlug, orgProjects] of Object.entries(projectsByOrg)) {
      console.log(`${colors.bright}Organization: ${orgSlug}${colors.reset}`);
      for (const project of orgProjects) {
        console.log(`  - ${project.name} (${project.id})`);
      }
      console.log();
    }
    
    // Show org-related fields in first project
    if (projects.length > 0) {
      subheader('Organization fields in project');
      const p = projects[0];
      highlight('organization_id', p.organization_id);
      highlight('organization_slug', p.organization_slug, true);
    }
  }

  // ============================================================
  // 5. GET /v1/organizations/{slug}/projects
  // ============================================================
  header('5. GET /v1/organizations/{slug}/projects');
  log('This endpoint may have more details than /v1/projects');
  console.log();
  
  for (const org of orgs) {
    const slug = org.slug as string;
    const name = org.name as string;
    
    subheader(`Projects for org: ${name} (${slug})`);
    
    const orgProjectsResponse = await apiRequest(token, `/v1/organizations/${slug}/projects`);
    log(`Status: ${orgProjectsResponse.status}`);
    
    if (orgProjectsResponse.status === 200) {
      const data = orgProjectsResponse.data as Record<string, unknown>;
      
      // This endpoint returns paginated results
      if ('projects' in data && Array.isArray(data.projects)) {
        const projects = data.projects as Record<string, unknown>[];
        success(`Found ${projects.length} projects`);
        
        for (const project of projects) {
          console.log(`  ${colors.bright}${project.name}${colors.reset} (${project.ref})`);
          
          // Check for any subscription/tier fields
          const tierFields = ['subscription_id', 'tier', 'plan', 'is_branch_enabled'];
          for (const field of tierFields) {
            if (field in project) {
              highlight(`  ${field}`, project[field], true);
            }
          }
        }
        
        if (projects.length > 0) {
          subheader('Raw project (first)');
          json(projects[0]);
        }
      } else {
        // May be array directly
        json(data);
      }
    } else {
      error(`Failed: ${orgProjectsResponse.status}`);
      json(orgProjectsResponse.data);
    }
  }

  // ============================================================
  // Summary
  // ============================================================
  header('Summary & Recommendations');
  
  log('Key findings to determine branching capability:');
  log('');
  log('1. Can we get subscription tier from organization?');
  log('   - Check if /v1/organizations returns plan/tier info');
  log('   - Check if /platform/.../subscription endpoint is accessible');
  log('');
  log('2. Can we map projects to organizations?');
  log('   - Projects have organization_slug field');
  log('   - Can cross-reference to get org subscription tier');
  log('');
  log('3. Branching capability logic:');
  log('   - tier_free → NO branching');
  log('   - tier_pro/tier_payg/tier_team/tier_enterprise → YES branching');
  log('');
  log('4. Fallback if subscription endpoint is not available:');
  log('   - Try to create a branch (current approach)');
  log('   - Check for existing non-default branches (current approach)');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
