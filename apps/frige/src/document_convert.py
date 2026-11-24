"""Isolated MarkItDown converter for Frige uploads.

Frige sends every uploaded attachment here over a private Unix socket
(``POST /v1/convert`` with ``{"name", "contentBase64"}``). For each request
this service starts Microsoft's stock ``markitdown-mcp`` server over stdio,
checks that it offers exactly ``convert_to_markdown``, and calls it with a
``data:`` URI built from the uploaded bytes. It never passes a file path or
web URL, because the stock server would open those with its own privileges.
The Markdown that comes back becomes the attachment's text for the author to
review and approve in Frige.

The hosted unit runs this with a throwaway user, no network, no view of
STEX state or credentials, and resource limits. Each conversion has a time
limit and an output limit, and the MCP process group is killed afterwards.
Logs carry only an outcome code, the file extension and the byte count,
never names or content.

Standard library only (Python 3.11+). MarkItDown and ``markitdown-mcp`` come
from ``PYTHONPATH``.
"""

from __future__ import annotations

import base64
import binascii
import json
import os
import queue
import re
import select
import signal
import socket
import socketserver
import stat
import subprocess
import sys
import threading
import time
from collections.abc import Callable
from http.server import BaseHTTPRequestHandler
from typing import Any, NoReturn

MEDIA_TYPES = {
    ".md": "text/markdown",
    ".txt": "text/plain",
    ".tex": "text/plain",
    ".csv": "text/csv",
    ".json": "application/json",
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}
NAME = re.compile(r"[A-Za-z0-9._ -]{1,160}")
MAX_INPUT_BYTES = 8_000_000
MAX_BODY_BYTES = 11_300_000  # Base64 of the largest input plus the JSON envelope.
MAX_MARKDOWN_BYTES = 600_000  # Frige's excerpt reader refuses larger extraction files.
MAX_LINE_BYTES = 4 * MAX_MARKDOWN_BYTES  # One JSON-RPC reply, escaping included.
CONVERT_SECONDS = 60.0
QUEUE_SECONDS = 20.0  # Queue wait plus conversion stays below Frige's 90-second client timeout.
READ_SECONDS = 30.0  # Socket timeout for reading a request.
CONFIG_EXIT = 78  # Configuration refusal; the unit does not restart on it.
CREDENTIAL_VARIABLES = frozenset({"OPENROUTER_API_KEY", "STEX_HERMES_API_KEY", "STEX_INFERENCE_SHARED_SECRET", "API_SERVER_KEY"})
PROTOCOL_VERSION = "2025-06-18"


class ConversionError(Exception):
    """A conversion that did not produce Markdown, with its HTTP status and a stable code."""

    def __init__(self, status: int, code: str) -> None:
        super().__init__(code)
        self.status = status
        self.code = code


def media_type(name: object) -> str:
    """The media type for an upload name, from a fixed extension allowlist.

    Raises:
        ConversionError: for a malformed name or an extension outside the allowlist.
    """
    if not isinstance(name, str) or not NAME.fullmatch(name):
        raise ConversionError(400, "INVALID_NAME")
    extension = os.path.splitext(name)[1].lower()
    if extension not in MEDIA_TYPES:
        raise ConversionError(415, "UNSUPPORTED_TYPE")
    return MEDIA_TYPES[extension]


def decode_upload(body: object) -> tuple[str, bytes]:
    """Validate a request body and return the upload's name and bytes.

    Raises:
        ConversionError: for a malformed body, bad Base64 or an out-of-range size.
    """
    if not isinstance(body, dict) or set(body) != {"name", "contentBase64"} or not isinstance(body["contentBase64"], str):
        raise ConversionError(400, "INVALID_REQUEST")
    media_type(body["name"])
    try:
        data = base64.b64decode(body["contentBase64"], validate=True)
    except (binascii.Error, ValueError) as error:
        raise ConversionError(400, "INVALID_REQUEST") from error
    if not 0 < len(data) <= MAX_INPUT_BYTES:
        raise ConversionError(413, "TOO_LARGE")
    return body["name"], data


