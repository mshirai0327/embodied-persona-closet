import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from wifi_cam_mcp import _behavior


def test_resolve_toml_path_finds_project_root(tmp_path, monkeypatch):
    repo_root = tmp_path / "repo"
    repo_root.mkdir()
    toml_path = repo_root / "mcpBehavior.toml"
    toml_path.write_text("[wifi-cam]\nmount_mode = 'ceiling'\n", encoding="utf-8")

    start_path = (
        repo_root
        / ".claude"
        / "mcps"
        / "wifi-cam-mcp"
        / "src"
        / "wifi_cam_mcp"
        / "_behavior.py"
    )

    monkeypatch.delenv("MCP_BEHAVIOR_TOML", raising=False)

    assert _behavior._resolve_toml_path(start_path) == toml_path


def test_resolve_toml_path_prefers_env_override(tmp_path, monkeypatch):
    override_path = tmp_path / "custom-behavior.toml"
    override_path.write_text("[wifi-cam]\nmount_mode = 'ceiling'\n", encoding="utf-8")

    monkeypatch.setenv("MCP_BEHAVIOR_TOML", str(override_path))

    assert _behavior._resolve_toml_path() == override_path
