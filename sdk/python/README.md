# Clawdbot Python SDK

Route traffic through real mobile phone IPs using the Clawdbot Proxy Network.

## Install

```bash
pip install requests
```

## Quick Start

```python
from clawdbot import ClawdbotClient

client = ClawdbotClient(
    api_key="your-api-key",
    base_url="https://your-router-url"
)

# Create a proxy session
session = client.create_session(country="DE")
print(f"Session: {session['sessionId']}")

# Use as requests proxy
import requests
proxies = client.proxy_dict(session["sessionId"])
resp = requests.get("https://httpbin.org/ip", proxies=proxies)
print(f"Proxy IP: {resp.json()['origin']}")

# Rotate IP (mobile only)
result = client.rotate_ip(session["sessionId"])
print(f"New IP: {result['newIp']}")

# End session
summary = client.end_session(session["sessionId"])
print(f"Bytes: {summary['bytesIn']} in / {summary['bytesOut']} out")
```

## x402 USDC Payment

```python
client = ClawdbotClient(
    x402_payment="<x402-payment-header>",
    base_url="https://your-router-url"
)
session = client.create_session()
```

## API

- `health()` — Check router health
- `list_nodes()` — List available proxy nodes
- `create_session(country?, carrier?, wallet?, escrow_tx?, min_stealth?, preferred_node_id?)` — Create session
- `get_session(session_id)` — Get session info
- `end_session(session_id)` — End session + trigger payout
- `rotate_ip(session_id)` — Rotate IP (mobile only)
- `proxy_request(url, session_id?)` — Single proxied fetch
- `proxy_dict(session_id, host?)` — Get `requests`-compatible proxy dict
