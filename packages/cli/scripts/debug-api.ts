#!/usr/bin/env npx tsx
/**
 * Debug script to inspect Supabase Management API responses.
 * 
 * This helps us understand exactly what fields Supabase returns
 * so we can build accurate detection logic.
 * 
 * Usage:
 *   npx tsx scripts/debug-api.ts
 * 
 * Requires:
 *   - Saved access token (~/.supacontrol/credentials) OR
 *   - SUPABASE_ACCESS_TOKEN environment variable
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';

const API_BASE = 'https://api.supabase.com/v1';

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

function dim(message: string) {
  console.log(`${colors.dim}${message}${colors.reset}`);
}

function json(obj: unknown) {
  console.log(JSON.stringify(obj, null, 2));
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
  endpoint: string
): Promise<{ status: number; data: unknown; headers: Record<string, string> }> {
  const url = `${API_BASE}${endpoint}`;
  
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
 * Highlight interesting fields in project data
 */
function analyzeProject(project: Record<string, unknown>, index: number) {
  const name = project.name as string;
  const id = project.id as string;
  const status = project.status as string;
  
  console.log(`${colors.bright}[${index + 1}] ${name}${colors.reset} (${id})`);
  console.log(`    Status: ${status}`);
  
  // Branching-related fields - this is what we care about
  const branchingFields = [
    'is_branch_enabled',
    'preview_branch_refs',
    'parent_project_ref',
    'is_branch',
  ];
  
  console.log(`    ${colors.magenta}Branching fields:${colors.reset}`);
  for (const field of branchingFields) {
    if (field in project) {
      console.log(`      ${field}: ${colors.green}${JSON.stringify(project[field])}${colors.reset}`);
    } else {
      console.log(`      ${field}: ${colors.dim}(not present)${colors.reset}`);
    }
  }
  
  // List ALL fields for reference
  console.log(`    ${colors.dim}All fields: ${Object.keys(project).join(', ')}${colors.reset}`);
  console.log();
}

/**
 * Main debug routine
 */
async function main() {
  header('Supabase API Debug Inspector');
  
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
  // 1. GET /projects - List all projects
  // ============================================================
  header('1. GET /projects (List)');
  
  const projectsResponse = await apiRequest(token, '/projects');
  log(`Status: ${projectsResponse.status}`);
  
  if (projectsResponse.status !== 200) {
    error('Failed to fetch projects');
    json(projectsResponse.data);
    process.exit(1);
  }

  const projects = projectsResponse.data as Record<string, unknown>[];
  success(`Found ${projects.length} projects`);
  
  subheader('Project Summary');
  for (let i = 0; i < projects.length; i++) {
    analyzeProject(projects[i], i);
  }

  subheader('Raw Response (first project)');
  if (projects.length > 0) {
    json(projects[0]);
  }

  // ============================================================
  // 2. GET /projects/{ref} - Single project detail
  // ============================================================
  header('2. GET /projects/{ref} (Single Project Detail)');
  
  for (const project of projects) {
    const ref = project.id as string;
    const name = project.name as string;
    
    subheader(`Project: ${name} (${ref})`);
    
    const detailResponse = await apiRequest(token, `/projects/${ref}`);
    log(`Status: ${detailResponse.status}`);
    
    if (detailResponse.status === 200) {
      const detail = detailResponse.data as Record<string, unknown>;
      
      // Compare with list response
      const listKeys = Object.keys(project).sort();
      const detailKeys = Object.keys(detail).sort();
      
      const newFields = detailKeys.filter(k => !listKeys.includes(k));
      const missingFields = listKeys.filter(k => !detailKeys.includes(k));
      
      if (newFields.length > 0) {
        console.log(`${colors.green}Fields ONLY in detail (not in list):${colors.reset}`);
        for (const field of newFields) {
          console.log(`  ${field}: ${JSON.stringify(detail[field])}`);
        }
      }
      
      if (missingFields.length > 0) {
        console.log(`${colors.yellow}Fields ONLY in list (not in detail):${colors.reset}`);
        for (const field of missingFields) {
          console.log(`  ${field}: ${JSON.stringify(project[field])}`);
        }
      }
      
      // Show branching fields from detail
      console.log(`${colors.magenta}Branching fields in detail:${colors.reset}`);
      const branchingFields = ['is_branch_enabled', 'preview_branch_refs', 'parent_project_ref', 'is_branch'];
      for (const field of branchingFields) {
        const value = detail[field];
        const color = value !== undefined ? colors.green : colors.dim;
        console.log(`  ${field}: ${color}${value !== undefined ? JSON.stringify(value) : '(not present)'}${colors.reset}`);
      }
    } else {
      error(`Failed to fetch detail for ${name}`);
    }
  }

  // ============================================================
  // 3. GET /projects/{ref}/branches - Branches for each project
  // ============================================================
  header('3. GET /projects/{ref}/branches');
  
  for (const project of projects) {
    const ref = project.id as string;
    const name = project.name as string;
    const status = project.status as string;
    
    subheader(`Branches for: ${name} (${ref})`);
    
    if (status !== 'ACTIVE_HEALTHY') {
      dim(`Skipping - project status is ${status}`);
      continue;
    }
    
    const branchesResponse = await apiRequest(token, `/projects/${ref}/branches`);
    log(`Status: ${branchesResponse.status}`);
    
    if (branchesResponse.status === 200) {
      const branches = branchesResponse.data as Record<string, unknown>[];
      success(`Found ${branches.length} branches`);
      
      if (branches.length > 0) {
        for (const branch of branches) {
          console.log(`  - ${branch.name} (${branch.id})`);
          console.log(`    is_default: ${branch.is_default}`);
          console.log(`    status: ${branch.status}`);
          console.log(`    project_ref: ${branch.project_ref}`);
          console.log(`    parent_project_ref: ${branch.parent_project_ref}`);
        }
        
        subheader('Raw branch response (first branch)');
        json(branches[0]);
      }
    } else if (branchesResponse.status === 403 || branchesResponse.status === 400) {
      dim('Branching not available for this project (expected for free tier)');
      json(branchesResponse.data);
    } else {
      error(`Unexpected status: ${branchesResponse.status}`);
      json(branchesResponse.data);
    }
  }

  // ============================================================
  // Summary
  // ============================================================
  header('Summary');
  
  log('Key findings to verify:');
  log('');
  log('1. Does /projects (list) include is_branch_enabled?');
  log('2. Does /projects/{ref} (detail) include is_branch_enabled?');
  log('3. What does /projects/{ref}/branches return for:');
  log('   - A free project (no branching)?');
  log('   - A Pro project with branching enabled?');
  log('   - A Pro project with existing branches?');
  log('');
  log('Use this info to fix checkBranchingCapability() logic.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
