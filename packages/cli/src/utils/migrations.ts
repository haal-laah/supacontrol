import { readdir, readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import pc from 'picocolors';
import * as p from '@clack/prompts';
import { runSupabase } from './supabase.js';

// Note: generateMigrationTimestamp was removed - no longer needed with fetch-based sync

/**
 * Calculate SHA256 hash of content
 */
export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/**
 * Result of checking migration sync status
 */
export interface MigrationSyncStatus {
  /** Whether sync is needed */
  needsSync: boolean;
  /** Migrations on remote but not local (timestamps only) */
  remoteMissing: string[];
  /** Migrations on local but not remote (timestamps only) */
  localMissing: string[];
  /** Error message if check failed */
  error?: string;
}

/**
 * Detailed migration info including full filename and content
 */
interface LocalMigration {
  timestamp: string;
  name: string;
  filename: string;
  fullPath: string;
  content?: string;
}

/**
 * Result of fetching remote migrations
 */
interface FetchResult {
  success: boolean;
  error?: string;
  /** Migrations fetched from remote */
  fetched: LocalMigration[];
}

/**
 * Conflict between local and remote migration content
 */
interface MigrationConflict {
  timestamp: string;
  filename: string;
  localPath: string;
  localContent: string;
  remoteContent: string;
  localHash: string;
  remoteHash: string;
}

/**
 * User's choice for resolving a conflict
 */
type ConflictResolution = 'create-migration' | 'keep-local' | 'keep-remote' | 'save-both' | 'cancel';

/**
 * Get list of local migration files
 */
async function getLocalMigrations(): Promise<string[]> {
  const migrationsDir = resolve(process.cwd(), 'supabase', 'migrations');
  
  try {
    const files = await readdir(migrationsDir);
    return files
      .filter(f => f.endsWith('.sql') && !f.endsWith('.remote.sql'))
      .map(f => f.replace('.sql', ''))
      .sort();
  } catch {
    // No migrations directory
    return [];
  }
}

/**
 * Get detailed local migration info
 */
async function getLocalMigrationDetails(): Promise<LocalMigration[]> {
  const migrationsDir = resolve(process.cwd(), 'supabase', 'migrations');
  
  try {
    const files = await readdir(migrationsDir);
    return files
      .filter(f => f.endsWith('.sql') && !f.endsWith('.remote.sql'))
      .map(f => {
        const match = f.match(/^(\d{14})_?(.*)\.sql$/);
        const timestamp = match?.[1] ?? f.replace('.sql', '');
        const name = match?.[2] ?? '';
        return {
          timestamp,
          name,
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
      const remoteCol = parts[1]?.trim();
      if (remoteCol) {
        const match = remoteCol.match(/^(\d{14})$/);
        if (match?.[1]) {
          migrations.push(match[1]);
        }
      }
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
    const localTimestamps: string[] = local.map(m => {
      const match = m.match(/^(\d{14})/);
      return match?.[1] ?? m;
    });
    
    // Find migrations on remote but not local
    const remoteMissing = remote.filter(r => !localTimestamps.includes(r));
    
    // Find migrations on local but not remote
    const localMissing = localTimestamps.filter(l => l !== undefined && !remote.includes(l));
    
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
 * Fetch remote migrations using `supabase migration fetch`
 * This downloads the actual SQL content from the remote history table
 */
async function fetchRemoteMigrations(): Promise<FetchResult> {
  const migrationsDir = resolve(process.cwd(), 'supabase', 'migrations');
  
  // Ensure migrations directory exists
  try {
    await mkdir(migrationsDir, { recursive: true });
  } catch {
    // Already exists
  }

  // Fetch migrations from remote
  const result = await runSupabase(
    ['migration', 'fetch', '--linked'],
    { stream: false, input: 'y\n' } // Auto-confirm the overwrite prompt
  );
  
  if (!result.success) {
    return {
      success: false,
      error: result.stderr || 'Failed to fetch migrations',
      fetched: [],
    };
  }
  
  // Get the list of migrations that now exist locally
  const fetched = await getLocalMigrationDetails();
  
  return {
    success: true,
    fetched,
  };
}

/**
 * Read content of a local migration file
 */
async function readMigrationContent(migration: LocalMigration): Promise<string> {
  return await readFile(migration.fullPath, 'utf-8');
}

/**
 * Find conflicts between local and remote migration content
 * Note: This function is kept for potential future use but currently
 * conflict detection is done inline in interactiveMigrationSync
 */
async function _findContentConflicts(
  localMigrations: LocalMigration[],
  remoteMigrations: LocalMigration[]
): Promise<MigrationConflict[]> {
  const conflicts: MigrationConflict[] = [];
  
  // Build map of remote migrations by timestamp
  const remoteByTimestamp = new Map<string, LocalMigration>();
  for (const m of remoteMigrations) {
    remoteByTimestamp.set(m.timestamp, m);
  }
  
  // Check each local migration for conflicts
  for (const local of localMigrations) {
    const remote = remoteByTimestamp.get(local.timestamp);
    if (!remote) continue; // No remote version, no conflict
    
    const localContent = await readMigrationContent(local);
    const remoteContent = await readMigrationContent(remote);
    
    const localHash = hashContent(localContent);
    const remoteHash = hashContent(remoteContent);
    
    if (localHash !== remoteHash) {
      conflicts.push({
        timestamp: local.timestamp,
        filename: local.filename,
        localPath: local.fullPath,
        localContent,
        remoteContent,
        localHash,
        remoteHash,
      });
    }
  }
  
  return conflicts;
}

/**
 * Simple diff: find lines only in local (additions) and only in remote (removals)
 */
export function computeSimpleDiff(localContent: string, remoteContent: string): {
  additions: string[];
  removals: string[];
} {
  const localLines = new Set(localContent.split('\n').map(l => l.trim()).filter(Boolean));
  const remoteLines = new Set(remoteContent.split('\n').map(l => l.trim()).filter(Boolean));
  
  const additions: string[] = [];
  const removals: string[] = [];
  
  // Lines in local but not in remote (additions)
  for (const line of localLines) {
    if (!remoteLines.has(line)) {
      additions.push(line);
    }
  }
  
  // Lines in remote but not in local (removals)
  for (const line of remoteLines) {
    if (!localLines.has(line)) {
      removals.push(line);
    }
  }
  
  return { additions, removals };
}

/**
 * Display a diff between local and remote content
 */
function displayDiff(conflict: MigrationConflict): void {
  const { additions, removals } = computeSimpleDiff(conflict.localContent, conflict.remoteContent);
  
  console.log();
  console.log(pc.bold(`  File: ${conflict.filename}`));
  console.log();
  
  // Show what's different
  if (removals.length > 0) {
    console.log(pc.dim('  In database (will be kept):'));
    for (const line of removals.slice(0, 8)) {
      console.log(pc.red(`    - ${line.slice(0, 70)}`));
    }
    if (removals.length > 8) {
      console.log(pc.dim(`    ... and ${removals.length - 8} more lines`));
    }
    console.log();
  }
  
  if (additions.length > 0) {
    console.log(pc.dim('  In your local file (NOT in database):'));
    for (const line of additions.slice(0, 8)) {
      console.log(pc.green(`    + ${line.slice(0, 70)}`));
    }
    if (additions.length > 8) {
      console.log(pc.dim(`    ... and ${additions.length - 8} more lines`));
    }
  }
}

/**
 * Prompt user to resolve a migration conflict
 */
async function resolveConflict(conflict: MigrationConflict): Promise<ConflictResolution> {
  console.log();
  console.log(pc.yellow('⚠'), pc.bold('Local file differs from applied migration'));
  console.log();
  
  displayDiff(conflict);
  
  console.log();
  p.note(
    [
      pc.bold(pc.yellow('Your local edits are NOT in the database.')),
      '',
      'It looks like this migration file was edited after it was',
      'already applied to your database. That\'s a common mistake!',
      '',
      pc.bold('How migrations work:'),
      '  • Each migration runs ONCE, then is marked as "done"',
      '  • Editing the file later has no effect - it won\'t re-run',
      '  • To change your schema, create a NEW migration',
      '',
      pc.dim('Example: To add a column, don\'t edit the CREATE TABLE.'),
      pc.dim('Instead, create a new migration with ALTER TABLE ... ADD COLUMN.'),
    ].join('\n'),
    'What happened?'
  );

  const choice = await p.select({
    message: 'How do you want to handle this?',
    options: [
      {
        value: 'create-migration',
        label: pc.green('Create new migration from my edits') + ' ' + pc.green('(Recommended)'),
        hint: 'Applies your changes to the database properly',
      },
      {
        value: 'keep-remote',
        label: 'Restore file to match database',
        hint: 'Discards your local edits',
      },
      {
        value: 'save-both',
        label: 'Keep both versions',
        hint: 'Save applied version as .remote.sql for reference',
      },
      {
        value: 'keep-local',
        label: pc.dim('Keep local file as-is (not recommended)'),
        hint: 'File won\'t match database - you\'ll need to fix manually',
      },
      {
        value: 'cancel',
        label: pc.dim('Cancel'),
        hint: 'Abort the sync',
      },
    ],
  });

  if (p.isCancel(choice)) {
    return 'cancel';
  }
  
  return choice as ConflictResolution;
}

/**
 * Generate a timestamp for a new migration
 */
export function generateMigrationTimestamp(): string {
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
 * Create a new migration containing the differences between local and remote
 */
async function createMigrationFromDiff(
  conflict: MigrationConflict,
  latestRemoteTimestamp?: string
): Promise<{ success: boolean; migrationPath?: string; error?: string }> {
  const migrationsDir = resolve(process.cwd(), 'supabase', 'migrations');
  
  // Calculate timestamp - must be after all existing migrations
  let timestamp = generateMigrationTimestamp();
  if (latestRemoteTimestamp && timestamp <= latestRemoteTimestamp) {
    // Ensure our new migration comes after the latest remote
    const nextTimestamp = parseInt(latestRemoteTimestamp, 10) + 1;
    timestamp = String(nextTimestamp).padStart(14, '0');
  }
  
  // Extract the base name from the original migration
  const nameMatch = conflict.filename.match(/^\d{14}_(.+)\.sql$/);
  const baseName = nameMatch ? nameMatch[1] : 'update';
  
  // Create a descriptive filename
  const newFilename = `${timestamp}_${baseName}_changes.sql`;
  const newPath = join(migrationsDir, newFilename);
  
  // Find the actual differences
  const { additions } = computeSimpleDiff(conflict.localContent, conflict.remoteContent);
  
  if (additions.length === 0) {
    return { 
      success: false, 
      error: 'No differences found to migrate' 
    };
  }
  
  // Build the migration content
  // Note: This is a simple approach - it extracts new lines but the user
  // should review and potentially adjust the migration
  const header = [
    '-- Migration generated by SupaControl',
    `-- Based on local edits to: ${conflict.filename}`,
    `-- Generated: ${new Date().toISOString()}`,
    '--',
    '-- ⚠️  REVIEW THIS MIGRATION BEFORE APPLYING',
    '-- The following changes were detected in your local file:',
    '--',
  ];
  
  // Try to extract meaningful SQL statements
  const meaningfulAdditions = additions.filter(line => {
    const l = line.toLowerCase();
    return (
      l.includes('create ') ||
      l.includes('alter ') ||
      l.includes('add ') ||
      l.includes('drop ') ||
      l.includes('index') ||
      l.includes('column') ||
      l.includes('constraint') ||
      l.includes('default') ||
      l.includes('comment on')
    );
  });
  
  let content: string;
  if (meaningfulAdditions.length > 0) {
    content = [
      ...header,
      '',
      '-- Detected changes (may need manual adjustment):',
      ...meaningfulAdditions.map(line => `-- ${line}`),
      '',
      '-- TODO: Write the actual SQL to apply these changes',
      '-- Example: ALTER TABLE ... ADD COLUMN ...;',
      '',
    ].join('\n');
  } else {
    content = [
      ...header,
      '',
      '-- Could not automatically extract SQL statements.',
      '-- Please review the diff and write the appropriate migration.',
      '',
      '-- Local file additions:',
      ...additions.slice(0, 20).map(line => `-- ${line}`),
      additions.length > 20 ? `-- ... and ${additions.length - 20} more lines` : '',
      '',
    ].filter(Boolean).join('\n');
  }
  
  await writeFile(newPath, content);
  
  // Restore the original file to match remote (database state)
  await writeFile(conflict.localPath, conflict.remoteContent);
  
  return { success: true, migrationPath: newPath };
}

/**
 * Apply conflict resolution
 */
async function applyConflictResolution(
  conflict: MigrationConflict,
  resolution: ConflictResolution,
  latestRemoteTimestamp?: string
): Promise<boolean> {
  const migrationsDir = resolve(process.cwd(), 'supabase', 'migrations');
  
  switch (resolution) {
    case 'create-migration': {
      const result = await createMigrationFromDiff(conflict, latestRemoteTimestamp);
      if (result.success && result.migrationPath) {
        console.log(pc.green('✓'), `Restored ${conflict.filename} to match database`);
        console.log(pc.green('✓'), `Created new migration: ${basename(result.migrationPath)}`);
        console.log();
        console.log(pc.yellow('⚠'), 'Please review and edit the new migration before pushing');
        console.log(pc.dim(`   ${result.migrationPath}`));
      } else if (result.error === 'No differences found to migrate') {
        // No meaningful differences - just restore to match database
        // This can happen with whitespace/formatting-only changes
        await writeFile(conflict.localPath, conflict.remoteContent);
        console.log(pc.green('✓'), `Restored ${conflict.filename} to match database`);
        console.log(pc.dim('   (No meaningful code differences found)'));
      } else {
        console.log(pc.red('✗'), 'Failed to create migration:', result.error);
        return false;
      }
      return true;
    }
    
    case 'keep-local':
      // Nothing to do - local file is already what we want
      console.log(pc.yellow('⚠'), `Keeping local version of ${conflict.filename}`);
      console.log(pc.dim('   Note: This file does not match what\'s in your database'));
      return true;
      
    case 'keep-remote':
      // Overwrite local with remote content
      await writeFile(conflict.localPath, conflict.remoteContent);
      console.log(pc.green('✓'), `Restored ${conflict.filename} to match database`);
      return true;
      
    case 'save-both': {
      // Save remote as a .remote.sql file for reference
      const remotePath = join(migrationsDir, conflict.filename.replace('.sql', '.remote.sql'));
      await writeFile(remotePath, conflict.remoteContent);
      console.log(pc.yellow('⚠'), `Keeping local ${conflict.filename} (doesn't match database)`);
      console.log(pc.green('✓'), `Saved database version as ${basename(remotePath)}`);
      return true;
    }
      
    case 'cancel':
      return false;
  }
}

/**
 * Rename local-only migrations to come after the latest remote migration
 */
async function reorderLocalMigrations(
  localOnly: LocalMigration[],
  latestRemoteTimestamp: string
): Promise<{ original: string; renamed: string }[]> {
  const renamed: { original: string; renamed: string }[] = [];
  const migrationsDir = resolve(process.cwd(), 'supabase', 'migrations');
  
  // Sort by timestamp to process in order
  const sorted = [...localOnly].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  
  // Find migrations that need reordering (timestamp <= latest remote)
  const needsReorder = sorted.filter(m => m.timestamp <= latestRemoteTimestamp);
  
  if (needsReorder.length === 0) {
    return renamed;
  }
  
  console.log();
  console.log(pc.blue('→'), 'Reordering local migrations to come after remote...');
  
  // Calculate new timestamps starting 1 second after the latest remote
  let nextTimestamp = parseInt(latestRemoteTimestamp, 10) + 1;
  
  for (const migration of needsReorder) {
    const newTimestamp = String(nextTimestamp).padStart(14, '0');
    const newFilename = migration.filename.replace(migration.timestamp, newTimestamp);
    const newPath = join(migrationsDir, newFilename);
    
    // Rename the file
    await rename(migration.fullPath, newPath);
    
    renamed.push({
      original: migration.filename,
      renamed: newFilename,
    });
    
    console.log(pc.dim(`  ${migration.filename}`));
    console.log(pc.green(`    → ${newFilename}`));
    
    nextTimestamp++;
  }
  
  return renamed;
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

  result.success = true;
  return result;
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
 * Full migration sync workflow with user interaction.
 * 
 * NEW APPROACH using `supabase migration fetch`:
 * 1. Fetch remote migrations (downloads actual SQL files)
 * 2. Compare content of matched migrations (same timestamp)
 * 3. Resolve any conflicts with user input
 * 4. Reorder local-only migrations if needed (timestamp after remote)
 * 5. Push local-only migrations
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
  // BUT we still need to check timestamp ordering!
  if (status.remoteMissing.length === 0 && status.localMissing.length > 0) {
    // Get the latest remote migration timestamp
    const remoteMigrations = await getRemoteMigrations();
    const latestRemote = remoteMigrations.length > 0 
      ? remoteMigrations.sort()[remoteMigrations.length - 1] 
      : null;
    
    // Check if any local-only migrations have timestamps before the latest remote
    const needsReorder = latestRemote && status.localMissing.some(ts => ts <= latestRemote);
    
    if (needsReorder) {
      console.log(pc.blue('→'), `${status.localMissing.length} new migration(s) need timestamp adjustment`);
      
      // Get full migration details for reordering
      const localDetails = await getLocalMigrationDetails();
      const localOnlyMigrations = localDetails.filter(m => status.localMissing.includes(m.timestamp));
      
      const renames = await reorderLocalMigrations(localOnlyMigrations, latestRemote);
      
      if (renames.length > 0) {
        console.log(pc.green('✓'), `Reordered ${renames.length} migration(s) to come after remote`);
      }
    } else {
      console.log(pc.blue('→'), `${status.localMissing.length} new migration(s) ready to push`);
    }
    
    return { success: true };
  }

  // We have remote migrations that aren't local
  // This is the scenario where we need to fetch and potentially resolve conflicts
  
  console.log();
  console.log(pc.yellow('⚠'), 'Migration sync needed');
  console.log();
  
  if (status.remoteMissing.length > 0) {
    console.log(pc.dim('  Remote has migrations not saved locally:'));
    for (const m of status.remoteMissing) {
      console.log(pc.blue(`    + ${m}`));
    }
  }
  
  if (status.localMissing.length > 0) {
    console.log(pc.dim('  Local has migrations not on remote:'));
    for (const m of status.localMissing) {
      console.log(pc.green(`    + ${m}`));
    }
  }
  
  console.log();

  // Explain what we're about to do
  p.note(
    [
      pc.bold('We will:'),
      '',
      `${pc.blue('1.')} Download ${status.remoteMissing.length} migration file(s) from remote`,
      `${pc.blue('2.')} Check for any content conflicts with your local files`,
      `${pc.blue('3.')} Let you resolve any conflicts`,
      status.localMissing.length > 0 
        ? `${pc.blue('4.')} Reorder your local migrations if needed, then push`
        : '',
      '',
      pc.dim('This preserves both remote and local work.'),
    ].filter(Boolean).join('\n'),
    'Migration Sync'
  );

  const proceed = await p.confirm({
    message: 'Proceed with sync?',
    initialValue: true,
  });

  if (p.isCancel(proceed) || !proceed) {
    return { success: false, cancelled: true };
  }

  // Step 1: Capture current local migrations BEFORE fetch
  const localBefore = await getLocalMigrationDetails();
  const localBeforeMap = new Map<string, LocalMigration>();
  for (const m of localBefore) {
    localBeforeMap.set(m.timestamp, m);
    // Read content now, before fetch potentially overwrites
    m.content = await readMigrationContent(m);
  }

  // Step 2: Fetch remote migrations
  const spinner = p.spinner();
  spinner.start('Fetching remote migrations...');
  
  const fetchResult = await fetchRemoteMigrations();
  
  if (!fetchResult.success) {
    spinner.stop('Fetch failed');
    console.log(pc.red('✗'), 'Failed to fetch remote migrations:', fetchResult.error);
    return { success: false };
  }
  
  spinner.stop(`Fetched ${status.remoteMissing.length} migration(s) from remote`);

  // Step 3: Find content conflicts (same timestamp, different content)
  // We compare the local content BEFORE fetch with what fetch wrote
  const conflicts: MigrationConflict[] = [];
  
  for (const [timestamp, localMigration] of localBeforeMap) {
    // Only check migrations that existed both locally and remotely
    if (status.remoteMissing.includes(timestamp) || status.localMissing.includes(timestamp)) {
      continue; // This was unique to one side, not a conflict
    }
    
    // Read what fetch wrote (remote content)
    const remotePath = localMigration.fullPath;
    let remoteContent: string;
    try {
      remoteContent = await readFile(remotePath, 'utf-8');
    } catch {
      continue; // File doesn't exist, skip
    }
    
    const localContent = localMigration.content ?? '';
    const localHash = hashContent(localContent);
    const remoteHash = hashContent(remoteContent);
    
    if (localHash !== remoteHash) {
      // Double-check: do we have MEANINGFUL differences?
      // (Hashes can differ due to whitespace/line endings)
      const { additions, removals } = computeSimpleDiff(localContent, remoteContent);
      
      if (additions.length === 0 && removals.length === 0) {
        // No meaningful differences - just whitespace/formatting
        // Silently keep the remote version (it's what's in the DB)
        continue;
      }
      
      conflicts.push({
        timestamp,
        filename: localMigration.filename,
        localPath: remotePath,
        localContent,
        remoteContent,
        localHash,
        remoteHash,
      });
    }
  }

  // Step 4: Resolve any conflicts
  // Get the latest remote timestamp for new migration ordering
  const sortedRemote = [...status.remoteMissing].sort();
  const latestRemoteTimestamp = sortedRemote.length > 0 
    ? sortedRemote[sortedRemote.length - 1] 
    : undefined;
  
  if (conflicts.length > 0) {
    console.log();
    console.log(pc.yellow('⚠'), `Found ${conflicts.length} file(s) with content differences`);
    console.log();
    
    for (let i = 0; i < conflicts.length; i++) {
      const conflict = conflicts[i];
      if (!conflict) continue;
      const conflictNum = i + 1;
      const totalConflicts = conflicts.length;
      
      // Show which conflict we're on
      console.log(pc.blue('─'.repeat(60)));
      console.log(pc.blue(`  Conflict ${conflictNum} of ${totalConflicts}`));
      console.log(pc.blue('─'.repeat(60)));
      
      const resolution = await resolveConflict(conflict);
      
      if (resolution === 'cancel') {
        // Restore original local files
        const restoreSpinner = p.spinner();
        restoreSpinner.start('Restoring original files...');
        for (const [, localMigration] of localBeforeMap) {
          if (localMigration.content) {
            await writeFile(localMigration.fullPath, localMigration.content);
          }
        }
        restoreSpinner.stop('Restored original files');
        return { success: false, cancelled: true };
      }
      
      // Show processing feedback
      const actionSpinner = p.spinner();
      const actionLabel = resolution === 'create-migration' 
        ? 'Creating migration from your edits...'
        : resolution === 'keep-remote'
        ? 'Restoring file to match database...'
        : resolution === 'save-both'
        ? 'Saving both versions...'
        : 'Processing...';
      
      actionSpinner.start(actionLabel);
      
      const applied = await applyConflictResolution(conflict, resolution, latestRemoteTimestamp);
      
      // Stop spinner before showing results
      actionSpinner.stop(applied ? 'Complete' : 'Failed');
      
      if (!applied) {
        return { success: false, cancelled: true };
      }
      
      // If there are more conflicts, add a visual break
      if (i < conflicts.length - 1) {
        console.log();
        console.log(pc.dim('  Moving to next conflict...'));
        console.log();
      }
    }
    
    console.log();
    console.log(pc.green('✓'), `Resolved ${conflicts.length} conflict(s)`);
  }

  // Step 5: Restore local-only migrations that might have been lost
  // (fetch overwrites the directory, so we need to restore files that were only local)
  const migrationsDir = resolve(process.cwd(), 'supabase', 'migrations');
  
  for (const timestamp of status.localMissing) {
    const localMigration = localBeforeMap.get(timestamp);
    if (localMigration && localMigration.content) {
      const targetPath = join(migrationsDir, localMigration.filename);
      await writeFile(targetPath, localMigration.content);
    }
  }

  // Step 6: Reorder local-only migrations if their timestamps are before remote migrations
  if (status.localMissing.length > 0 && latestRemoteTimestamp) {
    // Get fresh list of local migrations
    const currentLocal = await getLocalMigrationDetails();
    const localOnlyMigrations = currentLocal.filter(m => status.localMissing.includes(m.timestamp));
    
    const renames = await reorderLocalMigrations(localOnlyMigrations, latestRemoteTimestamp);
    
    if (renames.length > 0) {
      console.log(pc.green('✓'), `Reordered ${renames.length} local migration(s)`);
    }
  }

  console.log();
  console.log(pc.green('✓'), 'Migration sync complete!');
  
  // Show summary
  const finalLocal = await getLocalMigrationDetails();
  const finalRemote = await getRemoteMigrations();
  const stillMissing = finalLocal
    .filter(m => !finalRemote.includes(m.timestamp))
    .map(m => m.filename);
  
  if (stillMissing.length > 0) {
    console.log();
    console.log(pc.blue('→'), `${stillMissing.length} migration(s) ready to push:`);
    for (const f of stillMissing) {
      console.log(pc.dim(`    ${f}`));
    }
  }

  return { success: true };
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
 * Legacy rescue function - now just calls interactiveMigrationSync
 * which handles all scenarios including rescue
 */
export async function rescueMigrations(
  _remoteMigrations: string[]
): Promise<RescueResult> {
  // This is now handled by the new fetch-based sync
  const syncResult = await interactiveMigrationSync();
  
  const result: RescueResult = {
    success: syncResult.success,
    revertedMigrations: [],
  };
  
  if (syncResult.cancelled) {
    result.error = 'Cancelled by user';
  }
  
  return result;
}

/**
 * Legacy rescue flow - now redirects to interactiveMigrationSync
 */
export async function interactiveMigrationRescue(): Promise<{ success: boolean; cancelled?: boolean; rescued?: boolean }> {
  const result = await interactiveMigrationSync();
  return {
    ...result,
    rescued: result.success,
  };
}

