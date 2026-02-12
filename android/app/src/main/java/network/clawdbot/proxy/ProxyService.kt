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
    }

    private var webSocket: WebSocket? = null
    private val client = OkHttpClient()
    private val gson = Gson()
    private val executor = Executors.newCachedThreadPool()
    private var nodeId: String? = null
    private var requestCount = 0
    private var totalBytes = 0L
    private var wallet: String? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val serverUrl = intent?.getStringExtra("serverUrl") ?: "ws://46.225.67.114:3001/node"
        wallet = intent?.getStringExtra("wallet")

        startForeground(NOTIFICATION_ID, buildNotification("Connecting..."))
        connectToRouter(serverUrl)

        return START_STICKY
    }

    override fun onDestroy() {
        webSocket?.close(1000, "Service stopped")
        statusLiveData.postValue(ProxyStatus("disconnected"))
        super.onDestroy()
    }

    private fun connectToRouter(serverUrl: String) {
        val request = Request.Builder().url(serverUrl).build()

        webSocket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(ws: WebSocket, response: Response) {
                Log.i(TAG, "Connected to router")
                statusLiveData.postValue(ProxyStatus("connected"))
                updateNotification("Connected — waiting for requests")

                // Register with device info
                val registration = JsonObject().apply {
                    addProperty("type", "register")
                    addProperty("device", "${Build.MANUFACTURER} ${Build.MODEL}")
                    addProperty("carrier", getCarrierName())
                    addProperty("country", getCountryCode())
                    addProperty("wallet", wallet ?: "")
                    addProperty("androidVersion", Build.VERSION.RELEASE)
                    addProperty("sdk", Build.VERSION.SDK_INT)
                }
                ws.send(gson.toJson(registration))
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
                Log.i(TAG, "Disconnected: $reason")
                statusLiveData.postValue(ProxyStatus("disconnected", nodeId, requestCount, totalBytes))
                updateNotification("Disconnected")
                // Auto-reconnect after 5s
                executor.submit {
                    Thread.sleep(5000)
                    if (webSocket != null) connectToRouter(serverUrl.replace("wss://", "ws://"))
                }
            }

            override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                Log.e(TAG, "Connection failed: ${t.message}")
                statusLiveData.postValue(ProxyStatus("error", nodeId, requestCount, totalBytes))
                updateNotification("Connection error — retrying...")
                executor.submit {
                    Thread.sleep(5000)
                    connectToRouter(serverUrl)
                }
            }
        })
    }

    private fun handleMessage(ws: WebSocket, msg: JsonObject) {
        when (msg.get("type")?.asString) {
            "welcome" -> {
                nodeId = msg.get("nodeId")?.asString
                Log.i(TAG, "Registered as node: $nodeId")
                statusLiveData.postValue(ProxyStatus("connected", nodeId, requestCount, totalBytes))
            }
            "registered" -> {
                nodeId = msg.get("nodeId")?.asString
                Log.i(TAG, "Registration confirmed: $nodeId")
            }
            "proxy_http" -> {
                // Execute HTTP request on behalf of the agent
                executor.submit { handleHttpProxy(ws, msg) }
            }
            "proxy_connect" -> {
                // HTTPS tunnel
                executor.submit { handleConnectProxy(ws, msg) }
            }
            "proxy_data" -> {
                // Additional data for an existing tunnel
                // (handled by the tunnel thread)
            }
        }
    }

    private fun handleHttpProxy(ws: WebSocket, msg: JsonObject) {
        val requestId = msg.get("requestId")?.asString ?: return
        val sessionId = msg.get("sessionId")?.asString ?: return
        val rawRequest = msg.get("rawRequest")?.asString ?: return

        try {
            val requestBytes = Base64.decode(rawRequest, Base64.DEFAULT)
            val requestStr = String(requestBytes)

            // Parse HTTP request
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

            // Copy headers
            for (i in 1 until lines.size) {
                val line = lines[i]
                if (line.isBlank()) break
                val colonIdx = line.indexOf(':')
                if (colonIdx > 0) {
                    val key = line.substring(0, colonIdx).trim()
                    val value = line.substring(colonIdx + 1).trim()
                    if (key.equals("Host", ignoreCase = true) ||
                        key.equals("X-Session-Id", ignoreCase = true) ||
                        key.equals("Proxy-Connection", ignoreCase = true)) continue
                    conn.setRequestProperty(key, value)
                }
            }

            // Read response
            val responseCode = conn.responseCode
            val responseStream = try { conn.inputStream } catch (e: Exception) { conn.errorStream }
            val responseBody = responseStream?.readBytes() ?: ByteArray(0)
            totalBytes += responseBody.size

            // Build HTTP response
            val statusLine = "HTTP/1.1 $responseCode ${conn.responseMessage}\r\n"
            val headers = StringBuilder()
            conn.headerFields.forEach { (key, values) ->
                if (key != null) {
                    values.forEach { headers.append("$key: $it\r\n") }
                }
            }
            headers.append("\r\n")
            val fullResponse = statusLine.toByteArray() + headers.toString().toByteArray() + responseBody

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
            Log.e(TAG, "Proxy error: ${e.message}")
            val error = JsonObject().apply {
                addProperty("type", "proxy_error")
                addProperty("requestId", requestId)
                addProperty("error", e.message ?: "unknown error")
            }
            ws.send(gson.toJson(error))
        }
    }

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
            val input = socket.getInputStream()
            val output = socket.getOutputStream()

            // Read from target, send back to router
            executor.submit {
                try {
                    val buffer = ByteArray(8192)
                    while (true) {
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
                    // Send final done
                    val done = JsonObject().apply {
                        addProperty("type", "proxy_response")
                        addProperty("requestId", requestId)
                        addProperty("sessionId", sessionId)
                        addProperty("data", "")
                        addProperty("done", true)
                    }
                    ws.send(gson.toJson(done))
                } catch (e: Exception) {
                    Log.e(TAG, "CONNECT read error: ${e.message}")
                } finally {
                    socket.close()
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "CONNECT error: ${e.message}")
            val error = JsonObject().apply {
                addProperty("type", "proxy_error")
                addProperty("requestId", requestId)
                addProperty("error", e.message ?: "connection failed")
            }
            ws.send(gson.toJson(error))
        }
    }

    private fun getCarrierName(): String {
        return try {
            val tm = getSystemService(TELEPHONY_SERVICE) as TelephonyManager
            tm.networkOperatorName.ifBlank { "unknown" }
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
        updateNotification("Active — $requestCount requests | ${formatBytes(totalBytes)}")
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
