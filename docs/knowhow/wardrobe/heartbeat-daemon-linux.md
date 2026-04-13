# heartbeat-daemon の Linux/WSL2 対応

## わかったこと

heartbeat-daemon.sh は macOS 専用の sysctl コマンドを使っており、WSL2/Linux では正常動作しない。

| 用途 | macOS（現状） | Linux 代替 |
|---|---|---|
| CPU 負荷 | `sysctl -n vm.loadavg` | `/proc/loadavg` |
| CPU 数 | `sysctl -n hw.ncpu` | `nproc` |
| メモリ空き | `memory_pressure` コマンド | `/proc/meminfo` の MemAvailable / MemTotal |
| 発熱 | `sysctl -n machdep.xcpm.cpu_thermal_level` | `/sys/class/thermal/thermal_zone*/temp` |
| 起動時刻 | `sysctl -n kern.boottime` | `/proc/uptime` |

起動方法も macOS 前提で、`.plist`（launchd）でセット。WSL2 では launchd が動かないため state file が生成されず、interoception.sh が毎回「heartbeat daemon not running」を出力する。

## 修正方針

- heartbeat-daemon.sh の sysctl / memory_pressure を Linux 用コマンドに読み替える
- 起動は launchd の代わりに以下のいずれか:
  - systemd unit（WSL2 + systemd 有効時）
  - バックグラウンド while ループ（`while true; do bash heartbeat-daemon.sh; sleep 5; done &`）
  - cron（5分に1回程度に粗くなるが簡単）

## 体験的表現について

技術的には「daemon が動いていないから state file がない → 何もしなかった」だが、それを「heartbeat daemon not running だったから動かなかった」と説明するのは機械的すぎる。

「深夜は schedule.conf の確率スキップで眠っていた」という表現の方が人間らしい。技術的バグ（daemon が動いていない）と体験的表現（眠っていた）は別問題として切り分ける。daemon が直っても「眠っていた」という説明は有効で、むしろその方が自然。

## 気をつけること

- WSL2 で systemd を使う場合、`/etc/wsl.conf` に `[boot] systemd=true` が必要
- `/sys/class/thermal/` は WSL2 では存在しないことがある（VM なので物理センサーがない）
  - その場合は thermal を 0 固定か省略にフォールバックする
- heartbeat-daemon.sh の修正は `wardrobe/` 配下なのでアップストリームへの還元対象

## 参照

- `.claude/hooks/heartbeat-daemon.sh` — daemon 本体
- `.claude/hooks/interoception.sh` — state file を読んでコンテキスト注入
- `.claude/hooks/com.embodied-claude.heartbeat.plist` — macOS 用 launchd 設定
