# WSL2 cron から claude CLI を呼ぶ際の PATH 問題

## わかったこと

`autonomous-action.sh` の冒頭で PATH を拡張しているが、`~/.nvm/` が含まれていない。
`claude` を nvm 経由でインストールしている場合、cron からの実行時に `claude: command not found` となりスクリプトが1秒で終わる。

ログには `[新規セッション作成]` の直後に終了のみ記録され、エラーメッセージが残らないため原因が分かりにくい。

## 解決策

`~/.local/bin/` にシンボリックリンクを作成する（`autonomous-action.sh` の PATH に含まれている）:

```bash
mkdir -p ~/.local/bin
ln -sf ~/.nvm/versions/node/v22.19.0/bin/claude ~/.local/bin/claude
```

## 気をつけること

- nvm の Node.js バージョンを変えると `~/.nvm/versions/node/<version>/bin/` パスが変わるため、シンボリックリンクが切れる。変更後は再作成が必要
- heartbeat の実行ログは `.claude/logs/YYYYMMDD_HHMMSS.log` に残る。1秒で終わっていたら PATH/コマンド検索の失敗を疑う

## 参照

- `autonomous-action.sh` — cron から呼ばれる自律行動スクリプト
- `docs/knowhow/wardrobe/heartbeat-daemon-linux.md` — WSL2 での heartbeat 全般
