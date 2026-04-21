# embodied-reflecta

> Claude Code に身体性・記憶・自律行動・人格データ設計を与えるためのモノレポ。

`embodied-reflecta` は、Claude Code で動く MCP サーバー群、フック、スキル、テンプレート、自律行動スクリプトをまとめたエコシステムです。

このリポジトリをクローンし、`SOUL.md` や設定ファイルを自分の環境向けに育てていくことで、長期記憶・視覚/聴覚・音声・身体状態・定期行動を持つ Claude Code 環境を構成できます。

## 現行実装の要点

- `memory-mcp` は **SQLite + numpy** で記憶と埋め込みを保存します。
- ベクトル検索は SQLite から候補ベクトルを読み出し、numpy の cosine similarity でランキングします。
- 記憶本体は通常 `.claude/memories/memory.db` に保存されます。
- SQLite は WAL モードで動くため、移植やバックアップには `export_sqlite_snapshot.py` を使います。
- 各 MCP サーバーは独立した Python パッケージで、必要なものだけ `uv sync` すれば使えます。
- `.claude/scripts/` のユーティリティは Bun で実行します。

## ディレクトリ構成

| パス | 内容 |
|---|---|
| `.claude/mcps/memory-mcp/` | 長期記憶、ベクトル検索、エピソード記憶、感覚記憶、連想想起 |
| `.claude/mcps/hearing/` | 音声認識 |
| `.claude/mcps/tts-mcp/` | テキスト読み上げ |
| `.claude/mcps/wifi-cam-mcp/` | Wi-Fi PTZ カメラ制御 |
| `.claude/mcps/usb-webcam-mcp/` | USB カメラキャプチャ |
| `.claude/mcps/ip-webcam-mcp/` | Android IP Webcam 連携 |
| `.claude/mcps/system-temperature-mcp/` | システム温度センサー |
| `.claude/mcps/mobility-mcp/` | ロボット掃除機制御 |
| `.claude/mcps/toio-mcp/` | toio コアキューブ制御 |
| `.claude/mcps/mcp-pet/` | ペットインタラクション |
| `.claude/mcps/morning-call-mcp/` | モーニングコール |
| `.claude/hooks/` | セッション開始、内受容、想起などの Bash フック |
| `.claude/scripts/` | Bun で動かす補助スクリプト |
| `.claude/templates/` | `SOUL.md` や `ROUTINES.md` などの初期テンプレート |
| `docs/` | セットアップ、設計、運用メモ |
| `memo/` | 検討メモ、日次メモ、仕様メモ |
| `autonomous-action.sh` | cron で動かす自律行動スクリプト |
| `mcpBehavior.toml` | MCP の振る舞い設定 |

## クイックスタート

```bash
git clone https://github.com/mshirai0327/embodied-reflecta.git
cd embodied-reflecta

# Bun スクリプト用の依存関係
bun install

# まずは記憶 MCP をセットアップ
cd .claude/mcps/memory-mcp
uv sync
cd ../../..
```

テンプレートから初期ファイルを作ります。

```bash
cp .claude/templates/SOUL.template.md SOUL.md
cp .claude/templates/ROUTINES.template.md ROUTINES.md
cp .claude/templates/FLASH.template.md FLASH.md
```

`SOUL.md` を編集してから Claude Code を起動します。

```bash
claude
```

## 記憶システム

`memory-mcp` は embodied-reflecta の中核です。

- `remember` / `/wd-remember` で長期記憶を保存します。
- `search_memories` / `recall` / `/wd-recall` で意味検索します。
- `recall_divergent` で連想グラフを探索します。
- `link_memories` で因果・関連リンクを張ります。
- `create_episode` で複数の記憶をひとまとまりの体験として束ねます。
- `save_visual_memory` / `save_audio_memory` で感覚記憶を保存します。

保存方式:

- `memories` テーブルに本文、メタデータ、リンク、感覚参照を保存
- `embeddings` テーブルに `float32` ベクトルを BLOB として保存
- 検索時に候補ベクトルを読み、numpy で cosine similarity を計算
- BM25 の補助スコアはインメモリで構築

詳細は [memory-mcp README](./.claude/mcps/memory-mcp/README.md) を参照してください。

## 記憶データの移植とバックアップ

記憶本体は通常、各プロジェクト配下の `.claude/memories/memory.db` にあります。

別マシンへ移すときは、`memory.db` を直接コピーするより、SQLite backup API を使う snapshot を作るのが安全です。

```bash
cd .claude/mcps/memory-mcp
uv run python scripts/export_sqlite_snapshot.py \
    --dest /tmp/memory-portable.db
```

復元先では次のように配置します。

```bash
mkdir -p .claude/memories
cp /path/to/memory-portable.db .claude/memories/memory.db
```

一緒に退避するとよいもの:

- `.env`
- `.claude/settings.local.json`
- `SOUL.md`
- `FLASH.md`
- `memo/discussionMemo/`
- `state.md`
- `STATUS.md`
- `desires.conf`
- `schedule.conf`
- `desires.json`

通常コピーしなくてよいもの:

- `node_modules/`
- `.claude/mcps/*/.venv/`
- `.pytest_cache/`
- `.ruff_cache/`
- `.mypy_cache/`
- `.claude/logs/*.log`

## Memory MCP の移行メモ

embodied-reflecta では `heishio/embodied-claude-rem` 系の memory-mcp 実装を採用しています。

古い memory-mcp からデータを引き継ぐ場合、埋め込みモデルや次元数が異なることがあります。バックアップを取ったうえで、必要に応じて現在のモデルで埋め込みを再計算してください。

