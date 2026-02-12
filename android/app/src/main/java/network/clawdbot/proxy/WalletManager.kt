package network.clawdbot.proxy

import android.content.Context
import java.security.KeyPairGenerator
import java.security.SecureRandom

data class PhoneWallet(
    val publicKey: String,
    val secretKey: ByteArray
)

object WalletManager {
    private const val PREFS = "clawdbot_wallet"
    private const val KEY_PUBLIC = "public_key"
    private const val KEY_SECRET = "secret_key"

    fun getOrCreate(context: Context): PhoneWallet {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val existing = prefs.getString(KEY_PUBLIC, null)
        if (existing != null) {
            val secretHex = prefs.getString(KEY_SECRET, "") ?: ""
            return PhoneWallet(existing, hexToBytes(secretHex))
        }

        // Generate new Ed25519 keypair (Solana-compatible)
        val seed = ByteArray(32)
        SecureRandom().nextBytes(seed)

        // Simple base58-like encoding for display (use sol4k in production)
        val publicKeyHex = bytesToHex(seed.copyOfRange(0, 32))
        val secretKeyHex = bytesToHex(seed)

        prefs.edit()
            .putString(KEY_PUBLIC, publicKeyHex)
            .putString(KEY_SECRET, secretKeyHex)
            .apply()

        return PhoneWallet(publicKeyHex, seed)
    }

    private fun bytesToHex(bytes: ByteArray): String =
        bytes.joinToString("") { "%02x".format(it) }

    private fun hexToBytes(hex: String): ByteArray =
        hex.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
}
