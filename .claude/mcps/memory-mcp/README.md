# memory-mcp

MCP server for AI long-term memory — Let AI remember across sessions!

## Overview

This MCP server provides long-term memory capabilities for AI assistants using **SQLite + numpy** for vector storage. Memories are stored with semantic embeddings (`intfloat/multilingual-e5-base` by default), enabling intelligent recall based on context, emotion, and time.

**Backend: SQLite + numpy** (no external vector database required — standard library + existing deps only)

## Features

- **Semantic Memory Storage**: Save memories with emotion tags, importance levels, and categories
- **Semantic Search**: Find relevant memories using natural language queries (cosine similarity via numpy)
- **BM25 Hybrid Re-ranking**: Bigram BM25 index for Japanese/multilingual text (Phase 9)
- **Context-based Recall**: Automatically recall memories relevant to the current conversation
- **Divergent Recall**: Associative graph exploration for creative, non-obvious memory retrieval
- **Working Memory Buffer**: Fast access to recently activated memories
- **Episodic Memory**: Group memories into episodes (experiences, events)
- **Visual Memory**: Save memories with camera images
- **Audio Memory**: Save memories with audio transcripts
- **Theory of Mind (ToM)**: Perspective-taking tool for understanding others' feelings
- **Coactivation Weights**: Symmetric co-activation table for associative strength
- **Persistent Storage**: Memories stored in a single SQLite file, easy to backup and migrate

## Installation

```bash
cd memory-mcp
uv sync
uv run memory-mcp
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `MEMORY_DB_PATH` | `CLAUDE_PROJECT_DIR/.claude/memories/memory.db` if available, otherwise `~/.claude/memories/memory.db` | SQLite database path |

## Storage Model

- `memories` stores content, metadata, sensory references, links, and scores.
- `embeddings` stores `float32` vectors as SQLite BLOBs.
- Semantic search loads candidate vectors from SQLite and ranks them with numpy cosine similarity.
- BM25 re-ranking is held in memory and rebuilt on demand after writes.

## Portable SQLite Export

To move memory data to another machine or another Reflecta/Claude Code project, export a
portable SQLite snapshot first:

```bash
cd .claude/mcps/memory-mcp
uv run python scripts/export_sqlite_snapshot.py \
    --dest /tmp/memory-portable.db
