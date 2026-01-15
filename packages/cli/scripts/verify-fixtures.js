#!/usr/bin/env node
/**
 * Verify Test Fixture Checksums
 *
 * This script validates that test fixtures haven't been modified.
 * Run automatically before tests via `pnpm test`.
 *
 * Usage:
 *   node scripts/verify-fixtures.js          # Verify checksums
 *   node scripts/verify-fixtures.js --update # Update checksums file
 */

import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const FIXTURES_DIR = join(__dirname, '..', 'tests', 'fixtures');
const CHECKSUMS_FILE = join(FIXTURES_DIR, 'checksums.json');

/**
 * Calculate SHA256 checksum of a file
 */
async function getFileChecksum(filePath) {
  const content = await readFile(filePath, 'utf-8');
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Get all fixture files (excluding checksums.json and README.md)
 */
async function getFixtureFiles() {
  const files = await readdir(FIXTURES_DIR);
  return files.filter(
    (f) => f.endsWith('.ts') || f.endsWith('.json')
  ).filter(
    (f) => f !== 'checksums.json'
  );
}

/**
 * Load existing checksums
 */
async function loadChecksums() {
  try {
    const content = await readFile(CHECKSUMS_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

/**
 * Calculate checksums for all fixture files
 */
async function calculateChecksums() {
  const files = await getFixtureFiles();
  const checksums = {};

  for (const file of files) {
    const filePath = join(FIXTURES_DIR, file);
    checksums[file] = await getFileChecksum(filePath);
  }

  return checksums;
}

/**
 * Update checksums file
 */
async function updateChecksums() {
  const checksums = await calculateChecksums();

  await writeFile(
    CHECKSUMS_FILE,
    JSON.stringify(checksums, null, 2) + '\n',
    'utf-8'
  );

  console.log('✓ Updated checksums.json');
  console.log('  Files:', Object.keys(checksums).join(', '));
}

/**
 * Verify checksums match
 */
async function verifyChecksums() {
  const expected = await loadChecksums();
  const actual = await calculateChecksums();

  const errors = [];
  const newFiles = [];

  // Check for modified files
  for (const [file, hash] of Object.entries(expected)) {
    if (actual[file] !== hash) {
      if (actual[file] === undefined) {
        errors.push(`Missing file: ${file}`);
      } else {
        errors.push(`Modified file: ${file}`);
      }
    }
  }

  // Check for new files not in checksums
  for (const file of Object.keys(actual)) {
    if (expected[file] === undefined) {
      newFiles.push(file);
    }
  }

  if (errors.length > 0) {
    console.error('');
    console.error('╔═══════════════════════════════════════════════════════════════════╗');
    console.error('║  ⚠️  TEST FIXTURE MODIFICATION DETECTED                            ║');
    console.error('╠═══════════════════════════════════════════════════════════════════╣');
    console.error('║                                                                   ║');
    console.error('║  DO NOT MODIFY TEST FIXTURES TO MAKE TESTS PASS!                 ║');
    console.error('║                                                                   ║');
    console.error('║  If a test fails:                                                ║');
    console.error('║    1. FIX THE IMPLEMENTATION in src/                             ║');
    console.error('║    2. If the expected behavior changed intentionally:            ║');
    console.error('║       - Update the fixture file                                  ║');
    console.error('║       - Run: pnpm verify-fixtures --update                       ║');
    console.error('║       - Explain WHY in your commit message                       ║');
    console.error('║                                                                   ║');
    console.error('╚═══════════════════════════════════════════════════════════════════╝');
    console.error('');
    console.error('Modified fixtures:');
    for (const error of errors) {
      console.error(`  ✗ ${error}`);
    }
    console.error('');
    process.exit(1);
  }

  if (newFiles.length > 0) {
    console.log('⚠ New fixture files detected:');
    for (const file of newFiles) {
      console.log(`  + ${file}`);
    }
    console.log('  Run: pnpm verify-fixtures --update');
    console.log('');
  }

  console.log('✓ All fixture checksums verified');
}

// Main execution
const args = process.argv.slice(2);
if (args.includes('--update')) {
  await updateChecksums();
} else {
  await verifyChecksums();
}
