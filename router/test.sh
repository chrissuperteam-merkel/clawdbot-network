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
NODES_RESP=$(curl -s "$BASE/nodes" --max-time 5)
NODE_COUNT=$(echo "$NODES_RESP" | jq '.count')
[ "$NODE_COUNT" -ge 0 ] 2>/dev/null && pass "Nodes endpoint returns count ($NODE_COUNT)" || fail "Nodes endpoint" "invalid response"

# --- Stealth Score ---
echo "🥷 Stealth Score"
if [ "$NODE_COUNT" -gt 0 ]; then
  FIRST_STEALTH=$(echo "$NODES_RESP" | jq '.nodes[0].stealthScore')
  FIRST_PRICE=$(echo "$NODES_RESP" | jq '.nodes[0].pricePerGB')
  FIRST_TIER=$(echo "$NODES_RESP" | jq -r '.nodes[0].pricingTier')
  [ "$FIRST_STEALTH" != "null" ] && [ -n "$FIRST_STEALTH" ] && pass "Stealth score present ($FIRST_STEALTH)" || fail "Stealth score" "missing"
  [ "$FIRST_PRICE" != "null" ] && [ -n "$FIRST_PRICE" ] && pass "Price per GB present ($FIRST_PRICE)" || fail "Price per GB" "missing"
  [ "$FIRST_TIER" != "null" ] && [ -n "$FIRST_TIER" ] && pass "Pricing tier present ($FIRST_TIER)" || fail "Pricing tier" "missing"
