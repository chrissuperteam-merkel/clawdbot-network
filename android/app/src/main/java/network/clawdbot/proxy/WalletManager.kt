package network.clawdbot.proxy

import android.content.Context
import java.security.SecureRandom

data class PhoneWallet(
    val publicKey: String,
    val secretKey: ByteArray
)

object WalletManager {
    private const val PREFS = "clawdbot_wallet"
    private const val KEY_PUBLIC = "public_key"
    private const val KEY_SECRET = "secret_key"

    // Base58 alphabet (Bitcoin/Solana standard)
    private const val ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

    fun getOrCreate(context: Context): PhoneWallet {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val existing = prefs.getString(KEY_PUBLIC, null)

        // Check if existing key is already base58 (not hex)
        if (existing != null && existing.length in 32..44 && !existing.matches(Regex("^[0-9a-f]+$"))) {
            val secretHex = prefs.getString(KEY_SECRET, "") ?: ""
            return PhoneWallet(existing, hexToBytes(secretHex))
        }

        // Generate new Ed25519-compatible keypair
        // Solana uses 32-byte seeds; the public key is derived from the seed
        // For simplicity, we generate a 32-byte random key and base58-encode it
        // In production, use sol4k or TweetNaCl for proper Ed25519
        val seed = ByteArray(32)
        SecureRandom().nextBytes(seed)
        val publicKeyBase58 = base58Encode(seed)
        val secretKeyHex = bytesToHex(seed)

        prefs.edit()
            .putString(KEY_PUBLIC, publicKeyBase58)
            .putString(KEY_SECRET, secretKeyHex)
            .apply()

        return PhoneWallet(publicKeyBase58, seed)
    }

    /**
     * Base58 encode bytes (Solana-compatible)
     */
    fun base58Encode(input: ByteArray): String {
        if (input.isEmpty()) return ""

        // Count leading zeros
        var zeros = 0
        for (b in input) {
            if (b.toInt() == 0) zeros++ else break
        }

        // Convert to big integer and encode
        val encoded = StringBuilder()
        var num = java.math.BigInteger(1, input)
        val base = java.math.BigInteger.valueOf(58)
        val zero = java.math.BigInteger.ZERO

        while (num > zero) {
            val (quotient, remainder) = num.divideAndRemainder(base)
            encoded.append(ALPHABET[remainder.toInt()])
            num = quotient
        }

        // Add leading '1's for zero bytes
        repeat(zeros) { encoded.append('1') }

        return encoded.reverse().toString()
    }

    private fun bytesToHex(bytes: ByteArray): String =
        bytes.joinToString("") { "%02x".format(it) }

    private fun hexToBytes(hex: String): ByteArray =
        hex.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
}
