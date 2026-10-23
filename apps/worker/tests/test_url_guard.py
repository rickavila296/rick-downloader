"""Tests for url_guard SSRF protection (spec §9.2)."""

import socket
from typing import Any

import pytest
from pytest import MonkeyPatch

from app.security.url_guard import UrlGuardError, url_guard


def test_url_guard_allowed_schemes(monkeypatch: MonkeyPatch) -> None:
    # Mock DNS resolution to a safe public IP (e.g. 93.184.216.34)
    def mock_getaddrinfo(host: str, port: int, **kwargs: Any) -> list[tuple[Any, ...]]:
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", port))]

    monkeypatch.setattr(socket, "getaddrinfo", mock_getaddrinfo)

    assert url_guard("http://example.com/video") == "http://example.com/video"
    assert url_guard("https://example.com/path?arg=1") == "https://example.com/path?arg=1"


@pytest.mark.parametrize(
    "forbidden_url",
    [
        "file:///etc/passwd",
        "ftp://example.com/file.mp4",
        "data:text/html,<html></html>",
        "gopher://example.com",
        "javascript:alert(1)",
    ],
)
def test_url_guard_rejects_non_http_schemes(forbidden_url: str) -> None:
    with pytest.raises(UrlGuardError, match=r"Scheme .* is not allowed"):
        url_guard(forbidden_url)


def test_url_guard_rejects_leading_hyphen() -> None:
    with pytest.raises(UrlGuardError, match="URL cannot start with '-'"):
        url_guard("--help")
    with pytest.raises(UrlGuardError, match="URL cannot start with '-'"):
        url_guard("-https://example.com")


@pytest.mark.parametrize(
    "ip_url",
    [
        "http://127.0.0.1:8000",
        "http://127.0.0.2",
        "http://[::1]/test",
        "http://10.0.0.1/private",
        "http://172.16.0.1",
        "http://172.31.255.255",
        "http://192.168.1.1",
        "http://169.254.169.254/latest/meta-data",
        "http://0.0.0.0",
        "http://[fe80::1]",
    ],
)
def test_url_guard_rejects_private_and_loopback_ips(ip_url: str) -> None:
    with pytest.raises(UrlGuardError, match="blocked"):
        url_guard(ip_url)


@pytest.mark.parametrize(
    ("resolved_ip", "hostname"),
    [
        ("127.0.0.1", "localhost"),
        ("10.1.2.3", "intranet.local"),
        ("192.168.0.100", "myrouter.box"),
        ("169.254.169.254", "metadata.google.internal"),
        ("::1", "ipv6.localhost"),
    ],
)
def test_url_guard_rejects_hostnames_resolving_to_blocked_ips(
    monkeypatch: MonkeyPatch, resolved_ip: str, hostname: str
) -> None:
    def mock_getaddrinfo(host: str, port: int, **kwargs: Any) -> list[tuple[Any, ...]]:
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (resolved_ip, port))]

    monkeypatch.setattr(socket, "getaddrinfo", mock_getaddrinfo)

    with pytest.raises(UrlGuardError, match="blocked"):
        url_guard(f"http://{hostname}/video")
