package network.clawdbot.proxy

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.telephony.TelephonyManager
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat

class MainActivity : AppCompatActivity() {

    private lateinit var statusText: TextView
    private lateinit var nodeIdText: TextView
    private lateinit var statsText: TextView
    private lateinit var walletText: TextView
    private lateinit var serverUrlInput: EditText
    private lateinit var toggleButton: Button
    private var isRunning = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        statusText = findViewById(R.id.statusText)
        nodeIdText = findViewById(R.id.nodeIdText)
        statsText = findViewById(R.id.statsText)
        walletText = findViewById(R.id.walletText)
        serverUrlInput = findViewById(R.id.serverUrlInput)
        toggleButton = findViewById(R.id.toggleButton)

        // Request notification permission on Android 13+
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
            }
        }

        // Load or generate wallet
        val wallet = WalletManager.getOrCreate(this)
        walletText.text = "Wallet: ${wallet.publicKey}"

        toggleButton.setOnClickListener {
            if (isRunning) {
                stopProxyService()
            } else {
                startProxyService()
            }
        }

        // Listen for status updates
        ProxyService.statusLiveData.observe(this) { status ->
            statusText.text = "Status: ${status.state}"
            nodeIdText.text = "Node ID: ${status.nodeId ?: "—"}"
            statsText.text = "Requests: ${status.requestCount} | Bytes: ${formatBytes(status.totalBytes)}"
            isRunning = status.state == "connected"
            toggleButton.text = if (isRunning) "⏹ Stop Proxy" else "▶ Start Proxy"
        }
    }

    private fun startProxyService() {
        val serverUrl = serverUrlInput.text.toString().ifBlank { "ws://46.225.67.114:3001/node" }
        val intent = Intent(this, ProxyService::class.java).apply {
            putExtra("serverUrl", serverUrl)
            putExtra("wallet", WalletManager.getOrCreate(this@MainActivity).publicKey)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(intent)
        } else {
            startService(intent)
        }
    }

    private fun stopProxyService() {
        stopService(Intent(this, ProxyService::class.java))
    }

    private fun formatBytes(bytes: Long): String {
        return when {
            bytes < 1024 -> "$bytes B"
            bytes < 1024 * 1024 -> "${bytes / 1024} KB"
            else -> "${"%.1f".format(bytes / (1024.0 * 1024.0))} MB"
        }
    }
}
