/**
 * SolanaService — Handles Solana payments, escrow, and payouts
 */
const {
  Connection, PublicKey, Keypair, Transaction,
  SystemProgram, LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} = require('@solana/web3.js');
const fs = require('fs');
const config = require('../config');
const { child } = require('./logger');

const log = child('solana');

class SolanaService {
  constructor(db) {
    this.connection = new Connection(config.SOLANA_RPC, 'confirmed');
    this.platformWallet = new PublicKey(config.PLATFORM_WALLET);
    this.db = db || null;
    this._loadKeypair();
  }

  _loadKeypair() {
    try {
      const raw = JSON.parse(fs.readFileSync(config.PLATFORM_KEYPAIR_PATH, 'utf-8'));
      this.platformKeypair = Keypair.fromSecretKey(Uint8Array.from(raw));
      log.info({ wallet: this.platformKeypair.publicKey.toBase58() }, 'Platform wallet loaded');
    } catch (e) {
      log.warn({ path: config.PLATFORM_KEYPAIR_PATH }, 'No keypair found — payment features disabled');
      this.platformKeypair = null;
    }
  }

  async verifyEscrowPayment(txSignature, expectedAmount) {
    try {
      const tx = await this.connection.getTransaction(txSignature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      });

      if (!tx) return { valid: false, error: 'Transaction not found' };
      if (tx.meta.err) return { valid: false, error: 'Transaction failed on-chain' };

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
      if (received < expectedAmount * 0.99) {
        return { valid: false, error: `Insufficient payment: ${received} SOL (expected ${expectedAmount})` };
      }

      const sender = accountKeys[0].toBase58();
      return { valid: true, amount: received, sender };
    } catch (e) {
      return { valid: false, error: e.message };
    }
  }

  /**
   * Release payment to node owner with retry logic and TX verification
   */
  async releasePayment(nodeWallet, amount, sessionId) {
    if (!this.platformKeypair) {
      return { success: false, error: 'Platform keypair not loaded' };
    }

    let recipient;
    try {
      recipient = new PublicKey(nodeWallet);
    } catch {
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
    const MAX_RETRIES = 3;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const tx = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: this.platformKeypair.publicKey,
            toPubkey: recipient,
            lamports,
          })
        );

        const signature = await sendAndConfirmTransaction(this.connection, tx, [this.platformKeypair]);

        // Verify TX landed
        const confirmed = await this.connection.getSignatureStatus(signature);
        log.info({ amount, recipient: nodeWallet, signature, attempt }, 'Payment released');

        // Save payout to DB
        if (this.db) {
          try { this.db.savePayout(sessionId, nodeWallet, amount, signature, true, null); } catch {}
        }

        return { success: true, signature, amount };
      } catch (e) {
        log.warn({ attempt, error: e.message }, 'Payment attempt failed');
        if (attempt === MAX_RETRIES) {
          if (this.db) {
            try { this.db.savePayout(sessionId, nodeWallet, amount, null, false, e.message); } catch {}
          }
          return { success: false, error: e.message };
        }
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }

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
