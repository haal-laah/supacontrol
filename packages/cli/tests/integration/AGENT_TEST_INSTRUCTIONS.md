# Agent Instructions: SPC Interactive Integration Test

## Objective
Run the SPC CLI in the playground folder and verify all commands work correctly, including interactive prompts.

## Setup
1. Working directory: `playground/`
2. CLI command: `node ../packages/cli/dist/index.js <command>` (or `npx spc <command>`)
3. The CLI is already built

## Test Execution

### Phase 1: Non-Interactive Commands (Run These First)

Execute each command and report the output:

```bash
cd playground

# Test 1: Doctor - health check
node ../packages/cli/dist/index.js doctor

# Test 2: Status - current environment
node ../packages/cli/dist/index.js status

# Test 3: Version
node ../packages/cli/dist/index.js --version

# Test 4: Help
node ../packages/cli/dist/index.js --help
```

**Report**: Did each command succeed? Any errors?

---

### Phase 2: Lock Guard Tests (Non-Interactive with --ci flag)

Test that locked environments are properly protected:

```bash
# Test 5: Push to locked production (SHOULD BE BLOCKED)
node ../packages/cli/dist/index.js push -e production --ci

# Test 6: Reset to locked production (SHOULD BE BLOCKED)
node ../packages/cli/dist/index.js reset -e production --ci

# Test 7: Pull to locked production (SHOULD BE BLOCKED)
node ../packages/cli/dist/index.js pull -e production --ci
```

**Expected**: All three commands should show "locked" error and NOT proceed.
**Report**: Were they all blocked? What was the error message?

---

### Phase 3: Staging Commands (May Require Supabase Token)

Test commands on unlocked staging environment:

```bash
# Test 8: Push to staging (should check migrations)
node ../packages/cli/dist/index.js push -e staging --ci

# Test 9: Status after operations
node ../packages/cli/dist/index.js status
```

**Note**: These may fail if not linked to Supabase or missing token. That's OK - report the error.
**Report**: What was the output? Any errors about linking/token?

---

### Phase 4: Lock/Unlock Commands

```bash
# Test 10: Lock staging
node ../packages/cli/dist/index.js lock staging

# Test 11: Verify status shows locked
node ../packages/cli/dist/index.js status

# Test 12: Unlock staging (restore original state)
node ../packages/cli/dist/index.js unlock staging

# Test 13: Verify status shows unlocked
node ../packages/cli/dist/index.js status
```

**Report**: Did lock/unlock update the config? Did status reflect changes?

---

### Phase 5: Config Verification

```bash
# Test 14: Check config wasn't corrupted
cat supacontrol.toml
```

**Report**: Is the config file valid TOML? Are both environments still defined?

---

## Final Report Template

Please provide a summary in this format:

```
## SPC Integration Test Results

### Phase 1: Non-Interactive
- [ ] doctor: PASS/FAIL - [notes]
- [ ] status: PASS/FAIL - [notes]
- [ ] version: PASS/FAIL - [notes]
- [ ] help: PASS/FAIL - [notes]

### Phase 2: Lock Guards
- [ ] push production blocked: PASS/FAIL
- [ ] reset production blocked: PASS/FAIL
- [ ] pull production blocked: PASS/FAIL

### Phase 3: Staging Commands
- [ ] push staging: PASS/FAIL/SKIPPED - [notes]
- [ ] status: PASS/FAIL - [notes]

### Phase 4: Lock/Unlock
- [ ] lock staging: PASS/FAIL
- [ ] status shows locked: PASS/FAIL
- [ ] unlock staging: PASS/FAIL
- [ ] status shows unlocked: PASS/FAIL

### Phase 5: Config
- [ ] config valid: PASS/FAIL

### Summary
Total: X/14 passed
Issues Found: [list any bugs or unexpected behavior]
```
