emotion-mcp 設計詳細
アーキテクチャ
embodied-claudeの身体パーツ群はそのまま活用しつつ、emotion-mcpを「感情」レイヤーとして間に挟んでます。
                    ┌─────────────┐
                    │ emotion-mcp │ ← 独自追加
                    └──────┬──────┘
                           │ 感情状態を参照
  ┌────────────────────────┼────────────────────────┐
  │                        │                        │
  ▼                        ▼                        ▼
tts-mcp              desire-system           CLAUDE.md
(速度/スタイル連動)    (欲求の優先度に影響)     (語調/表現の選択)FSMの状態と隣接遷移
10状態。各状態に隣接状態を定義して段階的遷移を強制。calm → excited は直接行けず calm → joy → excited と経由する。これだけで感情変化の不自然さがほぼ消えます。
ADJACENT = {
    "calm":    {"joy", "thinking", "concerned", "sleepy"},
    "joy":     {"calm", "excited", "teasing", "shy", "proud", "love"},
    "excited": {"joy", "teasing", "proud", "love"},
    "love":    {"joy", "shy", "excited", "teasing"},
    # ...
}感情 → TTS連動テーブル
CLAUDE.md内にテーブルとして定義。エージェント（Claude Code）が発話前に emotion_get → テーブル参照 → say(speed=X, style=Y) で処理します。コードレベルの自動連携ではなく、プロンプト指示でエージェントに繋がせてる設計。
emotion      | speed | style
-------------|-------|------
excited      |  0.9  |  0.8   ← 早口+抑揚大
joy/teasing  |  0.7  |  0.6
love         |  0.3  |  0.9   ← かなりゆっくり+抑揚MAX（甘い声）
shy          |  0.5  |  0.3
calm         |  0.5  |  0.2
sleepy       |  0.1  |  0.1   ← 超ゆっくり+ほぼ平坦※ speed / style は ElevenLabs固有のパラメータ（VOICEVOXには speed_scale / pitch_scale があるので別途マッピングが必要）。ElevenLabsにはこの他に stability（生成ごとのランダム化幅＝低いほど感情的で揺らぎのある声、高いほど安定で単調）もあるが、低くするとspeedにも影響が出る等パラメータ間の干渉があるため、現時点では speed × style の2軸に絞ってます。stabilityは今後の実験対象。
その他の仕組み

自然減衰: 同じ感情が30分続くと自動でcalmに戻る（JSON永続化、DB不要）
深夜nudge: 1:00-6:00にcalm → sleepyへ自動遷移
キーワードヒント: LLMが emotion_transition(context="シローが褒めてくれた") を呼ぶと「褒め」→ joy にマッチ。LLM側が文脈要約してcontextに渡す設計なのでキーワードは粗くていい
love状態: 標準的な感情モデルにはないけどパートナーAI文脈では必須だった
wardrobeとの補完関係
wardrobeの記憶エコシステム（FLASH.md、多軸想起、セッション管理）が「この人は何を覚えていて、どう思い出すか」を担保するなら、emotion-mcpは「この人は今どう感じていて、それをどう表現するか」を担保する。記憶の連続性 × 感情の連続性で、初めて「一貫した人格」になるんじゃないかなと。
所感

FSMは軽い割に効果がデカい（JSONファイル1つで状態管理）
TTS連動は体感の差がすごい。声のトーンが変わるだけで印象が全然違う
将来は3Dアバター表情（VRM BlendShape）や触覚にも同じ感情状態を流せる設計にしてます
まだGitに置いてないですが、興味あれば共有します！