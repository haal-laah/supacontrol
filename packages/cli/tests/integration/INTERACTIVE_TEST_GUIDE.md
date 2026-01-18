# SPC Interactive Integration Test Guide

> **Purpose**: Manually verify that the SPC CLI works correctly with real interactive prompts.
> This is NOT automated coverage - it's a human/agent-driven smoke test.

## Prerequisites

1. Navigate to the playground folder: `cd playground`
2. Ensure SPC is built: `cd ../packages/cli && pnpm build && cd ../../playground`
3. Run SPC via: `npx spc <command>` or `node ../packages/cli/dist/index.js <command>`

## Test Scenarios

### Test 1: Doctor Command (Non-Interactive)
```bash
npx spc doctor
```

**Expected**:
- Shows health check results
- Should detect supabase CLI
- Should detect git
- Should detect config file
- Should show environment info

**Pass Criteria**: Command completes without error, shows meaningful output.

---

### Test 2: Status Command (Non-Interactive)
```bash
npx spc status
```

**Expected**:
- Shows current environment (based on git branch)
- Shows project reference
- Shows migration sync status (may show mismatch if not linked)

**Pass Criteria**: Command completes, shows environment info.

---

### Test 3: Switch Command - Environment Selection
```bash
npx spc switch staging
```

**Expected**:
- Prompts to link to project `lggdmijghuonkzbszuxm`
- May prompt for Supabase access token
- Should update supabase link

**Interactive Steps**:
1. If prompted for token: Enter valid Supabase access token or press Ctrl+C to cancel
2. Observe the linking process

**Pass Criteria**: Either links successfully OR shows clear error message.

---

### Test 4: Lock/Unlock Commands
```bash
# Check current lock status
npx spc status

# Lock staging (it's currently unlocked)
npx spc lock staging

# Verify lock
npx spc status

# Unlock staging
npx spc unlock staging
```

**Expected**:
- Lock command should update config to `locked = true`
- Unlock command should update config to `locked = false`
- Status should reflect the changes

**Pass Criteria**: Config file updated correctly, status reflects changes.

---

### Test 5: Push Command with Guards (Production is LOCKED)
```bash
# Try to push to production (should be blocked)
npx spc push -e production
```

**Expected**:
- Should be BLOCKED because production is `locked = true`
- Should show error message about locked environment
- Should NOT prompt for confirmation (blocked before that)

**Pass Criteria**: Command fails with clear "locked" message, no destructive action.

---

### Test 6: Push Command with Confirmation (Staging)
```bash
npx spc push -e staging
```

**Expected**:
- Should show migration diff (if migrations differ)
- Should prompt for confirmation (staging has `reset` protected, but push is not)
- Actually, push is NOT in `protected_operations` for staging, so should proceed

**Interactive Steps**:
1. Observe whether confirmation is requested
2. If prompted, type 'staging' or cancel with Ctrl+C

**Pass Criteria**: Either pushes or shows appropriate guards.

---

### Test 7: Reset Command with Confirmation (DANGEROUS)
```bash
# Reset on staging (protected operation)
npx spc reset -e staging
```

**Expected**:
- Should show warning about destructive operation
- Should require confirmation (reset is in `protected_operations`)
- Should prompt to type 'staging' to confirm

**Interactive Steps**:
1. When prompted, press Ctrl+C to cancel (DO NOT actually reset)
2. Verify the cancellation message is clear

**Pass Criteria**: Confirmation prompt appears, Ctrl+C cancels gracefully.

---

### Test 8: Reset Command on Locked Environment
```bash
npx spc reset -e production
```

**Expected**:
- Should be BLOCKED before confirmation prompt
- Should show "environment is locked" error
- Should NOT proceed to destructive action

**Pass Criteria**: Blocked with clear message, no reset occurs.

---

### Test 9: Pull Command
```bash
npx spc pull -e staging
```

**Expected**:
- Should check migration sync status
- May prompt if there are conflicts
- Should pull migrations from remote

**Interactive Steps**:
1. If prompted about conflicts, observe the options
2. Cancel with Ctrl+C if unsure

**Pass Criteria**: Command shows sync status, handles conflicts gracefully.

---

### Test 10: Init Command (Fresh Setup)
```bash
# Create a temp directory and test init
mkdir ../temp-init-test
cd ../temp-init-test
npx spc init
```

**Expected**:
- Should detect if supabase is already initialized
- Should prompt for environment setup
- Should prompt for project selection
- Should create supacontrol.toml

**Interactive Steps**:
1. Follow the prompts or Ctrl+C to cancel
2. Observe the flow

**Pass Criteria**: Init wizard runs, prompts are clear.

**Cleanup**:
```bash
cd ../playground
rm -rf ../temp-init-test
```

---

## Summary Checklist

| Test | Command | Expected Behavior | Pass/Fail |
|------|---------|-------------------|-----------|
| 1 | `doctor` | Shows health checks | |
| 2 | `status` | Shows environment info | |
| 3 | `switch staging` | Links or prompts for token | |
| 4 | `lock/unlock` | Updates config correctly | |
| 5 | `push -e production` | BLOCKED (locked) | |
| 6 | `push -e staging` | Shows diff, may proceed | |
| 7 | `reset -e staging` | Prompts confirmation, Ctrl+C cancels | |
| 8 | `reset -e production` | BLOCKED (locked) | |
| 9 | `pull -e staging` | Shows sync status | |
| 10 | `init` | Wizard runs in new folder | |

## Reporting

After running tests, report:
1. Which tests passed/failed
2. Any unexpected error messages
3. Any UX issues with prompts
4. Any crashes or unhandled exceptions
