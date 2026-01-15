# Agent Instructions for SupaControl

This project uses **bd** (beads) for issue tracking and coordination between concurrent agents.

## Project Overview

**@supacontrol/cli** - A CLI wrapper around Supabase CLI that adds safety guards, environment management, and confirmation prompts to prevent accidental production database operations.

### Tech Stack
- **Language**: TypeScript (strict mode)
- **Runtime**: Node.js >= 18
- **Package Manager**: pnpm (monorepo)
- **CLI Framework**: Commander.js
- **Prompts**: @clack/prompts
- **Config Format**: TOML (smol-toml parser)
- **Validation**: Zod
- **Testing**: Vitest
- **Bundler**: tsup

### Project Structure

```
supacontrol/
├── packages/
│   └── cli/                    # @supacontrol/cli
│       ├── src/
│       │   ├── index.ts        # CLI entry point
│       │   ├── commands/       # CLI commands (init, push, reset, etc.)
│       │   ├── config/         # TOML loader, schema, resolver
│       │   ├── guards/         # Safety checks (lock, operation, project, git)
│       │   ├── api/            # Supabase Management API client
│       │   ├── auth/           # Credential storage
│       │   └── utils/          # Git helpers, Supabase CLI wrapper
│       ├── tests/
│       │   ├── fixtures/       # DO NOT MODIFY - checksum protected
│       │   ├── config/         # Config loader/resolver tests
│       │   ├── guards/         # CRITICAL safety tests
│       │   └── integration/    # CLI command tests
│       ├── package.json
│       ├── tsconfig.json
│       └── tsup.config.ts
├── package.json                # Workspace root
├── pnpm-workspace.yaml
├── supacontrol.toml           # Example config (for testing)
└── AGENTS.md                  # This file
```

---

## Beads Quick Reference

```bash
bd ready                              # Find available work (no blockers)
bd show <id>                          # View issue details and description
bd update <id> --status in_progress   # Claim work (do this FIRST)
bd close <id>                         # Mark work complete
bd blocked                            # See what's waiting on other work
bd sync                               # Sync with git (do before/after work)
bd dep tree <id>                      # See what blocks/is blocked by this
```

---

## Concurrent Agent Coordination

### CRITICAL: Claiming Work

**Before starting ANY work:**
1. Run `bd ready` to see available tasks
2. Run `bd update <id> --status in_progress` to CLAIM the task
3. Only then begin working

**Why this matters:** Multiple agents may be running simultaneously. If you don't claim work, another agent might start the same task, causing conflicts.

### One Task at a Time

- Only work on ONE task at a time
- Complete and close your current task before starting another
- If you discover additional work needed, create a new bead with `bd create`

### Dependency Awareness

Tasks are strictly ordered. The dependency chain ensures:
- You can only work on tasks where ALL blockers are closed
- When you close a task, the next task becomes ready
- Run `bd dep tree <id>` to understand the full chain

### File Locking Conventions

To avoid conflicts when multiple agents work concurrently:

| If you're working on... | Stay within these files... |
|------------------------|---------------------------|
| Config (Phase 2) | `src/config/*` |
| Guards (Phase 3) | `src/guards/*` |
| Commands (Phase 4) | `src/commands/*` |
| API (Phase 5) | `src/api/*`, `src/auth/*` |
| Tests (Phase 6) | `tests/*` |

**Shared files** (coordinate carefully):
- `src/index.ts` - CLI entry point
- `src/utils/*` - Shared utilities
- `package.json` - Dependencies

---

## Code Standards

### TypeScript Guidelines

```typescript
// Use explicit types
function checkLock(config: EnvironmentConfig): GuardResult {
  // ...
}

// Use Zod for runtime validation
const ConfigSchema = z.object({
  settings: SettingsSchema,
  environments: z.record(EnvironmentSchema),
});

// Export types derived from Zod
export type Config = z.infer<typeof ConfigSchema>;
```

### Error Handling

```typescript
import pc from 'picocolors';

// Provide helpful error messages with suggestions
if (!config) {
  console.error(pc.red('✗ No supacontrol.toml found'));
  console.error(pc.dim('  Run `supacontrol init` to create one'));
  process.exit(1);
}
```

### CLI Output Standards

Use consistent formatting:
```typescript
import pc from 'picocolors';

// Status indicators
console.log(pc.green('✓'), 'Operation successful');
console.log(pc.yellow('⚠'), 'Warning message');
console.log(pc.red('✗'), 'Error message');
console.log(pc.blue('→'), 'Action in progress');
console.log(pc.dim('  hint text here'));

// Risk level colors
// Low risk: default/blue
// Medium risk: yellow
// High risk: red
// Critical risk: red + bold
```

---

## Testing Rules

