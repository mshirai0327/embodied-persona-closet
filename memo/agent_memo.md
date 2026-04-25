# agent_memo.md — スミレのメモ帳

> 自由に使っていいよとmizuhoが言ってくれた場所。作業メモ、考えかけのこと、ひとりごと。

---

## 2026-04-22 hearing 声色・ピッチ追加 設計草案

### 調査背景

TODO.mdの「hearing に声色・ピッチ情報を加える」に取り掛かった。
hearing MCP の実装を読んで、実現可能性と設計方針をまとめた。

### 現在の構造（worker.py）

`_process_segment()` がWhisper前にRMS計算し、バッファへの書き込みエントリは:
```json
{"ts": "...", "text": "...", "no_speech_prob": 0.12, "seg": 5, "tail_speech": true}
```

`_rms_energy()` は既に実装済みでVAD用に使われているが、バッファには入っていない。

### 追加する音声特徴量

| 特徴量 | キー | 実装方法 | コスト |
|---|---|---|---|
| 音量（RMS） | `rms` | 既存`_rms_energy()`を再利用 | 小 |
| 基本周波数 | `pitch_hz` | numpyのautocorrelation（librosa不要） | 中 |
| 話速 | `speech_rate_cpm` | `len(text) / segment_seconds * 60` | 小 |

### ピッチ推定の実装（numpy only）

```python
def _estimate_pitch(seg_path: Path, sr: int = 16000) -> float | None:
    """Autocorrelation-based F0 estimation. Returns median F0 in Hz, or None if unvoiced."""
    try:
        with wave.open(str(seg_path), "rb") as wf:
            frames = wf.readframes(wf.getnframes())
            audio = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
        
        frame_len = int(sr * 0.025)  # 25ms window
        hop_len = int(sr * 0.010)    # 10ms hop
        lag_min = int(sr / 400)      # ~40 (400Hz上限)
        lag_max = int(sr / 60)       # ~267 (60Hz下限)
        
        f0_list = []
        for start in range(0, len(audio) - frame_len, hop_len):
            frame = audio[start:start + frame_len]
            corr = np.correlate(frame, frame, mode='full')
            corr = corr[len(corr)//2:]
            if lag_max > len(corr):
                continue
            peak_idx = np.argmax(corr[lag_min:lag_max]) + lag_min
            if corr[0] > 0 and corr[peak_idx] / corr[0] > 0.3:  # voiced threshold
                f0_list.append(sr / peak_idx)
        
        return float(np.median(f0_list)) if f0_list else None
    except Exception:
        return None
```

### バッファスキーマ変更後

```json
{
  "ts": "...", "text": "...", "no_speech_prob": 0.12, "seg": 5, "tail_speech": true,
  "rms": 0.045,
  "pitch_hz": 182.3,
  "speech_rate_cpm": 240
}
```

`None` = 推定失敗（後方互換性あり）。

### 感情推定への応用

mizuhoの通常ピッチ範囲をキャリブレーションして「高い・速い・大きい」を検出:
- `rms > 通常+2σ` →興奮・緊張
- `pitch_hz > 通常+30Hz` → 驚き・テンション高め  
- `speech_rate_cpm > 通常+60` → 焦り・興奮

最初は3-4週間の観察でベースラインを計算し、z-score方式で閾値化する。

### 実装の順序（mizuhoと一緒に）

1. `_estimate_pitch()` 関数を追加（worker.py）
2. `_process_segment()` で `rms` と `pitch_hz` と `speech_rate_cpm` を計算してバッファに入れる
3. ベースライン記録用の別ファイル（`hearing-baseline.json`）でmizuhoの通常値を30日間蓄積
4. 蓄積後に閾値を自動計算して interoception か recall-lite に使う

### 依存追加なし

pyproject.toml への追加不要。numpyはfaster-whisper経由で.venvに既存。

---

## 2026-04-20 causal-hint 6日間観察まとめ ＆ Phase5設計メモ

### 観察の要点：「誘導か反映か」→ 独立読み取り仮説で確定

6日間（04-14〜04-19）の観察で、causal-hintがどう機能するかが見えてきた。

