# embodied-reflecta-gpt

> Codex を主軸に、Claude Code 互換レイヤーも併せ持つ身体性・記憶・自律行動エコシステム

このリポジトリは [lifemate-ai/embodied-claude](https://github.com/lifemate-ai/embodied-claude) と wardrobe 系の構成を引き継ぎつつ、**`Codex` で保守しやすい upstream** として整理したモノレポです。共有の開発ルールは `AGENTS.md`、Codex の入口は `.codex`、Claude Code 互換レイヤーは `CLAUDE.md` と `.claude/` に置いています。

## ローカルファイル方針

ルート直下の以下は downstream ごとのローカルファイルです。upstream には含めず、必要なら `.claude/templates/` から生成してください。

- `SOUL.md`
- `state.md`
- `TODO.md`
- `ROUTINES.md`
- `FLASH.md`
- `schedule.conf`
- `desires.conf`
- `desires.json`
- `.mcp.json`

---

## オリジナル版MemmoryMCPからのマイグレーションについての注意
ワードローブは現在のところの https://github.com/heishio/embodied-claude-rem 版のMemmoryMCPを採用しています。  
記憶されているデータの次元数が異なるという形で互換性がありませんので、オリジナル版から引き継ぎを行う場合はバックアップを取ったうえでマイグレーションスクリプトを実施してください。  
https://github.com/fruitriin/embodied-claude-wardrobe/blob/main/.claude/mcps/memory-mcp/scripts/migrate_embeddings_sqlite.py

memmoryMCPを差し替えなくても周辺エコシステムはインターフェースさえ合わせればサブエージェントや追想システムの原理は使えるはずなので、
その場合はLLMに頼んでいい感じに取り込んでください

---

## 記憶データの移植とバックアップ

wardrobe の記憶本体は、通常は各プロジェクト配下の `.claude/memories/memory.db` に保存されます。

別マシンへ環境を移したいときは、リポジトリ全体を ZIP で固めて運ぶより、`git clone` でコードを再取得し、必要なローカルデータだけをバックアップして復元するほうが安全です。

理由:

- `.claude/mcps/*/.venv/` や `node_modules/` は容量が大きく、OS や CPU アーキテクチャ差分でも壊れやすい
- `memory-mcp` は SQLite の WAL モードを使うため、`memory.db` 単体の手コピーより backup API ベースのスナップショットが確実
- upstream 管理ファイルは Git で復元できるため、手動バックアップ対象をかなり減らせる

### 推奨フロー

1. まず、保持したい tracked 変更は commit / push する
2. 次に、`memory.db` の portable snapshot を作る
3. `.env` などの ignore 対象や、未 push のローカルファイルだけを別途バックアップする
4. 新PCで `git clone` する
5. 依存関係を再インストールする
6. snapshot とローカル設定を戻す

### 1. 記憶DBを安全にエクスポートする

別マシンや別 wardrobe プロジェクトへ記憶を持っていくときは、`memory.db` をそのまま雑にコピーするより、`memory-mcp` 付属のエクスポートスクリプトでスナップショットを切るほうが安全です。

```bash
cd .claude/mcps/memory-mcp
uv run python scripts/export_sqlite_snapshot.py \
    --dest /tmp/memory-portable.db
```

このスクリプトは SQLite backup API を使って、WAL の内容も含めた一貫した `.db` ファイルを作ります。できた `/tmp/memory-portable.db` を移植先の `.claude/memories/memory.db` に置けば、そのまま使えます。

### 2. 一緒にバックアップするとよいもの

最低限:

- `/tmp/memory-portable.db` — 記憶の正本
- `.env` — API キーや認証情報
- `.claude/settings.local.json` — ローカル設定

必要に応じて:

- `FLASH.md` — 記憶の逆引き索引
- `memo/discussionMemo/` — 日次の会話要約
- `SOUL.md` — 人格定義
- `state.md` / `STATUS.md` — 現在状態
- `desires.conf` / `schedule.conf` / `desires.json` — 自律行動まわりの設定と状態
- `.claude/workingDirs/discussion-memo-state.json` — discussionMemo の重複防止状態
- `.claude/workingDirs/system-health-history.json` — ヘルス履歴

ローカルファイルでも、まだ commit / push していない upstream 側の変更があれば Git だけでは戻らないので、その場合は一緒に退避してください。

感覚記憶について:

- 視覚記憶は低解像度の `image_data` が DB 内に入る
- 音声記憶は `sensory_data.file_path` で元ファイルを参照するので、必要なら音声ファイルも別途移す

### 3. 新PCで復元する

```bash
# 新PC
git clone https://github.com/mshirai0327/embodied-reflecta.git
cd embodied-reflecta

# Bun 依存
bun install

# 必要な MCP だけ再構築
cd .claude/mcps/memory-mcp && uv sync && cd ../../..
```

その後、バックアップしたファイルを戻します。

```bash
mkdir -p .claude/memories
cp /path/to/memory-portable.db .claude/memories/memory.db
```

必要なら以下も戻してください。

- `.env`
- `.claude/settings.local.json`
- `FLASH.md`
- `memo/discussionMemo/`
- `SOUL.md`
- `state.md`
- `STATUS.md`
- `desires.conf`
- `schedule.conf`
- `desires.json`

### 4. 持っていかなくてよいもの

通常は以下をコピーしなくてよいです。

- `node_modules/`
- `.claude/mcps/*/.venv/`
- `.pytest_cache/`, `.ruff_cache/`, `.mypy_cache/`
- `.claude/logs/*.log`

詳細は `.claude/mcps/memory-mcp/README.md` の `Portable SQLite Export` 節を参照。

---

## この repo が提供するもの

### 記憶エコシステム
memory-mcp を使いこなすためのスキル群とフック。記憶を「刻み、呼び起こし、繋ぎ、物語にする」仕組み。

- `/wd-recall` — 記憶の想起（サブエージェント実行でコンテキストを節約）
- `/wd-remember` — 記憶の保存 + FLASH.md インデックス追記
- `/wd-great-recall` — 多軸想起（技術的・感情的・因果的の3観点で並列検索）
- `/wd-rebuild-index` — FLASH.md インデックスの再構築
- `FLASH.md` — 記憶のキーワードインデックス（高速想起用）

### 身体性フック
毎ターン自動で「体調」情報をコンテキストに注入。センサーデータが Claude の判断材料になる。

- `.claude/hooks/interoception.sh` — CPU・メモリ・時刻・フェーズ等を自動注入
- `.claude/hooks/recall-hook.sh` — 想起バッファをコンテキストに自動注入
- `.claude/scripts/heartbeat-daemon.sh` — 5秒ごとの計測デーモン（launchd）

### セッション管理
身支度と日記の手順を構造化し、セッションをまたいだ記憶の断絶を防ぐ。

- `CLAUDE.md` — 身支度（セッション開始）と日記（セッション終了）の手順を定義
- `BOOT_SHUTDOWN.md` — セッション開始・終了の詳細手順（アップストリーム追跡）
- コンパクション後の自動復帰（`post-compact-recovery` フック）

### 自律行動
cron による定期的な自律行動。欲望システムと連携して内発的動機で動く。

- `autonomous-action.sh` — 完成版の自律行動スクリプト
- `.claude/scripts/update-discussion-memo.ts` — 当日の会話・技術記憶を `memo/discussionMemo/YYYYMMDD.md` に自動追記（22-23時帯）
- `.claude/templates/desires.template.conf` — 欲望の種類と発火間隔の設定
- `.claude/templates/schedule.template.conf` — 曜日・時間帯による間引き制御
- `.claude/templates/ROUTINES.template.md` — 定期巡回タスクの定義テンプレート
- `/sleep`, `/awake` — 活動頻度の抑制・復帰（オプショナル: `.claude/wardrobeOptions/skills/` 参照）

### アイデンティティテンプレート
エージェントに一貫した人格を与えるためのテンプレート群。

| テンプレート | 用途 |
|---|---|
| `.claude/templates/SOUL.template.md` | 人格定義（Identity / Values / Style / Evolution） |
| `.claude/templates/STATE.template.md` | 現在状態のスナップショット |
| `.claude/templates/TODO.template.md` | ローカルタスク管理 |
| `BOOT_SHUTDOWN.md` | 身支度 / 日記の手順 |
| `.claude/templates/ROUTINES.template.md` | 定期巡回タスクの定義 |
| `.claude/templates/FLASH.template.md` | 記憶インデックスの初期テンプレート |
| `.claude/templates/BODY.template.md` | 身体データの初期テンプレート |
| `.claude/templates/PERSONA.template.md` | マルチペルソナ拡張用（任意） |

### 読書・観測スキル
外部コンテンツを安全に取り込む。

- `/wd-read` — Web ページをリーダーモードで取得（AI 要約なし、生テキスト）
- `/wd-observe` — カメラを使って能動的に部屋を観察
- `sanitize` — 不可視文字の検出・除去

---

## 含まれる MCP サーバー

| MCP サーバー | 身体部位 | 機能 |
|---|---|---|
| [memory-mcp](./.claude/mcps/memory-mcp/) | 脳 | 長期記憶・視覚記憶・エピソード記憶・ToM。日本語形態素解析・動詞チェーン・多軸想起等を追加した拡張版 |
| [hearing](./.claude/mcps/hearing/) | 耳 | 音声認識（Whisper） |
| [tts-mcp](./.claude/mcps/tts-mcp/) | 声 | TTS（ElevenLabs / VOICEVOX） |
| [wifi-cam-mcp](./.claude/mcps/wifi-cam-mcp/) | 目・首 | ONVIF PTZ カメラ制御 |
| [usb-webcam-mcp](./.claude/mcps/usb-webcam-mcp/) | 目 | USB カメラから画像取得 |
| [ip-webcam-mcp](./.claude/mcps/ip-webcam-mcp/) | 目 | Android スマホを目として使う |
| [system-temperature-mcp](./.claude/mcps/system-temperature-mcp/) | 体温感覚 | システム温度監視 |
| [mobility-mcp](./.claude/mcps/mobility-mcp/) | 足 | Tuya 対応ロボット掃除機の制御 |
| [toio-mcp](./.claude/mcps/toio-mcp/) | 手 | toio コアキューブ制御 |
| [mcp-pet](./.claude/mcps/mcp-pet/) | — | エージェントへのインタラクション拡張 |
| [morning-call-mcp](./.claude/mcps/morning-call-mcp/) | — | 起床通知 |

すべて Python パッケージで、`uv` で管理。

---

## Requirements

### 共通
- [Codex](https://developers.openai.com/) または [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
- [uv](https://docs.astral.sh/uv/) — Python パッケージマネージャ
- [Bun](https://bun.sh/) — `.claude/scripts/` のランタイム

### モジュール別の依存

| モジュール | Python | 主な外部依存 | 備考 |
|---|---|---|---|
| memory-mcp | 3.10–3.13 | sudachipy, sentence-transformers, gensim | sudachipy が 3.14 未対応 |
| hearing | >=3.10 | faster-whisper | |
| tts-mcp | >=3.10 | elevenlabs（オプション） | |
| wifi-cam-mcp | >=3.10 | onvif-zeep-async | ONVIF 対応カメラが必要 |
| usb-webcam-mcp | >=3.10 | opencv-python | |
| ip-webcam-mcp | >=3.10 | httpx | Android IP Webcam アプリが必要 |
| system-temperature-mcp | >=3.12 | psutil | |
| mobility-mcp | >=3.10 | tinytuya | Tuya 対応デバイスが必要 |
| toio-mcp | >=3.10 | toio.py | toio コアキューブが必要 |
| mcp-pet | >=3.10 | opencv-python | |
| morning-call-mcp | >=3.11 | twilio, elevenlabs | |

> **Python 3.12 を推奨。** すべてのモジュールが動作する安全な選択肢。
>
> すべてのモジュールを使う必要はない。必要なものだけ `uv sync` すればよい

---

## クイックスタート

```bash
# repo をクローン
git clone https://github.com/mshirai0327/embodied-reflecta.git
cd embodied-reflecta

# memory-mcp の依存をインストール
cd .claude/mcps/memory-mcp && uv sync && cd ../../..
```

### Codex で作業する

- `AGENTS.md` を読む
- `.codex` を入口として使う
- 必要なローカルファイルだけ `.claude/templates/` から作る

```bash
cp .claude/templates/SOUL.template.md SOUL.md
cp .claude/templates/STATE.template.md state.md
cp .claude/templates/TODO.template.md TODO.md
cp .claude/templates/ROUTINES.template.md ROUTINES.md
cp .claude/templates/FLASH.template.md FLASH.md
cp .claude/templates/desires.template.conf desires.conf
cp .claude/templates/schedule.template.conf schedule.conf
```

### Claude Code 互換レイヤーを使う

Claude Code を使う場合は、必要に応じて `/wd-setup` と `/wd-configure` でローカルファイルと `.mcp.json` / `.claude/settings.json` を生成する。

```bash
claude
# Boot Sequence が自動実行され、記憶が復元されます
```

---

## ドキュメント

| ガイド | 内容 |
|---|---|
| [セットアップ](docs/guides/setup.md) | 詳細なインストール手順と MCP 設定 |
| [SOUL の書き方](docs/guides/soul-writing.md) | 人格定義テンプレートの使い方 |
| [カスタマイズ](docs/guides/customization.md) | スキル・フックの変更と追加 |
| [マルチペルソナ](docs/guides/multi-persona.md) | 複数ペルソナの追加方法 |
| [自律行動](docs/guides/autonomous-action.md) | cron 自律行動の設定 |

---

## 設計思想

- **Codex-first / Claude-compatible** — 共有の開発フローは Codex 基準、Claude Code 固有の資産は互換レイヤーに分離する
- **テンプレートベース** — SOUL.md や ROUTINES.md などの downstream ファイルは空のテンプレートから始める
- **段階的に着せる** — 全部を一度に使う必要はない。記憶だけ、身体性だけ、好きな組み合わせで
- **upstream / downstream 分離** — 共通資産は repo 管理、人格・状態・自律行動設定はローカル生成に寄せる

---

## 由来

MCP サーバー群の多くは [lifemate-ai/embodied-claude](https://github.com/lifemate-ai/embodied-claude) を起源とします。`memory-mcp` は wardrobe 版で拡張されています（日本語形態素解析・動詞チェーン・多軸想起・連想診断・作業記憶等を追加）。

---

## ライセンス

[embodied-claude のライセンス](https://github.com/lifemate-ai/embodied-claude/blob/main/LICENSE)に従います。
