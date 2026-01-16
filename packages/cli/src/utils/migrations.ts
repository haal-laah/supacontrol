import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import pc from 'picocolors';
import * as p from '@clack/prompts';
import { runSupabase } from './supabase.js';

/**
 * Generate a timestamp in Supabase migration format (YYYYMMDDHHmmss)
 */
function generateMigrationTimestamp(): string {
  const now = new Date();
  return [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0'),
    String(now.getUTCHours()).padStart(2, '0'),
    String(now.getUTCMinutes()).padStart(2, '0'),
    String(now.getUTCSeconds()).padStart(2, '0'),
  ].join('');
}

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
 * Detailed migration info including full filename
 */
interface LocalMigration {
  timestamp: string;
  filename: string;
  fullPath: string;
}

/**
 * Get detailed local migration info
 */
async function getLocalMigrationDetails(): Promise<LocalMigration[]> {
  const migrationsDir = resolve(process.cwd(), 'supabase', 'migrations');
  
  try {
    const files = await readdir(migrationsDir);
    return files
      .filter(f => f.endsWith('.sql'))
      .map(f => {
        const match = f.match(/^(\d{14})/);
        return {
          timestamp: match ? match[1] : f.replace('.sql', ''),
          filename: f,
          fullPath: join(migrationsDir, f),
        };
      })
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  } catch {
    return [];
  }
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

/**
 * Result of migration repair operation
 */
export interface RepairResult {
  success: boolean;
  error?: string;
  /** Remote migrations that were marked as reverted */
  repairedRemote: string[];
}

/**
 * Repair migration history mismatch between local and remote.
 * 
 * Strategy:
 * - Mark remote-only migrations as 'reverted' (tells Supabase to forget them)
 * - Local-only migrations are left alone - they'll be pushed normally
 * 
 * This allows the next push to proceed without conflicts.
 * Local migrations become the source of truth.
 */
export async function repairMigrationHistory(
  status: MigrationSyncStatus
): Promise<RepairResult> {
  const result: RepairResult = {
    success: false,
    repairedRemote: [],
  };

  const spinner = p.spinner();

  // Mark remote-only migrations as reverted (Supabase forgets about them)
  if (status.remoteMissing.length > 0) {
    spinner.start('Marking remote-only migrations as reverted...');
    
    for (const version of status.remoteMissing) {
      const repairResult = await runSupabase(
        ['migration', 'repair', '--status', 'reverted', version],
        { stream: false }
      );
      
      if (!repairResult.success) {
        spinner.stop('Repair failed');
        result.error = `Failed to revert remote migration ${version}`;
        return result;
      }
      
      result.repairedRemote.push(version);
    }
    
    spinner.stop(`Reverted ${status.remoteMissing.length} remote migration(s)`);
  }

  // Note: We intentionally DON'T mark local migrations as "applied"
  // They need to actually run on push to apply their changes to the DB

  result.success = true;
  return result;
}

/**
 * Full migration sync workflow with user interaction.
 * 
 * Detects mismatches and offers repair options:
 * 1. Rescue (for remote-only migrations with no local files)
 * 2. Repair history (mark remote as reverted, keep local)
 * 3. Pull from remote (get remote migrations, potentially losing local changes)
 * 4. Cancel
 */
export async function interactiveMigrationSync(): Promise<{ success: boolean; cancelled?: boolean }> {
  const status = await checkMigrationSync();
  
  if (status.error) {
    console.log(pc.yellow('⚠'), 'Could not check migration sync status');
    console.log(pc.dim(`  ${status.error}`));
    return { success: true }; // Continue anyway
  }

  // No mismatch - all good
  if (status.remoteMissing.length === 0 && status.localMissing.length === 0) {
    return { success: true };
  }

  // Check if this is a rescue scenario (remote has migrations, local has few/none)
  const localMigrations = await getLocalMigrations();
  const isRescueScenario = status.remoteMissing.length > 0 && 
                          localMigrations.length === 0 &&
                          status.localMissing.length === 0;

  if (isRescueScenario) {
    // This looks like a new user with remote-only migrations
    const rescueResult = await interactiveMigrationRescue();
    return rescueResult;
  }

  // Show the mismatch details
  console.log();
  console.log(pc.yellow('⚠'), 'Migration history mismatch detected');
  console.log();
  
  if (status.remoteMissing.length > 0) {
    console.log(pc.dim('  Remote-only migrations (not in local):'));
    for (const m of status.remoteMissing) {
      console.log(pc.red(`    - ${m}`));
    }
  }
  
  if (status.localMissing.length > 0) {
    console.log(pc.dim('  Local-only migrations (not on remote):'));
    for (const m of status.localMissing) {
      console.log(pc.green(`    + ${m}`));
    }
  }
  
  console.log();

  // Build repair explanation
  const repairExplanation = [
    pc.bold('Repair migration history:'),
    '',
  ];
  
  if (status.remoteMissing.length > 0) {
    repairExplanation.push(`  • Mark ${status.remoteMissing.length} remote migration(s) as ${pc.yellow('reverted')}`);
    repairExplanation.push(pc.dim('    (Supabase will forget about these - they were likely auto-created)'));
  }
  
  if (status.localMissing.length > 0) {
    repairExplanation.push(`  • ${status.localMissing.length} local migration(s) will be ${pc.green('pushed')} to remote`);
    repairExplanation.push(pc.dim('    (These will run on the remote database)'));
  }
  
  repairExplanation.push('');
  repairExplanation.push(pc.dim('After repair, your local migrations become the source of truth.'));
  
  p.note(repairExplanation.join('\n'), 'Repair Option');

  // Build options based on the scenario
  const options: Array<{ value: string; label: string; hint: string }> = [];

  // If we have local migrations to keep, repair is the main option
  if (status.localMissing.length > 0) {
    options.push({
      value: 'repair',
      label: 'Repair migration history',
      hint: 'Recommended - keeps your local migrations, forgets remote-only ones',
    });
  }

  // If remote has migrations we don't have locally, offer rescue
  if (status.remoteMissing.length > 0) {
    options.push({
      value: 'rescue',
      label: 'Create baseline from current schema',
      hint: 'Captures remote schema in a local file, then clears history',
    });
  }

  options.push({
    value: 'pull',
    label: 'Pull from remote instead',
    hint: 'Replaces local migrations with remote state',
  });

  options.push({
    value: 'cancel',
    label: pc.dim('Cancel'),
    hint: 'Abort and fix manually',
  });

  const choice = await p.select({
    message: 'How would you like to resolve this?',
    options,
  });

  if (p.isCancel(choice) || choice === 'cancel') {
    return { success: false, cancelled: true };
  }

  if (choice === 'rescue') {
    // Rescue flow - create baseline from current schema
    console.log();
    console.log(pc.blue('→'), 'Starting migration rescue...');
    console.log();

    const rescueResult = await rescueMigrations(status.remoteMissing);
    
    if (rescueResult.success) {
      console.log();
      console.log(pc.green('✓'), 'Migration rescue complete!');
      console.log(pc.dim(`  Baseline: ${rescueResult.baselinePath}`));
      return { success: true };
    } else {
      console.log();
      console.log(pc.red('✗'), 'Rescue failed:', rescueResult.error);
      return { success: false };
    }
  }

  if (choice === 'pull') {
    console.log();
    console.log(pc.blue('→'), 'Pulling migrations from remote...');
    
    // First, backup local migrations
    const localDetails = await getLocalMigrationDetails();
    if (localDetails.length > 0) {
      const backup = await p.confirm({
        message: `Backup ${localDetails.length} local migration file(s) before pulling?`,
        initialValue: true,
      });
      
      if (p.isCancel(backup)) {
        return { success: false, cancelled: true };
      }
      
      if (backup) {
        const migrationsDir = resolve(process.cwd(), 'supabase', 'migrations');
        const backupDir = resolve(process.cwd(), 'supabase', 'migrations_backup_' + Date.now());
        
        try {
          await mkdir(backupDir, { recursive: true });
          
          for (const migration of localDetails) {
            const content = await readFile(migration.fullPath, 'utf-8');
            await writeFile(join(backupDir, migration.filename), content);
          }
          
          console.log(pc.green('✓'), `Backed up to ${pc.dim(backupDir)}`);
        } catch {
          console.log(pc.yellow('⚠'), 'Backup failed, continuing anyway');
        }
      }
    }
    
    // Pull from remote
    const pullResult = await runSupabase(['db', 'pull'], { stream: true });
    
    if (pullResult.success) {
      console.log(pc.green('✓'), 'Pulled migrations from remote');
      return { success: true };
    } else {
      console.log(pc.red('✗'), 'Pull failed');
      return { success: false };
    }
  }

  // Repair flow
  console.log();
  const repairResult = await repairMigrationHistory(status);
  
  if (repairResult.success) {
    console.log();
    console.log(pc.green('✓'), 'Migration history repaired');
    
    if (repairResult.repairedRemote.length > 0) {
      console.log(pc.dim(`  Reverted: ${repairResult.repairedRemote.join(', ')}`));
    }
    
    return { success: true };
  } else {
    console.log();
    console.log(pc.red('✗'), 'Repair failed:', repairResult.error);
    return { success: false };
  }
}

/**
 * Result of migration rescue operation
 */
export interface RescueResult {
  success: boolean;
  error?: string;
  /** Path to the created baseline migration file */
  baselinePath?: string;
  /** Remote migrations that were marked as reverted */
  revertedMigrations: string[];
}

/**
 * Rescue migrations for users who applied migrations remotely without local files.
 * 
 * This is for the scenario where:
 * - User applied migrations via MCP/dashboard (no local .sql files)
 * - Remote has migration history but local has no files
 * - User wants to start using SupaControl properly
 * 
 * Strategy:
 * 1. Dump the current remote schema as a "baseline" migration
 * 2. Mark all existing remote migrations as "reverted"
 * 3. Mark the new baseline as "applied" (schema already exists on remote)
 * 
 * After rescue:
 * - Local has a single migration file representing the full schema
 * - Remote history shows only this baseline as applied
 * - Future migrations work normally
 */
export async function rescueMigrations(
  remoteMigrations: string[]
): Promise<RescueResult> {
  const result: RescueResult = {
    success: false,
    revertedMigrations: [],
  };

  const spinner = p.spinner();
  const migrationsDir = resolve(process.cwd(), 'supabase', 'migrations');

  // Step 1: Ensure migrations directory exists
  try {
    await mkdir(migrationsDir, { recursive: true });
  } catch {
    // Already exists, that's fine
  }

  // Step 2: Dump current schema from remote
  spinner.start('Dumping current schema from remote...');
  
  const timestamp = generateMigrationTimestamp();
  const baselineFilename = `${timestamp}_baseline.sql`;
  const baselinePath = join(migrationsDir, baselineFilename);
  
  const dumpResult = await runSupabase(
    ['db', 'dump', '--linked', '-f', baselinePath],
    { stream: false }
  );
  
  if (!dumpResult.success) {
    spinner.stop('Schema dump failed');
    result.error = 'Failed to dump remote schema';
    return result;
  }
  
  spinner.stop('Schema dumped');
  
  // Step 3: Add a header comment to the baseline file
  try {
    const content = await readFile(baselinePath, 'utf-8');
    const header = [
      '-- Baseline migration generated by SupaControl',
      '-- This captures the full schema from remote at the time of rescue',
      `-- Generated: ${new Date().toISOString()}`,
      `-- Replaces remote migrations: ${remoteMigrations.join(', ')}`,
      '--',
      '',
    ].join('\n');
    await writeFile(baselinePath, header + content);
  } catch {
    // If we can't add the header, that's okay
  }
  
  console.log(pc.green('✓'), `Created baseline: ${pc.dim(baselineFilename)}`);

  // Step 4: Mark all existing remote migrations as reverted
  if (remoteMigrations.length > 0) {
    spinner.start('Clearing remote migration history...');
    
    for (const version of remoteMigrations) {
      const repairResult = await runSupabase(
        ['migration', 'repair', '--status', 'reverted', version],
        { stream: false }
      );
      
      if (!repairResult.success) {
        spinner.stop('Failed to clear history');
        result.error = `Failed to revert migration ${version}`;
        return result;
      }
      
      result.revertedMigrations.push(version);
    }
    
    spinner.stop(`Cleared ${remoteMigrations.length} remote migration(s)`);
  }

  // Step 5: Mark the baseline as applied (schema already exists on remote)
  spinner.start('Recording baseline in remote history...');
  
  const applyResult = await runSupabase(
    ['migration', 'repair', '--status', 'applied', timestamp],
    { stream: false }
  );
  
  if (!applyResult.success) {
    spinner.stop('Failed to record baseline');
    result.error = 'Failed to mark baseline as applied';
    return result;
  }
  
  spinner.stop('Baseline recorded');

  result.success = true;
  result.baselinePath = baselinePath;
  return result;
}

/**
 * Interactive rescue flow for users with remote-only migrations.
 * 
 * Detects when remote has migrations but local has no files, and offers
 * to create a baseline migration from the current schema.
 */
export async function interactiveMigrationRescue(): Promise<{ success: boolean; cancelled?: boolean; rescued?: boolean }> {
  const status = await checkMigrationSync();
  
  if (status.error) {
    console.log(pc.yellow('⚠'), 'Could not check migration status');
    console.log(pc.dim(`  ${status.error}`));
    return { success: true };
  }

  // Check if this is a rescue scenario:
  // - Remote has migrations
  // - Local has NO migrations (or very few compared to remote)
  const localMigrations = await getLocalMigrations();
  const localCount = localMigrations.length;
  const remoteOnlyCount = status.remoteMissing.length;
  
  // Not a rescue scenario if local has migrations or remote has none
  if (remoteOnlyCount === 0 || localCount >= remoteOnlyCount) {
    return { success: true };
  }

  // This looks like a rescue scenario
  console.log();
  p.note(
    [
      `${pc.red('⚠ Migration rescue needed')}`,
      '',
      `Found ${pc.yellow(remoteOnlyCount.toString())} remote migration(s) with no local files:`,
      ...status.remoteMissing.map(m => pc.dim(`  • ${m}`)),
      '',
      pc.bold('Why this matters:'),
      '  If you run `db reset`, these migrations will be lost because',
      '  there are no local .sql files to replay.',
      '',
      pc.bold('How this happens:'),
      '  • Migrations applied via Supabase MCP without saving files',
      '  • Migrations applied directly in Dashboard',
      '  • Starting SupaControl on an existing project',
    ].join('\n'),
    'Remote-Only Migrations Detected'
  );

  const choice = await p.select({
    message: 'How would you like to handle this?',
    options: [
      {
        value: 'rescue',
        label: 'Create baseline from current schema',
        hint: 'Recommended - captures everything in one migration file',
      },
      {
        value: 'ignore',
        label: 'Ignore and continue',
        hint: 'Risk: schema may be lost on reset',
      },
      {
        value: 'cancel',
        label: pc.dim('Cancel'),
        hint: 'Abort and handle manually',
      },
    ],
  });

  if (p.isCancel(choice) || choice === 'cancel') {
    return { success: false, cancelled: true };
  }

  if (choice === 'ignore') {
    console.log(pc.yellow('⚠'), 'Proceeding without rescue. Be careful with db reset!');
    return { success: true };
  }

  // Rescue flow
  console.log();
  console.log(pc.blue('→'), 'Starting migration rescue...');
  console.log();

  const rescueResult = await rescueMigrations(status.remoteMissing);
  
  if (rescueResult.success) {
    console.log();
    console.log(pc.green('✓'), 'Migration rescue complete!');
    console.log();
    console.log('Your schema is now captured in a local migration file.');
    console.log('Future migrations will work normally from this baseline.');
    console.log();
    console.log(pc.dim(`Baseline: ${rescueResult.baselinePath}`));
    
    return { success: true, rescued: true };
  } else {
    console.log();
    console.log(pc.red('✗'), 'Rescue failed:', rescueResult.error);
    return { success: false };
  }
}
