# Clawdbot Network - Security Deployment Guide

This guide explains how to deploy the hardened Clawdbot Network components securely.

## 🔒 Router Deployment (Production)

### 1. Environment Setup

```bash
# Required environment variables
export API_KEY="your-secure-api-key-here"          # 32+ char random string
export SOLANA_RPC="https://api.mainnet-beta.solana.com"  # Mainnet for production
export NODE_ENV="production"
export PORT="3001"
export PROXY_PORT="1080"

# SSL/TLS Configuration (recommended)
export SSL_CERT_PATH="/etc/ssl/certs/clawdbot.crt"
export SSL_KEY_PATH="/etc/ssl/private/clawdbot.key"
```

### 2. Install & Start Hardened Router

```bash
cd router/
cp package-hardened.json package.json
npm install
npm start  # Runs server-hardened.js
```

### 3. Reverse Proxy Configuration (Nginx)

```nginx
# /etc/nginx/sites-available/clawdbot
upstream clawdbot_backend {
    server 127.0.0.1:3001;
}

server {
    listen 443 ssl http2;
    server_name router.clawdbot.network;
    
    ssl_certificate /etc/ssl/certs/clawdbot.crt;
    ssl_certificate_key /etc/ssl/private/clawdbot.key;
    
    # Security headers
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";
    
    # Rate limiting
    limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
    
    # API endpoints
    location /api/ {
        limit_req zone=api burst=20 nodelay;
        proxy_pass http://clawdbot_backend;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
    
    # WebSocket for phone nodes
    location /node {
        proxy_pass http://clawdbot_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;
    }
}
```

### 4. Firewall Configuration

```bash
# UFW rules for router server
sudo ufw allow 22/tcp      # SSH
sudo ufw allow 80/tcp      # HTTP (redirect to HTTPS)
sudo ufw allow 443/tcp     # HTTPS
sudo ufw allow 1080/tcp    # Proxy port (restrict to authenticated IPs)
sudo ufw enable
```

---

## 📱 Android APK Security Deployment

### 1. Build Configuration

```gradle
// app/build.gradle (production)
android {
    compileSdk 34
    
    defaultConfig {
        minSdk 26  // Android 8.0+ required for modern security features
        targetSdk 34
        
        // Security features
        manifestPlaceholders = [
            usesCleartextTraffic: "false"  // Force HTTPS
        ]
    }
    
    buildTypes {
        release {
            minifyEnabled true
            shrinkResources true
            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
            
            // Sign with production keystore
            signingConfig signingConfigs.release
        }
    }
    
    signingConfigs {
        release {
            storeFile file('../keystore/clawdbot-release.jks')
            storePassword System.getenv("KEYSTORE_PASSWORD")
            keyAlias "clawdbot-release"
            keyPassword System.getenv("KEY_PASSWORD")
        }
    }
}
```

### 2. ProGuard Configuration

```proguard
# proguard-rules.pro
-keep class network.clawdbot.proxy.WalletManagerHardened { *; }
-keep class network.clawdbot.proxy.ProxyServiceHardened { *; }
-keep class com.google.gson.** { *; }
-keepclassmembers class * {
    @com.google.gson.annotations.SerializedName <fields>;
}

# Security: Obfuscate sensitive methods
-obfuscatedictionary dictionary.txt
-classobfuscationdictionary dictionary.txt
-packageobfuscationdictionary dictionary.txt
```

### 3. Network Security Config

```xml
<!-- res/xml/network_security_config.xml -->
<network-security-config>
    <domain-config>
        <domain includeSubdomains="true">router.clawdbot.network</domain>
        <pin-set>
            <!-- Pin your production SSL certificate -->
            <pin digest="SHA256">your-ssl-cert-pin-here</pin>
            <pin digest="SHA256">backup-ssl-cert-pin-here</pin>
        </pin-set>
    </domain-config>
    
    <!-- Block all cleartext traffic -->
    <base-config cleartextTrafficPermitted="false" />
</network-security-config>
```

### 4. Replace Original Files

To deploy the hardened Android app:

```bash
# Backup originals
cp android/app/src/main/AndroidManifest.xml android/app/src/main/AndroidManifest-original.xml
cp android/app/src/main/java/network/clawdbot/proxy/ProxyService.kt android/app/src/main/java/network/clawdbot/proxy/ProxyService-original.kt
cp android/app/src/main/java/network/clawdbot/proxy/WalletManager.kt android/app/src/main/java/network/clawdbot/proxy/WalletManager-original.kt

# Deploy hardened versions
cp android/app/src/main/AndroidManifest-hardened.xml android/app/src/main/AndroidManifest.xml
cp android/app/src/main/java/network/clawdbot/proxy/ProxyService-hardened.kt android/app/src/main/java/network/clawdbot/proxy/ProxyService.kt
cp android/app/src/main/java/network/clawdbot/proxy/WalletManager-hardened.kt android/app/src/main/java/network/clawdbot/proxy/WalletManager.kt

# Build release APK
cd android/
./gradlew assembleRelease
```

