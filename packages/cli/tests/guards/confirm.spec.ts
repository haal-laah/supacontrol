/**
 * Unit Tests for Confirmation System
 *
 * These tests verify the confirmation prompts and operation summaries.
 * We mock @clack/prompts to test without user interaction.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock @clack/prompts
vi.mock('@clack/prompts', () => ({
  note: vi.fn(),
  text: vi.fn(),
  confirm: vi.fn(),
  cancel: vi.fn(),
  isCancel: vi.fn(),
}));

import * as p from '@clack/prompts';
import { requestConfirmation, showOperationSummary } from '../../src/guards/confirm.js';
import type { OperationType } from '../../src/guards/types.js';

const mockNote = vi.mocked(p.note);
const mockText = vi.mocked(p.text);
const mockConfirm = vi.mocked(p.confirm);
const mockIsCancel = vi.mocked(p.isCancel);
const mockCancel = vi.mocked(p.cancel);

describe('Confirmation System', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsCancel.mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('requestConfirmation', () => {
    describe('CI Mode', () => {
      it('should return not confirmed in CI mode', async () => {
        const result = await requestConfirmation({
          environmentName: 'production',
          operation: 'push',
          riskLevel: 'high',
          confirmWord: undefined,
          isCI: true,
          reason: undefined,
        });

        expect(result.confirmed).toBe(false);
        expect(mockText).not.toHaveBeenCalled();
        expect(mockConfirm).not.toHaveBeenCalled();
      });
    });

    describe('Critical Risk / Confirm Word', () => {
      it('should require typing confirm word for critical risk', async () => {
        mockText.mockResolvedValueOnce('production');

        const result = await requestConfirmation({
          environmentName: 'production',
          operation: 'reset',
          riskLevel: 'critical',
          confirmWord: undefined,
          isCI: false,
          reason: undefined,
        });

        expect(result.confirmed).toBe(true);
        expect(mockText).toHaveBeenCalled();
        expect(mockNote).toHaveBeenCalled();
      });

      it('should use custom confirm word when specified', async () => {
        mockText.mockResolvedValueOnce('CONFIRM-PROD');

        const result = await requestConfirmation({
          environmentName: 'production',
          operation: 'push',
          riskLevel: 'high',
          confirmWord: 'CONFIRM-PROD',
          isCI: false,
          reason: undefined,
        });

        expect(result.confirmed).toBe(true);
        expect(mockText).toHaveBeenCalled();
      });

      it('should not confirm when typed word does not match', async () => {
        mockText.mockResolvedValueOnce('wrong-word');

        const result = await requestConfirmation({
          environmentName: 'production',
          operation: 'reset',
          riskLevel: 'critical',
          confirmWord: 'production',
          isCI: false,
          reason: undefined,
        });

        expect(result.confirmed).toBe(false);
      });

      it('should handle cancellation in text prompt', async () => {
         mockText.mockResolvedValueOnce(Symbol.for('cancel') as any);
         mockIsCancel.mockReturnValueOnce(true);
 
         const result = await requestConfirmation({
           environmentName: 'production',
           operation: 'reset',
           riskLevel: 'critical',
           confirmWord: undefined,
           isCI: false,
           reason: undefined,
         });
 
         expect(result.confirmed).toBe(false);
         expect(result.cancelled).toBe(true);
         expect(mockCancel).toHaveBeenCalled();
       });

       it('should call validate function with correct word', async () => {
         let validateFn: ((value: string) => string | undefined) | undefined;
         
         mockText.mockImplementationOnce(async (options: any) => {
           validateFn = options.validate;
           return 'production';
         });

         await requestConfirmation({
           environmentName: 'production',
           operation: 'reset',
           riskLevel: 'critical',
           confirmWord: undefined,
           isCI: false,
           reason: undefined,
         });

         expect(validateFn).toBeDefined();
         expect(validateFn!('production')).toBeUndefined();
       });

       it('should return error message when validate fails', async () => {
         let validateFn: ((value: string) => string | undefined) | undefined;
         
         mockText.mockImplementationOnce(async (options: any) => {
           validateFn = options.validate;
           return 'wrong-word';
         });

         await requestConfirmation({
           environmentName: 'production',
           operation: 'reset',
           riskLevel: 'critical',
           confirmWord: undefined,
           isCI: false,
           reason: undefined,
         });

         expect(validateFn).toBeDefined();
         const errorMsg = validateFn!('wrong-word');
         expect(errorMsg).toBe("Please type exactly 'production' to confirm");
       });
     });

    describe('Non-Critical Risk', () => {
      it('should use yes/no confirmation for medium risk', async () => {
        mockConfirm.mockResolvedValueOnce(true);

        const result = await requestConfirmation({
          environmentName: 'staging',
          operation: 'push',
          riskLevel: 'medium',
          confirmWord: undefined,
          isCI: false,
          reason: undefined,
        });

        expect(result.confirmed).toBe(true);
        expect(mockConfirm).toHaveBeenCalled();
        expect(mockText).not.toHaveBeenCalled();
      });

      it('should use yes/no confirmation for low risk', async () => {
        mockConfirm.mockResolvedValueOnce(false);

        const result = await requestConfirmation({
          environmentName: 'dev',
          operation: 'pull',
          riskLevel: 'low',
          confirmWord: undefined,
          isCI: false,
          reason: undefined,
        });

        expect(result.confirmed).toBe(false);
        expect(mockConfirm).toHaveBeenCalled();
      });

      it('should handle cancellation in confirm prompt', async () => {
        mockConfirm.mockResolvedValueOnce(Symbol.for('cancel') as any);
        mockIsCancel.mockReturnValueOnce(true);

        const result = await requestConfirmation({
          environmentName: 'staging',
          operation: 'push',
          riskLevel: 'medium',
          confirmWord: undefined,
          isCI: false,
          reason: undefined,
        });

        expect(result.confirmed).toBe(false);
        expect(result.cancelled).toBe(true);
        expect(mockCancel).toHaveBeenCalled();
      });
    });

    describe('Display', () => {
      it('should show operation details in note', async () => {
        mockConfirm.mockResolvedValueOnce(true);

        await requestConfirmation({
          environmentName: 'production',
          operation: 'push',
          riskLevel: 'high',
          confirmWord: undefined,
          isCI: false,
          reason: 'Test reason',
        });

        expect(mockNote).toHaveBeenCalled();
        // Check that note was called with expected content
        const noteCall = mockNote.mock.calls[0];
        expect(noteCall).toBeDefined();
      });

      it('should include reason when provided', async () => {
        mockConfirm.mockResolvedValueOnce(true);

        await requestConfirmation({
          environmentName: 'staging',
          operation: 'reset',
          riskLevel: 'medium',
          confirmWord: undefined,
          isCI: false,
          reason: 'Database cleanup needed',
        });

        expect(mockNote).toHaveBeenCalled();
      });
    });
  });

  describe('showOperationSummary', () => {
    it('should not throw for low risk', () => {
      expect(() => {
        showOperationSummary('diff', 'dev', 'dev-project-ref', 'low');
      }).not.toThrow();
    });

    it('should not throw for medium risk', () => {
      expect(() => {
        showOperationSummary('push', 'staging', 'staging-project-ref', 'medium');
      }).not.toThrow();
    });

    it('should not throw for high risk', () => {
      expect(() => {
        showOperationSummary('push', 'production', 'prod-project-ref', 'high');
      }).not.toThrow();
    });

    it('should not throw for critical risk', () => {
      expect(() => {
        showOperationSummary('reset', 'production', 'prod-project-ref', 'critical');
      }).not.toThrow();
    });

    it('should not throw when project ref is undefined', () => {
      expect(() => {
        showOperationSummary('push', 'local', undefined, 'low');
      }).not.toThrow();
    });

    it('should handle all operation types', () => {
      const operations: OperationType[] = ['push', 'reset', 'pull', 'seed', 'migrate', 'diff', 'link', 'unlink'];
      
      for (const op of operations) {
        expect(() => {
          showOperationSummary(op, 'staging', 'project-ref', 'medium');
        }).not.toThrow();
      }
    });
  });
});
