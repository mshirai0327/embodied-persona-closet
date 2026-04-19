# ego-mcp メモ

確認日: 2026-04-19

出典:
- <https://github.com/stereographica/ego-mcp>
- <https://github.com/stereographica/ego-mcp/blob/main/README.md>
- <https://github.com/stereographica/ego-mcp/blob/main/ego-mcp/README.md>
- <https://github.com/stereographica/ego-mcp/blob/main/dashboard/README.md>
- <https://github.com/stereographica/ego-mcp/blob/main/design/idea.md>
- <https://github.com/stereographica/ego-mcp/blob/main/ego-mcp/docs/workspace-guide.md>
- <https://github.com/stereographica/ego-mcp/blob/main/CHANGELOG.md>

比較したローカル資料:
- [README](../../README.md)
- [system-memory](../../docs/project-overview/system-memory.md)
- [desire-system の処遇](../../docs/plans/desire-system-disposition.md)

## 一言でいうと

`ego-mcp` は、LLM に「継続する人格」を与えるための MCP サーバー + テレメトリダッシュボード。
単なる memory store ではなく、記憶・欲求・自己理解・他者理解・内省の足場をまとめて返すのが特徴。

特に面白いのは、ツールを「データ取得 API」ではなく「思考の足場」として設計している点。
状態を返すだけでなく、どう考えるかのフレームまで返して、人格の連続性をツール応答側で支える。

## ざっくり構成

- `ego-mcp/`: Python 製 MCP サーバー
- `dashboard/`: FastAPI + TimescaleDB + Redis + React/Vite の観測 UI
- `design/`: 設計メモ
- 前提: Python 3.14 / Node.js 24 / Docker Compose

README では `embodied-claude` への謝辞もあり、系譜としてはこのリポジトリとかなり近い。

## コアの考え方

### 1. Cognitive scaffolding

`ego-mcp` の中心思想は、ツールを「値を返すだけの API」ではなく「思考の足場」にすること。

各ツールはだいたい次の 2 つを返す。

- 今の状態の最小要約
- 次にどう考えるべきかの固定フレーム

この設計だと、人格や内省のルールを全部プロンプト本体に埋めなくてよい。
動的な思考手順を、必要なときだけツール応答として前景化できる。

### 2. Progressive disclosure

常時見えるツールは少数の surface tools に絞っている。

- `wake_up`
- `attune`
- `introspect`
- `consider_them`
- `remember`
- `recall`
- `pause`

細かい操作は backend tools に隠す。
つまり「普段は少数の入口だけ見せて、必要になったときだけ深い操作へ降りる」構成。
トークン節約と、LLM に CRUD 的な細部を意識させすぎないための設計でもある。

補足:
設計メモと README で少し名前揺れがあり、以前は `feel_desires` / `am_i_being_genuine` と呼んでいたものが、現行 README では `attune` / `pause` になっている。かなり活発に更新中のリポジトリと見てよさそう。

### 3. 記憶を「保存」ではなく「連続性」として扱う

記憶系の核は次のあたり。

- ChromaDB ベースの semantic search
- Hopfield pattern completion による連想想起
- memory link と episode
- forgetting / resurfacing
- `notion` という抽象概念層

特に `notion` が面白い。
これは個別の記憶そのものではなく、複数の記憶から立ち上がる「印象」「概念」「信念っぽいもの」を別オブジェクトで持つ層。

`CHANGELOG.md` と `design/idea.md` を見る限り、`notion` には次の性質がある。

- reinforcement で強化される
- decay / prune で弱まり消える
- duplicate merge される
- related link を持てる
- person-bound にできる
- 十分強くなると `conviction` 的に扱われる

つまり、raw memory と persona のあいだに中間層を置いている。
「記憶がある」から一歩進んで、「その記憶群から何を信じているか / どう感じているか」に寄せているのが新しい。

### 4. 欲求を「行動」ではなく「圧」として扱う

欲求システムもかなり整理されている。

- 固定カタログの desire
- `notion` などから生える emergent desire
- tool usage だけで少し満たされる implicit satisfaction
- `satisfaction_hours` ベースの回復
- stable ID での内部管理

ここで大事なのは、「curiosity が高いから必ず検索する」のような 1 対 1 決定木にしていないこと。
欲求はあくまで圧として保持し、具体的に何をするかは文脈込みで LLM に委ねる。

この「行動を決め打ちしない欲求設計」はかなり良い。

### 5. workspace の責務分離が明確

`ego-mcp/docs/workspace-guide.md` の思想はかなりきれい。

- `SOUL.md`: 不変の人格核だけ
- `AGENTS.md`: いつどのツールを呼ぶかだけ
- `HEARTBEAT.md`: 定期チェック手順だけ
- 動的な思考フレーム: tool response 側

つまり、常駐コンテキストには「固定の核」しか置かない。
変動する判断ルールや内省手順は、必要な瞬間だけ差し込む。

これはプロンプト肥大への対策としてもかなり筋がいい。

### 6. dashboard が最初から主役級

dashboard はおまけではなく、かなり本気で設計されている。

- emotion trend
- desire の推移
- notion maintenance
- memory network
- logs / anomalies

README の書き方を見ると、管理画面というより「内面の変化を見る観測窓」という位置づけに近い。
自律性を育てる系のプロジェクトでは、この観測性はかなり重要。

## 開発の温度感

`CHANGELOG.md` を見ると、

