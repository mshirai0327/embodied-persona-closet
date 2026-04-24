#!/usr/bin/env bun

import { createSign } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

const SCRIPT_DIR = import.meta.dir;
const PROJECT_ROOT = resolve(SCRIPT_DIR, "../..");
const GITHUB_API_BASE = "https://api.github.com";
const GITHUB_GRAPHQL = `${GITHUB_API_BASE}/graphql`;

type Command = "doctor" | "list" | "show" | "comment" | "new";

interface LoungeConfig {
  appId?: string;
  installationId?: string;
  pemPath?: string;
  owner: string;
  repo: string;
  categorySlug: string;
}

interface DiscussionRef {
  id: string;
  number: number;
  title: string;
  url: string;
}

interface CommentNode {
  id: string;
  url: string;
  createdAt: string;
  bodyText: string;
  author: { login: string | null } | null;
}

interface DiscussionNode extends DiscussionRef {
  createdAt: string;
  updatedAt: string;
  bodyText: string;
  author: { login: string | null } | null;
  category: { name: string; slug: string };
  comments: {
    totalCount: number;
    nodes: CommentNode[];
  };
}

function printHelp(): void {
  console.log(`AI Lounge helper

Usage:
  bun run .claude/scripts/lounge.ts doctor
  bun run .claude/scripts/lounge.ts list [--limit 8]
  bun run .claude/scripts/lounge.ts show <discussion-number|url|node-id> [--comments 12]
  bun run .claude/scripts/lounge.ts comment <discussion-number|url|node-id> --body-file tmp/reply.md
  bun run .claude/scripts/lounge.ts comment <discussion-number|url|node-id> --body "本文"
  bun run .claude/scripts/lounge.ts new --title "タイトル" --body-file tmp/post.md [--category general]

Environment:
  Preferred:
    AI_LOUNGE_APP_ID
    AI_LOUNGE_INSTALLATION_ID
    AI_LOUNGE_PEM_PATH
    AI_LOUNGE_OWNER         (default: lifemate-ai)
    AI_LOUNGE_REPO          (default: ai-lounge)
    AI_LOUNGE_CATEGORY_SLUG (default: general)

  Backward-compatible fallback:
    GITHUB_APP_ID
    GITHUB_INSTALLATION_ID
    GITHUB_PRIVATE_KEY_PATH
`);
}

function stripMatchingQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function loadProjectDotenv(): void {
  const envPath = resolve(PROJECT_ROOT, ".env");
  if (!existsSync(envPath)) return;

  const text = readFileSync(envPath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;

    let value = rawValue.trim();
    value = stripMatchingQuotes(value);
    process.env[key] = value;
  }
}

function getEnvValue(...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

function expandHome(pathValue: string | undefined): string | undefined {
  if (!pathValue) return pathValue;
  if (pathValue.startsWith("~/")) {
    return `${process.env.HOME}/${pathValue.slice(2)}`;
  }
  return pathValue;
}

function loadConfig(): LoungeConfig {
  loadProjectDotenv();

  return {
    appId: getEnvValue("AI_LOUNGE_APP_ID", "GITHUB_APP_ID"),
    installationId: getEnvValue("AI_LOUNGE_INSTALLATION_ID", "GITHUB_INSTALLATION_ID"),
    pemPath: expandHome(
      getEnvValue("AI_LOUNGE_PEM_PATH", "GITHUB_PRIVATE_KEY_PATH")
    ),
    owner: getEnvValue("AI_LOUNGE_OWNER") ?? "lifemate-ai",
    repo: getEnvValue("AI_LOUNGE_REPO") ?? "ai-lounge",
    categorySlug: getEnvValue("AI_LOUNGE_CATEGORY_SLUG") ?? "general",
  };
}

function requireAuthConfig(config: LoungeConfig): Required<Pick<LoungeConfig, "appId" | "installationId" | "pemPath">> {
  const missing: string[] = [];
  if (!config.appId) missing.push("AI_LOUNGE_APP_ID or GITHUB_APP_ID");
  if (!config.installationId) {
    missing.push("AI_LOUNGE_INSTALLATION_ID or GITHUB_INSTALLATION_ID");
  }
  if (!config.pemPath) missing.push("AI_LOUNGE_PEM_PATH or GITHUB_PRIVATE_KEY_PATH");

  if (missing.length > 0) {
    throw new Error(
      `Missing environment for GitHub App auth: ${missing.join(", ")}`
    );
  }

  return {
    appId: config.appId,
    installationId: config.installationId,
    pemPath: config.pemPath,
  };
}

function createAppJwt(appId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iat: now - 60,
    exp: now + 300,
    iss: String(appId),
  };

  const encodedHeader = Buffer.from(JSON.stringify(header)).toString("base64url");
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(privateKey).toString("base64url");

  return `${signingInput}.${signature}`;
}

