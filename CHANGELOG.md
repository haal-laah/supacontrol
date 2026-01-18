# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2025-01-18

### Added

- **CLI Foundation**
  - Three command aliases: `supacontrol`, `supac`, `spc`
  - Global flags: `--ci`, `--env`, `--verbose`, `--version`
  - Comprehensive help system

- **Configuration System**
  - TOML-based configuration (`supacontrol.toml`)
  - Zod schema validation
  - Environment-specific settings
  - Branch pattern matching with wildcards

- **Safety Guards**
  - **Lock Guard**: Block operations on locked environments (production locked by default)
  - **Operation Guard**: Require confirmation for protected operations
  - **Project Guard**: Validate linked project matches expected environment
  - **Git Guard**: Require clean working directory for destructive operations

- **Commands**
  - `init` - Interactive setup wizard with Supabase Branching support
  - `status` - Show current environment and project status
  - `push` - Push migrations with safety checks
  - `pull` - Pull remote schema changes
  - `reset` - Reset database with confirmation
  - `switch` - Switch between environments
  - `lock` / `unlock` - Control environment access
  - `doctor` - Health check for setup

- **Supabase Integration**
  - Management API client for project/branch operations
  - Automatic migration sync on branch creation
  - Support for Supabase Branching workflow

- **CI/CD Support**
  - Non-interactive `--ci` mode
  - Environment variable support (`SUPABASE_ACCESS_TOKEN`)
  - GitHub Actions workflow

### Security

- Production environments locked by default
- Confirmation prompts for destructive operations
- Project reference validation prevents wrong-database operations

[0.1.0]: https://github.com/supacontrol/supacontrol/releases/tag/v0.1.0
