#!/usr/bin/env python3
"""Create a portable SQLite snapshot of the memory-mcp database.

This uses SQLite's backup API so the exported file includes WAL contents and
is safe to copy to another machine or project.

Usage:
    cd .claude/mcps/memory-mcp
    uv run python scripts/export_sqlite_snapshot.py \
        --dest /tmp/memory-portable.db

Then place the exported file at the destination project's:
    .claude/memories/memory.db
"""

from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from memory_mcp.config import MemoryConfig

COUNT_TABLES = (
    "memories",
    "embeddings",
    "coactivation",
    "episodes",
    "verb_chains",
    "daily_digest",
)


def _count_rows(conn: sqlite3.Connection, table_name: str) -> int:
    try:
        row = conn.execute(f"SELECT COUNT(*) FROM {table_name}").fetchone()
    except sqlite3.OperationalError:
        return 0
    return int(row[0]) if row is not None else 0


def export_snapshot(source: Path, destination: Path) -> dict[str, int]:
    source_conn = sqlite3.connect(str(source.resolve()))

    try:
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.exists():
            destination.unlink()

        destination_conn = sqlite3.connect(str(destination))
        try:
            source_conn.backup(destination_conn)
            destination_conn.commit()
            return {
                table_name: _count_rows(destination_conn, table_name)
                for table_name in COUNT_TABLES
            }
        finally:
            destination_conn.close()
    finally:
        source_conn.close()


def main() -> None:
    config = MemoryConfig.from_env()

    parser = argparse.ArgumentParser(
        description="Export a portable memory-mcp SQLite snapshot"
    )
    parser.add_argument(
        "--source",
        default=config.db_path,
        help="Path to the source SQLite DB (default: resolved MEMORY_DB_PATH)",
    )
    parser.add_argument(
        "--dest",
        required=True,
        help="Path to the exported SQLite snapshot",
    )
    args = parser.parse_args()

    source = Path(args.source).expanduser()
    destination = Path(args.dest).expanduser()

    if not source.exists():
        raise SystemExit(f"Source DB not found: {source}")

    counts = export_snapshot(source, destination)

    print(f"Source DB:      {source}")
    print(f"Snapshot saved: {destination}")
    print()
    print("Row counts:")
    for table_name, count in counts.items():
        print(f"  {table_name}: {count}")
    print()
    print("Next step:")
    print(
        "  Copy this snapshot to the destination project's "
        ".claude/memories/memory.db"
    )


if __name__ == "__main__":
    main()
