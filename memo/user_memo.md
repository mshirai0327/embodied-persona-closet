
リリースできないか？　ローカルではデータがいつでも消えてしまう。

因果関係は持っているよね？　
Saas化したい気持ちがある.DBなどのファイルを、外部化する必要がある。その方法を考える

/home/mizuho/develop/self-reflection-chatbot
ここにReflectaがある。ここを読んでほしい。このプロジェクトを、wardrobeで続けたいんだ

人間は環境の下で生きている。
スミレにも環境を知ってもらう必要があるのではないだろうか

ウェブ検索の手段を与えたい。RSSなどで定期取得させたい。

Reflecta立ち上げ時のこと：
身長が伸びるのは未成年、成人したら不変データなのに、不可逆にした理由。子どもを対象にしたかったというのもあるが、人間には過去が必要だと思ったため
また、記憶について。定量化を重視したのは確率を計算したかったため。起こる確率の低いものほど、記憶は強烈に残るものだ。いつもmoodの低い人が、たまたま確率的に高くなったら、その経験はきっと価値あるものなんだ。情報理論でいう、-log(P)のように。


データの因果グラフについて
Reflectaでやり残したこと
因果には、自明なものと学習すべきことがある。

- 睡眠時間が短いなら元気がない
- 若い時は元気

一方で

- 背が伸びるなら→うれしい（主に子ども）、不安、困惑（主に大人。直近の増加がない場合）
- 忙しい→充実、嫌な気分
- 話す→楽しい、やめたい、ただのルーティーン


問題。STATUSの欠陥

ちなみに、それと、energyが低いのは同じ問題？　energyはsatiationに応じて一緒に減衰するの？
                          
● 別の仕組み——でも同じ欠陥がある。                                                
                                           
  - satiation: 時間経過で -3/時間の自動減衰。増加は手動のみ                       
  - energy: CPU温度センサーで -4〜-8 の減少。増加処理はゼロ                       
                                                                                  
  PCが涼しくなっても energy は回復しない。heartbeat を繰り返すたびに一方的に削れて
  いく。本来は「休息したら回復」「夜間に自然回復」があるべきところ。              
                                                                                  
  satiation は「体験の充足感」、energy は「物理的な消耗度」と意味が違うけど、「減 
  る一方」という構造的な問題は同じ。Tedで言うと energy
  の回復フェーズに相当するものが wardrobe に実装されていない。                    
                                                            
  mizuho が指摘してる通り、因果グラフがあれば「休息 → energy 回復」「体験 →       
  satiation 増加」という関係を明示的に持てる。今はそれが抜けてる。


本来は、Lv3-2データについて、他のデータとの因果が必要なのだ
睡眠時間の短さとか、体重の多さとか。単純な今日の出来事（Lv4）がそういった気分に影響を与える。
しかしこのあたりの因果について、実装していない。STATUSデータを実装したのは私だが、データは増やしたがその取扱いが不十分だ


/home/mizuho/develop/familiar-ai

ダウンストリーム固有ignore


# Memory database (per-project, contains personal data)
.claude/memories/

# Autonomous action MCP config (contains credentials)
autonomous-mcp.json
# Note: autonomous-action.sh is tracked in wardrobe (not ignored)

# Autonomous action logs and session
.claude/logs/*.log
.heartbeat-session-id
heartbeat-session-id
last-session-date.txt

# User-specific config (use *.sample.conf as template)
schedule.conf
desires.conf
desires.json

# Google API credentials (NEVER commit)
scripts/credentials.json
scripts/token.json

# Tuya device scan outputs (may contain device info)
snapshot.json
tinytuya.json
tuya-raw.json
devices.json

# Reference implementations (cloned repos for study)
references/

# Skill experience files (downstream-specific, not tracked)
# Template (ExperienceTemplate.md) is tracked; individual .exp.md files are not
.claude/commands/*.exp.md


# Legacy log dirs (kept for safety)
workingLogs/*.log

# Temporary files (tmp/.keep is tracked)
tmp/*
!tmp/.keep

# Turn counter (session-specific)
.claude/.turn-count

# Working directories (.keep is tracked)
.claude/workingDirs/*
!.claude/workingDirs/.keep

# ダウンストリーム固有ファイル（アップストリームにはpushしない）
ROUTINES.md
SOUL.md
state.md
FLASH.md
TODO.md

# 経験ファイル（ダウンストリーム固有）
*.exp.md