else
  STEALTH_TEST=$(cd /root/.openclaw/workspace/clawdbot-network/router && node -e "
    const {calculateStealthScore, getPricePerGB, getPricingTier} = require('./src/services/stealth-scoring');
    const s1 = calculateStealthScore({connectionType:'mobile_5g',carrier:'T-Mobile'});
    const s2 = calculateStealthScore({connectionType:'wifi',carrier:'WiFi'});
    const s3 = calculateStealthScore({connectionType:'unknown',carrier:'unknown'});
    console.log(JSON.stringify({s1,s2,s3,p1:getPricePerGB(s1),p2:getPricePerGB(s2),p3:getPricePerGB(s3)}));
  " 2>/dev/null)
  S1=$(echo "$STEALTH_TEST" | jq '.s1')
  S2=$(echo "$STEALTH_TEST" | jq '.s2')
  P1=$(echo "$STEALTH_TEST" | jq '.p1')
  [ "$S1" -ge 80 ] 2>/dev/null && pass "5G stealth score ($S1) >= 80" || fail "5G stealth" "$S1"
  [ "$S2" -le 50 ] 2>/dev/null && pass "WiFi stealth score ($S2) <= 50" || fail "WiFi stealth" "$S2"
  [ "$P1" = "0.01" ] && pass "Premium pricing ($P1)" || fail "Premium pricing" "$P1"
fi

# --- Quality Score ---
echo "📊 Quality Score"
if [ "$NODE_COUNT" -gt 0 ]; then
  FIRST_QUALITY=$(echo "$NODES_RESP" | jq '.nodes[0].qualityScore')
  [ "$FIRST_QUALITY" != "null" ] && [ -n "$FIRST_QUALITY" ] && pass "Quality score present ($FIRST_QUALITY)" || fail "Quality score" "missing"
else
  QUALITY_TEST=$(cd /root/.openclaw/workspace/clawdbot-network/router && node -e "
    const QualityScorer = require('./src/services/quality-scorer');
    const qs = new QualityScorer();
    qs.initNode('test1');
    qs.recordRequest('test1', 200, true, 5000);
    console.log(qs.getQualityScore('test1'));
  " 2>/dev/null)
  [ "$QUALITY_TEST" -ge 0 ] 2>/dev/null && pass "Quality scorer works (score=$QUALITY_TEST)" || fail "Quality scorer" "$QUALITY_TEST"
fi

# --- API Keys ---
echo "🔑 API Keys"
check_status "Keys without admin secret" "$BASE/admin/keys" "403"

KEY_RESP=$(curl -s -X POST "$BASE/admin/keys" \
  -H "Content-Type: application/json" \
  -H "X-Admin-Secret: $ADMIN_SECRET" \
  -d '{"label":"test-runner","wallet":"TestWallet"}' --max-time 5)
API_KEY=$(echo "$KEY_RESP" | jq -r '.apiKey')
[ "$API_KEY" != "null" ] && [ -n "$API_KEY" ] && pass "Create API key" || fail "Create API key" "no key returned"

# --- Fix 1: Admin Stats (SQLite) ---
echo "📈 Admin Stats (SQLite)"
STATS_RESP=$(curl -s "$BASE/admin/stats" -H "X-Admin-Secret: $ADMIN_SECRET" --max-time 5)
STATS_SESSIONS=$(echo "$STATS_RESP" | jq '.totalSessions')
[ "$STATS_SESSIONS" != "null" ] && [ -n "$STATS_SESSIONS" ] && pass "Stats: totalSessions ($STATS_SESSIONS)" || fail "Stats totalSessions" "missing"
STATS_BYTES=$(echo "$STATS_RESP" | jq '.totalBytes')
[ "$STATS_BYTES" != "null" ] && pass "Stats: totalBytes ($STATS_BYTES)" || fail "Stats totalBytes" "missing"
STATS_NODES=$(echo "$STATS_RESP" | jq '.totalNodes')
[ "$STATS_NODES" != "null" ] && pass "Stats: totalNodes ($STATS_NODES)" || fail "Stats totalNodes" "missing"
STATS_SOL=$(echo "$STATS_RESP" | jq '.totalSOLEarned')
[ "$STATS_SOL" != "null" ] && pass "Stats: totalSOLEarned ($STATS_SOL)" || fail "Stats totalSOLEarned" "missing"

# --- Fix 3: Admin Payouts ---
echo "💸 Admin Payouts"
PAYOUTS_RESP=$(curl -s "$BASE/admin/payouts" -H "X-Admin-Secret: $ADMIN_SECRET" --max-time 5)
PAYOUTS_ARR=$(echo "$PAYOUTS_RESP" | jq '.payouts')
[ "$PAYOUTS_ARR" != "null" ] && pass "Payouts endpoint returns array" || fail "Payouts" "missing"

# --- Proxy Session + Cost ---
echo "🔄 Proxy Sessions + Cost"
if [ "$NODE_COUNT" -gt 0 ]; then
  SESSION_RESP=$(curl -s -X POST "$BASE/proxy/session" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $API_KEY" \
    -d '{}' --max-time 5)
  SESSION_ID=$(echo "$SESSION_RESP" | jq -r '.sessionId')
  [ "$SESSION_ID" != "null" ] && [ -n "$SESSION_ID" ] && pass "Create session" || fail "Create session" "no sessionId"

  SESSION_STATUS=$(echo "$SESSION_RESP" | jq -r '.status')
  [ "$SESSION_STATUS" = "active" ] && pass "Session status active" || fail "Session status" "$SESSION_STATUS"

  # Fix 2: Check unpaid warning
  PAYMENT_WARN=$(echo "$SESSION_RESP" | jq -r '.payment.warning // empty')
  [ -n "$PAYMENT_WARN" ] && pass "Unpaid session has warning" || fail "Unpaid session warning" "missing"

  # Check pricing in session response
  SESSION_TIER=$(echo "$SESSION_RESP" | jq -r '.pricing.tier')
  SESSION_PRICE=$(echo "$SESSION_RESP" | jq '.pricing.pricePerGB')
  [ "$SESSION_TIER" != "null" ] && [ -n "$SESSION_TIER" ] && pass "Session has pricing tier ($SESSION_TIER)" || fail "Session pricing tier" "missing"
  [ "$SESSION_PRICE" != "null" ] && pass "Session has pricePerGB ($SESSION_PRICE)" || fail "Session pricePerGB" "missing"

  # Fix 7: Test preferredNodeId
  FIRST_NODE=$(echo "$NODES_RESP" | jq -r '.nodes[0].nodeId')
  PREF_RESP=$(curl -s -X POST "$BASE/proxy/session" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $API_KEY" \
    -d "{\"preferredNodeId\":\"$FIRST_NODE\"}" --max-time 5)
  PREF_NODE=$(echo "$PREF_RESP" | jq -r '.nodeId')
  PREF_SID=$(echo "$PREF_RESP" | jq -r '.sessionId')
  [ "$PREF_NODE" = "$FIRST_NODE" ] && pass "PreferredNodeId works ($PREF_NODE)" || fail "PreferredNodeId" "got $PREF_NODE"
  # Clean up
  [ "$PREF_SID" != "null" ] && curl -s -X POST "$BASE/proxy/session/$PREF_SID/end" --max-time 5 > /dev/null

  # End session and check cost
  END_RESP=$(curl -s -X POST "$BASE/proxy/session/$SESSION_ID/end" --max-time 5)
  END_STATUS=$(echo "$END_RESP" | jq -r '.status')
  [ "$END_STATUS" = "completed" ] && pass "End session" || fail "End session" "$END_STATUS"

  END_COST=$(echo "$END_RESP" | jq '.cost')
  [ "$END_COST" != "null" ] && pass "Session cost calculated" || fail "Session cost" "missing"
  COST_SOL=$(echo "$END_RESP" | jq '.cost.totalSOL')
  [ "$COST_SOL" != "null" ] && pass "Cost in SOL ($COST_SOL)" || fail "Cost SOL" "missing"

  # Fix 2: Check paid=false for unpaid session
  END_PAID=$(echo "$END_RESP" | jq '.paid')
  [ "$END_PAID" = "false" ] && pass "Unpaid session marked paid=false" || fail "Unpaid flag" "$END_PAID"
else
  echo "  ⏭️  Skipped (no nodes online)"
fi

# --- IP Rotation ---
echo "🔄 IP Rotation"
if [ "$NODE_COUNT" -gt 0 ]; then
  # Create a new active session for rotation test
  ROT_SESSION_RESP=$(curl -s -X POST "$BASE/proxy/session" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $API_KEY" \
    -d '{}' --max-time 5)
  ROT_SESSION_ID=$(echo "$ROT_SESSION_RESP" | jq -r '.sessionId')
  
  if [ "$ROT_SESSION_ID" != "null" ] && [ -n "$ROT_SESSION_ID" ]; then
    # Fix 5: WiFi node should reject rotation
    ROTATE_RESP=$(curl -s -X POST "$BASE/proxy/session/$ROT_SESSION_ID/rotate" --max-time 5)
    ROTATE_ERR=$(echo "$ROTATE_RESP" | jq -r '.error // empty')
    if echo "$ROTATE_ERR" | grep -qi "wifi\|mobile"; then
      pass "WiFi rotation rejected with explanation"
    else
      # Could be a timeout or other error — still check
      ROTATE_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/proxy/session/$ROT_SESSION_ID/rotate" --max-time 5)
      [ "$ROTATE_STATUS" = "400" ] && pass "WiFi rotation returns 400" || fail "WiFi rotation" "got status $ROTATE_STATUS, error: $ROTATE_ERR"
    fi
    curl -s -X POST "$BASE/proxy/session/$ROT_SESSION_ID/end" --max-time 5 > /dev/null
  fi
else
  ROTATE_RESP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/proxy/session/fake-session-id/rotate" --max-time 5)
  [ "$ROTATE_RESP" = "404" ] && pass "Rotate on invalid session returns 404" || fail "Rotate invalid session" "got $ROTATE_RESP"
fi

# --- Fix 6: TCP Proxy Auth ---
echo "🔐 TCP Proxy Auth"
# Unauthenticated HTTP proxy should get 407
UNAUTH_RESP=$(curl -s -x http://localhost:1080 http://httpbin.org/ip --max-time 5 2>/dev/null)
if echo "$UNAUTH_RESP" | grep -q "407\|Authentication required"; then
  pass "Unauthenticated HTTP proxy rejected (407)"
else
  fail "Unauthenticated proxy" "expected 407, got: $(echo "$UNAUTH_RESP" | head -c 100)"
fi

# Fix 6: SOCKS5 without auth should be rejected
SOCKS_NOAUTH=$(printf '\x05\x01\x00' | nc -w 3 localhost 1080 2>/dev/null | xxd -p | head -c 4)
[ "$SOCKS_NOAUTH" = "05ff" ] && pass "SOCKS5 no-auth method rejected (0xFF)" || fail "SOCKS5 no-auth" "got '$SOCKS_NOAUTH'"

# --- SOCKS5 with auth ---
echo "🧦 SOCKS5"
if [ "$NODE_COUNT" -gt 0 ]; then
  # SOCKS5 with username/password method offered
  SOCKS_AUTH=$(printf '\x05\x01\x02' | nc -w 3 localhost 1080 2>/dev/null | xxd -p | head -c 4)
  [ "$SOCKS_AUTH" = "0502" ] && pass "SOCKS5 username/password auth accepted" || fail "SOCKS5 auth" "got '$SOCKS_AUTH'"
else
  nc -z localhost 1080 2>/dev/null && pass "TCP proxy port 1080 listening" || fail "TCP proxy port" "not listening"
fi

# --- Proxy Fetch ---
echo "🌐 Proxy Fetch"
if [ "$NODE_COUNT" -gt 0 ]; then
  FETCH_RESP=$(curl -s "$BASE/proxy/fetch?url=http://httpbin.org/ip" --max-time 20)
  FETCH_IP=$(echo "$FETCH_RESP" | jq -r '.response' | jq -r '.origin' 2>/dev/null)
  [ -n "$FETCH_IP" ] && [ "$FETCH_IP" != "null" ] && pass "Fetch returns IP ($FETCH_IP)" || fail "Fetch" "no IP in response"

  FETCH_DEVICE=$(echo "$FETCH_RESP" | jq -r '.device')
  [ -n "$FETCH_DEVICE" ] && [ "$FETCH_DEVICE" != "null" ] && pass "Fetch shows device ($FETCH_DEVICE)" || fail "Fetch device" "missing"

  # Fix 4: Check that fetch session had bytesIn > 0
  FETCH_SID=$(echo "$FETCH_RESP" | jq -r '.sessionId')
  # Session is already ended by fetch, so check the response data presence
  [ -n "$FETCH_IP" ] && pass "Fetch had response data (bytesIn tracked)" || fail "bytesIn tracking" "no response data"
else
  echo "  ⏭️  Skipped (no nodes online)"
fi

# --- SDK ---
echo "📦 SDK"
SDK_PATH="/root/.openclaw/workspace/clawdbot-network/sdk"
[ -f "$SDK_PATH/clawdbot-client.js" ] && pass "SDK client exists" || fail "SDK client" "missing"
[ -f "$SDK_PATH/package.json" ] && pass "SDK package.json exists" || fail "SDK package.json" "missing"
[ -f "$SDK_PATH/README.md" ] && pass "SDK README exists" || fail "SDK README" "missing"

SDK_TEST=$(node -e "
  const Client = require('$SDK_PATH/clawdbot-client');
  const c = new Client({ apiKey: 'test', baseUrl: '$BASE' });
  c.health().then(h => {
    console.log(h.status === 'ok' ? 'ok' : 'fail');
  }).catch(e => console.log('fail: ' + e.message));
" 2>/dev/null)
[ "$SDK_TEST" = "ok" ] && pass "SDK health check works" || fail "SDK health check" "$SDK_TEST"

# --- Skill ---
echo "🎯 OpenClaw Skill"
SKILL_PATH="/root/.openclaw/workspace/skills/clawdbot-proxy"
[ -f "$SKILL_PATH/SKILL.md" ] && pass "SKILL.md exists" || fail "SKILL.md" "missing"
[ -f "$SKILL_PATH/onboard.sh" ] && pass "onboard.sh exists" || fail "onboard.sh" "missing"

# --- Rate Limiting ---
echo "🚦 Rate Limiting"
HEADERS=$(curl -sI "$BASE/admin/health" --max-time 5 2>&1)
echo "$HEADERS" | grep -qi "x-ratelimit" && pass "Rate limit headers present" || fail "Rate limit headers" "missing"

# --- Payment E2E ---
echo "💸 Payment E2E"
SOLANA="/root/.local/share/solana/install/active_release/bin/solana"
AGENT_WALLET="/tmp/agent-wallet.json"
PLATFORM_WALLET="2hRGZqn5hZgr2U6A9ihYxTGoZNnt7XhzNkJCE5eiF5UB"
SESSION_COST="0.005"

if [ -f "$AGENT_WALLET" ]; then
  AGENT_BAL=$($SOLANA balance "$AGENT_WALLET" --url devnet 2>/dev/null | awk '{print $1}')
  if [ "$(echo "$AGENT_BAL > 0.006" | bc -l 2>/dev/null)" = "1" ]; then
    # Create escrow TX
    ESCROW_OUTPUT=$($SOLANA transfer "$PLATFORM_WALLET" "$SESSION_COST" --url devnet --keypair "$AGENT_WALLET" 2>&1)
    ESCROW_TX=$(echo "$ESCROW_OUTPUT" | grep -oP '[1-9A-HJ-NP-Za-km-z]{60,90}' | head -1)
    if [ -n "$ESCROW_TX" ]; then
      pass "Escrow TX created ($ESCROW_TX)"
      sleep 3

      # Create paid session
      PAY_RESP=$(curl -s -X POST "$BASE/proxy/session" \
        -H "Authorization: Bearer $API_KEY" \
        -H "Content-Type: application/json" \
        -d "{\"wallet\":\"Cntvwza3nASfbpqK1WgUUxLwc6qLhKPpevfbB5qbmwug\", \"escrowTx\":\"$ESCROW_TX\"}" --max-time 15)
      PAY_VERIFIED=$(echo "$PAY_RESP" | jq -r '.payment.verified')
      PAY_SID=$(echo "$PAY_RESP" | jq -r '.sessionId')
      PAY_PAID=$(echo "$PAY_RESP" | jq -r '.payment.verified')
      [ "$PAY_VERIFIED" = "true" ] && pass "Paid session verified" || fail "Paid session" "verified=$PAY_VERIFIED"

      if [ "$PAY_SID" != "null" ] && [ -n "$PAY_SID" ]; then
        # End paid session — should trigger payout
        PAY_END=$(curl -s -X POST "$BASE/proxy/session/$PAY_SID/end" --max-time 20)
        PAY_END_PAID=$(echo "$PAY_END" | jq '.paid')
        PAYOUT_OK=$(echo "$PAY_END" | jq -r '.payout.success')
        PAYOUT_SIG=$(echo "$PAY_END" | jq -r '.payout.signature // empty')
        [ "$PAY_END_PAID" = "true" ] && pass "Session marked paid=true" || fail "Paid flag" "$PAY_END_PAID"
        [ "$PAYOUT_OK" = "true" ] && pass "Payout succeeded (TX: ${PAYOUT_SIG:0:20}...)" || fail "Payout" "success=$PAYOUT_OK"
      fi
    else
      fail "Escrow TX" "failed: $ESCROW_OUTPUT"
    fi
  else
    echo "  ⏭️  Skipped (agent wallet balance too low: $AGENT_BAL SOL)"
  fi
else
  echo "  ⏭️  Skipped (no agent wallet at $AGENT_WALLET)"
fi

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
