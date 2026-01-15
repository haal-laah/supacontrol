# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-01-15

### Added

- **CLI Commands**
  - `init` - Interactive setup wizard with environment presets (basic, staging-prod, full)
  - `push` - Safe database migration push with environment guards
  - `reset` - Protected database reset with confirmation prompts
  - `status` - Show current environment and safety status

- **Configuration System**
  - TOML-based configuration (`supacontrol.toml`)
  - Environment inheritance with `extends` support
  - Git branch-based environment auto-detection
  - Environment variable interpolation (`${VAR}` syntax)

- **Safety Guards**
  - **Lock Guard** - Block operations on locked environments (production locked by default)
  - **Operation Guard** - Risk-level based confirmations and restrictions
  - **Project Guard** - Verify Supabase project ref matches expected environment
  - **Git Guard** - Ensure clean working directory and correct branch

- **Supabase Integration**
  - Management API client with rate limiting (120 req/min)
  - Secure credential storage with proper file permissions
  - Interactive project selector for environment setup

- **Developer Experience**
  - Three binary aliases: `supacontrol`, `supac`, `spc`
  - CI mode (`--ci`) for non-interactive pipelines
  - Colored output with risk-level indicators
  - Helpful error messages with suggestions

- **Testing & Quality**
  - 122 tests covering config, guards, and integration
  - Protected test fixtures with SHA256 checksums
  - ESLint + Prettier configuration
  - GitHub Actions CI pipeline (Node 18/20)

### Security

- Production environments are locked by default
- Credentials stored with 0600 file permissions
- Double confirmation required for destructive operations
- `--i-know-what-im-doing` flag required for production in CI mode

[0.1.0]: https://github.com/example/supacontrol/releases/tag/v0.1.0
