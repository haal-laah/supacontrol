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
  
  if (!result.success || !result.stdout) {
    return [];
  }
  
  // Parse migration list output
  // Format is:
  //   Local          | Remote         | Time (UTC)
  //   ----------------|----------------|---------------------
  //   20260116000044 | 20260116000044 | 2026-01-16 00:00:44   <- Both
  //                  | 20260116082525 | 2026-01-16 08:25:25   <- Remote only
  //   20260116123456 |                | 2026-01-16 12:34:56   <- Local only
  //
  // We need to parse the REMOTE column specifically (second column)
  
  const lines = result.stdout.split('\n');
  const migrations: string[] = [];
  
  for (const line of lines) {
    // Skip header/separator lines
    if (line.includes('Local') || line.includes('---') || !line.trim()) {
      continue;
    }
    
    // Split by | to get columns
    const parts = line.split('|');
    if (parts.length >= 2) {
      // Remote column is the second one (index 1)
      const remoteCol = parts[1].trim();
      const match = remoteCol.match(/^(\d{14})$/);
      if (match) {
        migrations.push(match[1]);
      }
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

  // NORMAL CASE: Local has new migrations to push, but no conflicts
  // This is NOT a mismatch - just new work ready to push
  if (status.remoteMissing.length === 0 && status.localMissing.length > 0) {
    // All remote migrations exist locally, we just have new local ones
    // This is the normal "push new migrations" flow - let it proceed
    console.log(pc.blue('→'), `${status.localMissing.length} new migration(s) ready to push`);
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

  // TRUE MISMATCH: Remote has migrations we don't have locally
  // This requires user decision
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
  
  // Show explanations for each option before the menu
  // "Save remote schema" is recommended when remote has migrations (safer choice)
  // "Repair" is only recommended when there are NO remote migrations to lose
  const hasRemoteMigrations = status.remoteMissing.length > 0;
  const hasLocalMigrations = status.localMissing.length > 0;
  
  const explanations: string[] = [];
  let optionNum = 1;

  if (hasRemoteMigrations) {
    const isRecommended = true; // Always recommend saving remote schema when remote has work
    explanations.push(
      pc.bold(pc.green(`① Save remote schema to a local file`)) + (isRecommended ? ' ' + pc.green('(Recommended)') : ''),
      pc.dim('   Downloads your current database structure and saves it as a migration file.'),
      pc.dim('   This protects your tables, indexes, and other changes from being lost.'),
      pc.dim('   Use this if you made changes via dashboard, MCP, or other tools.'),
      ''
    );
    optionNum++;
  }

  if (hasLocalMigrations) {
    // Only recommend repair if there are NO remote migrations to lose
    const isRecommended = !hasRemoteMigrations;
    explanations.push(
      pc.bold(isRecommended ? pc.green(`${optionNum === 1 ? '①' : '②'} Repair migration history`) : pc.yellow(`② Repair migration history`)) + 
        (isRecommended ? ' ' + pc.green('(Recommended)') : ' ' + pc.yellow('(Use with caution)')),
      pc.dim('   Pushes your local migration files to the remote database.'),
      hasRemoteMigrations 
        ? pc.dim('   ' + pc.yellow('⚠ Warning: Remote-only migrations will be forgotten/lost.'))
        : pc.dim('   Remote-only migrations will be cleared from history.'),
      pc.dim('   Your local files become the single source of truth.'),
      ''
    );
  }

  p.note(explanations.join('\n'), 'Your Options');

  // Build options based on the scenario
  // Order: Rescue first (if applicable) since it's safer, then Repair
  const options: Array<{ value: string; label: string; hint: string }> = [];

  // If remote has migrations, offer rescue FIRST (it's the safer option)
  if (hasRemoteMigrations) {
    options.push({
      value: 'rescue',
      label: 'Save remote schema to a local file',
      hint: 'Recommended - protects your database work',
    });
  }

  // If we have local migrations, offer repair
  if (hasLocalMigrations) {
    options.push({
      value: 'repair',
      label: 'Repair migration history',
      hint: hasRemoteMigrations 
        ? 'Caution - will forget remote-only migrations'
        : 'Push your local files to remote',
    });
  }

  options.push({
    value: 'cancel',
    label: pc.dim('Cancel'),
    hint: 'I\'ll fix this manually',
  });

  const choice = await p.select({
    message: 'What would you like to do?',
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

  // Step 2: Determine baseline timestamp
  // If there are existing local migrations, the baseline should come BEFORE them
  // (since it represents the pre-existing remote state)
  const localMigrations = await getLocalMigrationDetails();
  let timestamp: string;
  
  if (localMigrations.length > 0) {
    // Get the earliest local migration timestamp and subtract 1 second
    const earliestLocal = localMigrations[0].timestamp;
    const earliestNum = parseInt(earliestLocal, 10);
    timestamp = String(earliestNum - 1).padStart(14, '0');
  } else {
    // No local migrations, use current time
    timestamp = generateMigrationTimestamp();
  }

  // Step 3: Dump current schema from remote
  spinner.start('Saving remote schema...');
  
  const baselineFilename = `${timestamp}_baseline.sql`;
  const baselinePath = join(migrationsDir, baselineFilename);
  
  const dumpResult = await runSupabase(
    ['db', 'dump', '--linked', '-f', baselinePath],
    { stream: false }
  );
  
  if (!dumpResult.success) {
    spinner.stop('Failed to save schema');
    result.error = 'Failed to dump remote schema';
    return result;
  }
  
  spinner.stop('Schema saved');
  
  // Step 4: Add a header comment to the baseline file
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

  // Step 5: Mark all existing remote migrations as reverted
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

  // Step 6: Mark the baseline as applied (schema already exists on remote)
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
      `${pc.yellow('Your database has changes that aren\'t saved locally.')}`,
      '',
      `Found ${pc.bold(remoteOnlyCount.toString())} migration(s) on the remote database`,
      `but no matching files in your local ${pc.dim('supabase/migrations/')} folder.`,
      '',
      pc.bold('Why this matters:'),
      '  If you ever reset your database, those changes will be lost',
      '  because there\'s no local file to rebuild from.',
      '',
      pc.bold('How did this happen?'),
      '  • Changes made via Supabase MCP or dashboard',
      '  • Migration files weren\'t saved locally',
      '  • Starting fresh with SupaControl on an existing project',
    ].join('\n'),
    'No Local Migration Files'
  );

  // Show what we recommend
  p.note(
    [
      pc.bold(pc.green('Save your database schema locally')) + ' ' + pc.green('(Recommended)'),
      '',
      pc.dim('We\'ll download your current database structure and save it as a'),
      pc.dim('migration file. This way, if you ever need to reset, your tables,'),
      pc.dim('indexes, and other changes will be preserved.'),
    ].join('\n'),
    'Recommended Action'
  );

  const choice = await p.select({
    message: 'What would you like to do?',
    options: [
      {
        value: 'rescue',
        label: 'Save my database schema locally',
        hint: 'Creates a migration file to protect your work',
      },
      {
        value: 'ignore',
        label: 'Skip for now',
        hint: 'Continue without saving (not recommended)',
      },
      {
        value: 'cancel',
        label: pc.dim('Cancel'),
        hint: 'I\'ll handle this manually',
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