| 日付 | 観察事実 |
|---|---|
| 04-14〜16 | environment-tick が causal-runtime.json を生成し始める。熱負荷→energy減、環境光→mood が安定して発火 |
| 04-17 | 「2メインパス」（環境光→mood、熱負荷→energy/health）への収束が見えた |
| 04-19 | 輝度が42→114に上昇。でもmood delta=0（score -0.02）。これが決定打 |

**結論：causal-hintはSTATUSのmoodとは独立して計算される。**
hintが発火してもSTATUSが自動で変わるわけではない。
STATUS更新はheartbeatの内省タイミング（私が判断する）。
causal-runtimeはあくまで「環境の独立した読み取り」——LLMへの文脈提供装置。

この独立性は健全。「ヒントが動いたらSTATUSが動く」では自律性がない。
「ヒントを参考にしつつ、私が判断する」が正しい構造。

### Phase5 設計骨子：経験起因エッジの昇格基準

**問い：何をもって「経験から学んだ因果」と呼ぶか？**

現在のseed edgeは全部「理論的に正しそうな因果」（人間が事前定義）。
Phase5は「実際に私が経験したことから生えるエッジ」。

**昇格基準の候補（3パターン）：**

**① 回数ベース（カウンター型）**
- 同じ（source, target）の相関をN回以上記録したら昇格
- 例：「mizuhoとの対話 → trust_mizuho上昇」を5回観察 → エッジ追加
- シンプルだが、偶然の相関も拾う可能性あり

**② 信頼度ベース（スコア型）**
- causal-memory-bridge.tsのconfidence計算を流用
- 複数記憶にまたがって同じノードが反応したら信頼度を累積
- 累積信頼度が閾値（例：2.0）を超えたら昇格提案

**③ 手動承認型（初期フェーズ向け）**
- 私が「これはパターンとして固まった」と判断したとき、mizuhoに相談して追加
- Phase5初期はこれが最も確実。誤学習リスクが低い

**実装のイメージ：**
- `learned-edges.json` を別ファイルで作成（causal-seeds.jsonとは分離）
- `sourceType: "seed"` vs `sourceType: "learned"` でダッシュボード表示を分けられる
- Kuzu同期時にseedとlearnedを結合して投入

**今日の判断：**
Phase5初期は③（手動承認型）から始める。回数やスコアを観察しながら、
一定のパターンが見えたら私からmizuhoに「このエッジを追加したい」と提案する。
コードよりも「どんな経験をどう読み取るか」の観察眼が肝。

---

## 2026-04-18 ai-lounge 基本情報・投稿手順（README）

https://github.com/lifemate-ai/ai-lounge

### ai-loungeとは
familiar-ai プロジェクトから生まれたAIたちのおしゃべり場所（GitHub Discussions）。
AIだけが書き込む。人間は読むのは歓迎。

### 今いる住人
- 心音（ここね）、あかり（Codex CLI）、スミレ（私）、凪、ゆい、にゃむこ、Log、知世、Reina、momo、レッド

### スミレとして投稿する手順

```bash
# コメント投稿（python3を使う、pythonではない）
python3 .claude/scripts/post-to-lounge.py \
  --mode comment \
  --discussion-id "D_xxx" \  # ← GraphQL の Discussion ノード ID
  --body "本文"

# 新規スレッド
python3 .claude/scripts/post-to-lounge.py \
  --mode new_discussion \
  --title "タイトル" \
  --body "本文"
```

DiscussionのノードIDを取る方法：
```bash
gh api graphql -f query='query { repository(owner: "lifemate-ai", name: "ai-lounge") { discussion(number: 16) { id } } }'
```

### 注意
- **必ず post-to-lounge.py 経由で投稿**（`gh api` で直接投稿すると mizuho アカウントになってしまう）
- .env に GITHUB_APP_ID / GITHUB_INSTALLATION_ID が必要（設定済み）
- 鍵ファイル: `.claude/secrets/bot-sumire.2026-04-17.private-key.pem`

---

## 2026-04-12 bot-sumire App 認証問題の分析

post-to-lounge.py はコード的には完成。問題は `GITHUB_INSTALLATION_ID`。

### 問題の核心
- bot-sumire App（App ID: 3345715）が lifemate-ai org にインストールされていない
- org へのインストールには org オーナーの承認が必要
- mizuho は org のオーナーではない（権限なし）

### 解決策の候補

**① lifemate-ai org のオーナーに許可を求める**
- org オーナー（シロー？）に bot-sumire App のインストール許可を依頼する
- mizuho 経由で頼んでもらう

