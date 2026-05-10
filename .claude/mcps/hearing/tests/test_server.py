"""Tests for hearing.server startup diagnostics."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

from hearing import server


class _FakeStderr:
    def __init__(self, lines: list[str]):
        self._lines = [f"{line}\n".encode("utf-8") for line in lines]

    async def readline(self) -> bytes:
        if self._lines:
            return self._lines.pop(0)
        return b""


class _FakeProc:
    def __init__(self, returncode: int | None, lines: list[str]):
        self.returncode = returncode
        self.pid = 12345
        self.stderr = _FakeStderr(lines)


def test_handle_start_returns_worker_stderr_on_early_failure(monkeypatch):
    async def fake_create_subprocess_exec(*_args, **_kwargs):
        return _FakeProc(
            returncode=1,
            lines=["RuntimeError: Unable to open file 'model.bin'"],
        )

    monkeypatch.setattr(server.asyncio, "create_subprocess_exec", fake_create_subprocess_exec)
    monkeypatch.setattr(server, "STARTUP_CHECK_DELAY", 0)
    monkeypatch.setattr(
        server.HearingConfig,
        "from_toml",
        classmethod(
            lambda cls, **_overrides: SimpleNamespace(
                whisper_model="small",
                language="ja",
                segment_seconds=5,
                vad_energy_threshold=0.0,
            )
        ),
    )
    monkeypatch.setattr(server, "get_behavior", lambda _section, key, default=None: {
        "source": "local",
    }.get(key, default))

    hearing_server = server.HearingMCPServer()
    result = asyncio.run(hearing_server._handle_start({}))

    assert "Failed to start continuous listening." in result[0].text
    assert "model.bin" in result[0].text
    assert hearing_server._running is False


def test_handle_start_succeeds_when_worker_stays_alive(monkeypatch):
    async def fake_create_subprocess_exec(*_args, **_kwargs):
        return _FakeProc(returncode=None, lines=[])

    monkeypatch.setattr(server.asyncio, "create_subprocess_exec", fake_create_subprocess_exec)
    monkeypatch.setattr(server, "STARTUP_CHECK_DELAY", 0)
    monkeypatch.setattr(
        server.HearingConfig,
        "from_toml",
        classmethod(
            lambda cls, **_overrides: SimpleNamespace(
                whisper_model="medium",
                language="ja",
                segment_seconds=5,
                vad_energy_threshold=0.001,
            )
        ),
    )
    monkeypatch.setattr(server, "get_behavior", lambda _section, key, default=None: {
        "source": "local",
    }.get(key, default))

    hearing_server = server.HearingMCPServer()
    result = asyncio.run(hearing_server._handle_start({}))

    assert "Started continuous listening" in result[0].text
    assert hearing_server._running is True
