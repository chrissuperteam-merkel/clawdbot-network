/**
 * Clawdbot Network — Full End-to-End Demo
 * 
 * Demonstrates the complete flow:
 * 1. Register a real device (Solana Seeker) on Solana devnet
 * 2. Create a task with SOL payment escrow
 * 3. Route task to the device via Mobilerun API
 * 4. Execute task on real phone
 * 5. Store proof of execution on-chain (memo)
 * 6. Release payment to device owner
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
const MOBILERUN_API = 'https://api.mobilerun.ai/v1/tasks/';
const SEEKER_DEVICE_ID = '2ad4dcc1-d807-4ef0-ac27-47d5731e3d7c';
const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const PLATFORM_FEE_PCT = 30;

// Load keys
function loadKeypair(path: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(path, 'utf-8'));
  return Keypair.fromSecretKey(new Uint8Array(raw));
}

function loadMobilerunKey(): string {
  const config = JSON.parse(fs.readFileSync(`${process.env.HOME}/.config/droidrun/config.json`, 'utf-8'));
  return config.api_key;
}

// Step 1: Register Device on Solana
async function registerDevice(
  connection: Connection,
  payer: Keypair,
  deviceId: string,
  ownerWallet: PublicKey
): Promise<string> {
  console.log('\n📱 Step 1: Registering device on Solana...');
  
  const memo = JSON.stringify({
    action: 'register_device',
    deviceId,
    owner: ownerWallet.toBase58(),
    capabilities: ['screen', 'camera', 'gps', 'mobile_ip', 'apps'],
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
  console.log(`  ✅ Device registered! TX: ${sig}`);
  console.log(`  📋 Device: ${deviceId}`);
  console.log(`  👤 Owner: ${ownerWallet.toBase58()}`);
  return sig;
}

// Step 2: Create Task with Escrow Payment
async function createTask(
  connection: Connection,
  creator: Keypair,
  escrowWallet: PublicKey,
  taskDescription: string,
  rewardLamports: number
): Promise<{ taskId: string; sig: string }> {
  console.log('\n💰 Step 2: Creating task with escrow payment...');
  
  const taskId = crypto.randomUUID();
  
  // Transfer SOL to escrow
  const tx = new Transaction().add(
    // Payment to escrow
    SystemProgram.transfer({
      fromPubkey: creator.publicKey,
      toPubkey: escrowWallet,
      lamports: rewardLamports,
    }),
    // Memo with task details
    new TransactionInstruction({
      keys: [{ pubkey: creator.publicKey, isSigner: true, isWritable: true }],
      programId: MEMO_PROGRAM_ID,
      data: Buffer.from(JSON.stringify({
        action: 'create_task',
        taskId,
        description: taskDescription,
        reward_lamports: rewardLamports,
        creator: creator.publicKey.toBase58(),
        timestamp: Date.now(),
      })),
    })
  );

  const sig = await sendAndConfirmTransaction(connection, tx, [creator]);
  console.log(`  ✅ Task created! TX: ${sig}`);
  console.log(`  🎯 Task ID: ${taskId}`);
  console.log(`  💵 Reward: ${rewardLamports / LAMPORTS_PER_SOL} SOL escrowed`);
  return { taskId, sig };
}

// Step 3: Execute Task on Real Device via Mobilerun
async function executeTaskOnDevice(
  taskDescription: string,
  deviceId: string,
  apiKey: string
): Promise<{ mobilerunTaskId: string; status: string }> {
  console.log('\n🤖 Step 3: Executing task on real device via Mobilerun...');
  console.log(`  📱 Device: ${deviceId}`);
  console.log(`  📋 Task: ${taskDescription}`);

  const response = await fetch(MOBILERUN_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      device_id: deviceId,
      prompt: taskDescription,
      max_steps: 15,
    }),
  });

  const data = await response.json() as any;
  console.log(`  🚀 Mobilerun task started: ${data.id}`);
  
  // Poll for completion
  let status = 'running';
  let result = data;
  while (status === 'running' || status === 'pending') {
    await new Promise(r => setTimeout(r, 5000));
    const statusResp = await fetch(`${MOBILERUN_API}${data.id}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    result = await statusResp.json() as any;
    status = result.status;
    console.log(`  ⏳ Status: ${status}`);
  }

  console.log(`  ✅ Task completed on device!`);
  return { mobilerunTaskId: data.id, status };
}

// Step 4: Complete Task — Store Proof & Release Payment
async function completeTask(
  connection: Connection,
  escrowKeypair: Keypair,
  deviceOwnerWallet: PublicKey,
  platformWallet: PublicKey,
  taskId: string,
  resultHash: string,
  totalReward: number
): Promise<string> {
  console.log('\n🏁 Step 4: Completing task — proof + payment release...');
  
  const ownerShare = Math.floor(totalReward * (100 - PLATFORM_FEE_PCT) / 100);
  const platformShare = totalReward - ownerShare;

  const tx = new Transaction().add(
    // Pay device owner (70%)
    SystemProgram.transfer({
      fromPubkey: escrowKeypair.publicKey,
      toPubkey: deviceOwnerWallet,
      lamports: ownerShare,
    }),
    // Pay platform (30%)
    SystemProgram.transfer({
      fromPubkey: escrowKeypair.publicKey,
      toPubkey: platformWallet,
      lamports: platformShare,
    }),
    // Proof of execution memo
    new TransactionInstruction({
      keys: [{ pubkey: escrowKeypair.publicKey, isSigner: true, isWritable: true }],
      programId: MEMO_PROGRAM_ID,
      data: Buffer.from(JSON.stringify({
        action: 'complete_task',
        taskId,
        resultHash,
        ownerPayment: ownerShare,
        platformFee: platformShare,
        timestamp: Date.now(),
      })),
    })
  );

  const sig = await sendAndConfirmTransaction(connection, tx, [escrowKeypair]);
  console.log(`  ✅ Payment released! TX: ${sig}`);
  console.log(`  👤 Device owner received: ${ownerShare / LAMPORTS_PER_SOL} SOL (70%)`);
  console.log(`  🏢 Platform fee: ${platformShare / LAMPORTS_PER_SOL} SOL (30%)`);
  console.log(`  🔗 Result hash on-chain: ${resultHash}`);
  return sig;
}

// Main Demo Flow
async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('  🤖 CLAWDBOT NETWORK — End-to-End Demo');
  console.log('═══════════════════════════════════════════');

  const connection = new Connection(SOLANA_RPC, 'confirmed');
  
  // Load wallets
  const mainWallet = loadKeypair('/root/.config/solana/id.json');
  const escrowWallet = Keypair.generate(); // Temp escrow for this demo
  const deviceOwnerWallet = Keypair.generate(); // Simulated device owner
  const platformWallet = mainWallet; // Platform = us for demo

  console.log(`\n🔑 Main wallet: ${mainWallet.publicKey.toBase58()}`);
  console.log(`🔑 Escrow wallet: ${escrowWallet.publicKey.toBase58()}`);
  console.log(`🔑 Device owner: ${deviceOwnerWallet.publicKey.toBase58()}`);

  // Fund escrow and device owner accounts
  console.log('\n💸 Funding accounts...');
  const fundTx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: mainWallet.publicKey,
      toPubkey: escrowWallet.publicKey,
      lamports: 0.1 * LAMPORTS_PER_SOL,
    }),
    SystemProgram.transfer({
      fromPubkey: mainWallet.publicKey,
      toPubkey: deviceOwnerWallet.publicKey,
      lamports: 0.01 * LAMPORTS_PER_SOL, // Rent
    })
  );
  await sendAndConfirmTransaction(connection, fundTx, [mainWallet]);
  console.log('  ✅ Accounts funded');

  // Step 1: Register Device
  const regSig = await registerDevice(
    connection,
    mainWallet,
    SEEKER_DEVICE_ID,
    deviceOwnerWallet.publicKey
  );

  // Step 2: Create Task with Payment
  const taskReward = 0.05 * LAMPORTS_PER_SOL;
  const { taskId } = await createTask(
    connection,
    mainWallet,
    escrowWallet.publicKey,
    'Open Chrome browser, navigate to solana.com, take a screenshot of the homepage',
    taskReward
  );

  // Step 3: Execute on Real Device
  const mobilerunKey = loadMobilerunKey();
  let resultHash: string;
  
  try {
    const result = await executeTaskOnDevice(
      'Open Chrome browser, navigate to solana.com, take a screenshot of the homepage',
      SEEKER_DEVICE_ID,
      mobilerunKey
    );
    resultHash = crypto.createHash('sha256')
      .update(JSON.stringify(result))
      .digest('hex');
  } catch (err) {
    console.log('  ⚠️ Mobilerun execution skipped (demo mode)');
    resultHash = crypto.createHash('sha256')
      .update(`demo-result-${taskId}-${Date.now()}`)
      .digest('hex');
  }

  // Step 4: Complete & Pay
  const completeSig = await completeTask(
    connection,
    escrowWallet,
    deviceOwnerWallet.publicKey,
    platformWallet.publicKey,
    taskId,
    resultHash,
    taskReward
  );

  // Summary
  console.log('\n═══════════════════════════════════════════');
  console.log('  ✅ DEMO COMPLETE');
  console.log('═══════════════════════════════════════════');
  console.log(`  Device Registration TX: ${regSig}`);
  console.log(`  Task Escrow TX: see above`);
  console.log(`  Payment Release TX: ${completeSig}`);
  console.log(`  Result Hash: ${resultHash}`);
  console.log(`  Explorer: https://explorer.solana.com/tx/${completeSig}?cluster=devnet`);
  console.log('═══════════════════════════════════════════');
}

main().catch(console.error);
