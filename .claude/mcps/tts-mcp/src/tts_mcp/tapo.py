"""Direct Tapo backchannel playback."""

from __future__ import annotations

import hashlib
import http.client
import json
import re
import secrets
import shutil
import socket
import subprocess
from contextlib import suppress
from dataclasses import dataclass

_CLIENT_BOUNDARY = "--client-stream-boundary--"
_CLIENT_DELIMITER = b"----client-stream-boundary--"
_DEVICE_BOUNDARY = b"--device-stream-boundary--"
_MPEGTS_PACKET_SIZE = 188
_READ_SIZE = _MPEGTS_PACKET_SIZE * 7
_TALK_REQUEST = (
    b'{"params":{"talk":{"mode":"aec"},"method":"get"},"seq":3,"type":"request"}'
)
_DIGEST_ITEM_RE = re.compile(r'(\w+)=(?:"([^"]*)"|([^,]+))')


def _parse_digest_header(header: str) -> dict[str, str]:
    header = header.strip()
    if header.lower().startswith("digest "):
        header = header[7:]

    values: dict[str, str] = {}
    for match in _DIGEST_ITEM_RE.finditer(header):
        key, quoted, bare = match.groups()
        values[key] = quoted if quoted is not None else (bare or "").strip()
    return values


def _derive_tapo_password(cloud_password: str, auth_header: str) -> tuple[str, str]:
    auth = _parse_digest_header(auth_header)
    if auth.get("encrypt_type") == "3":
        password = hashlib.sha256(cloud_password.encode()).hexdigest().upper()
    else:
        password = hashlib.md5(cloud_password.encode()).hexdigest().upper()
    return "admin", password


def _build_digest_authorization(
    method: str,
    uri: str,
    username: str,
    password: str,
    auth_header: str,
) -> str:
    auth = _parse_digest_header(auth_header)
    realm = auth["realm"]
    nonce = auth["nonce"]
    qop = auth.get("qop", "auth").split(",", 1)[0].strip() or "auth"
    nc = "00000001"
    cnonce = secrets.token_hex(16)

    ha1 = hashlib.md5(f"{username}:{realm}:{password}".encode()).hexdigest()
    ha2 = hashlib.md5(f"{method}:{uri}".encode()).hexdigest()
    response = hashlib.md5(
        f"{ha1}:{nonce}:{nc}:{cnonce}:{qop}:{ha2}".encode()
    ).hexdigest()

    parts = [
        f'username="{username}"',
        f'realm="{realm}"',
        f'nonce="{nonce}"',
        f'uri="{uri}"',
        f"qop={qop}",
        f"nc={nc}",
        f'cnonce="{cnonce}"',
        f'response="{response}"',
    ]

    opaque = auth.get("opaque")
    if opaque:
        parts.append(f'opaque="{opaque}"')
        parts.append("algorithm=MD5")

    return "Digest " + ", ".join(parts)


def _build_stream_request(host: str, authorization: str | None = None) -> bytes:
    lines = [
        "POST /stream HTTP/1.1",
        f"Host: {host}",
        f"Content-Type: multipart/mixed; boundary={_CLIENT_BOUNDARY}",
        "Content-Length: 0",
        "Connection: keep-alive",
    ]
    if authorization:
        lines.append(f"Authorization: {authorization}")
    lines.extend(("", ""))
    return "\r\n".join(lines).encode()


def _build_json_part(body: bytes) -> bytes:
    return (
        _CLIENT_DELIMITER
        + b"\r\nContent-Type: application/json\r\n"
        + f"Content-Length: {len(body)}".encode()
        + b"\r\n\r\n"
        + body
        + b"\r\n"
    )


def _build_audio_part(session_id: str, body: bytes) -> bytes:
    return (
        _CLIENT_DELIMITER
        + b"\r\nContent-Type: audio/mp2t\r\n"
        + b"X-If-Encrypt: 0\r\n"
        + f"X-Session-Id: {session_id}".encode()
        + b"\r\n"
        + f"Content-Length: {len(body)}".encode()
        + b"\r\n\r\n"
        + body
    )


class _NonClosingReader:
    """Proxy for BufferedReader that ignores close() calls."""

    def __init__(self, reader: object) -> None:
        self._reader = reader

    def read(self, *args: object) -> bytes:
        return self._reader.read(*args)  # type: ignore[union-attr]

    def readline(self, *args: object) -> bytes:
        return self._reader.readline(*args)  # type: ignore[union-attr]

    def readinto(self, b: object) -> int:
        return self._reader.readinto(b)  # type: ignore[union-attr]

    def readable(self) -> bool:
        return True

    def close(self) -> None:
        pass


class _SockLike:
    """Wraps a BufferedReader so http.client.HTTPResponse can call makefile()."""

    def __init__(self, reader: object) -> None:
        self._reader = reader

    def makefile(self, mode: str) -> _NonClosingReader:
        return _NonClosingReader(self._reader)


