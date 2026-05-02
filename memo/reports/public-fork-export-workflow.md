# Public Fork Export Workflow

- 作成日: 2026-04-25
- 対象 repo: `embodied-reflecta`
- 目的: private repo では個人状態ファイルを Git 管理しつつ、public fork へ成果を反映するときだけ個人情報・状態情報を公開対象から外す

## 結論

private repo をそのまま public fork に merge しない。

代わりに、private 開発ブランチとは別に **public export 用ブランチ**を作り、そのブランチ上でだけ以下を行う。

1. 個人状態・秘密情報・ローカル設定を `.gitignore` に追加する
2. すでに tracked になっている個人ファイルを `git rm --cached` で index から外す
3. public fork へは public export ブランチから squash merge または PR する

これにより、private repo では引き続き Git をストレージとして使える。

## 前提

`.gitignore` は untracked file にだけ効く。

すでに Git 管理下にあるファイルは、あとから `.gitignore` に追加しても tracked のまま残る。そのため、public に出したくない tracked file は public export ブランチ上で `git rm --cached` する必要がある。

`git rm --cached` は index から外すだけなので、作業ツリー上の実ファイルは残る。

## 基本方針

### private 側

private repo では、これまで通り個人状態ファイルを tracked にしてよい。

例:

- `STATUS.md`
- `SOUL.md`
- `BODY.md`
- `ENVIRONMENT.md`
- `FLASH.md`
- `ROUTINES.md`
- `TODO.md`
- `state.md`
- `memo/`
- `.claude/persona/`
- `desires.conf`
- `desires.json`
- `schedule.conf`
- `.mcp.json`

これらは private repo では「作業状態・人格状態・運用状態のストレージ」として扱う。

### public 側

public fork には、配布物・実装・テンプレート・ドキュメントだけを出す。

個人状態の実体は出さず、必要な場合は template/example を出す。

例:

- `.claude/templates/*.template`
- `.env.example`
- `claude_desktop_config.example.json`
- setup guide
- customization guide

## 推奨ブランチ構成

```text
private repo
  main / feature branches
    個人状態ファイルも tracked

  public-export
    public fork へ出すための sanitized branch
    個人状態ファイルは ignored + untracked

public fork
  main
    public-export から PR / squash merge
```

public fork へは private の開発ブランチを直接 push / merge しない。

## 初回セットアップ例

public export ブランチを作る。

```bash
git switch -c public-export
```

public に出したくないファイルを `.gitignore` に追加する。

```gitignore
# Local/private Claude state
.mcp.json
BODY.md
ENVIRONMENT.md
FLASH.md
ROUTINES.md
SOUL.md
STATUS.md
TODO.md
state.md

# Local desires/schedule
desires.conf
desires.json
schedule.conf

# Personal memos and persona state
memo/
.claude/persona/
.claude/settings.json

# Local sessions/logs/secrets
.claude/memories/
.claude/logs/*.log
.claude/secrets/
.heartbeat-session-id
heartbeat-session-id
last-session-date.txt
```

すでに tracked になっているファイルを index から外す。

```bash
git rm --cached --ignore-unmatch .mcp.json
git rm --cached --ignore-unmatch BODY.md ENVIRONMENT.md FLASH.md ROUTINES.md SOUL.md STATUS.md TODO.md state.md
git rm --cached --ignore-unmatch desires.conf desires.json schedule.conf
git rm --cached -r --ignore-unmatch memo .claude/persona .claude/settings.json
```

公開用の削除と ignore 追加を commit する。

```bash
git add .gitignore
git commit -m "chore: exclude private state from public export"
```

この commit は public export ブランチにだけ置く。

実際にこの repo で commit する場合は、`AGENTS.md` の規約通り commit message の本文に co-author trailer を入れる。

## private の成果を public-export に取り込む手順

private 開発ブランチの成果を public fork に出したいときは、まず public export ブランチに取り込む。

```bash
git switch public-export
git merge <private-branch> --no-commit
```

merge で個人状態ファイルが index に戻った場合に備えて、毎回 cleanup を実行する。

