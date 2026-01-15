# Test Fixtures

> ⚠️ **WARNING: DO NOT MODIFY THESE FILES TO MAKE TESTS PASS** ⚠️

## Why Fixtures Are Protected

This directory contains test fixtures with SHA256 checksums. These fixtures define the **expected behavior** of the system.

The guard system is **safety-critical** - it prevents accidental production database destruction. Modifying fixtures to make tests pass could silently break these safety mechanisms.

## If a Test Fails

1. **DO NOT** modify the fixture files
2. **DO NOT** change the expected values
3. **DO** fix the implementation in `src/`
4. **DO** ask for help if the expected behavior is unclear

## Checksum Verification

Before each test run, checksums are verified:

```bash
pnpm verify-fixtures
```

If verification fails, it means fixture files were modified since their checksums were recorded.

## Intentional Changes

If the expected behavior **genuinely needs to change** (rare):

1. Update the fixture file
2. Run `pnpm verify-fixtures --update` to regenerate checksums
3. In your commit message, clearly explain:
   - **WHY** the expected behavior changed
   - **WHAT** scenarios are affected
   - **WHO** approved the change

## File Purposes

| File | Purpose |
|------|---------|
| `config.fixtures.ts` | Valid and invalid TOML configurations |
| `guard.fixtures.ts` | Safety guard test cases |
| `checksums.json` | SHA256 checksums of all fixtures |

## Questions?

If you're unsure whether to modify a fixture, **ask first**. Breaking safety guards could result in production data loss.
