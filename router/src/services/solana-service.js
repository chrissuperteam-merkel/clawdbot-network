/**
 * SolanaService — Handles Solana payments, escrow, and payouts
 */
const {
  Connection, PublicKey, Keypair, Transaction,
  SystemProgram, LAMPORTS_PER_SOL, TransactionMessage,
  VersionedTransaction, sendAndConfirmTransaction,
} = require('@solana/web3.js');
const fs = require('fs');
const config = require('../config');

class SolanaService {
  constructor() {
    this.connection = new Connection(config.SOLANA_RPC, 'confirmed');
    this.platformWallet = new PublicKey(config.PLATFORM_WALLET);
    this._loadKeypair();
  }

  _loadKeypair() {
    try {
      const raw = JSON.parse(fs.readFileSync(config.PLATFORM_KEYPAIR_PATH, 'utf-8'));
      this.platformKeypair = Keypair.fromSecretKey(Uint8Array.from(raw));
      console.log(`[SOLANA] Platform wallet: ${this.platformKeypair.publicKey.toBase58()}`);
    } catch (e) {
      console.warn(`[SOLANA] No keypair found at ${config.PLATFORM_KEYPAIR_PATH} — payment features disabled`);
      this.platformKeypair = null;
    }
  }

  /**
   * Verify an escrow payment TX from agent
   * Returns { valid, amount, sender } or { valid: false, error }
   */
  async verifyEscrowPayment(txSignature, expectedAmount) {
    try {
      const tx = await this.connection.getTransaction(txSignature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      });

      if (!tx) return { valid: false, error: 'Transaction not found' };
      if (tx.meta.err) return { valid: false, error: 'Transaction failed on-chain' };

      // Check that platform wallet received funds
      const preBalance = tx.meta.preBalances;
      const postBalance = tx.meta.postBalances;
      const accountKeys = tx.transaction.message.staticAccountKeys || tx.transaction.message.accountKeys;

      let platformIdx = -1;
      for (let i = 0; i < accountKeys.length; i++) {
        if (accountKeys[i].toBase58() === this.platformWallet.toBase58()) {
          platformIdx = i;
          break;
        }
      }

      if (platformIdx === -1) return { valid: false, error: 'Platform wallet not in transaction' };

      const received = (postBalance[platformIdx] - preBalance[platformIdx]) / LAMPORTS_PER_SOL;
      if (received < expectedAmount * 0.99) { // 1% tolerance for fees
        return { valid: false, error: `Insufficient payment: ${received} SOL (expected ${expectedAmount})` };
      }

      const sender = accountKeys[0].toBase58();
      return { valid: true, amount: received, sender };
    } catch (e) {
      return { valid: false, error: e.message };
    }
  }

  /**
   * Release payment to node owner after session completes
   */
  async releasePayment(nodeWallet, amount) {
    if (!this.platformKeypair) {
      return { success: false, error: 'Platform keypair not loaded' };
    }

    try {
      // Try to parse as base58, if it fails try hex→base58
      let recipient;
      try {
        recipient = new PublicKey(nodeWallet);
      } catch {
        // Try interpreting as hex-encoded pubkey bytes
        try {
          const bytes = Buffer.from(nodeWallet, 'hex');
          if (bytes.length === 32) {
            recipient = new PublicKey(bytes);
          } else {
            return { success: false, error: `Invalid wallet format (${bytes.length} bytes, need 32)` };
          }
        } catch {
          return { success: false, error: 'Invalid wallet address format' };
        }
      }
      const lamports = Math.floor(amount * LAMPORTS_PER_SOL);

      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: this.platformKeypair.publicKey,
          toPubkey: recipient,
          lamports,
        })
      );

      const signature = await sendAndConfirmTransaction(this.connection, tx, [this.platformKeypair]);
      console.log(`[SOLANA] Payment released: ${amount} SOL → ${nodeWallet} (${signature})`);
      return { success: true, signature, amount };
    } catch (e) {
      console.error(`[SOLANA] Payment failed: ${e.message}`);
      return { success: false, error: e.message };
    }
  }

  /**
   * Get wallet balance
   */
  async getBalance(wallet) {
    try {
      const balance = await this.connection.getBalance(new PublicKey(wallet));
      return balance / LAMPORTS_PER_SOL;
    } catch (e) {
      return null;
    }
  }
}

module.exports = SolanaService;
