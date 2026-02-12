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
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

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

        // Request permissions
        val permsNeeded = mutableListOf<String>()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                permsNeeded.add(Manifest.permission.POST_NOTIFICATIONS)
            }
        }
        if (checkSelfPermission(Manifest.permission.READ_PHONE_STATE) != PackageManager.PERMISSION_GRANTED) {
            permsNeeded.add(Manifest.permission.READ_PHONE_STATE)
        }
        if (permsNeeded.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, permsNeeded.toTypedArray(), 1)
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

        // Fix 9: Check for updates
        checkForUpdate()

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
        val serverUrl = serverUrlInput.text.toString().ifBlank { "wss://static.114.67.225.46.clients.your-server.de/clawdbot/node" }
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

    private fun checkForUpdate() {
        Thread {
            try {
                val url = URL("https://static.114.67.225.46.clients.your-server.de/clawdbot/version.json")
                val conn = url.openConnection() as HttpURLConnection
                conn.connectTimeout = 5000
                conn.readTimeout = 5000
                val json = conn.inputStream.bufferedReader().readText()
                conn.disconnect()
                val obj = JSONObject(json)
                val minVersion = obj.getString("minVersion")
                val currentVersion = packageManager.getPackageInfo(packageName, 0).versionName ?: "0.0.0"
                if (compareVersions(currentVersion, minVersion) < 0) {
                    runOnUiThread {
                        AlertDialog.Builder(this)
                            .setTitle("Update Required")
                            .setMessage("A new version (${obj.getString("version")}) is required. Current: $currentVersion")
                            .setPositiveButton("OK", null)
                            .show()
                    }
                }
            } catch (e: Exception) {
                // Silently ignore update check failures
            }
        }.start()
    }

    private fun compareVersions(v1: String, v2: String): Int {
        val p1 = v1.split(".").map { it.toIntOrNull() ?: 0 }
        val p2 = v2.split(".").map { it.toIntOrNull() ?: 0 }
        for (i in 0 until maxOf(p1.size, p2.size)) {
            val a = p1.getOrElse(i) { 0 }
            val b = p2.getOrElse(i) { 0 }
            if (a != b) return a.compareTo(b)
        }
        return 0
    }

    private fun formatBytes(bytes: Long): String {
        return when {
            bytes < 1024 -> "$bytes B"
            bytes < 1024 * 1024 -> "${bytes / 1024} KB"
            else -> "${"%.1f".format(bytes / (1024.0 * 1024.0))} MB"
        }
    }
}