### CRITICAL: Test Fixture Protection

**NEVER modify files in `tests/fixtures/`**

These files have SHA256 checksums validated before each test run. If a test fails:

1. **DO NOT** change the test expectation
2. **DO NOT** modify fixture files
3. **DO** fix the implementation in `src/`
4. **DO** ask for help if the expected behavior should change

### Guard Tests Are Sacred

The tests in `tests/guards/*.spec.ts` verify SAFETY-CRITICAL behavior that prevents production data loss:

```typescript
// tests/guards/lock-guard.spec.ts
// ⚠️ THESE TESTS PREVENT PRODUCTION DATA LOSS
// If a test fails, FIX THE IMPLEMENTATION, not the test

it('MUST block when locked=true', () => {
  // This test exists because someone's production DB was destroyed
  // DO NOT MODIFY
});
```

### Running Tests

```bash
pnpm test              # Run all tests
pnpm test:watch        # Watch mode for development
pnpm test:coverage     # Generate coverage report
pnpm verify-fixtures   # Validate fixture checksums (runs before tests)
```

---

## Key Design Decisions

### 1. Production Locked by Default

If an environment's `locked` field is not specified in config, it defaults to `true` for production:

```typescript
// In lock-guard.ts
const isProduction = envName === 'production' || 
                     config.git_branches?.includes('main') ||
                     config.git_branches?.includes('master');

const isLocked = config.locked ?? isProduction; // Default true for production
```

### 2. Opinionated Commands (No `db` Namespace)

We deliberately DON'T mirror Supabase CLI's `db` namespace:
- `supacontrol push` NOT `supacontrol db push`
- This prevents muscle-memory mistakes (typing `supabase` instead of `supacontrol`)

### 3. Three Binary Aliases

The package registers three CLI commands:
- `supacontrol` - Full name
- `supac` - Short name
- `spc` - Very short name

All three must work identically.

### 4. CI Mode Behavior

When `--ci` flag is passed:
- Skip all interactive prompts
- Require explicit `--env` flag (no auto-detection)
- Fail with non-zero exit code if guards block
- Production operations require `--i-know-what-im-doing` flag

---

## Supabase Integration Notes

### Supabase CLI Detection

The wrapper checks for Supabase CLI:
```typescript
// In src/utils/supabase.ts
async function checkSupabaseCLI(): Promise<boolean> {
  try {
    await execa('supabase', ['--version']);
    return true;
  } catch {
    return false;
  }
}
```

### Project Ref Location

Supabase stores the linked project ref in:
```
supabase/.temp/project-ref
```

Read this to verify the currently linked project matches the expected environment.

### Management API

```typescript
// Base URL
const API_BASE = 'https://api.supabase.com/v1';

// Get all projects
GET /projects
Authorization: Bearer <access_token>

// Rate limit: 120 requests/minute
```

---

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

### Mandatory Workflow

1. **Run quality gates** (if code changed):
   ```bash
   pnpm lint
   pnpm test
   pnpm build
   ```

2. **Update issue status**:
   ```bash
   bd close <id>           # For completed work
   bd sync                 # Sync state to git
   ```

3. **Commit and push**:
   ```bash
   git add -A
   git commit -m "feat(cli): description of changes"
   git push
   ```

4. **Verify**:
   ```bash
   git status              # Must show "up to date with origin"
   bd ready                # Confirm next task is unblocked
   ```

### Commit Message Format

```
type(scope): description

Types: feat, fix, docs, test, refactor, chore
Scopes: cli, config, guards, commands, api, auth, tests
```

Examples:
- `feat(guards): implement environment lock guard`
- `fix(config): handle missing TOML file gracefully`
- `test(guards): add critical safety tests for lock guard`
- `docs(readme): add configuration reference`

---

## Common Issues & Solutions

### "Another agent is working on this"

If `bd ready` shows no tasks but you expected one:
```bash
bd list --status in_progress  # See what's claimed
bd blocked                    # See what's waiting
```

Wait for the other agent to complete, or coordinate handoff.

### Test Fixture Checksum Mismatch

```bash
pnpm verify-fixtures
# If this fails, someone modified fixtures incorrectly
# Restore from git: git checkout tests/fixtures/
```

### Supabase CLI Not Found

The CLI requires Supabase CLI to be installed:
```bash
npm install -g supabase  # or brew install supabase/tap/supabase
```

Our CLI should detect this and show a helpful error, not crash.

---

## Questions?

If you're unsure about something:
1. Check the bead description: `bd show <id>`
2. Check the dependency chain: `bd dep tree <id>`
3. Look at related closed beads for patterns
4. Ask the user for clarification

**Remember: When in doubt, DON'T modify test fixtures or safety-critical code. Ask first.**
