#!/usr/bin/env node
/**
 * Clawdbot Network — Full E2E Payment Test
 * Creates real Solana devnet transactions, routes traffic through mobile proxy, verifies payout.
 */
const { execSync } = require('child_process');
const ClawdbotClient = require('../sdk/clawdbot-client');

const SOLANA = '/root/.local/share/solana/install/active_release/bin/solana';
const AGENT_WALLET_PATH = '/tmp/agent-wallet.json';
const PLATFORM_WALLET = '2hRGZqn5hZgr2U6A9ihYxTGoZNnt7XhzNkJCE5eiF5UB';
const ADMIN_SECRET = 'clawdbot-dev';
const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';
const SESSION_COST = 0.005;

function sol(cmd) {
  return execSync(`${SOLANA} ${cmd}`, { encoding: 'utf-8' }).trim();
}

async function adminRequest(method, path, body = null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': ADMIN_SECRET },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE_URL}${path}`, opts);
  return res.json();
}

async function main() {
  console.log('🚀 Clawdbot Network — E2E Payment Test');
  console.log('=' .repeat(60));

  // 1. Check agent wallet balance
  const agentBalance = parseFloat(sol(`balance ${AGENT_WALLET_PATH} --url devnet`));
  console.log(`\n💰 Agent wallet balance: ${agentBalance} SOL`);
  if (agentBalance < SESSION_COST + 0.001) {
    console.log('⚠️  Low balance, funding from platform wallet...');
    const fundTx = sol(`transfer Cntvwza3nASfbpqK1WgUUxLwc6qLhKPpevfbB5qbmwug 0.1 --url devnet --keypair ~/.config/solana/id.json --allow-unfunded-recipient`);
    console.log(`   Funded: ${fundTx}`);
    await new Promise(r => setTimeout(r, 3000));
  }

  // 2. Get API key
  console.log('\n🔑 Getting API key...');
  const keyResp = await adminRequest('POST', '/admin/keys', { label: 'e2e-demo-' + Date.now() });
  const apiKey = keyResp.apiKey;
  console.log(`   Key: ${apiKey.slice(0, 16)}...`);

  const client = new ClawdbotClient({ apiKey, baseUrl: BASE_URL });

  // 3. List nodes
  console.log('\n📱 Listing nodes...');
  const nodesResp = await client.listNodes();
  console.log(`   Found ${nodesResp.count} node(s)`);
  if (nodesResp.count === 0) {
    console.log('❌ No nodes online — cannot proceed');
    process.exit(1);
  }
  const node = nodesResp.nodes[0];
  console.log(`   Node: ${node.device} (${node.carrier}, ${node.country})`);
  console.log(`   Stealth: ${node.stealthScore}, Quality: ${node.qualityScore}, Tier: ${node.pricingTier}`);

  // 4. Record node wallet balance before
  const nodeBalanceBefore = parseFloat(sol(`balance ${node.wallet} --url devnet`));
  console.log(`\n💳 Node wallet before: ${nodeBalanceBefore} SOL`);

  // 5. Create escrow TX
  console.log('\n📝 Creating escrow TX...');
  const escrowOutput = sol(`transfer ${PLATFORM_WALLET} ${SESSION_COST} --url devnet --keypair ${AGENT_WALLET_PATH}`);
  const txSig = escrowOutput.replace(/^Signature:\s*/, '').trim();
  console.log(`   TX: ${txSig}`);
  await new Promise(r => setTimeout(r, 3000));

  // 6. Create paid session
  console.log('\n🔒 Creating paid session...');
  const sessionResp = await client._request('POST', '/proxy/session', {
    wallet: 'Cntvwza3nASfbpqK1WgUUxLwc6qLhKPpevfbB5qbmwug',
    escrowTx: txSig,
  });
  console.log(`   Session: ${sessionResp.sessionId}`);
  console.log(`   Payment verified: ${sessionResp.payment?.verified}`);
  console.log(`   Paid: ${sessionResp.payment?.verified === true ? '✅ YES' : '❌ NO'}`);

  if (!sessionResp.payment?.verified) {
    console.log('❌ Payment not verified — aborting');
    process.exit(1);
  }

  // 7. Fetch through proxy
  console.log('\n🌐 Fetching through proxy...');

  // Use the HTTP API fetch endpoint (simpler than TCP proxy from Node.js)
  const ipResp = await client.fetch(sessionResp.sessionId, 'http://httpbin.org/ip');
  console.log(`   IP: ${ipResp.response?.trim() || JSON.stringify(ipResp)}`);

  const headersResp = await client.fetch(sessionResp.sessionId, 'http://httpbin.org/headers');
  console.log(`   Headers response received (${headersResp.response?.length || 0} bytes)`);

  // 8. End session
  console.log('\n🏁 Ending session...');
  const endResp = await client.endSession(sessionResp.sessionId);
  console.log(`   Duration: ${endResp.duration}ms`);
  console.log(`   Bytes: in=${endResp.bytesIn}, out=${endResp.bytesOut}`);
  console.log(`   Requests: ${endResp.requestCount}`);
  console.log(`   Cost: ${JSON.stringify(endResp.cost)}`);
  console.log(`   Paid: ${endResp.paid}`);
  console.log(`   Payout: ${endResp.payout?.success ? '✅' : '❌'} ${endResp.payout?.signature || endResp.payout?.error || endResp.payout?.note || ''}`);

  // 9. Verify node wallet balance increased
  await new Promise(r => setTimeout(r, 2000));
  const nodeBalanceAfter = parseFloat(sol(`balance ${node.wallet} --url devnet`));
  const diff = nodeBalanceAfter - nodeBalanceBefore;
  console.log(`\n💳 Node wallet after: ${nodeBalanceAfter} SOL (${diff > 0 ? '+' : ''}${diff.toFixed(6)} SOL)`);

  // 10. Check payouts
  const payoutsResp = await adminRequest('GET', '/admin/payouts');
  const latestPayout = payoutsResp.payouts?.[0];
  console.log(`\n📊 Latest payout:`);
  if (latestPayout) {
    console.log(`   Session: ${latestPayout.sessionId}`);
    console.log(`   Amount: ${latestPayout.amount} SOL`);
    console.log(`   TX: ${latestPayout.txSignature}`);
    console.log(`   Success: ${latestPayout.success ? '✅' : '❌'}`);
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📋 E2E TEST REPORT');
  console.log('='.repeat(60));
  console.log(`Node:          ${node.device} (${node.country})`);
  console.log(`Stealth Score: ${node.stealthScore}`);
  console.log(`Escrow TX:     ${txSig}`);
  console.log(`Session:       ${sessionResp.sessionId}`);
  console.log(`Payment:       ${sessionResp.payment?.verified ? '✅ Verified' : '❌ Failed'}`);
  console.log(`Proxy IP:      ${ipResp.response?.trim() || 'N/A'}`);
  console.log(`Payout:        ${endResp.payout?.success ? '✅ ' + endResp.payout.signature : '❌ ' + (endResp.payout?.error || endResp.payout?.note)}`);
  console.log(`Node Δ:        ${diff > 0 ? '+' : ''}${diff.toFixed(6)} SOL`);
  console.log('='.repeat(60));

  const success = sessionResp.payment?.verified && endResp.payout?.success && diff > 0;
  console.log(success ? '\n✅ ALL CHECKS PASSED' : '\n⚠️  SOME CHECKS MAY HAVE ISSUES');
  process.exit(success ? 0 : 1);
}

main().catch(e => {
  console.error('❌ Fatal error:', e.message);
  process.exit(1);
});
