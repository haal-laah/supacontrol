# Contributing to SupaControl

Thank you for your interest in contributing to SupaControl! This document provides guidelines and instructions for contributing.

## Code of Conduct

Be respectful and constructive. We're all here to build something useful.

## Getting Started

### Prerequisites

- Node.js 18+
- pnpm 9+
- Supabase CLI (for integration testing)
- Git

### Setup

```bash
# Clone the repository
git clone https://github.com/supacontrol/supacontrol.git
cd supacontrol

# Install dependencies
pnpm install

# Build
pnpm build

# Run tests
pnpm test
```

### Project Structure

```
supacontrol/
├── packages/
│   └── cli/                    # @supacontrol/cli package
│       ├── src/
│       │   ├── index.ts        # CLI entry point
│       │   ├── commands/       # CLI commands
│       │   ├── config/         # Config loading and validation
│       │   ├── guards/         # Safety guards
│       │   ├── api/            # Supabase Management API
│       │   ├── auth/           # Credential storage
│       │   └── utils/          # Shared utilities
│       └── tests/
│           ├── fixtures/       # Test fixtures (checksum protected)
│           └── ...
├── .github/workflows/          # CI/CD
└── README.md
```

## Development Workflow

### Making Changes

1. **Create a branch** from `develop`:
   ```bash
   git checkout develop
   git pull origin develop
   git checkout -b feat/your-feature
   # or
   git checkout -b fix/your-bugfix
   ```

2. **Make your changes** following our coding standards

3. **Run quality checks**:
   ```bash
   pnpm lint        # Check code style
   pnpm typecheck   # Check types
   pnpm test        # Run tests
   pnpm build       # Build the project
   ```

4. **Commit your changes** using conventional commits:
   ```bash
   git commit -m "feat(cli): add new safety guard"
   git commit -m "fix(config): handle missing TOML gracefully"
   ```

### Commit Message Format

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): description

[optional body]

[optional footer]
```

**Types:**
- `feat` - New feature
- `fix` - Bug fix
- `docs` - Documentation only
- `test` - Adding/updating tests
- `refactor` - Code change that neither fixes a bug nor adds a feature
- `chore` - Maintenance tasks

**Scopes:**
- `cli` - CLI entry point
- `config` - Configuration loading
- `guards` - Safety guards
- `commands` - CLI commands
- `api` - Supabase API integration
- `auth` - Authentication/credentials

### Pull Requests

1. Push your branch to GitHub
2. Open a Pull Request against `develop` (not `main`)
3. Fill out the PR template
4. Wait for CI to pass
5. Request review

> **Note**: The `main` branch is reserved for releases. All feature and fix PRs should target `develop`.

## Testing

### Running Tests

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run with coverage
pnpm test:coverage
```

### Test Fixtures

Test fixtures in `packages/cli/tests/fixtures/` are **protected by SHA256 checksums**.

**CRITICAL**: If a test fails:
1. **DO NOT** modify the fixture files
2. **DO** fix the implementation in `src/`
3. If the expected behavior genuinely changed, update fixtures and regenerate checksums:
   ```bash
   pnpm verify-fixtures --update
   ```

### Guard Tests

Tests in `tests/guards/` verify **safety-critical behavior**. These tests exist because they prevent real production data loss. Treat them with extreme care.

## Code Style

### TypeScript Guidelines

```typescript
// Use explicit types for function parameters and return types
function checkLock(config: EnvironmentConfig): GuardResult {
  // ...
}

// Use Zod for runtime validation
const ConfigSchema = z.object({
  settings: SettingsSchema,
  environments: z.record(EnvironmentSchema),
});

// Export types derived from Zod schemas
export type Config = z.infer<typeof ConfigSchema>;
```

### CLI Output

Use consistent formatting with `picocolors`:

```typescript
import pc from 'picocolors';

// Status indicators
console.log(pc.green('✓'), 'Success message');
console.log(pc.yellow('⚠'), 'Warning message');
console.log(pc.red('✗'), 'Error message');
console.log(pc.blue('→'), 'Action in progress');
console.log(pc.dim('  Hint text'));
```

### Error Handling

Provide helpful error messages with actionable suggestions:

```typescript
if (!config) {
  console.error(pc.red('✗'), 'No supacontrol.toml found');
  console.error(pc.dim('  Run `supacontrol init` to create one'));
  process.exit(1);
}
```

## Adding New Commands

1. Create a new file in `packages/cli/src/commands/`
2. Export a `createXxxCommand()` function that returns a `Command`
3. Register it in `packages/cli/src/index.ts`
4. Add tests in `packages/cli/tests/commands/`
5. Update documentation

Example:

```typescript
// src/commands/my-command.ts
import { Command } from 'commander';
import { withErrorHandling } from '../index.js';

async function myCommandAction(): Promise<void> {
  // Implementation
}

export function createMyCommand(): Command {
  return new Command('my-command')
    .description('Description of my command')
    .option('-f, --flag', 'Some flag')
    .action(withErrorHandling(myCommandAction));
}
```

## Adding New Guards

Guards are safety checks that run before destructive operations.

1. Create a new file in `packages/cli/src/guards/`
2. Implement the `Guard` interface
3. Register it in the guard runner
4. Add comprehensive tests

```typescript
// src/guards/my-guard.ts
import type { GuardContext, GuardResult } from './types.js';

export function checkMyGuard(context: GuardContext): GuardResult {
  // Return { passed: true } or { passed: false, error, suggestions }
}
```

## Questions?

- Open an issue for bugs or feature requests
- Start a discussion for questions or ideas

Thank you for contributing!