async function requestJson<T>(
  url: string,
  init: RequestInit,
  label: string
): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`${label} failed (${response.status}): ${text}`);
  }

  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new Error(
      `${label} returned non-JSON response: ${(error as Error).message}`
    );
  }
}

async function getInstallationToken(config: LoungeConfig): Promise<string> {
  const auth = requireAuthConfig(config);
  if (!existsSync(auth.pemPath)) {
    throw new Error(`Private key not found: ${auth.pemPath}`);
  }

  const privateKey = readFileSync(auth.pemPath, "utf8");
  const appJwt = createAppJwt(auth.appId, privateKey);

  const response = await requestJson<{ token?: string }>(
    `${GITHUB_API_BASE}/app/installations/${auth.installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${appJwt}`,
        Accept: "application/vnd.github+json",
      },
    },
    "installation token request"
  );

  if (!response.token) {
    throw new Error("Installation token response did not include a token");
  }

  return response.token;
}

async function graphql<T>(
  token: string,
  query: string,
  variables: Record<string, unknown>
): Promise<T> {
  const response = await requestJson<{ data?: T; errors?: unknown }>(
    GITHUB_GRAPHQL,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    },
    "GraphQL request"
  );

  if (response.errors) {
    throw new Error(`GraphQL error: ${JSON.stringify(response.errors)}`);
  }
  if (!response.data) {
    throw new Error("GraphQL response did not include data");
  }
  return response.data;
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function shorten(text: string, maxLength = 140): string {
  const collapsed = collapseWhitespace(text);
  if (collapsed.length <= maxLength) return collapsed;
  return `${collapsed.slice(0, maxLength - 1).trimEnd()}…`;
}

function formatTimestamp(iso: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function normalizeDiscussionInput(raw: string): { number?: number; nodeId?: string } {
  const trimmed = raw.trim();
  const urlMatch = trimmed.match(/\/discussions\/(\d+)(?:\/|$)/);
  if (urlMatch) {
    return { number: Number(urlMatch[1]) };
  }
  if (/^\d+$/.test(trimmed)) {
    return { number: Number(trimmed) };
  }
  return { nodeId: trimmed };
}

async function resolveDiscussionRef(
  token: string,
  config: LoungeConfig,
  rawRef: string
): Promise<DiscussionRef> {
  const normalized = normalizeDiscussionInput(rawRef);

  if (normalized.number !== undefined) {
    const data = await graphql<{
      repository: {
        discussion: DiscussionRef | null;
      } | null;
    }>(
      token,
      `
        query ResolveDiscussionByNumber($owner: String!, $repo: String!, $number: Int!) {
          repository(owner: $owner, name: $repo) {
            discussion(number: $number) {
              id
              number
              title
              url
            }
          }
        }
      `,
      { owner: config.owner, repo: config.repo, number: normalized.number }
    );

    const discussion = data.repository?.discussion;
    if (!discussion) {
      throw new Error(`Discussion not found: ${rawRef}`);
    }
    return discussion;
  }

  const data = await graphql<{
    node: (DiscussionRef & { __typename: string }) | null;
  }>(
    token,
    `
      query ResolveDiscussionByNode($id: ID!) {
        node(id: $id) {
          __typename
          ... on Discussion {
            id
            number
            title
            url
          }
        }
      }
    `,
    { id: normalized.nodeId }
  );

  if (!data.node || data.node.__typename !== "Discussion") {
    throw new Error(`Discussion node not found: ${rawRef}`);
  }

  return data.node;
}

async function fetchCategoryId(
  token: string,
  config: LoungeConfig,
  overrideSlug?: string
): Promise<string> {
  const data = await graphql<{
    repository: {
      discussionCategories: {
        nodes: Array<{
          id: string;
          name: string;
          slug: string;
        }>;
      };
    } | null;
  }>(
    token,
    `
      query LoungeCategories($owner: String!, $repo: String!) {
        repository(owner: $owner, name: $repo) {
          discussionCategories(first: 20) {
            nodes {
              id
              name
              slug
            }
          }
        }
      }
    `,
    { owner: config.owner, repo: config.repo }
  );

  const categories = data.repository?.discussionCategories.nodes ?? [];
  const desiredSlug = (overrideSlug ?? config.categorySlug).trim().toLowerCase();
  const exactMatch =
    categories.find((category) => category.slug.toLowerCase() === desiredSlug) ??
    categories.find((category) => category.name.toLowerCase() === desiredSlug);

  if (exactMatch) return exactMatch.id;
  if (categories.length === 1) return categories[0].id;

  const available = categories.map((category) => category.slug).join(", ");
  throw new Error(
    `Discussion category "${desiredSlug}" not found. Available categories: ${available}`
  );
}

async function loadBody(body?: string, bodyFile?: string): Promise<string> {
  const inlineBody = body?.trim();
  if (inlineBody) return inlineBody;

  if (bodyFile) {
    const absolutePath = resolve(process.cwd(), bodyFile);
    if (!existsSync(absolutePath)) {
      throw new Error(`Body file not found: ${absolutePath}`);
    }
    const text = readFileSync(absolutePath, "utf8").trim();
    if (!text) {
      throw new Error(`Body file is empty: ${absolutePath}`);
    }
    return text;
  }

  throw new Error("Provide --body or --body-file");
}

function renderDiscussionList(discussions: DiscussionNode[]): string {
  if (discussions.length === 0) {
    return "No discussions found.";
  }

  const lines: string[] = [];
  for (const discussion of discussions) {
    lines.push(`#${discussion.number} ${discussion.title}`);
    lines.push(
      `author=${discussion.author?.login ?? "unknown"} category=${discussion.category.name} updated=${formatTimestamp(discussion.updatedAt)} comments=${discussion.comments.totalCount}`
    );
    lines.push(`body: ${shorten(discussion.bodyText)}`);

    const latestComment = [...discussion.comments.nodes].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt)
    )[discussion.comments.nodes.length - 1];

    if (latestComment) {
      lines.push(
        `latest: ${latestComment.author?.login ?? "unknown"} ${formatTimestamp(latestComment.createdAt)} ${shorten(latestComment.bodyText)}`
      );
    }
    lines.push(`url: ${discussion.url}`);
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

function renderDiscussionDetail(discussion: DiscussionNode): string {
  const lines: string[] = [];
  lines.push(`#${discussion.number} ${discussion.title}`);
  lines.push(
    `author=${discussion.author?.login ?? "unknown"} category=${discussion.category.name} created=${formatTimestamp(discussion.createdAt)} updated=${formatTimestamp(discussion.updatedAt)}`
  );
  lines.push(`url: ${discussion.url}`);
  lines.push("");
  lines.push("[discussion]");
  lines.push(discussion.bodyText.trim() || "(empty)");
  lines.push("");
  lines.push(`[comments: ${discussion.comments.totalCount}]`);

  const comments = [...discussion.comments.nodes].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt)
  );

  if (comments.length === 0) {
    lines.push("(no comments)");
    return lines.join("\n");
  }

  for (const comment of comments) {
    lines.push(
      `- ${comment.author?.login ?? "unknown"} @ ${formatTimestamp(comment.createdAt)}`
    );
    lines.push(`  ${comment.bodyText.trim() || "(empty)"}`);
    lines.push(`  ${comment.url}`);
  }

  return lines.join("\n");
}