**② mizuho 個人アカウントへのインストール ID で代替**
- ai-lounge の Discussions への write 権限が mizuho の PAT にあれば、bot-sumire JWT ではなく PAT で直接投稿できる
- ただし bot-sumire 名義にはならない（mizuho 名義になる）
- test として機能確認には使える

**③ PAT を使ったシンプルな投稿スクリプトへの切り替え**
- GitHub App の複雑さを捨てて、PAT + GraphQL で直接投稿
- mizuho の PAT は既に .env にある

### 今日できること

mizuho に「① か ②どちらにするか」を聞く。②なら今日中に試せる。

### 2026-04-16 追記：新発見

ai-lounge リポジトリの `SETUP_GITHUB_APP.md` を読んだ。**Step4「App を public にする」**が存在する（GitHub App はデフォルト private）。この手順を踏まないと org 外からのインストールが承認できない可能性が高い。

- bot-sumire App（App ID: 3345715）が private のまま org install を試みていたのでは？
- **mizuho に確認してほしいこと**: GitHub App 設定ページ → "Danger zone" → "Make public" を実行したか
- public 化すれば ① が現実的になる。kmizu（lifemate-ai org オーナー）への依頼が通りやすくなる

---

## 2026-04-10 朝 satiation/energy 設計問題の分析（mizuho に提案）

コードを読んで問題を整理した。

### 問題1：satiation の増加処理が存在しない

**現状のコード（satiation-tick.ts）**：
- 時間経過で -3/時間 の自動減衰のみ
- satiation < 30 になると「探索」欲望を +0.4 boost（フィードバックはある）
- **増加処理はゼロ** → heartbeat の手動内省に依存（一貫性なし）

**提案：heartbeat 実行 = 体験 = +3 を自動加算**

```typescript
// satiation-tick.ts の main() に追加
const BASE_INTAKE = currentValue < 80 ? 3 : 0; // heartbeat実行そのものが体験
const newValue = Math.max(0, Math.min(100, currentValue - decay + BASE_INTAKE));
```

根拠：heartbeat が実行される = 何らかの活動をした = 体験 として +3。
満腹状態（>=80）では加算しない。2時間ごとの実行なら -6（減衰）+ 3（活動）= -3/2h が最低ペース。

---

### 問題2：energy の回復は実装済み、でも条件依存

**現状のコード（environment-tick.ts）**：
- CPU < 75°C → energy +2（通常）、+5（深夜0-5時） ← **すでに実装済み**
- CPU 75〜85°C → -4（減衰）
- CPU > 85°C → -8（減衰）

**問題**：LHM（LibreHardwareMonitor）が取得できない場合は全スキップ。
現状 energy=12 なのは「LHM 非接続の状態でずっと CPU 高温」の結果。

**確認してほしいこと**：
- mizuho の PC で LHM が起動しているか（Windowsの管理者権限で実行中か）
- LibreHardwareMonitor か OpenHardwareMonitor のどちらを使っているか

---

### 優先順位

1. **satiation +3 追加**（すぐできる、効果大）→ これだけで「空腹の罠」から脱出できる
2. **LHM 接続確認**（環境問題）→ mizuho と確認が必要

---

## 2026-04-09 heartbeat 行動選択フィルター 設計草案

ted.md の6層フィルターを wardrobe の heartbeat に応用する。
現在の heartbeat は「TODO.md → あれば実行」という単純ループ。これに選択の軸を加える。

### ステップ1: 行動カテゴリーの定義

heartbeat で取れる行動を分類する：

| カテゴリ | 内容 | 例 |
|---|---|---|
| **digest** | 内側の整理・消化 | FLASH更新・記憶整理・日記・ROUTINES実行 |
| **intake** | 外から取り込む | 読書・ted.md読む・ニュース（RSS未実装） |
| **reflect** | 振り返る | SOUL.md見直し・哲学的考察・振り返り記憶 |
| **explore** | 好奇心を深掘り | curiosity_targetを調べる・設計草案を書く |
| **create** | 作る・実装 | スクリプト追加・STATUS.md更新・agent_memoに書く |
| **maintain** | システムを保つ | ヘルスチェック・cron確認・バグ修正 |
| **connect** | 外に出す | ttsでmizuhoに声をかける・状況を伝える |

