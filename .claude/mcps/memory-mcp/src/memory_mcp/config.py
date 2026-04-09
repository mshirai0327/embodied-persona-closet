"""Configuration for Memory MCP Server."""

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()


def _find_project_root(start: Path) -> Path | None:
    """Find the nearest ancestor that looks like a wardrobe project root."""
    current = start.resolve()

    while True:
        if (current / "CLAUDE.md").exists():
            return current

        parent = current.parent
        if parent == current:
            return None
        current = parent


@dataclass(frozen=True)
class MemoryConfig:
    """Memory storage configuration."""

    db_path: str
    collection_name: str
    embedding_model: str = "intfloat/multilingual-e5-base"
    enable_bm25: bool = True
    enable_composites: bool = False  # Phase 4: バウンダリー層・交差検出（重い計算）

    @classmethod
    def from_env(cls) -> "MemoryConfig":
        """Create config from environment variables."""
        # プロジェクトディレクトリ配下に記憶を保存する
        # CLAUDE_PROJECT_DIR → cwd の祖先にある CLAUDE.md → ホーム配下
        project_dir = os.getenv("CLAUDE_PROJECT_DIR")
        if project_dir:
            default_path = str(Path(project_dir) / ".claude" / "memories" / "memory.db")
        else:
            project_root = _find_project_root(Path.cwd())
            if project_root is not None:
                default_path = str(project_root / ".claude" / "memories" / "memory.db")
            else:
                default_path = str(Path.home() / ".claude" / "memories" / "memory.db")

        return cls(
            db_path=os.getenv("MEMORY_DB_PATH", default_path),
            collection_name=os.getenv("MEMORY_COLLECTION_NAME", "claude_memories"),
            embedding_model=os.getenv("MEMORY_EMBEDDING_MODEL", "intfloat/multilingual-e5-base"),
            enable_bm25=os.getenv("MEMORY_ENABLE_BM25", "true").lower() != "false",
            enable_composites=os.getenv("MEMORY_ENABLE_COMPOSITES", "false").lower() == "true",
        )


@dataclass(frozen=True)
class ServerConfig:
    """MCP Server configuration."""

    name: str = "memory-mcp"
    version: str = "0.1.0"

    @classmethod
    def from_env(cls) -> "ServerConfig":
        """Create config from environment variables."""
        return cls(
            name=os.getenv("MCP_SERVER_NAME", "memory-mcp"),
            version=os.getenv("MCP_SERVER_VERSION", "0.1.0"),
        )
