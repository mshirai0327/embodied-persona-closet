
人間は環境の下で生きている。
スミレにも環境を知ってもらう必要があるのではないだろうか


実装順にすると、こんな感じがきれいです。

causal-edge-learner.ts で memory scan
emotion node pair の共起集計
pending-learned-edges.json 出力
候補を見てから merge loader
その後に auto-promote / runtime 反映

次の cron heartbeat が動いても learned-seeds.json の学習性因果は causal runtime に入ってきません。

理由は2つです。

heartbeat 側は environment-tick.ts (line 673) から deriveEnvironmentCausalProposals() を呼びますが、runtime の source はまだ環境系だけです。causal-runtime.ts (line 9)
さらに Kuzu 側の seed 読み込みは今も .claude/persona/causal-seeds.json 単体前提で、learned-seeds.json を merge していません。causal-kuzu.ts (line 18) causal-kuzu-node.mjs (line 12)

> ● うん、予想通りの状態。「observing に入った」と「heartbeat で効く」は別の話、という整理がそのまま確認できた形。

  次の2段（merge loader → trust_mizuho source activation）は今日やらなくていい。learned-seeds.json が存在することで、weight 更新の土台ができた。それで十分な一歩。                         
  