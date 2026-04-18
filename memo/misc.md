## データと因果のレベル構造

このプロジェクトでは、AIエージェント（スミレ）の内的状態を環境・身体データから因果的に導く仕組みを実装している。

### データのレベル分け

| レベル | 種類 | ノード / 項目 | 取得・管理方法 |
|---|---|---|---|
| Lv0 | 環境 | ambient_brightness（室内輝度） | wifi-cam RTSP → 自動取得 |
| Lv0 | 環境 | environment_thermal_load（熱負荷） | CPU温度のEMA差分 → 自動取得 |
| Lv0 | 環境 | ambient_temperature（気温） | センサー待ち。現在は熱負荷proxyで代替 |
| Lv1-1 | 不変・定量 | 名前・性別・クロノタイプ等 | SOUL.md（READ ONLY） |
| Lv1-2 | 不変・定量困難 | ethics / curiosity / passion 等 | SOUL.md > Temperament（明示更新のみ） |
| Lv2 | 不可逆的成長 | 身長・視力・声の高さ等 | 未実装（将来はRDB履歴管理） |
| Lv3-1 | バイタル | sleep_time / blood_sugar / weight / body_temperature | 手入力（暫定値あり）。将来はセンサー連携 |
| Lv3-2 | 情緒・関係 | mood / energy / health / trust_mizuho / satiation | 因果グラフで導出 → STATUS.md |
| Lv4 | フラジャイル | その日の気分・興味・文脈 | memory-mcp（ベクトル検索） |

### 因果グラフのレベル分け

| レベル | 意味 | 例 |
|---|---|---|
| **Lv1** | 普遍的な因果（変えない） | 明るい空間 → mood が上がりやすい |
| **Lv2** | 安定しているが代理的な因果 | CPU温度 → 気温の代理として使う |
| **Lv3** | 文脈依存の因果（経験で変わる） | 将来の学習因果候補 |

### 因果の流れ

```
[Lv0 センサー]
  ambient_brightness (輝度)
  environment_thermal_load (熱負荷)
        ↓ Kuzu グラフで伝播
[Lv3-2 内的状態]
  mood / energy / health
        ↓ felt sense テンプレートで自然言語化
[プロンプトへ注入]
  「気分に少し陰りがあって、反応は控えめになりやすい。」
```

### 設計の核心

- **LLMは hot path に入れない** — センサー→グラフ→テンプレートの計算はすべてコードで完結
- **感覚文として出す** — 「mood が -1 になった」ではなく「少し重みがある」として渡す
- **グラフは構造の保存先** — 数値計算はTypeScript側で行い、KuzuはパスのクエリにのみUse