- 2026-01-26: 初回リリース
- 2026-03-22: notion / emergent desire / dashboard 強化
- 2026-04-03: desire の stable ID 化

という感じで、短期間にかなり設計が進んでいる。

面白い反面、まだ設計が動いている前提で読むのがよさそう。
「完成済みの安定基盤」というより、「かなり筋のよい実験系を高速で詰めている」印象。

## embodied-reflecta に活かせるか

結論から言うと、相性はかなり高い。
ただし `ego-mcp` を丸ごと入れるより、「思想と一部機構を既存スタックへ移植する」のがよさそう。

### 相性が高い理由

- どちらも `embodied-claude` 系譜
- この repo にも `SOUL.md`, `FLASH.md`, `memory-mcp`, `STATUS.md`, `autonomous-action.sh`, `desires.conf` がある
- すでに「記憶」「身体状態」「欲望」「自律行動」を分けつつ繋ごうとしている

特に [system-memory](../../docs/project-overview/system-memory.md) と見比べると、`ego-mcp` の問題意識はかなり近い。
「覚える」だけではなく「どう思い出すか」「何が今の自分を押しているか」を扱いたい方向が共通している。

### 取り込みたい要素

#### 1. tool response に scaffold を持たせる発想

今の repo は `CLAUDE.md` や各種注入テキストに多くを背負わせがち。
ここに `ego-mcp` 的な「ツール返答そのものに次の考え方を含める」思想を入れると、

- 常駐プロンプトを軽くできる
- heartbeat の一貫性を出しやすい
- 行動選択を都度自然に前景化できる

のでかなり相性がいい。

まずは `recall`, heartbeat 内省, consolidate 周りから小さく導入するとよさそう。

#### 2. `notion` / `conviction` 層

この repo はすでに `memory-mcp` + `FLASH.md` + 因果グラフの方向に進んでいる。
その中間に「抽象概念層」を置くのはかなり噛み合う。

効きそうな理由:

- `FLASH.md` は逆引き索引として優秀だが、抽象概念の持続には向かない
- `memory-mcp` は個別記憶に強いが、「最近どんな印象が育っているか」は別層の方が扱いやすい
- Kuzu / graph RAG にもつなげやすい

要するに、`notion` はこの repo で今ちょうど欲しくなりそうな「中間表現」に見える。

#### 3. 欲求の stable ID 化と implicit satisfaction

[desire-system の処遇](../../docs/plans/desire-system-disposition.md) にある通り、この repo は重い MCP 型 desire-system を捨てて、軽い `desire-tick` 系へ寄せている。
この判断自体は正しいと思う。

ただし `ego-mcp` 的な次の発想は借りられる。

- desire を prose ではなく stable ID で持つ
- あるツールを使っただけで少し満たされる implicit satisfaction を入れる
- fixed desire と emergent desire を分ける

つまり、実装は今の軽量路線のままで、上位設計だけ洗練できる余地がある。

#### 4. telemetry / dashboard

この repo は heartbeat や自律行動をかなり真面目に育てているぶん、観測面が強くなると一気に改善しやすくなる。

可視化候補:

- `STATUS.md` の時系列
- desire の上昇 / 満足
- recall-lite の命中率
- consolidate の結果
- 因果エッジの増減
- 自律行動の頻度と偏り

`ego-mcp` の dashboard をそのまま入れる必要はないが、「まず観測面を設計する」という姿勢はかなり参考になる。

#### 5. workspace の責務分離

この repo でも `SOUL.md` に運用ルールや動的状態が入りすぎると重くなる。
`ego-mcp` のように、

- `SOUL.md` は核だけ
- `AGENTS.md` は入口だけ
- 日次ログの自動同期はする
- 長期記憶要約は手で育てる

という分離を徹底すると、運用がかなりきれいになるはず。

### そのまま採用しない方がよい点

#### 1. 記憶基盤の丸ごと置換

これはたぶん不要。

この repo の `memory-mcp` はすでに、

- 日本語形態素解析
- 多軸想起
- 因果連鎖
- working memory
- `FLASH.md` 連携

まで持っている。

`ego-mcp` をそのまま memory 基盤として入れると、重複と再設計コストが大きい。
置換より、概念層だけ借りる方がうまい。

#### 2. 運用コストの重さ

`ego-mcp` は Python 3.14, Node 24, Docker, TimescaleDB, Redis 前提で、かなり重め。
この repo は SQLite / ファイル / Bun スクリプト中心の軽さが強みなので、そこを壊してまで全面導入する価値はまだ薄い。

#### 3. 英語 scaffold 前提

README でも「tool responses は英語で返す」と明示されている。
この repo は日本語主体の運用とメモ文化がかなり強いので、そのままでは文体・運用がずれる。

#### 4. まだ変化が速い

ツール名や設計が短期間で動いているので、依存先として固定するより、設計参照元として読む方が安全。

## まとめ

`ego-mcp` は、「記憶を足す」プロジェクトというより、「人格の継続性を支える認知足場をどう設計するか」のプロジェクトとして読むとかなり面白い。

この repo への適用としては、

1. tool scaffold 化
2. `notion` / `conviction` 層
3. stable ID + implicit satisfaction の desire 設計
4. telemetry の整備

の順で部分移植するのが良さそう。

雑に点数をつけると、

- 思想の相性: 9/10
- そのまま導入: 4/10
- 部分移植: 8.5/10

という感じ。