```bash
cd .claude/mcps/memory-mcp
uv run python scripts/migrate_embeddings_sqlite.py
```

## MCP サーバー一覧

| MCP サーバー | 役割 | 主な機能 |
|---|---|---|
| [memory-mcp](./.claude/mcps/memory-mcp/) | 脳 | 長期記憶、意味検索、エピソード、ToM、動詞チェーン |
| [hearing](./.claude/mcps/hearing/) | 耳 | Whisper 系音声認識 |
| [tts-mcp](./.claude/mcps/tts-mcp/) | 声 | ElevenLabs / VOICEVOX による読み上げ |
| [wifi-cam-mcp](./.claude/mcps/wifi-cam-mcp/) | 目・首 | ONVIF PTZ カメラ制御、音声キャプチャ |
| [usb-webcam-mcp](./.claude/mcps/usb-webcam-mcp/) | 目 | USB カメラ画像取得 |
| [ip-webcam-mcp](./.claude/mcps/ip-webcam-mcp/) | 目 | Android IP Webcam 連携 |
| [system-temperature-mcp](./.claude/mcps/system-temperature-mcp/) | 体温感覚 | 温度センサー取得 |
| [mobility-mcp](./.claude/mcps/mobility-mcp/) | 足 | Tuya 対応ロボット掃除機制御 |
| [toio-mcp](./.claude/mcps/toio-mcp/) | 手 | toio コアキューブ制御 |
| [mcp-pet](./.claude/mcps/mcp-pet/) | ふれあい | エージェントへのリアクション拡張 |
| [morning-call-mcp](./.claude/mcps/morning-call-mcp/) | 通知 | 起床通知 |

## Requirements

共通:

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
- [uv](https://docs.astral.sh/uv/)
- [Bun](https://bun.sh/)

モジュール別:

| モジュール | Python | 主な依存 | 備考 |
|---|---|---|---|
| memory-mcp | >=3.10,<3.14 | sentence-transformers, sudachipy, rank-bm25, gensim | Python 3.14 は未対応依存あり |
| hearing | >=3.10 | faster-whisper | |
| tts-mcp | >=3.10 | elevenlabs | VOICEVOX はローカル実行 |
| wifi-cam-mcp | >=3.10 | onvif-zeep-async | ONVIF 対応カメラが必要 |
| usb-webcam-mcp | >=3.10 | opencv-python | WSL2 では usbipd 設定が必要 |
| ip-webcam-mcp | >=3.10 | httpx | Android IP Webcam アプリが必要 |
| system-temperature-mcp | >=3.12 | psutil | WSL2 では温度取得不可 |
| mobility-mcp | >=3.10 | tinytuya | Tuya 対応デバイスが必要 |
| toio-mcp | >=3.10 | toio.py | toio コアキューブが必要 |
| mcp-pet | >=3.10 | opencv-python | |
| morning-call-mcp | >=3.11 | twilio, elevenlabs | |

Python 3.12 を推奨します。

## 開発コマンド

各 MCP サーバーはサブプロジェクト単位で操作します。

```bash
cd .claude/mcps/memory-mcp

# 依存関係
uv sync

# サーバー起動
uv run memory-mcp

# テスト
uv run pytest

# Lint
uv run ruff check .
```

Bun スクリプト:

```bash
bun run .claude/scripts/<script-name>.ts
```

## 自律行動

`autonomous-action.sh` は cron で定期実行するためのスクリプトです。`desires.conf` と `schedule.conf` を読み、現在の欲望・時間帯・曜日に応じて行動頻度を調整します。

例:

```cron
*/20 * * * * /path/to/embodied-reflecta/autonomous-action.sh
```

関連ファイル:

- `desires.conf`
- `schedule.conf`
- `desires.json`
- `ROUTINES.md`
- `TODO.md`
- `STATUS.md`

## カスタマイズ

| ファイル | 用途 |
|---|---|
| `SOUL.md` | エージェントの人格、価値観、話し方 |
| `BODY.md` | 身体設定 |
| `ENVIRONMENT.md` | 環境、デバイス、部屋の前提 |
| `state.md` | 現在状態のスナップショット |
| `STATUS.md` | mood / energy / health などの状態値 |
| `FLASH.md` | 記憶の逆引き索引 |
| `ROUTINES.md` | 定期巡回タスク |
| `desires.conf` | 欲望の種類と発火間隔 |
| `schedule.conf` | 曜日・時間帯による実行制御 |

## ドキュメント

| ガイド | 内容 |
|---|---|
| [セットアップ](docs/guides/setup.md) | インストール手順と MCP 設定 |
| [SOUL の書き方](docs/guides/soul-writing.md) | 人格定義テンプレートの使い方 |
| [カスタマイズ](docs/guides/customization.md) | スキル、フック、設定の変更 |
| [マルチペルソナ](docs/guides/multi-persona.md) | 複数ペルソナの追加 |
| [自律行動](docs/guides/autonomous-action.md) | cron 自律行動の設定 |

## 由来

MCP サーバー群の多くは [lifemate-ai/embodied-claude](https://github.com/lifemate-ai/embodied-claude) を起源とします。そこに wardrobe 系の Claude Code 向けフック、スキル、セッション管理、人格テンプレート、記憶運用を加え、さらに Reflecta 由来の人格データ設計を重ねています。

## ライセンス

[embodied-claude のライセンス](https://github.com/lifemate-ai/embodied-claude/blob/main/LICENSE) に従います。