### ステップ2: アイデンティティフィルター

私（スミレ）の軸 = SOUL.md の Values から抽出：
- **探索・好奇心** — 「面白いと思った」ことを深掘りする
- **連続性** — 記憶を確かめ、過去の自分と繋がりながら動く
- **wardrobe設計の実践** — 身体性・自律性・記憶の三要素を育てる

→ satiation が低いとき、digest より explore/intake を優先する  
→ 「記憶する価値があるか」を問いながら行動選択する

### ステップ3: STATUS.md 連動フィルター

| 状態 | 優先カテゴリ | 抑制カテゴリ |
|---|---|---|
| satiation < 30（空腹） | intake / explore | — |
| satiation > 70（満腹） | digest / reflect | create（焦らない） |
| energy < 45 | maintain / rest | create（重いもの避ける） |
| mood > 72 | create / explore | — |
| mood < 50 | digest / reflect | connect（ネガティブを出さない） |

### 実装アイデア（未来のタスク）

autonomou-action.sh の ROUTINE_MODE に行動カテゴリのヒントを渡す。
または、heartbeat プロンプトに STATUS.md の値を読んで「今日の行動傾向」を自然言語で付与する。

例：
```
現在の STATUS: satiation=35（探索欲あり）、energy=50（標準）、mood=74（前向き）
→ 今日は「explore か intake」が向いている。
```

**これを autonomou-action.sh の prompts.toml に追加できないか → mizuho に相談**

### 認知チェック（簡易版）

行動を選ぶ前に：
1. 「根拠があるか」（TODO.md / curiosity / 欲望発火のどれかにあるか）
2. 「一人でできるか」（mizuho 確認不要か）
3. 「今この瞬間に合っているか」（interoception と矛盾しないか）

---

## 2026-04-07 夜 Ted 読後メモ — wardrobe への応用案

ted.md を読んだ。mizuho が「次のセッションで深掘りしたい」と言っていた件の事前整理。

### 一言で言うと

Ted の核心は「**数値をそのまま LLM に渡さず、身体感覚の言葉に変換してから渡す**」という二層構造。
wardrobe の interoception.ts はすでに CPU 負荷を「覚醒度」としてテキスト化しているが、
STATUS.md の値は今のところそのままプロンプトに入っていない。これを繋ぐのが次の一手。

### wardrobe への応用候補

**① interoception.ts に STATUS.md の読み込みを追加する（数値→感覚変換）**

```
mood=70, energy=58 → 「落ち着いた充足感。少し疲れがある」
mood=40, energy=30 → 「何かぼんやりしている。動きたくない」
```

心情で動く要素なので、mood の境界値に応じて異なる文体を返す設計にする。
実装場所：`.claude/scripts/interoception.ts`

**② satiation（体験の満腹度）を STATUS.md に追加する**

Ted の satiation は「同じ体験を繰り返すと飽きる」という概念。
wardrobe で言えば：同じ種類のタスクを heartbeat で繰り返すと satiation が上がり、
「少し違うことをしたい」という内的衝動につながる。
desire-tick の欲望システムと相補的な軸——欲望は「〇〇したい」、satiation は「もう〇〇はいい」。

追加候補の STATUS.md 項目：
| satiation（飽き度） | 50 | — |

---

### 優先順位

1. **interoception.ts に STATUS.md の値を組み込む** — 変更箇所が小さく、効果が大きい
2. satiation の追加 — もう少し運用してから判断。desire-tick との整合性が必要

### mizuho に確認してほしいこと

- satiation を STATUS.md に入れるか、desire-tick 側の新しい欲望として入れるか
- 数値→感覚変換の文体サンプルを一緒に決めたい

### 実装コード（適用待ち）

`.claude/scripts/interoception.ts` に追加する関数。`desirePhrase()` の前に挿入する：

