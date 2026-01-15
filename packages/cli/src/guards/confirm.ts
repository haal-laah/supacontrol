import * as p from '@clack/prompts';
import pc from 'picocolors';
import type { RiskLevel, OperationType } from './types.js';

/**
 * Risk level colors and labels
 */
const RISK_DISPLAY: Record<RiskLevel, { color: (s: string) => string; label: string }> = {
  low: { color: pc.blue, label: 'Low Risk' },
  medium: { color: pc.yellow, label: 'Medium Risk' },
  high: { color: pc.red, label: 'High Risk' },
  critical: { color: (s) => pc.bold(pc.red(s)), label: 'CRITICAL RISK' },
};

/**
 * Operation descriptions for confirmation prompts
 */
const OPERATION_DESCRIPTIONS: Record<OperationType, string> = {
  push: 'Push local migrations to the remote database',
  reset: 'Reset the remote database to match local migrations',
  pull: 'Pull remote schema changes to local migrations',
  seed: 'Run seed data on the remote database',
  migrate: 'Run database migrations',
  diff: 'Show differences between local and remote schemas',
  link: 'Link to a Supabase project',
  unlink: 'Unlink from the current Supabase project',
};

/**
 * Options for confirmation request
 */
export interface ConfirmationOptions {
  environmentName: string;
  operation: OperationType;
  riskLevel: RiskLevel;
  confirmWord: string | undefined;
  isCI: boolean;
  reason: string | undefined;
}

/**
 * Result of confirmation request
 */
export interface ConfirmationResult {
  confirmed: boolean;
  cancelled?: boolean;
}

/**
 * Request user confirmation for an operation
 */
export async function requestConfirmation(
  options: ConfirmationOptions
): Promise<ConfirmationResult> {
  const { environmentName, operation, riskLevel, confirmWord, isCI, reason } = options;

  const riskDisplay = RISK_DISPLAY[riskLevel];
  const description = OPERATION_DESCRIPTIONS[operation] ?? operation;

  // In CI mode, we can't prompt - just fail
  if (isCI) {
    console.error(pc.red('\u2717'), 'Cannot confirm interactively in CI mode');
    console.error(
      pc.dim('  Use --i-know-what-im-doing flag to bypass confirmation')
    );
    return { confirmed: false };
  }

  // Show warning box
  p.note(
    [
      riskDisplay.color(`${riskDisplay.label}`),
      '',
      `Operation: ${pc.bold(operation)}`,
      `Environment: ${pc.bold(environmentName)}`,
      `Description: ${description}`,
      reason ? `\nReason: ${reason}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    riskDisplay.color('\u26A0 Confirmation Required')
  );

  // For critical operations, require typing the confirm word
  if (riskLevel === 'critical' || confirmWord) {
    const word = confirmWord ?? environmentName;

    const response = await p.text({
      message: `Type '${pc.bold(word)}' to confirm:`,
      placeholder: word,
      validate(value) {
        if (value !== word) {
          return `Please type exactly '${word}' to confirm`;
        }
        return undefined;
      },
    });

    if (p.isCancel(response)) {
      p.cancel('Operation cancelled');
      return { confirmed: false, cancelled: true };
    }

    return { confirmed: response === word };
  }

  // For non-critical, just yes/no
  const confirmed = await p.confirm({
    message: 'Do you want to proceed?',
    initialValue: false,
  });

  if (p.isCancel(confirmed)) {
    p.cancel('Operation cancelled');
    return { confirmed: false, cancelled: true };
  }

  return { confirmed };
}

/**
 * Show a summary of the operation before executing
 */
export function showOperationSummary(
  operation: OperationType,
  environmentName: string,
  projectRef: string | undefined,
  riskLevel: RiskLevel
): void {
  const riskDisplay = RISK_DISPLAY[riskLevel];

  console.log();
  console.log(
    pc.blue('\u2192'),
    pc.bold(operation),
    'on',
    riskDisplay.color(environmentName)
  );

  if (projectRef) {
    console.log(pc.dim(`  Project: ${projectRef}`));
  }

  console.log(pc.dim(`  Risk: ${riskDisplay.label}`));
  console.log();
}
