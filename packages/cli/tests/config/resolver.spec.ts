/**
 * Unit Tests for Environment Resolver
 *
 * ====================================================================
 * CRITICAL: These tests ensure correct environment detection.
 * If tests fail, FIX THE IMPLEMENTATION in src/config/resolver.ts
 * ====================================================================
 */

import { describe, it, expect } from 'vitest';
import {
  resolveEnvironment,
  resolveEnvironmentByProjectRef,
  getEnvironmentByName,
  listEnvironments,
  hasEnvironment,
} from '../../src/config/resolver.js';
import type { Config, Environment } from '../../src/config/schema.js';

/**
 * Helper to create test config
 */
function createConfig(environments: Record<string, Partial<Environment>>): Config {
  const envs: Record<string, Environment> = {};
  for (const [name, env] of Object.entries(environments)) {
    envs[name] = {
      project_ref: env.project_ref,
      git_branches: env.git_branches ?? [],
      protected_operations: env.protected_operations ?? [],
      confirm_word: env.confirm_word,
      locked: env.locked,
    };
  }
  return {
    settings: {
      strict_mode: false,
      require_clean_git: true,
      show_migration_diff: true,
    },
    environments: envs,
  };
}

describe('Environment Resolver', () => {
  describe('Exact Branch Matching', () => {
    it('should match exact branch name', () => {
      const config = createConfig({
        staging: { git_branches: ['staging', 'develop'] },
        production: { git_branches: ['main', 'master'] },
      });

      const result = resolveEnvironment('develop', config);

      expect(result).not.toBeNull();
      expect(result!.name).toBe('staging');
      expect(result!.matchType).toBe('exact');
    });

    it('should return first matching environment when multiple match', () => {
      // Important: Object iteration order in JavaScript is guaranteed for string keys
      const config = createConfig({
        env1: { git_branches: ['shared-branch'] },
        env2: { git_branches: ['shared-branch'] },
      });

      const result = resolveEnvironment('shared-branch', config);

      expect(result).not.toBeNull();
      expect(result!.name).toBe('env1'); // First wins
    });

    it('should match main branch to production', () => {
      const config = createConfig({
        staging: { git_branches: ['staging'] },
        production: { git_branches: ['main'] },
      });

      const result = resolveEnvironment('main', config);

      expect(result).not.toBeNull();
      expect(result!.name).toBe('production');
    });

    it('should match master branch to production', () => {
      const config = createConfig({
        production: { git_branches: ['master'] },
      });

      const result = resolveEnvironment('master', config);

      expect(result).not.toBeNull();
      expect(result!.name).toBe('production');
    });
  });

  describe('Wildcard Pattern Matching', () => {
    it('should match feature/* pattern', () => {
      const config = createConfig({
        preview: { git_branches: ['feature/*'] },
        production: { git_branches: ['main'] },
      });

      const result = resolveEnvironment('feature/add-login', config);

      expect(result).not.toBeNull();
      expect(result!.name).toBe('preview');
      expect(result!.matchType).toBe('wildcard');
    });

    it('should match nested paths with feature/*', () => {
      const config = createConfig({
        preview: { git_branches: ['feature/*'] },
      });

      const result = resolveEnvironment('feature/auth/oauth', config);

      expect(result).not.toBeNull();
      expect(result!.name).toBe('preview');
    });

    it('should match release/* pattern', () => {
      const config = createConfig({
        release: { git_branches: ['release/*'] },
      });

      const result = resolveEnvironment('release/v1.2.3', config);

      expect(result).not.toBeNull();
      expect(result!.name).toBe('release');
    });

    it('should match hotfix/* pattern', () => {
      const config = createConfig({
        hotfix: { git_branches: ['hotfix/*'] },
      });

      const result = resolveEnvironment('hotfix/urgent-fix', config);

      expect(result).not.toBeNull();
      expect(result!.name).toBe('hotfix');
    });

    it('should match multiple wildcard patterns', () => {
      const config = createConfig({
        preview: { git_branches: ['feature/*', 'bugfix/*', 'pr/*'] },
      });

      expect(resolveEnvironment('feature/foo', config)?.name).toBe('preview');
      expect(resolveEnvironment('bugfix/bar', config)?.name).toBe('preview');
      expect(resolveEnvironment('pr/123', config)?.name).toBe('preview');
    });

    it('should prefer exact match over wildcard', () => {
      const config = createConfig({
        specific: { git_branches: ['feature/special'] },
        preview: { git_branches: ['feature/*'] },
      });

      const result = resolveEnvironment('feature/special', config);

      expect(result).not.toBeNull();
      expect(result!.name).toBe('specific');
      expect(result!.matchType).toBe('exact');
    });

    it('should match ? single character wildcard', () => {
      const config = createConfig({
        env: { git_branches: ['env-?'] },
      });

      expect(resolveEnvironment('env-a', config)?.name).toBe('env');
      expect(resolveEnvironment('env-1', config)?.name).toBe('env');
      expect(resolveEnvironment('env-ab', config)).toBeNull(); // Too many chars
    });
  });

  describe('Fallback to Local Environment', () => {
    it('should fallback to local when no branch matches', () => {
      const config = createConfig({
        local: { git_branches: [] },
        production: { git_branches: ['main'] },
      });

      const result = resolveEnvironment('unknown-branch', config);

      expect(result).not.toBeNull();
      expect(result!.name).toBe('local');
      expect(result!.matchType).toBe('fallback');
    });

    it('should fallback to local when branch is null', () => {
      const config = createConfig({
        local: { project_ref: undefined },
        production: { git_branches: ['main'] },
      });

      const result = resolveEnvironment(null, config);

      expect(result).not.toBeNull();
      expect(result!.name).toBe('local');
      expect(result!.matchType).toBe('fallback');
    });

    it('should return null when no local fallback and no match', () => {
      const config = createConfig({
        production: { git_branches: ['main'] },
      });

      const result = resolveEnvironment('unknown-branch', config);

      expect(result).toBeNull();
    });

    it('should return null when branch is null and no local environment', () => {
      const config = createConfig({
        production: { git_branches: ['main'] },
      });

      const result = resolveEnvironment(null, config);

      expect(result).toBeNull();
    });
  });

  describe('No Match Behavior', () => {
    it('should return null for empty environments', () => {
      const config = createConfig({});

      const result = resolveEnvironment('any-branch', config);

      expect(result).toBeNull();
    });

    it('should return null for unmatched branch without fallback', () => {
      const config = createConfig({
        staging: { git_branches: ['staging'] },
        production: { git_branches: ['main'] },
      });

      const result = resolveEnvironment('feature/something', config);

      expect(result).toBeNull();
    });
  });

  describe('getEnvironmentByName', () => {
    it('should return environment by exact name', () => {
      const config = createConfig({
        staging: { project_ref: 'staging-ref' },
        production: { project_ref: 'prod-ref' },
      });

      const result = getEnvironmentByName('staging', config);

      expect(result).not.toBeNull();
      expect(result!.name).toBe('staging');
      expect(result!.projectRef).toBe('staging-ref');
    });

    it('should return null for non-existent environment', () => {
      const config = createConfig({
        production: { project_ref: 'prod-ref' },
      });

      const result = getEnvironmentByName('nonexistent', config);

      expect(result).toBeNull();
    });
  });

  describe('listEnvironments', () => {
    it('should list all environment names', () => {
      const config = createConfig({
        dev: {},
        staging: {},
        production: {},
      });

      const names = listEnvironments(config);

      expect(names).toHaveLength(3);
      expect(names).toContain('dev');
      expect(names).toContain('staging');
      expect(names).toContain('production');
    });

    it('should return empty array for no environments', () => {
      const config = createConfig({});

      const names = listEnvironments(config);

      expect(names).toEqual([]);
    });
  });

  describe('hasEnvironment', () => {
    it('should return true for existing environment', () => {
      const config = createConfig({
        production: {},
      });

      expect(hasEnvironment('production', config)).toBe(true);
    });

    it('should return false for non-existent environment', () => {
      const config = createConfig({
        production: {},
      });

      expect(hasEnvironment('staging', config)).toBe(false);
    });
  });

  describe('Project Ref Resolution', () => {
    it('should include project_ref in resolved environment', () => {
      const config = createConfig({
        production: {
          project_ref: 'prod-abc123',
          git_branches: ['main'],
        },
      });

      const result = resolveEnvironment('main', config);

      expect(result).not.toBeNull();
      expect(result!.projectRef).toBe('prod-abc123');
    });

    it('should return undefined projectRef if not configured', () => {
      const config = createConfig({
        local: { git_branches: [] },
      });

      const result = resolveEnvironment('any', config);

      expect(result).not.toBeNull();
      expect(result!.projectRef).toBeUndefined();
    });
  });

  describe('resolveEnvironmentByProjectRef', () => {
    it('should resolve environment by matching project_ref', () => {
      const config = createConfig({
        staging: { project_ref: 'staging-ref-123' },
        production: { project_ref: 'prod-ref-456' },
      });

      const result = resolveEnvironmentByProjectRef('staging-ref-123', config);

      expect(result).not.toBeNull();
      expect(result!.name).toBe('staging');
      expect(result!.projectRef).toBe('staging-ref-123');
      expect(result!.matchType).toBe('exact');
    });

    it('should return null for unknown project_ref', () => {
      const config = createConfig({
        staging: { project_ref: 'staging-ref-123' },
        production: { project_ref: 'prod-ref-456' },
      });

      const result = resolveEnvironmentByProjectRef('unknown-ref', config);

      expect(result).toBeNull();
    });

    it('should return null when linkedRef is null', () => {
      const config = createConfig({
        staging: { project_ref: 'staging-ref-123' },
      });

      const result = resolveEnvironmentByProjectRef(null, config);

      expect(result).toBeNull();
    });

    it('should return first matching environment when multiple have same ref', () => {
      // Edge case: multiple environments with same project_ref (shouldn't happen, but test it)
      const config = createConfig({
        env1: { project_ref: 'shared-ref' },
        env2: { project_ref: 'shared-ref' },
      });

      const result = resolveEnvironmentByProjectRef('shared-ref', config);

      expect(result).not.toBeNull();
      expect(result!.name).toBe('env1'); // First wins
    });

    it('should match production environment by project_ref', () => {
      const config = createConfig({
        local: { git_branches: [] },
        staging: { project_ref: 'staging-ref', git_branches: ['staging'] },
        production: { project_ref: 'prod-ref', git_branches: ['main'] },
      });

      const result = resolveEnvironmentByProjectRef('prod-ref', config);

      expect(result).not.toBeNull();
      expect(result!.name).toBe('production');
    });

    it('should return null for empty environments', () => {
      const config = createConfig({});

      const result = resolveEnvironmentByProjectRef('any-ref', config);

      expect(result).toBeNull();
    });

    it('should not match environment without project_ref', () => {
      const config = createConfig({
        local: { git_branches: [] }, // No project_ref
        staging: { project_ref: 'staging-ref' },
      });

      // local has no project_ref, so it shouldn't match anything
      const result = resolveEnvironmentByProjectRef('local', config);
      expect(result).toBeNull();

      // staging has project_ref
      const stagingResult = resolveEnvironmentByProjectRef('staging-ref', config);
      expect(stagingResult).not.toBeNull();
      expect(stagingResult!.name).toBe('staging');
    });
  });
});