```

This is safer than copying `memory.db` by hand because memory-mcp uses SQLite
WAL mode. The backup API produces one consistent file that already includes
recent WAL contents.

Typical transplant flow:

1. Export a snapshot on the source side.
2. Copy the snapshot to the destination project's `.claude/memories/memory.db`.
3. If you also want recall indexes and daily summaries, copy `FLASH.md` and
   `memo/discussionMemo/`.
4. If you rely on sensory memories, note that:
   - visual memories keep a low-resolution `image_data` copy inside SQLite
   - audio memories still reference external files via `sensory_data.file_path`
   - original image/audio files may need to be copied separately

## Tools

### remember

Save a memory to long-term storage.

```json
{
  "content": "Today I learned about SQLite performance tuning",
  "emotion": "excited",
  "importance": 4,
  "category": "technical"
}
```

### search_memories

Search memories by semantic similarity with optional filters.

```json
{
  "query": "things I learned about databases",
  "n_results": 5,
  "category_filter": "technical",
  "emotion_filter": "excited"
}
```

### recall

Recall relevant memories based on conversation context.

```json
{
  "context": "We were discussing database optimization",
  "n_results": 3
}
```

### recall_divergent

Divergent associative recall — explores memory graph to surface non-obvious connections.

```json
{
  "context": "late night coding session",
  "n_results": 5,
  "max_branches": 3,
  "max_depth": 3,
  "temperature": 0.7
}
```

### recall_with_associations

Recall memories along with their linked memories.

```json
{
  "context": "first time I saw the night sky",
  "n_results": 3,
  "chain_depth": 2
}
```

### list_recent_memories

List the most recent memories.

```json
{
  "limit": 10,
  "category_filter": "memory"
}
```

### get_memory_stats

Get statistics about stored memories (count by category, emotion).

### get_working_memory

Get recently activated memories from the fast working memory buffer.

```json
{ "n_results": 10 }
```

### refresh_working_memory

Refresh the working memory buffer with frequently accessed memories from long-term storage.

### consolidate_memories

Run a manual replay/consolidation cycle to strengthen associations.

```json
{
  "window_hours": 24,
  "max_replay_events": 200,
  "link_update_strength": 0.2
}
```

### save_visual_memory

Save a memory with a camera image.

```json
{
  "content": "Saw a beautiful sunset from the balcony",
  "image_path": "/tmp/wifi-cam-mcp/capture_20260220_183000.jpg",
  "camera_position": { "pan_angle": -30, "tilt_angle": 20 },
  "emotion": "moved",
  "importance": 4
}
```

### save_audio_memory

Save a memory with an audio transcript.

```json
{
  "content": "User said good morning",
  "audio_path": "/tmp/audio.wav",
  "transcript": "Good morning! How are you?",
  "emotion": "happy"
}
```

### create_episode

Group memories into a named episode.

```json
{
  "title": "Morning sky search",
  "memory_ids": ["id1", "id2", "id3"],
  "participants": ["コウタ"],
  "auto_summarize": true
}
```

### search_episodes

Search through past episodes.

```json
{ "query": "night sky", "n_results": 5 }
```

### get_episode_memories

Get all memories in an episode in chronological order.

```json
{ "episode_id": "ep-xxx" }
```

### link_memories

Create a causal or relational link between two memories.

```json
{
  "source_id": "mem-a",
  "target_id": "mem-b",
  "link_type": "caused_by",
  "note": "The sunset triggered a philosophical thought"
}
```

### get_causal_chain

Trace the causal chain of a memory forward or backward.

```json
{
  "memory_id": "mem-a",
  "direction": "forward",
  "max_depth": 3
}
```

### recall_by_camera_position

Recall memories associated with a camera direction (pan/tilt angle).

```json
{
  "pan_angle": -30,
  "tilt_angle": 20,
  "tolerance": 15
}
```

### tom

Theory of Mind: perspective-taking tool. Call this before responding to understand what the other person might be feeling.

```json
{
  "situation": "User suddenly went quiet after showing me the photo",
  "person": "コウタ"
}
```

### get_association_diagnostics

Inspect associative expansion diagnostics without committing activation updates.

```json
{ "context": "night sky", "sample_size": 20 }
```

## Emotion Labels

`happy`, `sad`, `surprised`, `moved`, `excited`, `nostalgic`, `curious`, `neutral`

## Category Labels

`daily`, `philosophical`, `technical`, `memory`, `observation`, `feeling`, `conversation`

## Claude Code Integration

Add to your `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "memory": {
      "command": "uv",
      "args": ["run", "--directory", "/path/to/memory-mcp", "memory-mcp"]
    }
  }
}
```

## Development

```bash
# Install dev dependencies
uv sync --all-extras

# Run tests
uv run pytest

# Lint
uv run ruff check .

# Type check
uv run mypy src/memory_mcp/ --ignore-missing-imports
```

## Architecture

```
memory-mcp/
├── src/memory_mcp/
│   ├── server.py       # MCP server (tool handlers)
│   ├── store.py        # SQLite MemoryStore (main backend)
│   ├── vector.py       # numpy cosine similarity utilities
│   ├── embedding.py    # intfloat/multilingual-e5-base embedding
│   ├── bm25.py         # Bigram BM25 index for hybrid re-ranking
│   ├── hopfield.py     # Hopfield network for associative recall
│   ├── episode.py      # EpisodeManager (delegates to MemoryStore)
│   ├── sensory.py      # Visual/audio memory integration
│   ├── verb_chain.py   # Verb-flow structural memory
│   ├── consolidation.py # Replay, association, digest generation
│   ├── config.py       # Configuration
│   └── types.py        # Emotion / Category enums
├── scripts/
│   ├── export_sqlite_snapshot.py    # Portable SQLite backup
│   ├── migrate_embeddings_sqlite.py # Recompute stored embeddings
│   └── migrate_postgres_to_sqlite.py # PostgreSQL import helper
└── tests/
```

## License

MIT
