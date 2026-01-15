# @supacontrol/cli

> Safety-first CLI wrapper for Supabase with environment guards and confirmation prompts

[![CI](https://github.com/your-org/supacontrol/actions/workflows/ci.yml/badge.svg)](https://github.com/your-org/supacontrol/actions/workflows/ci.yml)
[![npm version](https://badge.fury.io/js/%40supacontrol%2Fcli.svg)](https://www.npmjs.com/package/@supacontrol/cli)

## Why SupaControl?

The Supabase CLI is powerful but dangerous. One wrong command on the wrong branch can wipe your production database. **SupaControl adds safety guards:**

- 🔒 **Environment locking** - Production locked by default
- ✅ **Confirmation prompts** - Type environment name to confirm destructive operations
- 🌿 **Branch-based auto-detection** - Automatically targets the right environment
- 🛡️ **Project ref validation** - Prevents operating on wrong database
- 🧹 **Clean git checks** - Requires clean working directory for safety

## Installation

```bash
# npm
npm install -g @supacontrol/cli

# pnpm
pnpm add -g @supacontrol/cli

# yarn
yarn global add @supacontrol/cli
```

## Quick Start

```bash
# Initialize in your Supabase project (requires supabase init first)
supacontrol init

# Check current status
supacontrol status

# Push migrations (with safety guards)
supacontrol push

# Reset database (requires confirmation)
supacontrol reset
```

## Configuration

SupaControl uses a `supacontrol.toml` file in your project root:

```toml
[settings]
# Fail on any guard warning (default: false)
strict_mode = false

# Require clean git working tree (default: true)
require_clean_git = true

# Show migration diff before push (default: true)
show_migration_diff = true

[environments.staging]
# Supabase project reference
project_ref = "your-staging-project-ref"

# Git branches that map to this environment
git_branches = ["develop", "staging"]

# Operations that require confirmation
protected_operations = ["reset"]

[environments.production]
project_ref = "your-production-project-ref"
git_branches = ["main", "master"]
protected_operations = ["push", "reset", "seed"]

# Custom confirmation word (default: environment name)
confirm_word = "production"

# Lock environment (blocks ALL destructive operations)
locked = true
```

### Configuration Options

#### Settings

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `strict_mode` | boolean | `false` | Fail on warnings, not just errors |
| `require_clean_git` | boolean | `true` | Require clean git working directory |
| `show_migration_diff` | boolean | `true` | Show diff before push |

#### Environment Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `project_ref` | string | - | Supabase project reference |
| `git_branches` | string[] | `[]` | Branches mapping to this environment |
| `protected_operations` | string[] | `[]` | Operations requiring confirmation |
| `confirm_word` | string | env name | Word to type for confirmation |
| `locked` | boolean | `true` for production | Block all destructive operations |

#### Protected Operations

- `push` - Push migrations
- `reset` - Reset database
- `pull` - Pull schema changes
- `seed` - Run seed files
- `link` - Link to project
- `unlink` - Unlink project

#### Branch Patterns

Use wildcards to match multiple branches:

```toml
[environments.preview]
git_branches = ["feature/*", "pr/*", "preview/*"]
```

## Commands

### `supacontrol init`

Interactive setup wizard to create `supacontrol.toml`.

```bash
supacontrol init
```

### `supacontrol status`

Show current environment, linked project, and configuration.

```bash
supacontrol status
```

### `supacontrol push`

Push local migrations to remote database.

```bash
# Auto-detect environment from git branch
supacontrol push

# Target specific environment
supacontrol push -e staging

# Dry run (show what would be pushed)
supacontrol push --dry-run

# Force (bypass guards - use with caution!)
supacontrol push --force
```

### `supacontrol reset`

Reset remote database (destructive!).

```bash
supacontrol reset
```

### `supacontrol pull`

Pull schema changes from remote database.

```bash
supacontrol pull
```

### `supacontrol switch`

Switch to a different environment (relinks Supabase project).

```bash
supacontrol switch staging
supacontrol switch production
```

### `supacontrol lock/unlock`

Lock or unlock an environment.

```bash
supacontrol lock production
supacontrol unlock staging
```

### `supacontrol doctor`

Health check for your setup.

```bash
supacontrol doctor
```

## CI/CD Usage

### GitHub Actions

```yaml
- name: Push migrations
  run: |
    supacontrol push -e production --ci --i-know-what-im-doing
  env:
    SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
```

### CI Mode Flags

| Flag | Description |
|------|-------------|
| `--ci` | Non-interactive mode |
| `--i-know-what-im-doing` | Required for protected operations in CI |
| `-e, --env <name>` | Explicit environment (required in CI) |

### Environment Variables

| Variable | Description |
|----------|-------------|
| `SUPABASE_ACCESS_TOKEN` | Supabase access token for API operations |

## Safety Features

### Lock Guard

Production environments are locked by default. Locked environments block ALL destructive operations:

```
✗ Environment 'production' is locked
  Suggestions:
  • Set 'locked = false' in supacontrol.toml for [environments.production]
  • Or use --force flag to override (not recommended for production)
```

### Operation Guard

Protected operations require typing a confirmation word:

```
⚠ This will reset the staging database
  Type 'staging' to confirm: 
```

### Project Guard

Validates that the linked Supabase project matches the expected environment:

```
✗ Project mismatch: linked to 'wrong-project' but 'production' expects 'prod-project'
  Suggestions:
  • Run 'supabase link --project-ref prod-project' to switch
```

### Git Guard

Requires clean git working directory for destructive operations:

```
✗ Uncommitted changes detected
  Suggestions:
  • Commit or stash your changes before running this command
```

## Aliases

The CLI is available under three names:

- `supacontrol` - Full name
- `supac` - Short name
- `spc` - Very short name

## Contributing

```bash
# Clone the repo
git clone https://github.com/your-org/supacontrol.git
cd supacontrol

# Install dependencies
pnpm install

# Run tests
pnpm --filter @supacontrol/cli test

# Build
pnpm --filter @supacontrol/cli build
```

### Test Fixtures

Test fixtures in `tests/fixtures/` are protected by SHA256 checksums. If a test fails:

1. **DO NOT** modify the fixture
2. **DO** fix the implementation in `src/`
3. If the expected behavior changed, update fixtures and run `pnpm verify-fixtures --update`

## License

MIT © [Your Name]
