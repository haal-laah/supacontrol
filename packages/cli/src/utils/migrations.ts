import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import pc from 'picocolors';
import { runSupabase } from './supabase.js';

/**
 * Result of checking migration sync status
 */
export interface MigrationSyncStatus {
  /** Whether sync is needed */
  needsSync: boolean;
  /** Migrations on remote but not local */
  remoteMissing: string[];
  /** Migrations on local but not remote */
  localMissing: string[];
  /** Error message if check failed */
  error?: string;
}

/**
 * Get list of local migration files
 */
async function getLocalMigrations(): Promise<string[]> {
  const migrationsDir = resolve(process.cwd(), 'supabase', 'migrations');
  
  try {
    const files = await readdir(migrationsDir);
    return files
      .filter(f => f.endsWith('.sql'))
      .map(f => f.replace('.sql', ''))
      .sort();
  } catch {
    // No migrations directory
    return [];
  }
}

/**
 * Get list of remote migrations from Supabase
 * This parses the output of `supabase migration list`
 */
async function getRemoteMigrations(): Promise<string[]> {
  const result = await runSupabase(['migration', 'list'], { stream: false });
  
  if (!result.success || !result.output) {
    return [];
  }
  
  // Parse migration list output
  // Format is typically:
  //   LOCAL | REMOTE | TIME (UTC)
  //   -------|--------|------------
  //   ...    | ...    | ...
  const lines = result.output.split('\n');
  const migrations: string[] = [];
  
  for (const line of lines) {
    // Skip header/separator lines
    if (line.includes('LOCAL') || line.includes('---') || !line.trim()) {
      continue;
    }
    
    // Parse the timestamp from the line
    // Looking for patterns like "20260116054129" (timestamp format)
    const match = line.match(/(\d{14})/);
    if (match) {
      migrations.push(match[1]);
    }
  }
  
  return migrations.sort();
}

/**
 * Check if local and remote migrations are in sync
 */
export async function checkMigrationSync(): Promise<MigrationSyncStatus> {
  try {
    const [local, remote] = await Promise.all([
      getLocalMigrations(),
      getRemoteMigrations(),
    ]);
    
    // Extract just the timestamp portion from local migrations
    // Local files are like "20260116000044_test_dummy_table"
    const localTimestamps = local.map(m => {
      const match = m.match(/^(\d{14})/);
      return match ? match[1] : m;
    });
    
    // Find migrations on remote but not local
    const remoteMissing = remote.filter(r => !localTimestamps.includes(r));
    
    // Find migrations on local but not remote
    const localMissing = localTimestamps.filter(l => !remote.includes(l));
    
    return {
      needsSync: remoteMissing.length > 0,
      remoteMissing,
      localMissing,
    };
  } catch (error) {
    return {
      needsSync: false,
      remoteMissing: [],
      localMissing: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Sync migrations from remote to local
 */
export async function syncMigrations(): Promise<boolean> {
  console.log(pc.blue('→'), 'Pulling migrations from remote...');
  
  const result = await runSupabase(['db', 'pull'], { stream: true });
  
  return result.success;
}

/**
 * Check migration sync and provide user-friendly output
 * Returns true if in sync or user chose to continue
 */
export async function ensureMigrationSync(): Promise<boolean> {
  const status = await checkMigrationSync();
  
  if (status.error) {
    console.log(pc.yellow('⚠'), 'Could not check migration sync status');
    console.log(pc.dim(`  ${status.error}`));
    return true; // Continue anyway
  }
  
  if (status.remoteMissing.length > 0) {
    console.log(pc.red('✗'), 'Remote has migrations not in your local directory:');
    for (const m of status.remoteMissing) {
      console.log(pc.dim(`  - ${m}`));
    }
    console.log();
    console.log(pc.dim('Run `supabase db pull` to sync, or `spc switch <env>` to auto-sync'));
    return false;
  }
  
  return true;
}