---

## ⛓️ Solana Contracts Deployment

### 1. Replace Original Contract

```bash
# Backup original
cp contracts/task-escrow.ts contracts/task-escrow-original.ts

# Deploy hardened version
cp contracts/task-escrow-hardened.ts contracts/task-escrow.ts
```

### 2. Update Imports

```typescript
// Any file importing the escrow contract
import { 
  createTask, 
  assignTask, 
  completeTask, 
  getEscrowStats 
} from './contracts/task-escrow.ts';  // Now points to hardened version
```

---

## 🔐 API Key Management

### 1. Generate Secure API Key

```bash
# Generate 256-bit API key
openssl rand -hex 32

# Or use Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 2. Client Usage

```javascript
// Agent clients must include API key
const response = await fetch('https://router.clawdbot.network/api/proxy/request', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': 'your-api-key-here'
  },
  body: JSON.stringify({
    country: 'US',
    carrier: 'T-Mobile',
    wallet: 'agent-wallet-address'
  })
});
```

### 3. API Key Rotation

```bash
# Graceful API key rotation (zero-downtime)
export OLD_API_KEY="old-key"
export NEW_API_KEY="new-key"

# Update router to accept both keys temporarily
# Then update all clients to use new key
# Finally, remove old key support
```

---

## 🌐 DNS & CDN Configuration

### 1. DNS Records

```dns
; Production DNS configuration
router.clawdbot.network.    A      203.0.113.1
api.clawdbot.network.       CNAME  router.clawdbot.network.
proxy.clawdbot.network.     CNAME  router.clawdbot.network.

; Security records
clawdbot.network.           TXT    "v=spf1 -all"
_dmarc.clawdbot.network.    TXT    "v=DMARC1; p=reject; rua=mailto:security@clawdbot.network"
```

### 2. CloudFlare Security Rules

```javascript
// Block common attack patterns
(http.request.uri.path contains "..") or
(http.request.uri.path contains "<script") or
(http.request.uri.path contains "SELECT * FROM") or
(http.request.method eq "TRACE")
```

---

## 📊 Monitoring Setup

### 1. Health Check Monitoring

```bash
#!/bin/bash
# health-check.sh - Add to cron every 1 minute

ENDPOINT="https://router.clawdbot.network/health"
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$ENDPOINT")

if [ "$RESPONSE" != "200" ]; then
    echo "ALERT: Router health check failed (HTTP $RESPONSE)" | \
    mail -s "Clawdbot Router Down" admin@clawdbot.network
fi
```

### 2. Log Monitoring

```bash
# Set up log rotation
sudo tee /etc/logrotate.d/clawdbot <<EOF
/var/log/clawdbot/*.log {
    daily
    missingok
    rotate 30
    compress
    notifempty
    sharedscripts
    postrotate
        systemctl reload clawdbot-router
    endscript
}
EOF
```

### 3. Security Monitoring

```bash
# Monitor for suspicious activity
tail -f /var/log/clawdbot/security.log | grep -E "(ATTACK|BREACH|UNAUTHORIZED)" | \
while read line; do
    echo "SECURITY ALERT: $line" | mail -s "Security Alert" security@clawdbot.network
done
```

---

## 🚨 Incident Response Plan

### 1. Security Breach Response

```bash
# Immediate actions for security incident
1. Rotate all API keys immediately
2. Block suspicious IP addresses
3. Enable maintenance mode
4. Audit recent logs for compromise
5. Notify users via status page
```

### 2. Service Recovery

```bash
# Service restoration checklist
1. Verify hardened components are deployed
2. Confirm all security patches applied
3. Test functionality in staging environment
4. Gradual traffic restoration with monitoring
5. Post-incident review and documentation
```

---

## ✅ Security Checklist

Before production deployment, verify:

- [ ] **Router** - API keys configured and tested
- [ ] **Router** - Rate limiting active and tuned
- [ ] **Router** - SSL certificates valid and pinned  
- [ ] **Router** - Firewall rules configured
- [ ] **Android** - APK signed with production certificate
- [ ] **Android** - Cleartext traffic disabled
- [ ] **Android** - Network security config pinned
- [ ] **Solana** - Contracts deployed to mainnet
- [ ] **Solana** - Input validation active
- [ ] **Monitoring** - Health checks configured
- [ ] **Monitoring** - Security alerting active
- [ ] **Logs** - Structured logging enabled
- [ ] **Logs** - Log rotation configured

---

**🎯 Result:** Secure, production-ready Clawdbot Network deployment with comprehensive security measures.