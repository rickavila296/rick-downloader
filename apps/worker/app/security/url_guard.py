"""SSRF protection and URL validation (spec §9.2)."""

import ipaddress
import socket
from urllib.parse import urlparse


class UrlGuardError(Exception):
    def __init__(self, message: str, code: str = "blocked_url") -> None:
        super().__init__(message)
        self.message = message
        self.code = code


def is_ip_blocked(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    """Returns True if the IP address is private, loopback, link-local,
    reserved, multicast, or unspecified.
    """
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
    )


def url_guard(url: str) -> str:
    """Validates that a URL is safe to fetch:
    - Must not start with '-' (command injection defense)
    - Must have http or https scheme
    - Must not resolve to private, loopback, link-local, reserved, or multicast IPs
    """
    if not url or not isinstance(url, str):
        raise UrlGuardError("URL must be a non-empty string")

    stripped = url.strip()
    if stripped.startswith("-"):
        raise UrlGuardError("URL cannot start with '-'")

    try:
        parsed = urlparse(stripped)
    except Exception as e:
        raise UrlGuardError(f"Invalid URL: {e}") from e

    scheme = (parsed.scheme or "").lower()
    if scheme not in ("http", "https"):
        raise UrlGuardError(f"Scheme '{scheme}' is not allowed. Only http and https are supported.")

    hostname = parsed.hostname
    if not hostname:
        raise UrlGuardError("URL must contain a valid hostname")

    # If the hostname is an IP literal (e.g. 127.0.0.1 or [::1])
    try:
        raw_ip = hostname.strip("[]")
        ip = ipaddress.ip_address(raw_ip)
        if is_ip_blocked(ip):
            raise UrlGuardError(f"Access to IP address '{ip}' is blocked")
        return stripped
    except ValueError:
        pass  # Hostname is a domain name, proceed to DNS resolution

    port = parsed.port or (443 if scheme == "https" else 80)
    try:
        addr_infos = socket.getaddrinfo(hostname, port, proto=socket.IPPROTO_TCP)
    except socket.gaierror as e:
        raise UrlGuardError(f"Could not resolve hostname '{hostname}': {e}") from e

    if not addr_infos:
        raise UrlGuardError(f"No IP addresses found for hostname '{hostname}'")

    for addr_info in addr_infos:
        sockaddr = addr_info[4]
        ip_str = sockaddr[0]
        try:
            ip = ipaddress.ip_address(ip_str)
            if is_ip_blocked(ip):
                raise UrlGuardError(f"Access to resolved IP '{ip}' is blocked")
        except ValueError:
            continue

    return stripped