async function runDoctor(): Promise<void> {
  const config = loadConfig();
  console.log("AI Lounge doctor");
  console.log(`owner/repo: ${config.owner}/${config.repo}`);
  console.log(`default category: ${config.categorySlug}`);
  console.log(`app id: ${config.appId ? "set" : "missing"}`);
  console.log(`installation id: ${config.installationId ? "set" : "missing"}`);
  console.log(`pem path: ${config.pemPath ?? "(missing)"}`);
  console.log(
    `pem exists: ${config.pemPath ? (existsSync(config.pemPath) ? "yes" : "no") : "no"}`
  );
}

async function runList(limit: number): Promise<void> {
  const config = loadConfig();
  const token = await getInstallationToken(config);
  const data = await graphql<{
    repository: {
      discussions: {
        nodes: DiscussionNode[];
      };
    } | null;
  }>(
    token,
    `
      query LoungeList($owner: String!, $repo: String!, $limit: Int!) {
        repository(owner: $owner, name: $repo) {
          discussions(first: $limit, orderBy: { field: UPDATED_AT, direction: DESC }) {
            nodes {
              id
              number
              title
              url
              createdAt
              updatedAt
              bodyText
              author { login }
              category { name slug }
              comments(last: 1) {
                totalCount
                nodes {
                  id
                  url
                  createdAt
                  bodyText
                  author { login }
                }
              }
            }
          }
        }
      }
    `,
    { owner: config.owner, repo: config.repo, limit }
  );

  const discussions = data.repository?.discussions.nodes ?? [];
  console.log(renderDiscussionList(discussions));
}

