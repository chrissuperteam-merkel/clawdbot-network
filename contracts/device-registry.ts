/**
 * Clawdbot Network - Device Registry
 * 
 * Client-side device registry using Solana accounts.
 * Stores device metadata on-chain via account data and memo program.
 * PDAs are derived conceptually for deterministic addressing.
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
import * as fs from 'fs';

const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const DEVICE_SEED_PREFIX = 'clawdbot-device';

export interface DeviceInfo {
  deviceId: string;
  capabilities: string[];
  ownerWallet: string;
  registeredAt: number;
  account: string; // on-chain account pubkey
  registrationTx: string;
}

// In-memory registry backed by on-chain memo proofs
const deviceStore: Map<string, DeviceInfo> = new Map();

/**
 * Derive a deterministic keypair for a device (simulated PDA).
 * We use a seed-derived approach since true PDAs need a program.
 */
export function deriveDeviceAddress(deviceId: string, authority: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(DEVICE_SEED_PREFIX), Buffer.from(deviceId)],
    SystemProgram.programId
  );
}

/**
 * Register a device on-chain.
 * Creates a memo transaction as proof of registration.
 */
export async function registerDevice(
  connection: Connection,
  payer: Keypair,
  deviceId: string,
  capabilities: string[],
  ownerWallet: PublicKey
): Promise<DeviceInfo> {
  const [devicePda] = deriveDeviceAddress(deviceId, payer.publicKey);

  const memoData = JSON.stringify({
    action: 'register_device',
    deviceId,
    capabilities,
    owner: ownerWallet.toBase58(),
    timestamp: Date.now(),
  });

  const memoIx = new TransactionInstruction({
    keys: [{ pubkey: payer.publicKey, isSigner: true, isWritable: true }],
    programId: MEMO_PROGRAM_ID,
    data: Buffer.from(memoData),
  });

  const tx = new Transaction().add(memoIx);
  const signature = await sendAndConfirmTransaction(connection, tx, [payer], {
    commitment: 'confirmed',
  });

  const device: DeviceInfo = {
    deviceId,
    capabilities,
    ownerWallet: ownerWallet.toBase58(),
    registeredAt: Date.now(),
    account: devicePda.toBase58(),
    registrationTx: signature,
  };

  deviceStore.set(deviceId, device);
  console.log(`✅ Device "${deviceId}" registered. TX: ${signature}`);
  return device;
}

/**
 * Get device info by ID.
 */
export function getDevice(deviceId: string): DeviceInfo | undefined {
  return deviceStore.get(deviceId);
}

/**
 * List all registered devices.
 */
export function listDevices(): DeviceInfo[] {
  return Array.from(deviceStore.values());
}

/**
 * Verify a device registration on-chain by checking the memo transaction.
 */
export async function verifyDeviceRegistration(
  connection: Connection,
  deviceId: string
): Promise<boolean> {
  const device = deviceStore.get(deviceId);
  if (!device) return false;

  try {
    const tx = await connection.getTransaction(device.registrationTx, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });
    return tx !== null;
  } catch {
    return false;
  }
}
