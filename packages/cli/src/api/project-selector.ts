import * as p from '@clack/prompts';
import pc from 'picocolors';
import { type Project, type SupabaseManagementClient } from './supabase-client.js';

/**
 * Format a date string for display
 */
function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Format a project for display in the selection list
 */
function formatProjectLabel(project: Project): string {
  const status = project.status === 'ACTIVE_HEALTHY' 
    ? pc.green('●') 
    : project.status === 'PAUSED'
      ? pc.yellow('○')
      : pc.red('●');
  
  return `${status} ${project.name} ${pc.dim(`(${project.region})`)}`;
}

/**
 * Format project hint (shown below the label)
 */
function formatProjectHint(project: Project): string {
  return `ref: ${project.id} • created: ${formatDate(project.created_at)}`;
}

/**
 * Special value for skipping project selection
 */
const SKIP_VALUE = '__skip__';

/**
 * Fetch projects from Supabase and display interactive selector
 * 
 * @param client - Authenticated Supabase Management API client
 * @returns Selected project ref, or null if skipped
 */
export async function fetchAndDisplayProjects(
  client: SupabaseManagementClient
): Promise<string | null> {
  const spinner = p.spinner();
  spinner.start('Fetching your Supabase projects...');

  let projects: Project[];
  try {
    projects = await client.getProjects();
    spinner.stop('Found projects');
  } catch (error) {
    spinner.stop('Failed to fetch projects');
    throw error;
  }

  if (projects.length === 0) {
    p.note(
      'No projects found in your Supabase account.\n' +
      'Create a project at https://supabase.com/dashboard',
      'No projects'
    );
    return null;
  }

  // Sort projects: active first, then by name
  const sortedProjects = [...projects].sort((a, b) => {
    // Active healthy projects first
    if (a.status === 'ACTIVE_HEALTHY' && b.status !== 'ACTIVE_HEALTHY') return -1;
    if (b.status === 'ACTIVE_HEALTHY' && a.status !== 'ACTIVE_HEALTHY') return 1;
    // Then by name
    return a.name.localeCompare(b.name);
  });

  // Build selection options
  const options = [
    ...sortedProjects.map((project) => ({
      value: project.id,
      label: formatProjectLabel(project),
      hint: formatProjectHint(project),
    })),
    {
      value: SKIP_VALUE,
      label: pc.dim('Skip (configure manually later)'),
      hint: 'You can set project_ref in supacontrol.toml',
    },
  ];

  const selected = await p.select({
    message: 'Select a project for this environment:',
    options,
  });

  if (p.isCancel(selected)) {
    return null;
  }

  if (selected === SKIP_VALUE) {
    return null;
  }

  return selected as string;
}

/**
 * Display a summary of the selected project
 */
export function displayProjectSummary(project: Project): void {
  const statusText = project.status === 'ACTIVE_HEALTHY'
    ? pc.green('Active')
    : project.status === 'PAUSED'
      ? pc.yellow('Paused')
      : pc.red(project.status);

  console.log();
  console.log(pc.bold('Selected project:'));
  console.log(`  ${pc.cyan('Name:')}    ${project.name}`);
  console.log(`  ${pc.cyan('Ref:')}     ${project.id}`);
  console.log(`  ${pc.cyan('Region:')}  ${project.region}`);
  console.log(`  ${pc.cyan('Status:')}  ${statusText}`);
  console.log(`  ${pc.cyan('Created:')} ${formatDate(project.created_at)}`);
  if (project.database) {
    console.log(`  ${pc.cyan('DB Host:')} ${pc.dim(project.database.host)}`);
  }
  console.log();
}

/**
 * Filter projects by search query (name or ref)
 */
export function filterProjects(projects: Project[], query: string): Project[] {
  const lowerQuery = query.toLowerCase();
  return projects.filter(
    (p) =>
      p.name.toLowerCase().includes(lowerQuery) ||
      p.id.toLowerCase().includes(lowerQuery)
  );
}
