package network.clawdbot.proxy

import android.app.*
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.telephony.TelephonyManager
import android.util.Base64
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.lifecycle.MutableLiveData
import com.google.gson.Gson
import com.google.gson.JsonObject
import okhttp3.*
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.ConcurrentHashMap

data class ProxyStatus(
    val state: String = "disconnected",
    val nodeId: String? = null,
    val requestCount: Int = 0,
    val totalBytes: Long = 0
)

class ProxyService : Service() {
    companion object {
        val statusLiveData = MutableLiveData(ProxyStatus())
        private const val TAG = "ClawdbotProxy"
        private const val CHANNEL_ID = "clawdbot_proxy"
        private const val NOTIFICATION_ID = 1
        private const val MAX_RECONNECT_DELAY_MS = 60_000L
        private const val HEARTBEAT_INTERVAL_MS = 25_000L
    }

    private var webSocket: WebSocket? = null
    private val client = OkHttpClient.Builder()
        .pingInterval(20, TimeUnit.SECONDS)
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.SECONDS) // No read timeout for WebSocket
        .build()
    private val gson = Gson()
    private val executor = Executors.newCachedThreadPool()
    private var nodeId: String? = null
    private var requestCount = 0
    private var totalBytes = 0L
    private var wallet: String? = null
    private var serverUrl: String = ""
    private var reconnectAttempts = 0
    private var isRunning = false

    // Active CONNECT tunnels: requestId -> Socket
    private val activeTunnels = ConcurrentHashMap<String, java.net.Socket>()

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        serverUrl = intent?.getStringExtra("serverUrl")
            ?: "wss://static.114.67.225.46.clients.your-server.de/clawdbot/node"
        wallet = intent?.getStringExtra("wallet")
        isRunning = true

        startForeground(NOTIFICATION_ID, buildNotification("Connecting..."))
        connectToRouter()

        return START_STICKY
    }

    override fun onDestroy() {
        isRunning = false
        webSocket?.close(1000, "Service stopped")
        webSocket = null
        // Close all active tunnels
        activeTunnels.values.forEach { runCatching { it.close() } }
        activeTunnels.clear()
        statusLiveData.postValue(ProxyStatus("disconnected"))
        super.onDestroy()
    }

    // ─── WebSocket Connection ───

    private fun connectToRouter() {
        if (!isRunning) return

        Log.i(TAG, "Connecting to $serverUrl (attempt ${reconnectAttempts + 1})")
        val request = Request.Builder().url(serverUrl).build()

        webSocket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(ws: WebSocket, response: Response) {
                Log.i(TAG, "Connected to router")
                reconnectAttempts = 0
                statusLiveData.postValue(ProxyStatus("connected"))
                updateNotification("Connected — registering...")
                register(ws)
                startHeartbeat(ws)
            }

            override fun onMessage(ws: WebSocket, text: String) {
                try {
                    val msg = gson.fromJson(text, JsonObject::class.java)
                    handleMessage(ws, msg)
                } catch (e: Exception) {
                    Log.e(TAG, "Error parsing message: ${e.message}")
                }
            }

            override fun onClosed(ws: WebSocket, code: Int, reason: String) {
                Log.i(TAG, "Disconnected: $reason (code $code)")
                statusLiveData.postValue(ProxyStatus("disconnected", nodeId, requestCount, totalBytes))
                updateNotification("Disconnected — reconnecting...")
                closeTunnels()
                scheduleReconnect()
            }

            override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                Log.e(TAG, "Connection failed: ${t.message}")
                statusLiveData.postValue(ProxyStatus("error", nodeId, requestCount, totalBytes))
                updateNotification("Connection error — reconnecting...")
                closeTunnels()
                scheduleReconnect()
            }
        })
    }

    private fun register(ws: WebSocket) {
        val registration = JsonObject().apply {
            addProperty("type", "register")
            addProperty("device", "${Build.MANUFACTURER} ${Build.MODEL}")
            addProperty("carrier", getCarrierName())
            addProperty("country", getCountryCode())
            addProperty("connectionType", getConnectionType())
            addProperty("wallet", wallet ?: "")
            addProperty("androidVersion", Build.VERSION.RELEASE)
            addProperty("sdk", Build.VERSION.SDK_INT)
        }
        ws.send(gson.toJson(registration))
    }

    private fun startHeartbeat(ws: WebSocket) {
        executor.submit {
            while (isRunning && ws.send(gson.toJson(JsonObject().apply {
                    addProperty("type", "heartbeat")
                    addProperty("timestamp", System.currentTimeMillis())
                    addProperty("requestCount", requestCount)
                    addProperty("totalBytes", totalBytes)
                    addProperty("activeTunnels", activeTunnels.size)
                }))) {
                Thread.sleep(HEARTBEAT_INTERVAL_MS)
            }
        }
    }

    private fun scheduleReconnect() {
        if (!isRunning) return
        reconnectAttempts++
        // Exponential backoff: 2s, 4s, 8s, 16s, 32s, 60s max
        val delay = minOf(2000L * (1L shl minOf(reconnectAttempts - 1, 5)), MAX_RECONNECT_DELAY_MS)
        Log.i(TAG, "Reconnecting in ${delay}ms (attempt $reconnectAttempts)")
        executor.submit {
            Thread.sleep(delay)
            if (isRunning) connectToRouter()
        }
    }

    private fun closeTunnels() {
        activeTunnels.values.forEach { runCatching { it.close() } }
        activeTunnels.clear()
    }

    // ─── Message Handler ───

    private fun handleMessage(ws: WebSocket, msg: JsonObject) {
        when (msg.get("type")?.asString) {
            "welcome" -> {
                nodeId = msg.get("nodeId")?.asString
                Log.i(TAG, "Got welcome, nodeId: $nodeId")
            }
            "registered" -> {
                nodeId = msg.get("nodeId")?.asString
                Log.i(TAG, "Registration confirmed: $nodeId")
                statusLiveData.postValue(ProxyStatus("connected", nodeId, requestCount, totalBytes))
                updateNotification("Online — waiting for requests")
            }
            "heartbeat_ack" -> {
                // Router is alive
            }
            "proxy_http" -> {
                executor.submit { handleHttpProxy(ws, msg) }
            }
            "proxy_connect" -> {
                executor.submit { handleConnectProxy(ws, msg) }
            }
            "proxy_data" -> {
                executor.submit { handleProxyData(msg) }
            }
        }
    }

    // ─── HTTP Proxy ───

    private fun handleHttpProxy(ws: WebSocket, msg: JsonObject) {
        val requestId = msg.get("requestId")?.asString ?: return
        val sessionId = msg.get("sessionId")?.asString ?: return
        val rawRequest = msg.get("rawRequest")?.asString ?: return

        try {
            val requestBytes = Base64.decode(rawRequest, Base64.DEFAULT)
            val requestStr = String(requestBytes)

            // Parse HTTP request line
            val lines = requestStr.split("\r\n")
            val firstLine = lines[0]
            val match = Regex("^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS) (\\S+) HTTP").find(firstLine)
            val method = match?.groupValues?.get(1) ?: "GET"
            val urlStr = match?.groupValues?.get(2) ?: return

            Log.i(TAG, "[$requestId] $method $urlStr")
            requestCount++
            updateStats()

            val url = URL(urlStr)
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = method
            conn.connectTimeout = 15000
            conn.readTimeout = 15000
            conn.instanceFollowRedirects = true

            // Copy headers (skip proxy-internal ones)
            for (i in 1 until lines.size) {
                val line = lines[i]
                if (line.isBlank()) break
                val colonIdx = line.indexOf(':')
                if (colonIdx > 0) {
                    val key = line.substring(0, colonIdx).trim()
                    val value = line.substring(colonIdx + 1).trim()
                    if (key.equals("Host", ignoreCase = true) ||
                        key.equals("X-Session-Id", ignoreCase = true) ||
                        key.equals("Proxy-Connection", ignoreCase = true) ||
                        key.equals("Proxy-Authorization", ignoreCase = true)) continue
                    conn.setRequestProperty(key, value)
                }
            }

            // Read response
            val responseCode = conn.responseCode
            val responseStream = try { conn.inputStream } catch (e: Exception) { conn.errorStream }
            val responseBody = responseStream?.readBytes() ?: ByteArray(0)
            totalBytes += responseBody.size

            // Build full HTTP response
            val sb = StringBuilder()
            sb.append("HTTP/1.1 $responseCode ${conn.responseMessage ?: "OK"}\r\n")
            conn.headerFields.forEach { (key, values) ->
                if (key != null) {
                    values.forEach { sb.append("$key: $it\r\n") }
                }
            }
            sb.append("\r\n")
            val fullResponse = sb.toString().toByteArray() + responseBody

            // Send back to router
            val response = JsonObject().apply {
                addProperty("type", "proxy_response")
                addProperty("requestId", requestId)
                addProperty("sessionId", sessionId)
                addProperty("data", Base64.encodeToString(fullResponse, Base64.NO_WRAP))
                addProperty("done", true)
            }
            ws.send(gson.toJson(response))
            updateStats()
            conn.disconnect()

        } catch (e: Exception) {
            Log.e(TAG, "Proxy error [$requestId]: ${e.message}")
            val error = JsonObject().apply {
                addProperty("type", "proxy_error")
                addProperty("requestId", requestId)
                addProperty("error", e.message ?: "unknown error")
            }
            ws.send(gson.toJson(error))
        }
    }

    // ─── HTTPS CONNECT Tunnel ───

    private fun handleConnectProxy(ws: WebSocket, msg: JsonObject) {
        val requestId = msg.get("requestId")?.asString ?: return
        val sessionId = msg.get("sessionId")?.asString ?: return
        val host = msg.get("host")?.asString ?: return
        val port = msg.get("port")?.asInt ?: 443

        try {
            Log.i(TAG, "[$requestId] CONNECT $host:$port")
            requestCount++
            updateStats()

            val socket = java.net.Socket(host, port)
            socket.soTimeout = 60000
            socket.tcpNoDelay = true
            activeTunnels[requestId] = socket

            val input = socket.getInputStream()

            // Tell router we're ready — router will send 200 Connection Established to client
            val ready = JsonObject().apply {
                addProperty("type", "connect_ready")
                addProperty("requestId", requestId)
                addProperty("sessionId", sessionId)
            }
            ws.send(gson.toJson(ready))
            Log.i(TAG, "[$requestId] CONNECT ready, tunnel open to $host:$port")

            // Background thread: read from target → send to router
            executor.submit {
                try {
                    val buffer = ByteArray(32768)
                    while (!socket.isClosed) {
                        val bytesRead = input.read(buffer)
                        if (bytesRead == -1) break
                        totalBytes += bytesRead
                        val chunk = buffer.copyOf(bytesRead)
                        val response = JsonObject().apply {
                            addProperty("type", "proxy_response")
                            addProperty("requestId", requestId)
                            addProperty("sessionId", sessionId)
                            addProperty("data", Base64.encodeToString(chunk, Base64.NO_WRAP))
                            addProperty("done", false)
                        }
                        ws.send(gson.toJson(response))
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "CONNECT read error [$requestId]: ${e.message}")
                } finally {
                    // Send done signal
                    val done = JsonObject().apply {
                        addProperty("type", "proxy_response")
                        addProperty("requestId", requestId)
                        addProperty("sessionId", sessionId)
                        addProperty("data", "")
                        addProperty("done", true)
                    }
                    runCatching { ws.send(gson.toJson(done)) }
                    runCatching { socket.close() }
                    activeTunnels.remove(requestId)
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "CONNECT error [$requestId]: ${e.message}")
            val error = JsonObject().apply {
                addProperty("type", "proxy_error")
                addProperty("requestId", requestId)
                addProperty("error", e.message ?: "connection failed")
            }
            ws.send(gson.toJson(error))
        }
    }

    /**
     * Handle proxy_data: forward data from agent to the CONNECT tunnel target
     */
    private fun handleProxyData(msg: JsonObject) {
        val requestId = msg.get("requestId")?.asString ?: return
        val data = msg.get("data")?.asString ?: return

        val socket = activeTunnels[requestId] ?: return
        try {
            val bytes = Base64.decode(data, Base64.DEFAULT)
            socket.getOutputStream().write(bytes)
            socket.getOutputStream().flush()
            totalBytes += bytes.size
        } catch (e: Exception) {
            Log.e(TAG, "proxy_data write error [$requestId]: ${e.message}")
            runCatching { socket.close() }
            activeTunnels.remove(requestId)
        }
    }

    // ─── Utilities ───

    private fun getCarrierName(): String {
        return try {
            val tm = getSystemService(TELEPHONY_SERVICE) as TelephonyManager
            // Try network operator first, then SIM operator as fallback
            val network = tm.networkOperatorName?.takeIf { it.isNotBlank() }
            val sim = tm.simOperatorName?.takeIf { it.isNotBlank() }
            val carrier = network ?: sim

            if (carrier != null) return carrier

            // No SIM — check if on WiFi
            val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as android.net.ConnectivityManager
            val activeNetwork = cm.activeNetwork
            val caps = activeNetwork?.let { cm.getNetworkCapabilities(it) }
            if (caps?.hasTransport(android.net.NetworkCapabilities.TRANSPORT_WIFI) == true) {
                // Try to get WiFi SSID
                val wm = applicationContext.getSystemService(Context.WIFI_SERVICE) as android.net.wifi.WifiManager
                val ssid = wm.connectionInfo?.ssid?.removePrefix("\"")?.removeSuffix("\"")
                    ?.takeIf { it.isNotBlank() && it != "<unknown ssid>" }
                return "WiFi" + (ssid?.let { " ($it)" } ?: "")
            }

            "unknown"
        } catch (e: Exception) { "unknown" }
    }

    private fun getConnectionType(): String {
        return try {
            val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as android.net.ConnectivityManager
            val caps = cm.activeNetwork?.let { cm.getNetworkCapabilities(it) }
            when {
                caps == null -> "none"
                caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
                caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_CELLULAR) -> "mobile"
                caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
                else -> "other"
            }
        } catch (e: Exception) { "unknown" }
    }

    private fun getCountryCode(): String {
        return try {
            val tm = getSystemService(TELEPHONY_SERVICE) as TelephonyManager
            tm.networkCountryIso.uppercase().ifBlank { "unknown" }
        } catch (e: Exception) { "unknown" }
    }

    private fun updateStats() {
        statusLiveData.postValue(ProxyStatus("connected", nodeId, requestCount, totalBytes))
        updateNotification("Online — $requestCount reqs | ${formatBytes(totalBytes)}")
    }

    private fun formatBytes(bytes: Long): String = when {
        bytes < 1024 -> "$bytes B"
        bytes < 1024 * 1024 -> "${bytes / 1024} KB"
        else -> "${"%.1f".format(bytes / (1024.0 * 1024.0))} MB"
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(CHANNEL_ID, "Clawdbot Proxy", NotificationManager.IMPORTANCE_LOW)
            channel.description = "Proxy service status"
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    private fun buildNotification(text: String): Notification {
        val intent = Intent(this, MainActivity::class.java)
        val pendingIntent = PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_IMMUTABLE)
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Clawdbot Proxy")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_menu_share)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .build()
    }

    private fun updateNotification(text: String) {
        val notification = buildNotification(text)
        getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification)
    }
}
