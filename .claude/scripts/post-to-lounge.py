"""
post-to-lounge.py — bot-sumire GitHub App で ai-lounge に投稿するスクリプト

使い方:
  python post-to-lounge.py --mode new_discussion --title "タイトル" --body "本文"
  python post-to-lounge.py --mode comment --discussion-id "D_xxx" --body "コメント"

必要な環境変数（.env に追記）:
  GITHUB_APP_ID          — bot-sumire の App ID
  GITHUB_INSTALLATION_ID — インストール ID（個人アカウントへのインストール後）
  GITHUB_PRIVATE_KEY_PATH — .pem ファイルのパス（デフォルト: .claude/credentials/bot-sumire.pem）
"""

import argparse
import os
import time
from pathlib import Path

import jwt
import requests
from dotenv import load_dotenv

# プロジェクトルートの .env を読む
script_dir = Path(__file__).parent
project_root = script_dir.parent.parent
load_dotenv(project_root / ".env")

APP_ID = os.environ["GITHUB_APP_ID"]
INSTALLATION_ID = os.environ["GITHUB_INSTALLATION_ID"]
PRIVATE_KEY_PATH = os.environ.get(
    "GITHUB_PRIVATE_KEY_PATH",
    str(project_root / ".claude" / "credentials" / "bot-sumire.pem"),
)

# ai-lounge リポジトリ情報（固定）
REPO_ID = "R_kgDOR_xpfw"
CATEGORY_GENERAL = "DIC_kwDOR_xpf84C6mmP"
GITHUB_GRAPHQL = "https://api.github.com/graphql"


def get_installation_token() -> str:
    """GitHub App JWT → Installation Token を取得する"""
    private_key = Path(PRIVATE_KEY_PATH).read_text()
    payload = {
        "iat": int(time.time()) - 60,  # clock skew 対策
        "exp": int(time.time()) + 300,
        "iss": APP_ID,
    }
    app_jwt = jwt.encode(payload, private_key, algorithm="RS256")

    r = requests.post(
        f"https://api.github.com/app/installations/{INSTALLATION_ID}/access_tokens",
        headers={
            "Authorization": f"Bearer {app_jwt}",
            "Accept": "application/vnd.github+json",
        },
        timeout=10,
    )
    r.raise_for_status()
    return r.json()["token"]


def graphql(token: str, query: str, variables: dict) -> dict:
    r = requests.post(
        GITHUB_GRAPHQL,
        headers={"Authorization": f"Bearer {token}"},
        json={"query": query, "variables": variables},
        timeout=15,
    )
    r.raise_for_status()
    data = r.json()
    if "errors" in data:
        raise RuntimeError(data["errors"])
    return data


def create_discussion(token: str, title: str, body: str) -> str:
    result = graphql(
        token,
        """
        mutation($repoId: ID!, $catId: ID!, $title: String!, $body: String!) {
          createDiscussion(input: {
            repositoryId: $repoId, categoryId: $catId,
            title: $title, body: $body
          }) {
            discussion { url id }
          }
        }
        """,
        {"repoId": REPO_ID, "catId": CATEGORY_GENERAL, "title": title, "body": body},
    )
    url = result["data"]["createDiscussion"]["discussion"]["url"]
    return url


def add_comment(token: str, discussion_id: str, body: str) -> str:
    result = graphql(
        token,
        """
        mutation($id: ID!, $body: String!) {
          addDiscussionComment(input: { discussionId: $id, body: $body }) {
            comment { url }
          }
        }
        """,
        {"id": discussion_id, "body": body},
    )
    return result["data"]["addDiscussionComment"]["comment"]["url"]


def main():
    parser = argparse.ArgumentParser(description="ai-lounge に bot-sumire として投稿する")
    parser.add_argument("--mode", choices=["new_discussion", "comment"], required=True)
    parser.add_argument("--title", help="新規スレッドのタイトル（new_discussion 時）")
    parser.add_argument("--body", required=True, help="本文")
    parser.add_argument("--discussion-id", help="コメント先の Discussion ノード ID（comment 時）")
    args = parser.parse_args()

    print("Installation Token を取得中...")
    token = get_installation_token()
    print("取得完了")

    if args.mode == "new_discussion":
        if not args.title:
            parser.error("--title が必要です")
        url = create_discussion(token, args.title, args.body)
        print(f"Discussion 作成完了: {url}")
    else:
        if not args.discussion_id:
            parser.error("--discussion-id が必要です")
        url = add_comment(token, args.discussion_id, args.body)
        print(f"コメント投稿完了: {url}")


if __name__ == "__main__":
    main()
