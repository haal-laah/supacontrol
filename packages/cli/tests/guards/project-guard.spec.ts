/**
 * Unit Tests for Project Guard
 *
 * ====================================================================
 * ⚠️ SAFETY-CRITICAL TESTS - PREVENT WRONG PROJECT OPERATIONS ⚠️
 * ====================================================================
 *
 * These tests verify that operations are blocked when the linked
 * Supabase project doesn't match the expected environment.
 *
 * If tests fail, FIX THE IMPLEMENTATION, not the tests.
 *
 * ====================================================================
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkProjectMatch, clearProjectCache, getCurrentLinkedProject } from '../../src/guards/project-guard.js';
import { PROJECT_GUARD_CASES, BASE_ENVIRONMENTS, createTestContext } from '../fixtures/guard.fixtures.js';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('Project Guard', () => {
  let testDir: string;
  let originalCwd: () => string;

  beforeEach(async () => {
    // Create temp directory for each test
    testDir = join(tmpdir(), `supacontrol-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(join(testDir, 'supabase', '.temp'), { recursive: true });

    // Clear project cache before each test
    clearProjectCache();

    // Mock process.cwd to return our test directory
    originalCwd = process.cwd;
    vi.stubGlobal('process', { ...process, cwd: () => testDir });
  });

  afterEach(async () => {
    // Restore original cwd
    vi.stubGlobal('process', { ...process, cwd: originalCwd });

    // Clean up temp directory
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }

    // Clear cache
    clearProjectCache();
  });

  /**
   * Helper to write project ref file
   */
  async function writeProjectRef(ref: string): Promise<void> {
    const refPath = join(testDir, 'supabase', '.temp', 'project-ref');
    await writeFile(refPath, ref, 'utf-8');
  }

  describe('Matching Project Refs', () => {
    it('should allow when linked project matches config', async () => {
      await writeProjectRef('staging-project-ref');

      const context = createTestContext({
        environment: BASE_ENVIRONMENTS.staging,
        environmentName: 'staging',
      });

      const result = await checkProjectMatch(context);

      expect(result.allowed).toBe(true);
    });

    it('should allow exact match for production', async () => {
      await writeProjectRef('prod-project-ref');

      const context = createTestContext({
        environment: BASE_ENVIRONMENTS.production,
        environmentName: 'production',
      });

      const result = await checkProjectMatch(context);

      expect(result.allowed).toBe(true);
    });
  });

  describe('Mismatched Project Refs', () => {
    /**
     * CRITICAL: This must block to prevent operating on wrong database
     */
    it('MUST block when linked project does not match config', async () => {
      await writeProjectRef('wrong-project-ref');

      const context = createTestContext({
        environment: BASE_ENVIRONMENTS.production,
        environmentName: 'production',
      });

      const result = await checkProjectMatch(context);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('mismatch');
    });

    it('should include both project refs in error message', async () => {
      await writeProjectRef('actual-linked-project');

      const context = createTestContext({
        environment: {
          ...BASE_ENVIRONMENTS.staging,
          project_ref: 'expected-project',
        },
        environmentName: 'staging',
      });

      const result = await checkProjectMatch(context);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('actual-linked-project');
      expect(result.reason).toContain('expected-project');
    });

    it('should provide helpful suggestions on mismatch', async () => {
      await writeProjectRef('wrong-ref');

      const context = createTestContext({
        environment: BASE_ENVIRONMENTS.staging,
        environmentName: 'staging',
      });

      const result = await checkProjectMatch(context);

      expect(result.suggestions).toBeDefined();
      expect(result.suggestions!.length).toBeGreaterThan(0);
      expect(result.suggestions!.some(s => s.includes('link'))).toBe(true);
    });
  });

  describe('No Linked Project', () => {
    it('should allow but suggest linking when no project is linked', async () => {
      // Don't write project-ref file

      const context = createTestContext({
        environment: BASE_ENVIRONMENTS.staging,
        environmentName: 'staging',
      });

      const result = await checkProjectMatch(context);

      // Should allow but provide suggestions
      expect(result.allowed).toBe(true);
      expect(result.suggestions).toBeDefined();
    });
  });

  describe('No project_ref Configured', () => {
    /**
     * If environment has no project_ref, skip the check.
     * This is for local-only setups.
     */
    it('should allow when environment has no project_ref configured', async () => {
      await writeProjectRef('some-linked-project');

      const context = createTestContext({
        environment: {
          ...BASE_ENVIRONMENTS.noProtections,
          project_ref: undefined,
        },
        environmentName: 'local',
      });

      const result = await checkProjectMatch(context);

      expect(result.allowed).toBe(true);
    });

    it('should suggest adding project_ref for safety', async () => {
      const context = createTestContext({
        environment: {
          ...BASE_ENVIRONMENTS.noProtections,
          project_ref: undefined,
        },
        environmentName: 'local',
      });

      const result = await checkProjectMatch(context);

      expect(result.suggestions).toBeDefined();
      expect(result.suggestions!.some(s => s.includes('project_ref'))).toBe(true);
    });
  });

  describe('Cache Behavior', () => {
    it('should cache the linked project ref', async () => {
      await writeProjectRef('cached-ref');

      // First call
      const ref1 = await getCurrentLinkedProject(testDir);

      // Change the file (shouldn't matter due to cache)
      await writeProjectRef('new-ref');

      // Second call should return cached value
      const ref2 = await getCurrentLinkedProject(testDir);

      expect(ref1).toBe('cached-ref');
      expect(ref2).toBe('cached-ref');
    });

    it('should allow clearing the cache', async () => {
      await writeProjectRef('original-ref');

      const ref1 = await getCurrentLinkedProject(testDir);

      await writeProjectRef('new-ref');
      clearProjectCache();

      const ref2 = await getCurrentLinkedProject(testDir);

      expect(ref1).toBe('original-ref');
      expect(ref2).toBe('new-ref');
    });
  });

  describe('Risk Level', () => {
    it('should indicate high risk for project mismatch', async () => {
      await writeProjectRef('wrong-ref');

      const context = createTestContext({
        environment: BASE_ENVIRONMENTS.production,
        environmentName: 'production',
      });

      const result = await checkProjectMatch(context);

      expect(result.riskLevel).toBe('high');
    });
  });
});