class _Session:
    """A line-delimited JSON-RPC session with one stock ``markitdown-mcp`` process."""

    def __init__(self, command: list[str], env: dict[str, str], deadline: float) -> None:
        self.deadline = deadline
        self.process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                        stderr=subprocess.DEVNULL, env=env, cwd="/", start_new_session=True)
        self.buffer = b""
        # One writer thread keeps messages in order; a child that stops reading cannot block past the deadline.
        self.outbox: queue.Queue[bytes] = queue.Queue()
        threading.Thread(target=self._write, daemon=True).start()

    def send(self, message: dict[str, Any]) -> None:
        self.outbox.put(json.dumps({"jsonrpc": "2.0", **message}).encode() + b"\n")

    def _write(self) -> None:
        try:
            assert self.process.stdin is not None
            while True:
                self.process.stdin.write(self.outbox.get())
                self.process.stdin.flush()
        except (OSError, ValueError):
            pass

    def receive(self, identifier: int) -> dict[str, Any]:
        """The result for ``identifier``; notifications and other ids are skipped."""
        assert self.process.stdout is not None
        descriptor = self.process.stdout.fileno()
        while True:
            newline = self.buffer.find(b"\n")
            if newline >= 0:
                line, self.buffer = self.buffer[:newline], self.buffer[newline + 1:]
                try:
                    message = json.loads(line)
                except ValueError as error:
                    raise ConversionError(502, "CONVERSION_FAILED") from error
                if isinstance(message, dict) and message.get("id") == identifier:
                    if "error" in message or not isinstance(message.get("result"), dict):
                        raise ConversionError(422, "CONVERSION_FAILED")
                    return message["result"]
                continue
            remaining = self.deadline - time.monotonic()
            if remaining <= 0:
                raise ConversionError(504, "CONVERSION_TIMEOUT")
            readable, _, _ = select.select([descriptor], [], [], remaining)
            if not readable:
                raise ConversionError(504, "CONVERSION_TIMEOUT")
            chunk = os.read(descriptor, 65536)
            if not chunk:
                raise ConversionError(502, "CONVERSION_FAILED")
            self.buffer += chunk
            if len(self.buffer) > MAX_LINE_BYTES:
                raise ConversionError(413, "OUTPUT_TOO_LARGE")

    def close(self) -> None:
        try:
            os.killpg(self.process.pid, signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            pass
        for stream in (self.process.stdin, self.process.stdout):
            try:
                if stream is not None:
                    stream.close()
            except OSError:
                pass
        self.process.wait()


def convert(data: bytes, media: str, *, command: list[str], env: dict[str, str],
            seconds: float = CONVERT_SECONDS) -> str:
    """Convert one document to Markdown through the stock MarkItDown MCP server.

    Raises:
        ConversionError: when the server is unexpected, fails, times out, or returns no text.
    """
    session = _Session(command, env, time.monotonic() + seconds)
    try:
        session.send({"id": 1, "method": "initialize", "params": {
            "protocolVersion": PROTOCOL_VERSION, "capabilities": {},
            "clientInfo": {"name": "stex-frige-converter", "version": "1"}}})
        session.receive(1)
        session.send({"method": "notifications/initialized"})
        session.send({"id": 2, "method": "tools/list", "params": {}})
        tools = session.receive(2).get("tools")
        if not isinstance(tools, list) or [tool.get("name") for tool in tools if isinstance(tool, dict)] != ["convert_to_markdown"]:
            raise ConversionError(502, "UNEXPECTED_SERVER")
        uri = f"data:{media};base64,{base64.b64encode(data).decode()}"
        session.send({"id": 3, "method": "tools/call", "params": {"name": "convert_to_markdown", "arguments": {"uri": uri}}})
        result = session.receive(3)
        if result.get("isError"):
            raise ConversionError(422, "CONVERSION_FAILED")
        content = result.get("content")
        parts = [item.get("text") for item in content if isinstance(item, dict) and item.get("type") == "text"] if isinstance(content, list) else []
        text = "\n".join(part for part in parts if isinstance(part, str))
        if len(text.encode()) > MAX_MARKDOWN_BYTES:
            raise ConversionError(413, "OUTPUT_TOO_LARGE")
        if not text.strip():
            raise ConversionError(422, "NO_TEXT")
        return text
    finally:
        session.close()


def converter_environment(parent: dict[str, str]) -> dict[str, str]:
    """The MCP process environment: an allowlist, plugins off, small thread pools, no credentials."""
    env = {name: parent[name] for name in ("PATH", "PYTHONPATH", "LANG") if name in parent}
    env.update(PYTHONNOUSERSITE="1", PYTHONDONTWRITEBYTECODE="1", HOME="/tmp", MARKITDOWN_ENABLE_PLUGINS="false",
               OMP_NUM_THREADS="2", OPENBLAS_NUM_THREADS="2", MKL_NUM_THREADS="2")
    return env


# Unix sockets exist only on POSIX hosts; on others the pure functions still import for tests.
_UnixStreamServer: Any = getattr(socketserver, "UnixStreamServer", object)


class ConverterServer(socketserver.ThreadingMixIn, _UnixStreamServer):
    """The converter's Unix-socket HTTP server. It converts one document at a time."""

    daemon_threads = True

    def __init__(self, path: str, *, command: list[str], env: dict[str, str], socket_group: str | None = None,
                 seconds: float = CONVERT_SECONDS,
                 log: Callable[[str], None] = lambda line: print(line, file=sys.stderr, flush=True)) -> None:
        self.command, self.env, self.seconds, self.log = command, env, seconds, log
        self.slot = threading.Lock()
        _remove_stale_socket(path)
        super().__init__(path, ConverterHandler)
        if socket_group:
            import grp  # POSIX only.

            os.chown(path, -1, grp.getgrnam(socket_group).gr_gid)
        os.chmod(path, 0o660)


class ConverterHandler(BaseHTTPRequestHandler):
    """Converts one upload per request and answers with JSON."""

    server: ConverterServer
    protocol_version = "HTTP/1.1"
    timeout = READ_SECONDS

    def log_message(self, *_args: object) -> None:  # Never log request lines.
        pass

    def _send(self, status: int, value: dict[str, Any]) -> None:
        body = json.dumps(value, ensure_ascii=False).encode()
        self.close_connection = True
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(body)
        except OSError:
            pass  # The client left, for example after its own timeout.

    def do_GET(self) -> None:  # noqa: N802 - http.server naming
        self._send(404, {"error": {"code": "NOT_FOUND"}})

    def do_POST(self) -> None:  # noqa: N802 - http.server naming
        extension, size = "-", 0
        try:
            if self.path != "/v1/convert":
                raise ConversionError(404, "NOT_FOUND")
            try:
                length = int(self.headers.get("Content-Length", ""))
            except ValueError as error:
                raise ConversionError(411, "LENGTH_REQUIRED") from error
            if not 0 < length <= MAX_BODY_BYTES:
                raise ConversionError(413, "TOO_LARGE")
            try:
                body = json.loads(self.rfile.read(length))
            except ValueError as error:
                raise ConversionError(400, "INVALID_REQUEST") from error
            name, data = decode_upload(body)
            extension, size = os.path.splitext(name)[1].lower(), len(data)
            if not self.server.slot.acquire(timeout=QUEUE_SECONDS):
                raise ConversionError(429, "BUSY")
            try:
                markdown = convert(data, media_type(name), command=self.server.command, env=self.server.env,
                                   seconds=self.server.seconds)
            finally:
                self.server.slot.release()
            self.server.log(f"stex-document-converter CONVERTED {extension} {size}")
            self._send(200, {"markdown": markdown, "converter": "markitdown-mcp"})
        except ConversionError as error:
            self.server.log(f"stex-document-converter {error.code} {extension} {size}")
            self._send(error.status, {"error": {"code": error.code}})
        except Exception:  # noqa: BLE001 - an unexpected failure is a failed conversion, never a traceback
            self.server.log(f"stex-document-converter CONVERSION_FAILED {extension} {size}")
            self._send(500, {"error": {"code": "CONVERSION_FAILED"}})


def _remove_stale_socket(path: str) -> None:
    """Remove a socket left by a killed process; never any other file type."""
    try:
        mode = os.lstat(path).st_mode
    except FileNotFoundError:
        return
    if not stat.S_ISSOCK(mode):
        raise RuntimeError(f"{path} exists and is not a socket.")
    probe = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        probe.connect(path)
    except (ConnectionRefusedError, FileNotFoundError):
        os.unlink(path)
        return
    finally:
        probe.close()
    raise RuntimeError(f"Another process is serving {path}.")


def _refuse_start(message: str) -> NoReturn:
    print(message, file=sys.stderr, flush=True)
    raise SystemExit(CONFIG_EXIT)


def serve(path: str, *, socket_group: str | None = None, seconds: float = CONVERT_SECONDS) -> None:
    """Serve on ``path`` until stopped, with the stock server from ``PYTHONPATH``."""
    server = ConverterServer(path, command=[sys.executable, "-m", "markitdown_mcp"],
                             env=converter_environment(dict(os.environ)), socket_group=socket_group, seconds=seconds)
    print("stex-document-converter is ready", file=sys.stderr, flush=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()


def main() -> None:
    """Check the sandbox, then serve on ``STEX_CONVERTER_SOCKET``."""
    path = os.environ.get("STEX_CONVERTER_SOCKET", "")
    if not os.path.isabs(path):
        _refuse_start("The converter needs an absolute STEX_CONVERTER_SOCKET path.")
    if CREDENTIAL_VARIABLES.intersection(os.environ):
        _refuse_start("The converter must not see provider or service credentials.")
    try:
        interfaces = {name for _, name in socket.if_nameindex()}
    except OSError:
        _refuse_start("The converter cannot list its network interfaces; its sandbox must allow AF_NETLINK.")
    if interfaces - {"lo"}:
        _refuse_start("The converter must run without network interfaces other than loopback.")
    serve(path, socket_group=os.environ.get("STEX_CONVERTER_SOCKET_GROUP") or None)


if __name__ == "__main__":
    main()
