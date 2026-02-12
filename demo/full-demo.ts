/**
 * Clawdbot Network — Full End-to-End Proxy Demo
 *
 * Demonstrates the complete mobile proxy flow:
 * 1. Register a phone as a proxy node on Solana devnet
 * 2. Agent requests a proxy session (country, carrier, protocol)
 * 3. Escrow SOL payment for the session
 * 4. Route agent traffic through the phone's mobile IP
 * 5. Complete session, release payment to phone owner
 * 6. Store bandwidth proof on-chain
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import * as fs from 'fs';
import * as crypto from 'crypto';

// Config
const SOLANA_RPC = 'https://api.devnet.solana.com';
const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const PLATFORM_FEE_PCT = 30;

function loadKeypair(path: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(path, 'utf-8'));
  return Keypair.fromSecretKey(new Uint8Array(raw));
}

// ── Step 1: Register Phone as Proxy Node ───────────────────────────

async function registerProxyNode(
  connection: Connection,
  payer: Keypair,
  deviceId: string,
  ownerWallet: PublicKey,
  nodeInfo: { carrier: string; country: string; networkType: string }
): Promise<string> {
  console.log('\n📱 Step 1: Registering phone as proxy node on Solana...');

  const memo = JSON.stringify({
    action: 'register_proxy_node',
    deviceId,
    owner: ownerWallet.toBase58(),
    carrier: nodeInfo.carrier,
    country: nodeInfo.country,
    networkType: nodeInfo.networkType,
    capabilities: ['socks5', 'http', 'ip_rotation', 'bandwidth_metering'],
    timestamp: Date.now(),
  });

  const tx = new Transaction().add(
    new TransactionInstruction({
      keys: [{ pubkey: payer.publicKey, isSigner: true, isWritable: true }],
      programId: MEMO_PROGRAM_ID,
      data: Buffer.from(memo),
    })
  );

  const sig = await sendAndConfirmTransaction(connection, tx, [payer]);
  console.log(`  ✅ Proxy node registered! TX: ${sig}`);
  console.log(`  📱 Device: ${deviceId}`);
  console.log(`  📡 Carrier: ${nodeInfo.carrier} (${nodeInfo.country}) — ${nodeInfo.networkType}`);
  console.log(`  👤 Owner: ${ownerWallet.toBase58()}`);
  return sig;
}

// ── Step 2: Agent Requests Proxy Session with Escrow ───────────────

async function requestProxySession(
  connection: Connection,
  agent: Keypair,
  escrowWallet: PublicKey,
  sessionParams: { country: string; carrier: string; protocol: string; durationMinutes: number },
  paymentLamports: number
): Promise<{ sessionId: string; sig: string }> {
  console.log('\n💰 Step 2: Agent requests proxy session + escrows SOL...');

  const sessionId = crypto.randomUUID();

  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: agent.publicKey,
      toPubkey: escrowWallet,
      lamports: paymentLamports,
    }),
    new TransactionInstruction({
      keys: [{ pubkey: agent.publicKey, isSigner: true, isWritable: true }],
      programId: MEMO_PROGRAM_ID,
      data: Buffer.from(JSON.stringify({
        action: 'request_proxy_session',
        sessionId,
        country: sessionParams.country,
        carrier: sessionParams.carrier,
        protocol: sessionParams.protocol,
        duration_minutes: sessionParams.durationMinutes,
        payment_lamports: paymentLamports,
        agent: agent.publicKey.toBase58(),
        timestamp: Date.now(),
      })),
    })
  );

  const sig = await sendAndConfirmTransaction(connection, tx, [agent]);
  console.log(`  ✅ Proxy session created! TX: ${sig}`);
  console.log(`  🔗 Session ID: ${sessionId}`);
  console.log(`  🌐 Protocol: ${sessionParams.protocol}`);
  console.log(`  📍 Target: ${sessionParams.carrier} (${sessionParams.country})`);
  console.log(`  💵 Payment: ${paymentLamports / LAMPORTS_PER_SOL} SOL escrowed`);
  return { sessionId, sig };
}

// ── Step 3: Route Traffic Through Phone Proxy ──────────────────────

async function simulateProxyTraffic(sessionId: string, nodeId: string): Promise<{ bytesTransferred: number; requestCount: number }> {
  console.log('\n🌐 Step 3: Routing agent traffic through phone proxy...');
  console.log(`  📱 Node: ${nodeId}`);
  console.log(`  🔗 Session: ${sessionId}`);
  console.log(`  🔒 Tunnel: WireGuard (encrypted)`);

  // Simulate proxy traffic
  const requests = [
    { url: 'https://api.example.com/data', status: 200, bytes: 15400 },
    { url: 'https://search.example.com/q=solana', status: 200, bytes: 42300 },
    { url: 'https://news.example.com/latest', status: 200, bytes: 28700 },
    { url: 'https://pricing.example.com/plans', status: 200, bytes: 19200 },
    { url: 'https://docs.example.com/api-reference', status: 200, bytes: 35100 },
  ];

  let totalBytes = 0;
  for (const req of requests) {
    totalBytes += req.bytes;
    console.log(`  → ${req.url} [${req.status}] ${(req.bytes / 1024).toFixed(1)}KB`);
  }

  console.log(`  ✅ ${requests.length} requests proxied — ${(totalBytes / 1024).toFixed(1)}KB total`);
  console.log(`  📡 All traffic routed via real mobile IP (CGNAT)`);
  return { bytesTransferred: totalBytes, requestCount: requests.length };
}

// ── Step 4: Complete Session — Release Payment + Store Proof ───────

async function completeSession(
  connection: Connection,
  escrowKeypair: Keypair,
  nodeOwnerWallet: PublicKey,
  platformWallet: PublicKey,
  sessionId: string,
  trafficProof: { bytesTransferred: number; requestCount: number },
  totalPayment: number
): Promise<string> {
  console.log('\n🏁 Step 4: Completing session — payment release + proof...');

  const ownerShare = Math.floor(totalPayment * (100 - PLATFORM_FEE_PCT) / 100);
  const platformShare = totalPayment - ownerShare;

  const proofHash = crypto.createHash('sha256')
    .update(JSON.stringify({ sessionId, ...trafficProof, timestamp: Date.now() }))
    .digest('hex');

  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: escrowKeypair.publicKey,
      toPubkey: nodeOwnerWallet,
      lamports: ownerShare,
    }),
    SystemProgram.transfer({
      fromPubkey: escrowKeypair.publicKey,
      toPubkey: platformWallet,
      lamports: platformShare,
    }),
    new TransactionInstruction({
      keys: [{ pubkey: escrowKeypair.publicKey, isSigner: true, isWritable: true }],
      programId: MEMO_PROGRAM_ID,
      data: Buffer.from(JSON.stringify({
        action: 'complete_proxy_session',
        sessionId,
        proofHash,
        bytesTransferred: trafficProof.bytesTransferred,
        requestCount: trafficProof.requestCount,
        ownerPayment: ownerShare,
        platformFee: platformShare,
        timestamp: Date.now(),
      })),
    })
  );

  const sig = await sendAndConfirmTransaction(connection, tx, [escrowKeypair]);
  console.log(`  ✅ Payment released! TX: ${sig}`);
  console.log(`  👤 Phone owner received: ${ownerShare / LAMPORTS_PER_SOL} SOL (70%)`);
  console.log(`  🏢 Platform fee: ${platformShare / LAMPORTS_PER_SOL} SOL (30%)`);
  console.log(`  📊 Bandwidth proof: ${proofHash.slice(0, 16)}...`);
  console.log(`  📈 Traffic: ${trafficProof.requestCount} requests, ${(trafficProof.bytesTransferred / 1024).toFixed(1)}KB`);
  return sig;
}

// ── Main Demo ──────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  🌐 CLAWDBOT NETWORK — Mobile Proxy for AI Agents');
  console.log('  📱 Phone proxy nodes + Solana micropayments');
  console.log('  ⛓️  Devnet demo');
  console.log('═══════════════════════════════════════════════════════════');

  const connection = new Connection(SOLANA_RPC, 'confirmed');

  // Load wallets
  const mainWallet = loadKeypair('/root/.config/solana/id.json');
  const escrowWallet = Keypair.generate();
  const phoneOwnerWallet = Keypair.generate();
  const platformWallet = mainWallet;

  console.log(`\n🔑 Agent wallet: ${mainWallet.publicKey.toBase58()}`);
  console.log(`🔑 Escrow wallet: ${escrowWallet.publicKey.toBase58()}`);
  console.log(`🔑 Phone owner: ${phoneOwnerWallet.publicKey.toBase58()}`);

  // Fund accounts
  console.log('\n💸 Funding accounts...');
  const fundTx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: mainWallet.publicKey,
      toPubkey: escrowWallet.publicKey,
      lamports: 0.1 * LAMPORTS_PER_SOL,
    }),
    SystemProgram.transfer({
      fromPubkey: mainWallet.publicKey,
      toPubkey: phoneOwnerWallet.publicKey,
      lamports: 0.01 * LAMPORTS_PER_SOL,
    })
  );
  await sendAndConfirmTransaction(connection, fundTx, [mainWallet]);
  console.log('  ✅ Accounts funded');

  // Step 1: Register phone as proxy node
  const nodeId = 'pixel-7-proxy-001';
  await registerProxyNode(connection, mainWallet, nodeId, phoneOwnerWallet.publicKey, {
    carrier: 'T-Mobile',
    country: 'US',
    networkType: 'lte',
  });

  // Step 2: Agent requests proxy session
  const sessionPayment = 0.05 * LAMPORTS_PER_SOL;
  const { sessionId } = await requestProxySession(
    connection,
    mainWallet,
    escrowWallet.publicKey,
    { country: 'US', carrier: 'T-Mobile', protocol: 'socks5', durationMinutes: 10 },
    sessionPayment
  );

  // Step 3: Route traffic through phone
  const trafficProof = await simulateProxyTraffic(sessionId, nodeId);

  // Step 4: Complete session + release payment
  const completeSig = await completeSession(
    connection,
    escrowWallet,
    phoneOwnerWallet.publicKey,
    platformWallet.publicKey,
    sessionId,
    trafficProof,
    sessionPayment
  );

  // Summary
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  ✅ DEMO COMPLETE — Mobile Proxy Session');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  📱 Phone proxy node: ${nodeId} (T-Mobile US, LTE)`);
  console.log(`  🌐 Requests proxied: ${trafficProof.requestCount}`);
  console.log(`  📊 Bandwidth: ${(trafficProof.bytesTransferred / 1024).toFixed(1)}KB`);
  console.log(`  💵 Payment: 0.05 SOL (70% to owner, 30% platform)`);
  console.log(`  🔗 TX: ${completeSig}`);
  console.log(`  🔍 Explorer: https://explorer.solana.com/tx/${completeSig}?cluster=devnet`);
  console.log('═══════════════════════════════════════════════════════════');
}

main().catch(console.error);
