#!/bin/bash
# Clawdbot Network Router — Test Suite
# Usage: bash test.sh [BASE_URL]

BASE="${1:-http://localhost:3001}"
PASS=0
FAIL=0
ADMIN_SECRET="clawdbot-dev"

pass() { PASS=$((PASS+1)); echo "  ✅ $1"; }
fail() { FAIL=$((FAIL+1)); echo "  ❌ $1: $2"; }

check_status() {
  local desc="$1" url="$2" expected="$3"
  local status=$(curl -s -o /dev/null -w "%{http_code}" "$url" --max-time 10)
  [ "$status" = "$expected" ] && pass "$desc" || fail "$desc" "got $status, expected $expected"
}

check_json() {
  local desc="$1" url="$2" field="$3" expected="$4"
  local val=$(curl -s "$url" --max-time 10 | jq -r "$field" 2>/dev/null)
  [ "$val" = "$expected" ] && pass "$desc" || fail "$desc" "got '$val', expected '$expected'"
}

echo ""
echo "🧪 Clawdbot Network Router Tests"
echo "   Base: $BASE"
echo ""

# --- Health ---
echo "📡 Health"
check_json "Health status" "$BASE/admin/health" ".status" "ok"
check_json "Health version" "$BASE/admin/health" ".version" "1.0.0"
check_json "Health network" "$BASE/admin/health" ".network" "devnet"

# --- Root ---
echo "🏠 Root"
check_json "Root name" "$BASE/" ".name" "Clawdbot Network Router"

# --- Nodes ---
echo "📱 Nodes"
NODE_COUNT=$(curl -s "$BASE/nodes" --max-time 5 | jq '.count')
[ "$NODE_COUNT" -ge 0 ] 2>/dev/null && pass "Nodes endpoint returns count ($NODE_COUNT)" || fail "Nodes endpoint" "invalid response"

# --- API Keys ---
echo "🔑 API Keys"
check_status "Keys without admin secret" "$BASE/admin/keys" "403"

KEY_RESP=$(curl -s -X POST "$BASE/admin/keys" \
  -H "Content-Type: application/json" \
  -H "X-Admin-Secret: $ADMIN_SECRET" \
  -d '{"label":"test-runner","wallet":"TestWallet"}' --max-time 5)
API_KEY=$(echo "$KEY_RESP" | jq -r '.apiKey')
[ "$API_KEY" != "null" ] && [ -n "$API_KEY" ] && pass "Create API key" || fail "Create API key" "no key returned"

# --- Proxy Session ---
echo "🔄 Proxy Sessions"
if [ "$NODE_COUNT" -gt 0 ]; then
  SESSION_RESP=$(curl -s -X POST "$BASE/proxy/session" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $API_KEY" \
    -d '{}' --max-time 5)
  SESSION_ID=$(echo "$SESSION_RESP" | jq -r '.sessionId')
  [ "$SESSION_ID" != "null" ] && [ -n "$SESSION_ID" ] && pass "Create session" || fail "Create session" "no sessionId"

  SESSION_STATUS=$(echo "$SESSION_RESP" | jq -r '.status')
  [ "$SESSION_STATUS" = "active" ] && pass "Session status active" || fail "Session status" "$SESSION_STATUS"

  # End session
  END_RESP=$(curl -s -X POST "$BASE/proxy/session/$SESSION_ID/end" --max-time 5)
  END_STATUS=$(echo "$END_RESP" | jq -r '.status')
  [ "$END_STATUS" = "completed" ] && pass "End session" || fail "End session" "$END_STATUS"
else
  echo "  ⏭️  Skipped (no nodes online)"
fi

# --- Proxy Fetch ---
echo "🌐 Proxy Fetch"
if [ "$NODE_COUNT" -gt 0 ]; then
  FETCH_RESP=$(curl -s "$BASE/proxy/fetch?url=http://httpbin.org/ip" --max-time 20)
  FETCH_IP=$(echo "$FETCH_RESP" | jq -r '.response' | jq -r '.origin' 2>/dev/null)
  [ -n "$FETCH_IP" ] && [ "$FETCH_IP" != "null" ] && pass "Fetch returns IP ($FETCH_IP)" || fail "Fetch" "no IP in response"

  FETCH_DEVICE=$(echo "$FETCH_RESP" | jq -r '.device')
  [ -n "$FETCH_DEVICE" ] && [ "$FETCH_DEVICE" != "null" ] && pass "Fetch shows device ($FETCH_DEVICE)" || fail "Fetch device" "missing"
else
  echo "  ⏭️  Skipped (no nodes online)"
fi

# --- Rate Limiting ---
echo "🚦 Rate Limiting"
HEADERS=$(curl -sI "$BASE/admin/health" --max-time 5 2>&1)
echo "$HEADERS" | grep -qi "x-ratelimit" && pass "Rate limit headers present" || fail "Rate limit headers" "missing"

# --- Balance ---
echo "💰 Solana"
BALANCE=$(curl -s "$BASE/admin/balance" -H "X-Admin-Secret: $ADMIN_SECRET" --max-time 10 | jq '.balance')
[ "$BALANCE" != "null" ] && pass "Balance endpoint ($BALANCE SOL)" || fail "Balance" "null"

# --- Summary ---
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Results: $PASS passed, $FAIL failed"
echo "━━━━━━━━━━━━━━━━━━━━━━━━"
[ "$FAIL" -eq 0 ] && echo "  🎉 All tests passed!" || echo "  ⚠️  Some tests failed"
echo ""
exit $FAIL
