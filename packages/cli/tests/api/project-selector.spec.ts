/**
 * Unit Tests for Project Selector API
 *
 * These tests verify the project selection and display functionality.
 * We mock external dependencies (@clack/prompts, picocolors) to test in isolation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock @clack/prompts
vi.mock('@clack/prompts', () => ({
  spinner: vi.fn(),
  select: vi.fn(),
  isCancel: vi.fn(),
  note: vi.fn(),
}));

// Mock picocolors
vi.mock('picocolors', () => ({
  default: {
    green: vi.fn((str: string) => `[green]${str}[/green]`),
    yellow: vi.fn((str: string) => `[yellow]${str}[/yellow]`),
    red: vi.fn((str: string) => `[red]${str}[/red]`),
    dim: vi.fn((str: string) => `[dim]${str}[/dim]`),
    bold: vi.fn((str: string) => `[bold]${str}[/bold]`),
    cyan: vi.fn((str: string) => `[cyan]${str}[/cyan]`),
  },
}));

import * as p from '@clack/prompts';
import pc from 'picocolors';
import type { Project, SupabaseManagementClient } from '../../src/api/supabase-client.js';
import {
  fetchAndDisplayProjects,
  displayProjectSummary,
  filterProjects,
} from '../../src/api/project-selector.js';

const mockSpinner = vi.mocked(p.spinner);
const mockSelect = vi.mocked(p.select);
const mockIsCancel = vi.mocked(p.isCancel);
const mockNote = vi.mocked(p.note);

// Helper to create mock projects
function createMockProject(overrides?: Partial<Project>): Project {
  return {
    id: 'test-project-ref',
    organization_id: 'org-123',
    name: 'Test Project',
    region: 'us-east-1',
    created_at: '2024-01-15T10:30:00Z',
    status: 'ACTIVE_HEALTHY',
    database: {
      host: 'db.example.com',
      version: '15.1',
    },
    ...overrides,
  };
}

// Helper to create mock client
function createMockClient(): SupabaseManagementClient {
  return {
    getProjects: vi.fn(),
  } as unknown as SupabaseManagementClient;
}

describe('Project Selector', () => {
  let mockConsoleLog: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('fetchAndDisplayProjects', () => {
    it('should fetch projects and display interactive selector', async () => {
      // Arrange
      const mockClient = createMockClient();
      const projects = [
        createMockProject({ id: 'proj-1', name: 'Project A' }),
        createMockProject({ id: 'proj-2', name: 'Project B' }),
      ];

      const mockSpinnerInstance = {
        start: vi.fn(),
        stop: vi.fn(),
      };

      vi.mocked(mockClient.getProjects).mockResolvedValue(projects);
      mockSpinner.mockReturnValue(mockSpinnerInstance);
      mockSelect.mockResolvedValue('proj-1');
      mockIsCancel.mockReturnValue(false);

      // Act
      const result = await fetchAndDisplayProjects(mockClient);

      // Assert
      expect(mockSpinnerInstance.start).toHaveBeenCalledWith('Fetching your Supabase projects...');
      expect(mockSpinnerInstance.stop).toHaveBeenCalledWith('Found projects');
      expect(mockSelect).toHaveBeenCalled();
      expect(result).toBe('proj-1');
    });

    it('should return null when user cancels selection', async () => {
      // Arrange
      const mockClient = createMockClient();
      const projects = [createMockProject()];

      const mockSpinnerInstance = {
        start: vi.fn(),
        stop: vi.fn(),
      };

      vi.mocked(mockClient.getProjects).mockResolvedValue(projects);
      mockSpinner.mockReturnValue(mockSpinnerInstance);
      mockSelect.mockResolvedValue(Symbol('cancel'));
      mockIsCancel.mockReturnValue(true);

      // Act
      const result = await fetchAndDisplayProjects(mockClient);

      // Assert
      expect(result).toBeNull();
    });

    it('should return null when user selects skip option', async () => {
      // Arrange
      const mockClient = createMockClient();
      const projects = [createMockProject()];

      const mockSpinnerInstance = {
        start: vi.fn(),
        stop: vi.fn(),
      };

      vi.mocked(mockClient.getProjects).mockResolvedValue(projects);
      mockSpinner.mockReturnValue(mockSpinnerInstance);
      mockSelect.mockResolvedValue('__skip__');
      mockIsCancel.mockReturnValue(false);

      // Act
      const result = await fetchAndDisplayProjects(mockClient);

      // Assert
      expect(result).toBeNull();
    });

    it('should display note when no projects found', async () => {
      // Arrange
      const mockClient = createMockClient();

      const mockSpinnerInstance = {
        start: vi.fn(),
        stop: vi.fn(),
      };

      vi.mocked(mockClient.getProjects).mockResolvedValue([]);
      mockSpinner.mockReturnValue(mockSpinnerInstance);

      // Act
      const result = await fetchAndDisplayProjects(mockClient);

      // Assert
      expect(mockNote).toHaveBeenCalledWith(
        expect.stringContaining('No projects found'),
        'No projects'
      );
      expect(result).toBeNull();
    });

    it('should throw error when fetching projects fails', async () => {
      // Arrange
      const mockClient = createMockClient();
      const error = new Error('API Error');

      const mockSpinnerInstance = {
        start: vi.fn(),
        stop: vi.fn(),
      };

      vi.mocked(mockClient.getProjects).mockRejectedValue(error);
      mockSpinner.mockReturnValue(mockSpinnerInstance);

      // Act & Assert
      await expect(fetchAndDisplayProjects(mockClient)).rejects.toThrow('API Error');
      expect(mockSpinnerInstance.stop).toHaveBeenCalledWith('Failed to fetch projects');
    });

    it('should sort projects with active healthy first, then by name', async () => {
      // Arrange
      const mockClient = createMockClient();
      const projects = [
        createMockProject({ id: 'proj-1', name: 'Zebra', status: 'PAUSED' }),
        createMockProject({ id: 'proj-2', name: 'Alpha', status: 'ACTIVE_HEALTHY' }),
        createMockProject({ id: 'proj-3', name: 'Beta', status: 'ACTIVE_HEALTHY' }),
        createMockProject({ id: 'proj-4', name: 'Charlie', status: 'PAUSED' }),
      ];

      const mockSpinnerInstance = {
        start: vi.fn(),
        stop: vi.fn(),
      };

      vi.mocked(mockClient.getProjects).mockResolvedValue(projects);
      mockSpinner.mockReturnValue(mockSpinnerInstance);
      mockSelect.mockResolvedValue('proj-2');
      mockIsCancel.mockReturnValue(false);

      // Act
      await fetchAndDisplayProjects(mockClient);

      // Assert
      const selectCall = mockSelect.mock.calls[0][0];
      const selectOptions = selectCall.options;

      // First two should be active healthy (sorted by name: Alpha, Beta)
      expect(selectOptions[0].value).toBe('proj-2'); // Alpha (ACTIVE_HEALTHY)
      expect(selectOptions[1].value).toBe('proj-3'); // Beta (ACTIVE_HEALTHY)
      // Then paused projects (sorted by name: Charlie, Zebra)
      expect(selectOptions[2].value).toBe('proj-4'); // Charlie (PAUSED)
      expect(selectOptions[3].value).toBe('proj-1'); // Zebra (PAUSED)
      // Last should be skip option
      expect(selectOptions[4].value).toBe('__skip__');
    });

    it('should include skip option in selection list', async () => {
      // Arrange
      const mockClient = createMockClient();
      const projects = [createMockProject()];

      const mockSpinnerInstance = {
        start: vi.fn(),
        stop: vi.fn(),
      };

      vi.mocked(mockClient.getProjects).mockResolvedValue(projects);
      mockSpinner.mockReturnValue(mockSpinnerInstance);
      mockSelect.mockResolvedValue('proj-1');
      mockIsCancel.mockReturnValue(false);

      // Act
      await fetchAndDisplayProjects(mockClient);

      // Assert
      const selectCall = mockSelect.mock.calls[0][0];
      const options = selectCall.options;
      const skipOption = options.find((opt) => opt.value === '__skip__');

      expect(skipOption).toBeDefined();
      expect(skipOption?.label).toContain('Skip');
      expect(skipOption?.hint).toContain('supacontrol.toml');
    });

    it('should format project labels with status colors', async () => {
      // Arrange
      const mockClient = createMockClient();
      const projects = [
        createMockProject({ id: 'proj-1', name: 'Active', status: 'ACTIVE_HEALTHY' }),
        createMockProject({ id: 'proj-2', name: 'Paused', status: 'PAUSED' }),
        createMockProject({ id: 'proj-3', name: 'Unhealthy', status: 'ACTIVE_UNHEALTHY' }),
      ];

      const mockSpinnerInstance = {
        start: vi.fn(),
        stop: vi.fn(),
      };

      vi.mocked(mockClient.getProjects).mockResolvedValue(projects);
      mockSpinner.mockReturnValue(mockSpinnerInstance);
      mockSelect.mockResolvedValue('proj-1');
      mockIsCancel.mockReturnValue(false);

      // Act
      await fetchAndDisplayProjects(mockClient);

      // Assert
      // Check that color functions were called
      expect(pc.green).toHaveBeenCalled();
      expect(pc.yellow).toHaveBeenCalled();
      expect(pc.red).toHaveBeenCalled();
      expect(pc.dim).toHaveBeenCalled();
    });

    it('should include project hints with ref and creation date', async () => {
      // Arrange
      const mockClient = createMockClient();
      const projects = [
        createMockProject({
          id: 'test-ref-123',
          created_at: '2024-01-15T10:30:00Z',
        }),
      ];

      const mockSpinnerInstance = {
        start: vi.fn(),
        stop: vi.fn(),
      };

      vi.mocked(mockClient.getProjects).mockResolvedValue(projects);
      mockSpinner.mockReturnValue(mockSpinnerInstance);
      mockSelect.mockResolvedValue('test-ref-123');
      mockIsCancel.mockReturnValue(false);

      // Act
      await fetchAndDisplayProjects(mockClient);

      // Assert
      const selectCall = mockSelect.mock.calls[0][0];
      const options = selectCall.options;
      const projectOption = options[0];

      expect(projectOption.hint).toContain('test-ref-123');
      expect(projectOption.hint).toContain('created');
    });
  });

  describe('displayProjectSummary', () => {
    it('should display project summary with all details', () => {
      // Arrange
      const project = createMockProject({
        name: 'My Project',
        id: 'proj-123',
        region: 'us-east-1',
        status: 'ACTIVE_HEALTHY',
        created_at: '2024-01-15T10:30:00Z',
        database: {
          host: 'db.example.com',
          version: '15.1',
        },
      });

      // Act
      displayProjectSummary(project);

      // Assert
      expect(mockConsoleLog).toHaveBeenCalledWith();
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('Selected project'));
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('My Project'));
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('proj-123'));
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('us-east-1'));
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('db.example.com'));
    });

    it('should display active status in green', () => {
      // Arrange
      const project = createMockProject({ status: 'ACTIVE_HEALTHY' });

      // Act
      displayProjectSummary(project);

      // Assert
      expect(pc.green).toHaveBeenCalledWith('Active');
    });

    it('should display paused status in yellow', () => {
      // Arrange
      const project = createMockProject({ status: 'PAUSED' });

      // Act
      displayProjectSummary(project);

      // Assert
      expect(pc.yellow).toHaveBeenCalledWith('Paused');
    });

    it('should display other statuses in red', () => {
      // Arrange
      const project = createMockProject({ status: 'ACTIVE_UNHEALTHY' });

      // Act
      displayProjectSummary(project);

      // Assert
      expect(pc.red).toHaveBeenCalledWith('ACTIVE_UNHEALTHY');
    });

    it('should not display database host when not available', () => {
      // Arrange
      const project = createMockProject({ database: undefined });

      // Act
      displayProjectSummary(project);

      // Assert
      const consoleCalls = mockConsoleLog.mock.calls.map((call) => call[0]);
      const hasDbHost = consoleCalls.some((call) =>
        typeof call === 'string' && call.includes('DB Host')
      );
      expect(hasDbHost).toBe(false);
    });

    it('should format date correctly', () => {
      // Arrange
      const project = createMockProject({ created_at: '2024-01-15T10:30:00Z' });

      // Act
      displayProjectSummary(project);

      // Assert
      const consoleCalls = mockConsoleLog.mock.calls.map((call) => call[0]);
      const hasFormattedDate = consoleCalls.some((call) =>
        typeof call === 'string' && (call.includes('Jan 15, 2024') || call.includes('1/15/2024'))
      );
      expect(hasFormattedDate).toBe(true);
    });

    it('should use cyan color for labels', () => {
      // Arrange
      const project = createMockProject();

      // Act
      displayProjectSummary(project);

      // Assert
      expect(pc.cyan).toHaveBeenCalledWith('Name:');
      expect(pc.cyan).toHaveBeenCalledWith('Ref:');
      expect(pc.cyan).toHaveBeenCalledWith('Region:');
      expect(pc.cyan).toHaveBeenCalledWith('Status:');
      expect(pc.cyan).toHaveBeenCalledWith('Created:');
    });

    it('should use dim color for database host', () => {
      // Arrange
      const project = createMockProject({
        database: {
          host: 'db.example.com',
          version: '15.1',
        },
      });

      // Act
      displayProjectSummary(project);

      // Assert
      expect(pc.dim).toHaveBeenCalledWith('db.example.com');
    });
  });

  describe('filterProjects', () => {
    it('should filter projects by name', () => {
      // Arrange
      const projects = [
        createMockProject({ id: 'proj-1', name: 'Production Database' }),
        createMockProject({ id: 'proj-2', name: 'Staging Database' }),
        createMockProject({ id: 'proj-3', name: 'Development App' }),
      ];

      // Act
      const result = filterProjects(projects, 'Database');

      // Assert
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('proj-1');
      expect(result[1].id).toBe('proj-2');
    });

    it('should filter projects by ref (id)', () => {
      // Arrange
      const projects = [
        createMockProject({ id: 'abc-123', name: 'Project A' }),
        createMockProject({ id: 'def-456', name: 'Project B' }),
        createMockProject({ id: 'abc-789', name: 'Project C' }),
      ];

      // Act
      const result = filterProjects(projects, 'abc');

      // Assert
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('abc-123');
      expect(result[1].id).toBe('abc-789');
    });

    it('should be case-insensitive', () => {
      // Arrange
      const projects = [
        createMockProject({ id: 'proj-1', name: 'Production' }),
        createMockProject({ id: 'proj-2', name: 'Staging' }),
      ];

      // Act
      const result1 = filterProjects(projects, 'PRODUCTION');
      const result2 = filterProjects(projects, 'production');
      const result3 = filterProjects(projects, 'PrOdUcTiOn');

      // Assert
      expect(result1).toHaveLength(1);
      expect(result2).toHaveLength(1);
      expect(result3).toHaveLength(1);
      expect(result1[0].id).toBe('proj-1');
    });

    it('should return empty array when no matches found', () => {
      // Arrange
      const projects = [
        createMockProject({ id: 'proj-1', name: 'Production' }),
        createMockProject({ id: 'proj-2', name: 'Staging' }),
      ];

      // Act
      const result = filterProjects(projects, 'NonExistent');

      // Assert
      expect(result).toHaveLength(0);
    });

    it('should return all projects when query is empty', () => {
      // Arrange
      const projects = [
        createMockProject({ id: 'proj-1', name: 'Production' }),
        createMockProject({ id: 'proj-2', name: 'Staging' }),
        createMockProject({ id: 'proj-3', name: 'Development' }),
      ];

      // Act
      const result = filterProjects(projects, '');

      // Assert
      expect(result).toHaveLength(3);
    });

    it('should match partial names', () => {
      // Arrange
      const projects = [
        createMockProject({ id: 'proj-1', name: 'My Production App' }),
        createMockProject({ id: 'proj-2', name: 'Production Database' }),
        createMockProject({ id: 'proj-3', name: 'Staging' }),
      ];

      // Act
      const result = filterProjects(projects, 'Prod');

      // Assert
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('proj-1');
      expect(result[1].id).toBe('proj-2');
    });

    it('should match partial refs', () => {
      // Arrange
      const projects = [
        createMockProject({ id: 'abcdef123456', name: 'Project A' }),
        createMockProject({ id: 'abcxyz789012', name: 'Project B' }),
        createMockProject({ id: 'xyzdef345678', name: 'Project C' }),
      ];

      // Act
      const result = filterProjects(projects, 'def');

      // Assert
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('abcdef123456');
      expect(result[1].id).toBe('xyzdef345678');
    });

    it('should not modify original array', () => {
      // Arrange
      const projects = [
        createMockProject({ id: 'proj-1', name: 'Production' }),
        createMockProject({ id: 'proj-2', name: 'Staging' }),
      ];
      const originalLength = projects.length;

      // Act
      filterProjects(projects, 'Production');

      // Assert
      expect(projects).toHaveLength(originalLength);
    });

    it('should handle special characters in query', () => {
      // Arrange
      const projects = [
        createMockProject({ id: 'proj-1', name: 'My-Project' }),
        createMockProject({ id: 'proj-2', name: 'My_Project' }),
        createMockProject({ id: 'proj-3', name: 'MyProject' }),
      ];

      // Act
      const result = filterProjects(projects, 'My-');

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('proj-1');
    });
  });

  describe('edge cases', () => {
    it('should handle projects with minimal data', async () => {
      // Arrange
      const mockClient = createMockClient();
      const minimalProject: Project = {
        id: 'minimal-ref',
        organization_id: 'org-123',
        name: 'Minimal',
        region: 'us-east-1',
        created_at: '2024-01-15T10:30:00Z',
        status: 'ACTIVE_HEALTHY',
      };

      const mockSpinnerInstance = {
        start: vi.fn(),
        stop: vi.fn(),
      };

      vi.mocked(mockClient.getProjects).mockResolvedValue([minimalProject]);
      mockSpinner.mockReturnValue(mockSpinnerInstance);
      mockSelect.mockResolvedValue('minimal-ref');
      mockIsCancel.mockReturnValue(false);

      // Act
      const result = await fetchAndDisplayProjects(mockClient);

      // Assert
      expect(result).toBe('minimal-ref');
    });

    it('should handle projects with special characters in names', async () => {
      // Arrange
      const mockClient = createMockClient();
      const projects = [
        createMockProject({
          id: 'proj-1',
          name: 'Project (2024) - Test & Demo',
        }),
      ];

      const mockSpinnerInstance = {
        start: vi.fn(),
        stop: vi.fn(),
      };

      vi.mocked(mockClient.getProjects).mockResolvedValue(projects);
      mockSpinner.mockReturnValue(mockSpinnerInstance);
      mockSelect.mockResolvedValue('proj-1');
      mockIsCancel.mockReturnValue(false);

      // Act
      const result = await fetchAndDisplayProjects(mockClient);

      // Assert
      expect(result).toBe('proj-1');
    });

    it('should handle very long project names', () => {
      // Arrange
      const longName = 'A'.repeat(100);
      const project = createMockProject({ name: longName });

      // Act
      displayProjectSummary(project);

      // Assert
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining(longName));
    });

    it('should handle multiple projects with same name but different refs', () => {
      // Arrange
      const projects = [
        createMockProject({ id: 'ref-1', name: 'Duplicate' }),
        createMockProject({ id: 'ref-2', name: 'Duplicate' }),
      ];

      // Act
      const result = filterProjects(projects, 'Duplicate');

      // Assert
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('ref-1');
      expect(result[1].id).toBe('ref-2');
    });

    it('should handle projects with different status values', async () => {
      // Arrange
      const mockClient = createMockClient();
      const projects = [
        createMockProject({ id: 'proj-1', status: 'COMING_UP' }),
        createMockProject({ id: 'proj-2', status: 'GOING_DOWN' }),
        createMockProject({ id: 'proj-3', status: 'RESTORING' }),
      ];

      const mockSpinnerInstance = {
        start: vi.fn(),
        stop: vi.fn(),
      };

      vi.mocked(mockClient.getProjects).mockResolvedValue(projects);
      mockSpinner.mockReturnValue(mockSpinnerInstance);
      mockSelect.mockResolvedValue('proj-1');
      mockIsCancel.mockReturnValue(false);

      // Act
      const result = await fetchAndDisplayProjects(mockClient);

      // Assert
      expect(result).toBe('proj-1');
      expect(pc.red).toHaveBeenCalled();
    });
  });
});
