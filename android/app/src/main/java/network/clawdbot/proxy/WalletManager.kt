package network.clawdbot.proxy

import android.content.Context
import android.util.Log
import org.sol4k.Keypair
import org.sol4k.PublicKey

data class PhoneWallet(
    val publicKey: String,
    val keypair: Keypair
)

object WalletManager {
    private const val PREFS = "clawdbot_wallet"
    private const val KEY_PUBLIC = "public_key"
    private const val KEY_SECRET = "secret_key"
    private const val TAG = "WalletManager"

    fun getOrCreate(context: Context): PhoneWallet {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val existingPublic = prefs.getString(KEY_PUBLIC, null)
        val existingSecret = prefs.getString(KEY_SECRET, null)

        // Try to restore existing keypair
        if (existingPublic != null && existingSecret != null) {
            try {
                val secretBytes = hexToBytes(existingSecret)
                val keypair = Keypair.fromSecretKey(secretBytes)
                // Verify it matches stored public key
                if (keypair.publicKey.toBase58() == existingPublic) {
                    Log.i(TAG, "Restored wallet: $existingPublic")
                    return PhoneWallet(existingPublic, keypair)
                }
            } catch (e: Exception) {
                Log.w(TAG, "Failed to restore wallet, generating new one: ${e.message}")
            }
        }

        // Generate new Ed25519 keypair (real Solana wallet)
        val keypair = Keypair.generate()
        val publicKeyBase58 = keypair.publicKey.toBase58()
        val secretKeyHex = bytesToHex(keypair.secret)

        prefs.edit()
            .putString(KEY_PUBLIC, publicKeyBase58)
            .putString(KEY_SECRET, secretKeyHex)
            .apply()

        Log.i(TAG, "Generated new wallet: $publicKeyBase58")
        return PhoneWallet(publicKeyBase58, keypair)
    }

    private fun bytesToHex(bytes: ByteArray): String =
        bytes.joinToString("") { "%02x".format(it) }

    private fun hexToBytes(hex: String): ByteArray =
        hex.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
}