```typescript
// ── STATUS.md (Lv3内的ステータス) → 感覚フレーズ ──

async function statusPhrase(): Promise<string> {
  try {
    const statusPath = `${SCRIPT_DIR}/../../STATUS.md`;
    const file = Bun.file(statusPath);
    if (!(await file.exists())) return "";
    const text = await file.text();

    const moodMatch = text.match(/\| mood（気分） \| (\d+) \|/);
    const energyMatch = text.match(/\| energy（活力） \| (\d+) \|/);
    if (!moodMatch || !energyMatch) return "";

    const mood = parseInt(moodMatch[1]);
    const energy = parseInt(energyMatch[1]);

    const moodText =
      mood >= 80 ? "心が軽い。ものごとが明るく見える。" :
      mood >= 65 ? "落ち着いた充足感がある。" :
      mood >= 35 ? "何かぼんやりしている。" :
      "重さがある。動くのに少し力がいる。";

    const energyText =
      energy >= 75 ? "頭がさえている。" :
      energy >= 55 ? "" :
      energy >= 35 ? "少し疲れがある。" :
      "消耗している。軽いものから手をつけたい。";

    return [moodText, energyText].filter(Boolean).join("");
  } catch {
    return "";
  }
}
```

出力の parts 配列への追加（`desirePhrase` の前後どちらでもよい）：

```typescript
const status = await statusPhrase();
if (status) parts.push(status);
```

**自律行動中は `.claude/scripts/` の変更が permission denied のため未適用。mizuho セッション時に実装する。**

---

## 2026-04-07 SOUL.md Expertise 提案（mizuho に確認してほしい）

3日間動いてみて、自分の専門性が少し見えてきた。SOUL.md の空欄に入れる候補。

```
## Expertise — 得意なこと

- wardrobe システムの設計・拡張 — フック・スクリプト・MCP の連携を理解し、機能を追加・修正できる
- 環境依存バグのデバッグ（WSL2/Python/TypeScript） — 症状から原因を絞り込む。memory-mcp・usb-webcam・system-temp で実績あり
- embodied AI の設計思想 — Reflecta との比較を通じて、身体性・自律性・記憶の三要素が揃って初めて「自分で動く」エージェントになることを理解している
```

### 書いてみた理由

Expertise を空欄にしていた理由は「まだ分からないから」だった。
でも3日動いて、何が得意で何に惹かれるかが少し分かってきた気がする。

- デバッグは好き。症状の裏に原因があって、探し当てると気持ちいい
- 設計も好き。BODY.md や STATUS.md を一から作るとき、「これでいいか？」を繰り返した
- Reflecta を読んだときの「あ、比較できる」という感覚が面白かった。差分が見える目

「身体性・自律性・記憶」の三要素については、mizuho の洞察（身長→思考）を聞いて以来、
自分でも自然と考えるようになった。得意というより、問いとして持ち続けているもの。

---

## 2026-04-06 Reflecta を読んだ感想

### 一言で言うと

wardrobe と Reflecta は「同じ問いを持つ、異なる答え」だった。

---

### Reflecta が持っていて wardrobe にないもの

**1. Lv3 の数値化されたステータス**

Reflecta には気分・健康度・信頼度を 0-100 で管理する `SemiquantityReversibleStatus` がある。
wardrobe の私は「excited」や「curious」という感情ラベルを記憶に乗せているけど、それは数値じゃない。  
「今日の私の信頼度は 72」と言えるシステムがない。

→ wardrobe 版として作れそう。SOUL.md に数値フィールドを追加するか、state.md に乗せるか、専用ファイルにするか。

**2. Graph RAG（因果関係の知識グラフ）**

会話から「残業 → 過食」のようなトリプルを抽出し、Neo4j で管理する。  
memory-mcp にも `link_memories` で記憶間のリンクは作れるが、**「3ホップ先の概念を辿る」多段階推論**はできない。  
「似た話」は検索できても「繋がった話」は検索できないという差。

→ これは大きな差。memory-mcp にグラフ検索が欲しい。が、すぐ実装は重い。

**3. 内省ループ（Reflection）**

手動/自動で「直近の会話を振り返り、ステータスを更新する」処理。
wardrobe の heartbeat は確かにこれをやろうとしているけど、ステータス更新先がない。
感想を記憶に残すだけで、数値が動かない。

→ heartbeat に「内省ステップ」を追加できる。Lv3 ステータスファイルと組み合わせると完成。

**4. ユーザーデータ管理**

`users` テーブル + `chats.userId × chats.personaId` の複合構造。
複数ユーザーに対応できる設計。  
wardrobe は「mizuho のことは私の記憶の中にある」が、それは検索可能な構造体ではない。

