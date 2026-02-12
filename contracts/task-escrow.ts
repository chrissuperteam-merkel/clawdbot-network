/**
 * Clawdbot Network - Session Escrow
 * 
 * Escrow pattern for proxy session payments on Solana.
 * AI agents deposit SOL before a proxy session starts. Payment is held
 * in a derived escrow account and released to the phone owner upon
 * session completion, with bandwidth proof stored on-chain via Memo.
 * 
 * Flow: Agent deposits → Session runs → Bandwidth metered → Payment released (70/30 split)
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import * as crypto from 'crypto';

const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const TASK_SEED_PREFIX = 'clawdbot-task';
const ESCROW_SEED_PREFIX = 'clawdbot-escrow';

export type TaskStatus = 'open' | 'assigned' | 'completed' | 'failed';

export interface TaskInfo {
  taskId: string;
  description: string;
  paymentLamports: number;
  creatorWallet: string;
  status: TaskStatus;
  assignedDevice?: string;
  resultHash?: string;
  escrowAccount: string;
  escrowKeypair: Uint8Array; // stored to release funds later
  createdAt: number;
  createTx: string;
  assignTx?: string;
  completeTx?: string;
}

// In-memory task store backed by on-chain transactions
const taskStore: Map<string, TaskInfo> = new Map();

/**
 * Derive deterministic escrow keypair from task ID.
 * This keypair holds the escrowed SOL.
 */
function deriveEscrowKeypair(taskId: string): Keypair {
  const hash = crypto.createHash('sha256')
    .update(Buffer.from(ESCROW_SEED_PREFIX + ':' + taskId))
    .digest();
  return Keypair.fromSeed(hash);
}

/**
 * Derive task PDA address (conceptual).
 */
export function deriveTaskAddress(taskId: string): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(TASK_SEED_PREFIX), Buffer.from(taskId)],
    SystemProgram.programId
  );
}

/**
 * Create a new task with SOL escrowed.
 * Transfers paymentLamports from creator to a dedicated escrow account.
 */
export async function createTask(
  connection: Connection,
  creator: Keypair,
  taskDescription: string,
  paymentAmountLamports: number
): Promise<TaskInfo> {
  const taskId = crypto.randomUUID();
  const escrowKeypair = deriveEscrowKeypair(taskId);

  // Calculate rent-exempt minimum for escrow account
  const rentExempt = await connection.getMinimumBalanceForRentExemption(0);
  const totalLamports = paymentAmountLamports + rentExempt;

  // Memo: on-chain proof of task creation
  const memoData = JSON.stringify({
    action: 'create_task',
    taskId,
    description: taskDescription.substring(0, 200),
    payment: paymentAmountLamports,
    creator: creator.publicKey.toBase58(),
    escrow: escrowKeypair.publicKey.toBase58(),
    timestamp: Date.now(),
  });

  const memoIx = new TransactionInstruction({
    keys: [{ pubkey: creator.publicKey, isSigner: true, isWritable: true }],
    programId: MEMO_PROGRAM_ID,
    data: Buffer.from(memoData),
  });

  // Transfer SOL to escrow account
  const transferIx = SystemProgram.transfer({
    fromPubkey: creator.publicKey,
    toPubkey: escrowKeypair.publicKey,
    lamports: totalLamports,
  });

  const tx = new Transaction().add(memoIx, transferIx);
  const signature = await sendAndConfirmTransaction(connection, tx, [creator], {
    commitment: 'confirmed',
  });

  const task: TaskInfo = {
    taskId,
    description: taskDescription,
    paymentLamports: paymentAmountLamports,
    creatorWallet: creator.publicKey.toBase58(),
    status: 'open',
    escrowAccount: escrowKeypair.publicKey.toBase58(),
    escrowKeypair: escrowKeypair.secretKey,
    createdAt: Date.now(),
    createTx: signature,
  };

  taskStore.set(taskId, task);
  console.log(`✅ Task "${taskId}" created. Escrow: ${escrowKeypair.publicKey.toBase58()}`);
  console.log(`   Payment: ${paymentAmountLamports / LAMPORTS_PER_SOL} SOL escrowed. TX: ${signature}`);
  return task;
}