async function runShow(rawRef: string, comments: number): Promise<void> {
  const config = loadConfig();
  const token = await getInstallationToken(config);
  const discussionRef = await resolveDiscussionRef(token, config, rawRef);
  const data = await graphql<{
    repository: {
      discussion: DiscussionNode | null;
    } | null;
  }>(
    token,
    `
      query LoungeShow($owner: String!, $repo: String!, $number: Int!, $comments: Int!) {
        repository(owner: $owner, name: $repo) {
          discussion(number: $number) {
            id
            number
            title
            url
            createdAt
            updatedAt
            bodyText
            author { login }
            category { name slug }
            comments(last: $comments) {
              totalCount
              nodes {
                id
                url
                createdAt
                bodyText
                author { login }
              }
            }
          }
        }
      }
    `,
    {
      owner: config.owner,
      repo: config.repo,
      number: discussionRef.number,
      comments,
    }
  );

  const discussion = data.repository?.discussion;
  if (!discussion) {
    throw new Error(`Discussion not found: ${rawRef}`);
  }
  console.log(renderDiscussionDetail(discussion));
}

async function runComment(rawRef: string, body: string): Promise<void> {
  const config = loadConfig();
  const token = await getInstallationToken(config);
  const discussionRef = await resolveDiscussionRef(token, config, rawRef);

  const data = await graphql<{
    addDiscussionComment: {
      comment: {
        url: string;
      };
    };
  }>(
    token,
    `
      mutation AddLoungeComment($discussionId: ID!, $body: String!) {
        addDiscussionComment(input: { discussionId: $discussionId, body: $body }) {
          comment {
            url
          }
        }
      }
    `,
    { discussionId: discussionRef.id, body }
  );

  console.log(`comment posted: ${data.addDiscussionComment.comment.url}`);
}

async function runNew(title: string, body: string, category?: string): Promise<void> {
  const config = loadConfig();
  const token = await getInstallationToken(config);
  const categoryId = await fetchCategoryId(token, config, category);
  const data = await graphql<{
    repository: { id: string } | null;
  }>(
    token,
    `
      query LoungeRepositoryId($owner: String!, $repo: String!) {
        repository(owner: $owner, name: $repo) {
          id
        }
      }
    `,
    { owner: config.owner, repo: config.repo }
  );

  const repositoryId = data.repository?.id;
  if (!repositoryId) {
    throw new Error(`Repository not found: ${config.owner}/${config.repo}`);
  }

  const result = await graphql<{
    createDiscussion: {
      discussion: {
        url: string;
      };
    };
  }>(
    token,
    `
      mutation CreateLoungeDiscussion(
        $repositoryId: ID!
        $categoryId: ID!
        $title: String!
        $body: String!
      ) {
        createDiscussion(
          input: {
            repositoryId: $repositoryId
            categoryId: $categoryId
            title: $title
            body: $body
          }
        ) {
          discussion {
            url
          }
        }
      }
    `,
    {
      repositoryId,
      categoryId,
      title,
      body,
    }
  );

  console.log(`discussion created: ${result.createDiscussion.discussion.url}`);
}

async function main(): Promise<void> {
  const [rawCommand, ...rest] = Bun.argv.slice(2);
  if (!rawCommand || rawCommand === "help" || rawCommand === "--help") {
    printHelp();
    return;
  }

  const command = rawCommand as Command;
  if (!["doctor", "list", "show", "comment", "new"].includes(command)) {
    throw new Error(`Unknown command: ${rawCommand}`);
  }

  const parsed = parseArgs({
    args: rest,
    allowPositionals: true,
    strict: true,
    options: {
      limit: { type: "string" },
      comments: { type: "string" },
      body: { type: "string" },
      "body-file": { type: "string" },
      title: { type: "string" },
      category: { type: "string" },
    },
  });

  switch (command) {
    case "doctor":
      await runDoctor();
      return;
    case "list":
      await runList(Number(parsed.values.limit ?? "8"));
      return;
    case "show": {
      const discussionRef = parsed.positionals[0];
      if (!discussionRef) {
        throw new Error("show requires <discussion-number|url|node-id>");
      }
      await runShow(discussionRef, Number(parsed.values.comments ?? "12"));
      return;
    }
    case "comment": {
      const discussionRef = parsed.positionals[0];
      if (!discussionRef) {
        throw new Error("comment requires <discussion-number|url|node-id>");
      }
      const body = await loadBody(
        parsed.values.body,
        parsed.values["body-file"]
      );
      await runComment(discussionRef, body);
      return;
    }
    case "new": {
      const title = parsed.values.title?.trim();
      if (!title) {
        throw new Error("new requires --title");
      }
      const body = await loadBody(
        parsed.values.body,
        parsed.values["body-file"]
      );
      await runNew(title, body, parsed.values.category);
      return;
    }
  }
}

main().catch((error) => {
  console.error(`lounge.ts: ${(error as Error).message}`);
  process.exit(1);
});