@dataclass
class TapoBackchannelClient:
    host: str
    cloud_password: str
    port: int = 8800
    timeout: float = 10.0

    def __post_init__(self) -> None:
        self._socket: socket.socket | None = None
        self._reader = None
        self._session_id: str | None = None

    def connect(self) -> None:
        address = (self.host, self.port)
        self._socket = socket.create_connection(address, timeout=self.timeout)
        self._reader = self._socket.makefile("rb")

        challenge = self._request_stream()
        auth_header = challenge.getheader("WWW-Authenticate", "")
        if challenge.status != http.client.UNAUTHORIZED or not auth_header.startswith("Digest"):
            raise RuntimeError(
                "unexpected Tapo auth response: "
                f"{challenge.status} {challenge.reason}"
            )

        username, password = _derive_tapo_password(self.cloud_password, auth_header)
        authorization = _build_digest_authorization(
            method="POST",
            uri="/stream",
            username=username,
            password=password,
            auth_header=auth_header,
        )

        response = self._request_stream(authorization)
        if response.status != http.client.OK:
            if response.status == http.client.UNAUTHORIZED:
                raise RuntimeError(
                    "Tapo stream auth failed: 401 Unauthorized "
                    "(verify TAPO_CLOUD_PASSWORD is the TP-Link app password, "
                    "not the account name or local camera password)"
                )
            raise RuntimeError(f"Tapo stream auth failed: {response.status} {response.reason}")

        self._session_id = self._request_session(_TALK_REQUEST)

    def close(self) -> None:
        if self._reader is not None:
            with suppress(Exception):
                self._reader.close()
            self._reader = None
        if self._socket is not None:
            with suppress(Exception):
                self._socket.close()
            self._socket = None

    def stream_file(self, file_path: str, ffmpeg_bin: str = "ffmpeg") -> None:
        ffmpeg = ffmpeg_bin if "/" in ffmpeg_bin else shutil.which(ffmpeg_bin)
        if not ffmpeg:
            raise FileNotFoundError(f"{ffmpeg_bin} not found")

        command = [
            ffmpeg,
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-re",
            "-i",
            file_path,
            "-vn",
            "-ac",
            "1",
            "-ar",
            "8000",
            "-c:a",
            "pcm_alaw",
            "-f",
            "mpegts",
            "pipe:1",
        ]

        process = subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        if process.stdout is None or process.stderr is None:
            process.kill()
            raise RuntimeError("ffmpeg did not expose stdout/stderr")

        buffer = bytearray()
        try:
            while True:
                reader = getattr(process.stdout, "read1", process.stdout.read)
                chunk = reader(_READ_SIZE)
                if not chunk:
                    break

                buffer.extend(chunk)
                aligned = len(buffer) // _MPEGTS_PACKET_SIZE * _MPEGTS_PACKET_SIZE
                if aligned == 0:
                    continue

                self.write_audio(bytes(buffer[:aligned]))
                del buffer[:aligned]

            if buffer:
                self.write_audio(bytes(buffer))

            stderr = process.stderr.read().decode().strip()
            return_code = process.wait()
            if return_code != 0:
                detail = stderr or f"exit code {return_code}"
                raise RuntimeError(f"ffmpeg failed: {detail}")
        finally:
            if process.poll() is None:
                with suppress(Exception):
                    process.kill()
                with suppress(Exception):
                    process.wait(timeout=1)

    def write_audio(self, chunk: bytes) -> None:
        if not self._session_id:
            raise RuntimeError("Tapo talk session not established")
        self._send(_build_audio_part(self._session_id, chunk))

    def _request_stream(self, authorization: str | None = None) -> http.client.HTTPResponse:
        if self._socket is None:
            raise RuntimeError("Tapo socket not initialized")
        self._send(_build_stream_request(f"{self.host}:{self.port}", authorization))
        response = http.client.HTTPResponse(_SockLike(self._reader))
        response.begin()
        response.read()
        return response

    def _request_session(self, payload: bytes) -> str:
        self._send(_build_json_part(payload))

        while True:
            headers, body = self._read_part()
            if headers.get("content-type") != "application/json":
                continue

            data = json.loads(body.decode())
            session_id = data.get("params", {}).get("session_id")
            if session_id:
                return str(session_id)

    def _read_part(self) -> tuple[dict[str, str], bytes]:
        if self._reader is None:
            raise RuntimeError("Tapo reader not initialized")

        while True:
            line = self._reader.readline()
            if not line:
                raise RuntimeError("Tapo stream closed before multipart boundary")

            stripped = line.strip()
            if stripped == _DEVICE_BOUNDARY:
                break

        headers: dict[str, str] = {}
        while True:
            line = self._reader.readline()
            if not line:
                raise RuntimeError("Tapo stream closed while reading multipart headers")
            if line in {b"\r\n", b"\n"}:
                break

            key, value = line.decode().split(":", 1)
            headers[key.strip().lower()] = value.strip()

        length = int(headers.get("content-length", "0"))
        body = self._reader.read(length)
        if len(body) != length:
            raise RuntimeError("Tapo stream closed while reading multipart body")
        return headers, body

    def _send(self, payload: bytes) -> None:
        if self._socket is None:
            raise RuntimeError("Tapo socket not initialized")
        self._socket.sendall(payload)
