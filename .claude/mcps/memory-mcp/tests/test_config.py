from memory_mcp.config import MemoryConfig


def test_from_env_prefers_claude_project_dir(monkeypatch):
    monkeypatch.setenv("CLAUDE_PROJECT_DIR", "/tmp/wardrobe")
    monkeypatch.delenv("MEMORY_DB_PATH", raising=False)

    config = MemoryConfig.from_env()

    assert config.db_path == "/tmp/wardrobe/.claude/memories/memory.db"


def test_from_env_finds_project_root_in_ancestors(tmp_path, monkeypatch):
    project_root = tmp_path / "wardrobe"
    nested_dir = project_root / ".claude" / "mcps" / "memory-mcp"
    nested_dir.mkdir(parents=True)
    (project_root / "CLAUDE.md").write_text("# marker\n", encoding="utf-8")

    monkeypatch.delenv("CLAUDE_PROJECT_DIR", raising=False)
    monkeypatch.delenv("MEMORY_DB_PATH", raising=False)
    monkeypatch.chdir(nested_dir)

    config = MemoryConfig.from_env()

    assert config.db_path == str(project_root / ".claude" / "memories" / "memory.db")
