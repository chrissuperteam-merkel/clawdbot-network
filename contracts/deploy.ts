/**
 * Clawdbot Network - Deploy & Demo Script
 * 
 * Runs a full demo on Solana devnet:
 * 1. Registers a device
 * 2. Creates a task with escrowed SOL
 * 3. Assigns task to device
 * 4. Completes task, releasing payment
 * 
 * Usage: npx ts-node contracts/deploy.ts
 */

import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  clusterApiUrl,
} from '@solana/web3.js';
import * as fs from 'fs';
import * as crypto from 'crypto';

import { registerDevice, getDevice, listDevices } from './device-registry';
import { createTask, assignTask, completeTask, getTask, getEscrowBalance } from './task-escrow';

const SOLANA_CLI_PATH = '/root/.local/share/solana/install/active_release/bin/';
const KEYPAIR_PATH = '/root/.config/solana/id.json';

async function loadKeypair(): Promise<Keypair> {
  const raw = fs.readFileSync(KEYPAIR_PATH, 'utf-8');
  const secretKey = Uint8Array.from(JSON.parse(raw));
  return Keypair.fromSecretKey(secretKey);
}

async function main() {
  console.log('🚀 Clawdbot Network - Solana Devnet Deploy & Demo');
  console.log('='.repeat(55));

  // Connect to devnet
  const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');
  const payer = await loadKeypair();
  console.log(`\n👛 Wallet: ${payer.publicKey.toBase58()}`);

  // Check balance
  const balance = await connection.getBalance(payer.publicKey);
  console.log(`💰 Balance: ${balance / LAMPORTS_PER_SOL} SOL`);

  if (balance < 0.1 * LAMPORTS_PER_SOL) {
    console.log('⚠️  Low balance. Requesting airdrop...');
    const sig = await connection.requestAirdrop(payer.publicKey, LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig, 'confirmed');
    console.log('✅ Airdrop received!');
  }

  // --- Step 1: Register Device ---
  console.log('\n📱 Step 1: Register Device');
  console.log('-'.repeat(40));
  const device = await registerDevice(
    connection,
    payer,
    'android-pixel-001',
    ['camera', 'gps', 'browser', 'app-interaction'],
    payer.publicKey
  );
  console.log(`   Device PDA: ${device.account}`);

  // Verify
  const fetched = getDevice('android-pixel-001');
  console.log(`   Verified: ${fetched ? '✅' : '❌'}`);

  // --- Step 2: Create Task ---
  console.log('\n📋 Step 2: Create Task with Escrow');
  console.log('-'.repeat(40));
  const paymentAmount = 0.01 * LAMPORTS_PER_SOL; // 0.01 SOL
  const task = await createTask(
    connection,
    payer,
    'Take screenshot of app store listing for ClawdBot',
    paymentAmount
  );

  // Check escrow
  const escrowBal = await getEscrowBalance(connection, task.taskId);
  console.log(`   Escrow balance: ${escrowBal / LAMPORTS_PER_SOL} SOL`);

  // --- Step 3: Assign Task ---
  console.log('\n🔗 Step 3: Assign Task to Device');
  console.log('-'.repeat(40));
  await assignTask(connection, payer, task.taskId, 'android-pixel-001');

  // --- Step 4: Complete Task ---
  console.log('\n✅ Step 4: Complete Task & Release Payment');
  console.log('-'.repeat(40));
  const resultHash = crypto.createHash('sha256')
    .update('screenshot-data-placeholder-' + Date.now())
    .digest('hex');

  await completeTask(
    connection,
    payer,
    task.taskId,
    resultHash,
    payer.publicKey // In real scenario, this would be the device owner's wallet
  );

  // --- Summary ---
  console.log('\n📊 Summary');
  console.log('='.repeat(55));
  const finalTask = getTask(task.taskId);
  if (finalTask) {
    console.log(`   Task ID:      ${finalTask.taskId}`);
    console.log(`   Status:       ${finalTask.status}`);
    console.log(`   Result Hash:  ${finalTask.resultHash}`);
    console.log(`   Create TX:    ${finalTask.createTx}`);
    console.log(`   Assign TX:    ${finalTask.assignTx}`);
    console.log(`   Complete TX:  ${finalTask.completeTx}`);
  }

  const devices = listDevices();
  console.log(`\n   Registered Devices: ${devices.length}`);
  devices.forEach(d => console.log(`     - ${d.deviceId} (${d.capabilities.join(', ')})`));

  console.log('\n🎉 Demo complete! All transactions on Solana devnet.');
  console.log('   View on explorer: https://explorer.solana.com/?cluster=devnet');
}

main().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
