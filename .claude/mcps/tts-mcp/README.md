# tts-mcp

`tts-mcp` は `ElevenLabs` または `VOICEVOX` で音声を合成し、PC スピーカーか Tapo カメラの内蔵スピーカーへ再生する MCP サーバーです。

`Tapo C200` でしゃべらせたい場合は、`VOICEVOX` で音声生成し、`Tapo direct` バックチャネルでカメラへ直送します。

## できること

- `VOICEVOX` または `ElevenLabs` で TTS
- `speaker=local` で PC 再生
- `speaker=camera` で Tapo カメラ再生
- `speaker=both` で両方再生
- `Tapo direct` によるカメラスピーカー再生

## 必要なもの

- `ffmpeg`
- `VOICEVOX` を使うなら VOICEVOX エンジン
- Tapo C200/C210/C220 など、`tapo://` バックチャネルが使えるカメラ
- Tapo 直送を使うなら TP-Link クラウドアカウントのパスワード

## VOICEVOX + Tapo C200 セットアップ

1. 依存を入れる

```bash
cd .claude/mcps/tts-mcp
uv sync
```

2. `.env` を作る

```bash
cp .env.example .env
```

最低限、以下を設定します。

```dotenv
VOICEVOX_URL=http://localhost:50021
VOICEVOX_SPEAKER=3

TTS_CAMERA_BACKEND=auto
TAPO_CAMERA_HOST=192.168.11.xxx
TAPO_CLOUD_PASSWORD=your-tplink-cloud-password
```

`TTS_CAMERA_BACKEND=auto` は `TAPO_CAMERA_HOST` と `TAPO_CLOUD_PASSWORD` が揃っていれば `Tapo direct` を使います。明示したい場合は `TTS_CAMERA_BACKEND=tapo` にします。

3. `mcpBehavior.toml` の `[tts]` を確認する

```toml
[tts]
default_engine = "voicevox"
speaker = "camera"
camera_ffmpeg = "ffmpeg"
```

4. VOICEVOX エンジンを起動する

`VOICEVOX_URL` で指定した URL に VOICEVOX が応答している必要があります。

5. 動作確認する

```bash
uv run --directory .claude/mcps/tts-mcp python -m tts_mcp.cli --speaker camera "こんにちは、Tapo C200 から話しています"
```

## トラブルシュート

### VOICEVOX に接続できない

- `VOICEVOX_URL` が実際のエンジン URL と一致しているか確認する
- `curl http://127.0.0.1:50021/version` で応答するか確認する

### カメラから音が出ない

- `speaker = "camera"` または `--speaker camera` になっているか確認する
- `TTS_CAMERA_BACKEND=tapo` か `auto` なら `TAPO_CAMERA_HOST` と `TAPO_CLOUD_PASSWORD` を確認する
- `TTS_CAMERA_FFMPEG` をカスタム指定している場合は、その `ffmpeg` パスが存在するか確認する

### PC からも同時に鳴らしたい

- `mcpBehavior.toml` の `[tts].speaker = "both"` にする
- もしくは CLI で `--speaker both` を使う
