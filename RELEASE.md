# Release Instructions

This document contains instructions for preparing and publishing a release of SupaControl.

## Pre-Release Checklist

Before releasing, ensure:

- [ ] All tests pass: `pnpm test`
- [ ] Build succeeds: `pnpm build`
- [ ] Linting passes: `pnpm lint`
- [ ] Type checking passes: `pnpm typecheck`
- [ ] CHANGELOG.md is updated
- [ ] Version in `packages/cli/package.json` is correct

## First Release: Squashing Git History

For the initial v0.1.0 release, we want a clean git history. Follow these steps to squash all commits into a single initial commit:

### Option 1: Soft Reset (Recommended)

```bash
# Make sure you're on main and everything is committed
git checkout main
git status  # Should be clean

# Soft reset to the beginning (keeps all changes staged)
git reset --soft $(git rev-list --max-parents=0 HEAD)

# Create a single clean commit
git commit -m "feat: initial release v0.1.0

SupaControl - Safety-first CLI wrapper for Supabase

Features:
- Environment locking (production locked by default)
- Confirmation prompts for destructive operations
- Branch-based environment detection
- Project reference validation
- Git status checks

Commands:
- init, status, push, pull, reset
- switch, lock, unlock, doctor

Includes comprehensive test suite and CI/CD pipeline."

# Force push to remote (ONLY for initial release!)
git push --force origin main
```

### Option 2: Interactive Rebase

```bash
# Find the first commit hash
git log --oneline | tail -1

# Rebase interactively from the first commit
git rebase -i --root

# In the editor:
# - Keep the first commit as "pick"
# - Change all other commits to "squash" or "s"
# - Save and exit

# Edit the commit message when prompted

# Force push
git push --force origin main
```

### Option 3: Create Fresh Repository

If you want a completely clean slate:

```bash
# Remove git history
rm -rf .git

# Initialize fresh
git init
git add .
git commit -m "feat: initial release v0.1.0"

# Add remote and push
git remote add origin https://github.com/supacontrol/supacontrol.git
git push -u origin main --force
```

## Header Image Generation

The README requires a hero image at `.github/assets/hero.jpg`.

### Image Prompt for AI Image Generators

Use this prompt with Midjourney, DALL-E, or similar:

```
A modern, minimalist tech header image for a CLI tool called "SupaControl". 
The design should feature:
- A shield or lock icon symbolizing safety and protection
- Subtle database/server imagery in the background
- Green (#3ECF8E - Supabase brand color) and dark gray/black color scheme
- Clean, professional aesthetic suitable for a GitHub README
- Terminal/command-line visual elements
- Text "SupaControl" in a modern sans-serif font
- Tagline "Safety-first database migrations"
- 1600x400 pixel banner format
- Flat/2D design style, no 3D effects
- Dark background with light text
```

### Alternative: Text-Based Header

If you prefer a simpler approach, create a text-based header using:
- [Capsule Render](https://github.com/kyechan99/capsule-render)
- [Readme Typing SVG](https://github.com/DenverCoder1/readme-typing-svg)
- Figma/Canva with the Supabase color palette

### Supabase Brand Colors

- Primary Green: `#3ECF8E`
- Dark: `#1C1C1C`
- Light: `#F8F8F8`

## Publishing to npm

### First Time Setup

```bash
# Login to npm
npm login

# Verify you're logged in
npm whoami
```

### Publishing

```bash
# Build the package
pnpm --filter @supacontrol/cli build

# Publish (from packages/cli directory)
cd packages/cli
npm publish --access public
```

### Version Bumping

For subsequent releases:

```bash
# Patch release (0.1.0 -> 0.1.1)
npm version patch

# Minor release (0.1.0 -> 0.2.0)
npm version minor

# Major release (0.1.0 -> 1.0.0)
npm version major
```

## Creating a GitHub Release

1. Go to https://github.com/supacontrol/supacontrol/releases
2. Click "Create a new release"
3. Create a new tag: `v0.1.0`
4. Title: `v0.1.0 - Initial Release`
5. Copy the CHANGELOG entry for the release notes
6. Publish release

## Post-Release

After releasing:

1. Verify npm package: `npm view @supacontrol/cli`
2. Test installation: `npm install -g @supacontrol/cli`
3. Verify CLI works: `supacontrol --version`
4. Update any external documentation
5. Announce on social media if applicable
