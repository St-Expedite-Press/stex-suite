#!/usr/bin/env python3
"""Loopback-only authenticated relay for the fixed private Hermes endpoint."""

import http.client
import os
import socket
import ssl
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.parse import quote, urlparse
from urllib.request import Request, urlopen

UPSTREAM = os.environ.get("SCREENLAB_ORCHESTRATOR_URL", "https://screenlab-orchestrator-oleydldaea-uc.a.run.app").rstrip("/")
UPSTREAM_URL = urlparse(UPSTREAM)
PRIVATE_API_VIP = os.environ.get("SCREENLAB_PRIVATE_API_VIP", "199.36.153.4")
METADATA = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=" + quote(UPSTREAM, safe="")


def identity_token():
    request = Request(METADATA, headers={"Metadata-Flavor": "Google"})
    with urlopen(request, timeout=5) as response:
        return response.read().decode("utf-8")


class PrivateGoogleConnection(http.client.HTTPSConnection):
    """Connect to the private Google API VIP but validate the service hostname."""

    def connect(self):
        self.sock = socket.create_connection((PRIVATE_API_VIP, 443), self.timeout, self.source_address)
        self.sock = self._context.wrap_socket(self.sock, server_hostname=self.host)


class Relay(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *_args):
        pass

    def forward(self):
        size = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(size) if size else None
        headers = {"Authorization": f"Bearer {identity_token()}"}
        if self.headers.get("Content-Type"):
            headers["Content-Type"] = self.headers["Content-Type"]
        if self.headers.get("X-Screenlab-Internal-Key"):
            headers["X-Screenlab-Internal-Key"] = self.headers["X-Screenlab-Internal-Key"]
        connection = PrivateGoogleConnection(UPSTREAM_URL.hostname, timeout=130, context=ssl.create_default_context())
        try:
            connection.request(self.command, self.path, body=body, headers=headers)
            response = connection.getresponse()
            payload = response.read()
        finally:
            connection.close()
        self.send_response(response.status)
        for name, value in response.getheaders():
            if name.lower() not in {"connection", "transfer-encoding", "content-length"}:
                self.send_header(name, value)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    do_GET = forward
    do_POST = forward


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", 8100), Relay).serve_forever()
