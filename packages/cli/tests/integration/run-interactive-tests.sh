#!/bin/bash
# SPC Interactive Integration Tests
# Run from repo root: ./packages/cli/tests/integration/run-interactive-tests.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
PLAYGROUND="$REPO_ROOT/playground"
SPC="node $REPO_ROOT/packages/cli/dist/index.js"

echo "=============================================="
echo "SPC Interactive Integration Tests"
echo "=============================================="
echo ""
echo "Repo root: $REPO_ROOT"
echo "Playground: $PLAYGROUND"
echo ""

# Ensure we're in playground
cd "$PLAYGROUND"

# Build CLI first
echo "[SETUP] Building CLI..."
cd "$REPO_ROOT/packages/cli"
pnpm build > /dev/null 2>&1
cd "$PLAYGROUND"
echo "[SETUP] Build complete"
echo ""

# Track results
PASSED=0
FAILED=0
RESULTS=""

run_test() {
    local test_num=$1
    local test_name=$2
    local command=$3
    local expect_fail=${4:-false}
    
    echo "----------------------------------------------"
    echo "TEST $test_num: $test_name"
    echo "Command: $command"
    echo "----------------------------------------------"
    
    if $expect_fail; then
        # Expect command to fail (non-zero exit)
        if eval "$command" 2>&1; then
            echo "[UNEXPECTED] Command succeeded when it should have failed"
            FAILED=$((FAILED + 1))
            RESULTS="$RESULTS\nTEST $test_num: FAIL - $test_name (expected failure)"
        else
            echo "[EXPECTED] Command failed as expected"
            PASSED=$((PASSED + 1))
            RESULTS="$RESULTS\nTEST $test_num: PASS - $test_name"
        fi
    else
        # Expect command to succeed
        if eval "$command" 2>&1; then
            echo "[PASS] Command succeeded"
            PASSED=$((PASSED + 1))
            RESULTS="$RESULTS\nTEST $test_num: PASS - $test_name"
        else
            echo "[FAIL] Command failed unexpectedly"
            FAILED=$((FAILED + 1))
            RESULTS="$RESULTS\nTEST $test_num: FAIL - $test_name"
        fi
    fi
    echo ""
}

# ============================================
# NON-INTERACTIVE TESTS (can run automatically)
# ============================================

echo "=============================================="
echo "PHASE 1: Non-Interactive Tests"
echo "=============================================="
echo ""

# Test 1: Doctor
run_test 1 "doctor command" "$SPC doctor"

# Test 2: Status  
run_test 2 "status command" "$SPC status"

# Test 3: Help
run_test 3 "help command" "$SPC --help"

# Test 4: Version
run_test 4 "version command" "$SPC --version"

# Test 5: Push to locked production (should FAIL with lock error)
echo "----------------------------------------------"
echo "TEST 5: push to locked production (expect BLOCKED)"
echo "Command: $SPC push -e production --ci"
echo "----------------------------------------------"
OUTPUT=$($SPC push -e production --ci 2>&1 || true)
echo "$OUTPUT"
if echo "$OUTPUT" | grep -qi "locked\|block"; then
    echo "[PASS] Correctly blocked due to lock"
    PASSED=$((PASSED + 1))
    RESULTS="$RESULTS\nTEST 5: PASS - push blocked on locked production"
else
    echo "[FAIL] Should have been blocked by lock"
    FAILED=$((FAILED + 1))
    RESULTS="$RESULTS\nTEST 5: FAIL - push not blocked on locked production"
fi
echo ""

# Test 6: Reset to locked production (should FAIL with lock error)
echo "----------------------------------------------"
echo "TEST 6: reset to locked production (expect BLOCKED)"
echo "Command: $SPC reset -e production --ci"
echo "----------------------------------------------"
OUTPUT=$($SPC reset -e production --ci 2>&1 || true)
echo "$OUTPUT"
if echo "$OUTPUT" | grep -qi "locked\|block"; then
    echo "[PASS] Correctly blocked due to lock"
    PASSED=$((PASSED + 1))
    RESULTS="$RESULTS\nTEST 6: PASS - reset blocked on locked production"
else
    echo "[FAIL] Should have been blocked by lock"
    FAILED=$((FAILED + 1))
    RESULTS="$RESULTS\nTEST 6: FAIL - reset not blocked on locked production"
fi
echo ""

# Test 7: Pull to locked production (should also be blocked)
echo "----------------------------------------------"
echo "TEST 7: pull to locked production (expect BLOCKED)"
echo "Command: $SPC pull -e production --ci"
echo "----------------------------------------------"
OUTPUT=$($SPC pull -e production --ci 2>&1 || true)
echo "$OUTPUT"
if echo "$OUTPUT" | grep -qi "locked\|block"; then
    echo "[PASS] Correctly blocked due to lock"
    PASSED=$((PASSED + 1))
    RESULTS="$RESULTS\nTEST 7: PASS - pull blocked on locked production"
else
    echo "[FAIL] Should have been blocked by lock"
    FAILED=$((FAILED + 1))
    RESULTS="$RESULTS\nTEST 7: FAIL - pull not blocked on locked production"
fi
echo ""

# ============================================
# SUMMARY
# ============================================

echo "=============================================="
echo "TEST RESULTS SUMMARY"
echo "=============================================="
echo -e "$RESULTS"
echo ""
echo "----------------------------------------------"
echo "PASSED: $PASSED"
echo "FAILED: $FAILED"
echo "TOTAL:  $((PASSED + FAILED))"
echo "----------------------------------------------"

if [ $FAILED -gt 0 ]; then
    echo ""
    echo "[WARNING] Some tests failed!"
    exit 1
else
    echo ""
    echo "[SUCCESS] All non-interactive tests passed!"
fi

echo ""
echo "=============================================="
echo "PHASE 2: Interactive Tests (Manual)"
echo "=============================================="
echo ""
echo "The following tests require manual interaction."
echo "See INTERACTIVE_TEST_GUIDE.md for instructions:"
echo ""
echo "  - switch command (may prompt for token)"
echo "  - lock/unlock commands"
echo "  - reset with confirmation prompt"
echo "  - init wizard in fresh directory"
echo ""
