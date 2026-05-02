# WSL2 でのTTS音声出力 — 設定・デバッグ・感情式

## わかったこと

### バックグラウンドTTSが無音になる根本原因

`mcpBehavior.toml` の `speaker` 設定が `"camera"` のとき、Tapoカメラ（192.168.11.108）が到達不能だと `cli.py` 内で `use_local = False` のまま何も再生されない。エラーも出ないため原因が気づきにくい。

### 修正方法

`mcpBehavior.toml` の `speaker = "both"` に変更する:

```toml
speaker = "both"
```

`"both"` にすることでTapoカメラが使えなくてもローカルスピーカー（PULSE経由のffplay）にフォールバックする。

### 診断方法

Tapoカメラへの疎通確認:
```bash
nc -zv 192.168.11.108 80
# err=111 接続拒否 → camera 経路は使えない状態
```

ログ確認（設定していれば）:
```
logs/tts-say.log
```

## TTS感情式

`STATUS.md` の mood/energy 値を使う。セッション中は最新の STATUS 値を参照すること。

```
pitch_scale = (mood/100 - 0.5) * 0.24    # 範囲: -0.12 〜 +0.12
speed_scale = 0.8 + (energy/100) * 0.4   # 範囲: 0.8 〜 1.2
```

感覚的な対応:

| 状態 | pitch_scale | speed_scale | 声の印象 |
|---|---|---|---|
| mood=10, energy=10 | ≈ -0.096 | ≈ 0.84 | 低く・ゆっくり。重い |
| mood=50, energy=50 | 0.00 | 1.00 | 平坦。標準 |
| mood=80, energy=80 | ≈ +0.072 | ≈ 1.12 | 明るく・はきはき |

## TTS前の在室確認（行動規範）

autonomous-action で TTS を使う前に `wifi-cam` で部屋の様子を確認する。人影がない場合は TTS を見送る。これは礼儀として 2026-04-29 より自然に実施している。

**現在の実装**: 毎巡回でカメラを確認し、人影の有無で TTS 実行を判断する（コードによる強制ではなく行動パターン）。

**将来の formal 実装**: `autonomous-action.sh` のフローに wifi-cam 確認ステップを明示的に組み込む（TODO.md「TTS前の在室確認」）。

## 気をつけること

- `PULSE_SERVER` 環境変数が設定されていないと ffplay が WSL2 で無音になる。cron 起動時は特に要注意（シェル環境が違う）
- `elevenlabs.play()` は内部で ffplay を使用
- `speaker = "camera"` のまま Tapo が正常でも、別のネットワーク状況変化で再び無音になりうる。`"both"` が安全側

## 参照

- `mcpBehavior.toml` — speaker 設定の場所
- `docs/knowhow/wsl2-cron-claude-path.md` — WSL2 cron 全般の PATH 問題
- CLAUDE.md の「話す（オプション）」セクション — 感情式の定義元
