"""
Clawdbot Python SDK — Route traffic through real mobile phone IPs.

Supports both API Key auth and x402 USDC payment.

Usage:
    from clawdbot import ClawdbotClient

    client = ClawdbotClient(api_key="your-key", base_url="https://your-router")
    session = client.create_session(country="DE")

    # Use as requests proxy
    import requests
    resp = requests.get("https://httpbin.org/ip", proxies=client.proxy_dict(session["sessionId"]))
    print(resp.json())

    client.end_session(session["sessionId"])
"""

from typing import Optional, Dict, Any
import requests as _requests


class ClawdbotClient:
    """Client for the Clawdbot Proxy Network."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: str = "http://localhost:3001",
        x402_payment: Optional[str] = None,
        timeout: int = 30,
    ):
        """
        Initialize the Clawdbot client.

        Args:
            api_key: API key for authentication (use with SOL escrow or free tier).
            base_url: Router base URL (e.g. https://your-server/clawdbot).
            x402_payment: x402 payment header for USDC payment (alternative to API key).
            timeout: Request timeout in seconds.
        """
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.x402_payment = x402_payment
        self.timeout = timeout
        self._session = _requests.Session()
        if api_key:
            self._session.headers["Authorization"] = f"Bearer {api_key}"
        if x402_payment:
            self._session.headers["X-Payment"] = x402_payment

    def _url(self, path: str) -> str:
        return f"{self.base_url}{path}"

    def _request(self, method: str, path: str, **kwargs) -> Dict[str, Any]:
        kwargs.setdefault("timeout", self.timeout)
        resp = self._session.request(method, self._url(path), **kwargs)
        resp.raise_for_status()
        return resp.json()

    def health(self) -> Dict[str, Any]:
        """Check router health."""
        return self._request("GET", "/admin/health")

    def list_nodes(self) -> Dict[str, Any]:
        """List available proxy nodes."""
        return self._request("GET", "/nodes")

    def create_session(
        self,
        country: Optional[str] = None,
        carrier: Optional[str] = None,
        wallet: Optional[str] = None,
        escrow_tx: Optional[str] = None,
        min_stealth: Optional[int] = None,
        preferred_node_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Create a new proxy session.

        Args:
            country: Filter by country code (e.g. "DE", "US").
            carrier: Filter by mobile carrier (e.g. "T-Mobile").
            wallet: Your Solana wallet address (for SOL escrow).
            escrow_tx: Solana escrow transaction signature.
            min_stealth: Minimum stealth score (0-100).
            preferred_node_id: Request a specific node.

        Returns:
            Session info including sessionId, proxy config, and pricing.
        """
        body: Dict[str, Any] = {}
        if country:
            body["country"] = country
        if carrier:
            body["carrier"] = carrier
        if wallet:
            body["wallet"] = wallet
        if escrow_tx:
            body["escrowTx"] = escrow_tx
        if min_stealth is not None:
            body["minStealth"] = min_stealth
        if preferred_node_id:
            body["preferredNodeId"] = preferred_node_id
        return self._request("POST", "/proxy/session", json=body)

    def get_session(self, session_id: str) -> Dict[str, Any]:
        """Get session info."""
        return self._request("GET", f"/proxy/session/{session_id}")

    def end_session(self, session_id: str) -> Dict[str, Any]:
        """
        End a proxy session and trigger payout.

        Args:
            session_id: The session ID to end.

        Returns:
            Session summary with bytes transferred, cost, and payout info.
        """
        return self._request("POST", f"/proxy/session/{session_id}/end")

    def rotate_ip(self, session_id: str) -> Dict[str, Any]:
        """
        Rotate the IP address (mobile connections only).

        The phone node toggles airplane mode to get a new CGNAT IP.
        WiFi connections cannot rotate IPs.

        Args:
            session_id: Active session ID.

        Returns:
            New IP address and confirmation.
        """
        return self._request("POST", f"/proxy/session/{session_id}/rotate")

    def proxy_request(
        self,
        url: str,
        session_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Make a single proxied HTTP request via the fetch API.

        Args:
            url: Target URL to fetch through the proxy.
            session_id: Optional session ID (creates temp session if omitted).

        Returns:
            Response data including the proxied content.
        """
        params: Dict[str, str] = {"url": url}
        if session_id:
            params["sessionId"] = session_id
        return self._request("GET", "/proxy/fetch", params=params)

    def proxy_dict(self, session_id: str, host: Optional[str] = None) -> Dict[str, str]:
        """
        Get a proxy dict compatible with the `requests` library.

        Args:
            session_id: Active session ID.
            host: Proxy host (defaults to base_url host).

        Returns:
            Dict suitable for requests.get(..., proxies=proxy_dict).

        Example:
            proxies = client.proxy_dict(session["sessionId"])
            resp = requests.get("https://httpbin.org/ip", proxies=proxies)
        """
        if host is None:
            from urllib.parse import urlparse
            parsed = urlparse(self.base_url)
            host = parsed.hostname or "localhost"

        proxy_url = f"http://{self.api_key}:auto@{host}:1080"
        return {
            "http": proxy_url,
            "https": proxy_url,
        }