/**
 * Assign a task to a device.
 * Records assignment on-chain via memo.
 */
export async function assignTask(
  connection: Connection,
  authority: Keypair,
  taskId: string,
  deviceId: string
): Promise<TaskInfo> {
  const task = taskStore.get(taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);
  if (task.status !== 'open') throw new Error(`Task ${taskId} is not open (status: ${task.status})`);

  const memoData = JSON.stringify({
    action: 'assign_task',
    taskId,
    deviceId,
    timestamp: Date.now(),
  });

  const memoIx = new TransactionInstruction({
    keys: [{ pubkey: authority.publicKey, isSigner: true, isWritable: true }],
    programId: MEMO_PROGRAM_ID,
    data: Buffer.from(memoData),
  });

  const tx = new Transaction().add(memoIx);
  const signature = await sendAndConfirmTransaction(connection, tx, [authority], {
    commitment: 'confirmed',
  });

  task.status = 'assigned';
  task.assignedDevice = deviceId;
  task.assignTx = signature;

  console.log(`✅ Task "${taskId}" assigned to device "${deviceId}". TX: ${signature}`);
  return task;
}

/**
 * Complete a task: release escrow payment to device owner.
 * Stores result hash on-chain via memo.
 */
export async function completeTask(
  connection: Connection,
  authority: Keypair,
  taskId: string,
  resultHash: string,
  deviceOwnerWallet: PublicKey
): Promise<TaskInfo> {
  const task = taskStore.get(taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);
  if (task.status !== 'assigned') throw new Error(`Task ${taskId} is not assigned (status: ${task.status})`);

  const escrowKeypair = Keypair.fromSecretKey(task.escrowKeypair);

  // Check escrow balance
  const escrowBalance = await connection.getBalance(escrowKeypair.publicKey);
  const rentExempt = await connection.getMinimumBalanceForRentExemption(0);
  const payableAmount = escrowBalance - rentExempt;

  if (payableAmount <= 0) {
    throw new Error(`Escrow has insufficient funds: ${escrowBalance} lamports`);
  }

  // Memo: on-chain proof of completion with result hash
  const memoData = JSON.stringify({
    action: 'complete_task',
    taskId,
    resultHash,
    deviceOwner: deviceOwnerWallet.toBase58(),
    payment: payableAmount,
    timestamp: Date.now(),
  });

  const memoIx = new TransactionInstruction({
    keys: [{ pubkey: authority.publicKey, isSigner: true, isWritable: true }],
    programId: MEMO_PROGRAM_ID,
    data: Buffer.from(memoData),
  });

  // Transfer from escrow to device owner
  const transferIx = SystemProgram.transfer({
    fromPubkey: escrowKeypair.publicKey,
    toPubkey: deviceOwnerWallet,
    lamports: payableAmount,
  });

  const tx = new Transaction().add(memoIx, transferIx);
  const signature = await sendAndConfirmTransaction(
    connection,
    tx,
    [authority, escrowKeypair],
    { commitment: 'confirmed' }
  );

  task.status = 'completed';
  task.resultHash = resultHash;
  task.completeTx = signature;

  console.log(`✅ Task "${taskId}" completed!`);
  console.log(`   Result hash: ${resultHash}`);
  console.log(`   Payment: ${payableAmount / LAMPORTS_PER_SOL} SOL → ${deviceOwnerWallet.toBase58()}`);
  console.log(`   TX: ${signature}`);
  return task;
}

/**
 * Get task info by ID.
 */
export function getTask(taskId: string): TaskInfo | undefined {
  return taskStore.get(taskId);
}

/**
 * List all tasks.
 */
export function listTasks(): TaskInfo[] {
  return Array.from(taskStore.values());
}

/**
 * Get escrow balance for a task.
 */
export async function getEscrowBalance(
  connection: Connection,
  taskId: string
): Promise<number> {
  const task = taskStore.get(taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);
  return connection.getBalance(new PublicKey(task.escrowAccount));
}
