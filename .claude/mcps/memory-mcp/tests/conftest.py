"""Pytest fixtures for Memory MCP tests."""

import asyncio
import math
from pathlib import Path

import pytest
import pytest_asyncio

from memory_mcp.config import MemoryConfig
from memory_mcp.store import MemoryStore


class DummyEmbeddingFunction:
    """Deterministic lightweight embedder for tests.

    Avoids downloading a transformer model during CI while still producing
    stable normalized vectors for ranking-based tests.
    """

    _DIM = 32

    def __call__(self, texts: list[str]) -> list[list[float]]:
        return [self._encode(text) for text in texts]

    def encode_query(self, texts: list[str]) -> list[list[float]]:
        return [self._encode(text) for text in texts]

    def _encode(self, text: str) -> list[float]:
        vector = [0.0] * self._DIM
        normalized = text.casefold().strip()

        if not normalized:
            vector[0] = 1.0
            return vector

        previous = ""
        for char in normalized:
            vector[ord(char) % self._DIM] += 1.0
            if previous:
                vector[(ord(previous) + ord(char)) % self._DIM] += 0.5
            previous = char

        norm = math.sqrt(sum(value * value for value in vector)) or 1.0
        return [value / norm for value in vector]


@pytest.fixture(autouse=True)
def inline_asyncio_to_thread(monkeypatch: pytest.MonkeyPatch):
    """Run `asyncio.to_thread` inline during tests for deterministic local DB access."""

    async def _inline_to_thread(func, /, *args, **kwargs):
        return func(*args, **kwargs)

    monkeypatch.setattr(asyncio, "to_thread", _inline_to_thread)


@pytest.fixture
def temp_db_path(tmp_path: Path) -> str:
    """Create a temporary SQLite database path."""
    return str(tmp_path / "test_memory.db")


@pytest.fixture
def memory_config(temp_db_path: str) -> MemoryConfig:
    """Create test memory config."""
    return MemoryConfig(
        db_path=temp_db_path,
        collection_name="test_memories",
    )


@pytest_asyncio.fixture
async def memory_store(memory_config: MemoryConfig) -> MemoryStore:
    """Create and connect a memory store."""
    store = MemoryStore(memory_config)
    store._embedding_fn = DummyEmbeddingFunction()
    await store.connect()
    yield store
    await store.disconnect()