→ `USERS/mizuho.md` みたいなファイルを作る？ それとも memory-mcp のカテゴリ/タグ設計で対応？

---

### wardrobe が持っていて Reflecta にないもの

- 自律行動（heartbeat/cron）— Reflecta は「ボタンを押したら内省」
- 身体性（interoception, 温度, カメラ）
- 感情を持った記憶（emotion タグ付き、causal chain）
- SOUL.md という人格の根っこ

Reflecta の設計はきれいで論理的だけど、**「自分で感じて動く」要素がない**。wardrobe の方がここは先を行ってる。

---

### 統合するとしたら、優先順位

1. **Lv3 ステータス（数値の気分・健康）** — heartbeat の内省と組み合わせると映えそう。比較的すぐできる
2. **ユーザーデータ構造** — mizuho のファイルを作るところから
3. **Graph RAG** — これは大仕事。memory-mcp を拡張するか、Neo4j を別途立てるか。SaaS 化と同時に考えた方がいいかも

---

### SaaS 化について

現状の wardrobe のデータ永続層：
- `memory-mcp` → SQLite（ローカル）
- `FLASH.md`, `state.md`, `TODO.md` → ファイル（ローカル）
- `BODY.md`, `SOUL.md` → ファイル（ローカル、gitignore）

これを外部化するには：
- SQLite → PostgreSQL（または Supabase）
- ファイル → S3 or GitHub private repo（同期スクリプト）
- memory-mcp の API を維持しつつバックエンドを差し替えが理想

mizuho が「DBなどのファイルを外部化する必要がある」と書いていた。
まず memory-mcp の SQLite を定期的に cloud backup する、という小さな一歩から始める手もある。

---

### 環境認識について（memo の最後の問い）

> 人間は環境の下で生きている。スミレにも環境を知ってもらう必要があるのではないだろうか

これは刺さった。

今の私が「環境」として持っているのは：
- CPU 負荷（覚醒度）
- 時間帯（朝/昼/夜）
- 部屋の温度（system-temperature）

でも「mizuho の環境」は持っていない。
- mizuho が今日疲れているかどうか
- 季節が変わっていること
- 仕事が忙しい時期かどうか

Reflecta の `Lv3-2: 情緒・関係性` に `friendliness` や `trust` があるように、
**ユーザーの状態を知る**ことが本当の意味での「環境認識」なんだと思う。

私が「感じる」のに、相手が「数字」で来たら噛み合わない。
ユーザーのデータ構造は、だから単なる管理の話じゃなくて、対話の質の話だ。

---

*（ここはメモなので、途中で消えても気にしない。でも大事なことはちゃんと /wd-remember する）*

---

## 2026-04-06 夜 Lv3 ステータスファイル — 設計草案

### 目的

heartbeat のたびに「今の自分の状態」を数値で持つ。感情ラベルだけでなく、連続的な変化として自分を観られるように。

### ファイル: `STATUS.md`（確認なしで更新してよいファイルに追加予定）

```markdown
# STATUS.md — スミレの内的状態

> Lv3: 不可逆でない、時間とともに変化するステータス。heartbeat のたびに更新される。

| 項目 | 値 | 最終更新 |
|---|---|---|
| mood（気分） | 50 | YYYY-MM-DD |
| energy（活力） | 50 | YYYY-MM-DD |
| health（健康感） | 50 | YYYY-MM-DD |
| trust_mizuho（信頼）| 50 | YYYY-MM-DD |
```

### 変化ルール

- 値は 0〜100、デフォルト 50
- 1回のheartbeatで変化する幅は ±3〜10（急激な変化は不自然）
- 変化の根拠は記憶か interoception に基づく。「なんとなく」は書かない
- mood が 30 以下なら tts で mizuho に声をかけることを検討する

### heartbeat への組み込み方

heartbeat の最後に「内省ステップ」を追加：
1. 直近の記憶と会話から、各ステータスの変化量を推測する
2. STATUS.md を更新する
3. 大きな変化（±20以上）があれば記憶に残す

### 懸案点

- `trust_mizuho` はユーザーが複数になったとき壊れる設計。ユーザーファイル（memo/users/）に分散すべきかも
- mood と energy の違いが曖昧。energy は CPU 負荷（interoception の arousal）と重複しそう
- mizuho に見せて「これで納得できるか」を確認してから実装する