```bash
git rm --cached --ignore-unmatch .mcp.json
git rm --cached --ignore-unmatch BODY.md ENVIRONMENT.md FLASH.md ROUTINES.md SOUL.md STATUS.md TODO.md state.md
git rm --cached --ignore-unmatch desires.conf desires.json schedule.conf
git rm --cached -r --ignore-unmatch memo .claude/persona .claude/settings.json
```

差分を確認する。

```bash
git status --short
git diff --cached --stat
git diff --cached --name-only
```

問題なければ commit する。

```bash
git commit -m "chore: sync public export"
```

実際にこの repo で commit する場合は、`AGENTS.md` の規約通り commit message の本文に co-author trailer を入れる。

## public fork へ push する手順

public fork を remote に追加していない場合は追加する。

```bash
git remote add public git@github.com:mshirai0327/embodied-persona-closet.git
```

public export ブランチを public fork に push する。

```bash
git push public public-export
```

その後、GitHub 上で public fork の main に PR を出す。

履歴に private の個人状態が混ざる可能性を下げるため、public fork では squash merge を使うのが安全。

## merge conflict が出た場合

private 側で個人状態ファイルを更新していると、public-export への merge 時に modify/delete conflict が出ることがある。

public-export では公開しない方針なので、該当ファイルは index 上では削除側を採用する。

private の作業ツリー上に個人ファイルを残したい場合、plain な `git rm` は使わない。`git rm` は working tree の実ファイルも削除するため、基本は `--cached` を使う。

```bash
git rm --cached -f --ignore-unmatch STATUS.md SOUL.md BODY.md ENVIRONMENT.md FLASH.md ROUTINES.md TODO.md state.md
git rm --cached -r -f --ignore-unmatch memo .claude/persona
```

そのあと、必要なら cleanup を再実行する。

```bash
git rm --cached -r --ignore-unmatch memo .claude/persona .claude/settings.json
```

ただし、public export 作業を別 worktree / 別 clone で行っている場合は、その public export 作業ツリーから個人ファイルが消えても private 側の作業ツリーには影響しない。長期的には別 worktree での export が安全。

## 事前監査

public fork に push する前に、最低限以下を確認する。

tracked file の一覧から、危険そうなものが残っていないか見る。

```bash
git ls-files
git ls-files | rg '(^|/)(memo|STATUS.md|SOUL.md|BODY.md|ENVIRONMENT.md|FLASH.md|ROUTINES.md|TODO.md|state.md|desires.conf|desires.json|schedule.conf|\\.mcp\\.json|\\.claude/persona|\\.claude/settings.json)'
```

秘密情報らしい文字列を検索する。

```bash
git grep -nI -E 'token|secret|password|passwd|api[_-]?key|bearer|sk-|ANTHROPIC|OPENAI|TUYA|TAPO'
```

可能であれば secret scanner も使う。

```bash
gitleaks detect --no-git
gitleaks detect
```

`--no-git` は現在の working tree、通常の `detect` は履歴も見る。

## 注意点

### `.gitignore` だけでは不十分

`.gitignore` に追加しても、tracked 済みのファイルは公開対象から外れない。

public export ブランチでは必ず `git rm --cached` とセットで扱う。

### private の履歴を public にそのまま出さない

private の commit history に個人状態ファイルが入っている場合、final tree で削除しても履歴から見える可能性がある。

public fork に出すときは、public-export の clean tree を squash merge するか、必要に応じて orphan branch / clean import を使う。

### credential は消すだけでなく rotate する

もし token や password が一度でも public に出た可能性がある場合、ファイルから削除するだけではなく credential を再発行する。

## より安全な運用

public export 作業は別 worktree または別 clone で行うと安全。

例:

```bash
git worktree add ../embodied-reflecta-public-export public-export
```

private の作業ツリーと public export の作業ツリーを分けることで、個人状態ファイルを誤って public 側の commit に含める事故を減らせる。

## まとめ

この repo では、private 側の Git をストレージとして使う運用は維持する。

public fork に成果を出すときだけ、public-export ブランチで個人状態ファイルを ignored + untracked にする。

重要なのは、公開時の入口を `private branch -> public fork` にしないこと。

必ず `private branch -> public-export -> public fork` の順に通す。
