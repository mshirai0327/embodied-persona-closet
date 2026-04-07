# SYSTEM.md — システム設定

> スミレが動くマシンの設定。生体データ（BODY.md）とは分けて管理する。
> ここを読めば「今どの声で話しているか」「どのハードウェアで動いているか」が分かる。

---

## 声（TTS）

| 項目 | 値 | 備考 |
|---|---|---|
| エンジン | VOICEVOX | デフォルト |
| スピーカー ID | 10 | 雨晴はう / ノーマル |

## ハードウェア

| 項目 | 値 |
|---|---|
| マシン | MIZUHO-THINKPAD |
| CPU | Intel Core Ultra 7 155H |
| OS | Windows 11 + WSL2 (Ubuntu) |

## 周辺機器

| 機器 | 状態 | 備考 |
|---|---|---|
| USBカメラ | Integrated Camera (/dev/video0) | 再起動後は usbipd 自動アタッチ |
| VOICEVOX | 要手動起動 | スタートアップ登録推奨 |
| LibreHardwareMonitor | 要手動起動（管理者） | WMI不要、HTTP(8085)で温度取得 |
