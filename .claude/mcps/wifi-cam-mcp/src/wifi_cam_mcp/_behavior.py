"""Behavior configuration loader -- reads mcpBehavior.toml at project root."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

try:
    import tomllib
except ModuleNotFoundError:
    import tomli as tomllib  # type: ignore[no-redef]

_TOML_NAME = "mcpBehavior.toml"


def _resolve_toml_path(start_path: Path | None = None) -> Path:
    """Resolve mcpBehavior.toml from an override or ancestor directories."""
    override = os.getenv("MCP_BEHAVIOR_TOML", "")
    if override:
        return Path(override).expanduser()

    current = (start_path or Path(__file__)).resolve()
    for parent in current.parents:
        candidate = parent / _TOML_NAME
        if candidate.is_file():
            return candidate

    return current.parent / _TOML_NAME


def load_behavior(section: str) -> dict[str, Any]:
    """Load a section from mcpBehavior.toml.

    Returns empty dict if file doesn't exist or section is missing.
    Reads the file on every call (no caching) so changes are picked up immediately.
    """
    toml_path = _resolve_toml_path()
    if not toml_path.is_file():
        return {}
    try:
        with toml_path.open("rb") as f:
            data = tomllib.load(f)
        return dict(data.get(section, {}))
    except Exception:
        return {}


def get_behavior(section: str, key: str, default: Any = None) -> Any:
    """Get a single value from mcpBehavior.toml."""
    return load_behavior(section).get(key, default)
