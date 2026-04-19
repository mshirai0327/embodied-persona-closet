#!/usr/bin/env bun

import { parseArgs } from "node:util";

import { readCausalTrace } from "./causal-graph";
import { PERSONA_DB_PATH, readPersonaDashboardSnapshot } from "./persona-data";

const CLIENT_SCRIPT_PATH = new URL("./persona-dashboard-client.js", import.meta.url);

function parseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function escapeHtmlServer(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function serializeForInlineScript(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll("</script", "<\\/script");
}

async function buildPayload() {
  const snapshot = await readPersonaDashboardSnapshot();
  const trace = await readCausalTrace(
    "energy",
    { direction: "both", maxDepth: 3, skipSync: true },
  );

  return {
    generatedAt: new Date().toISOString(),
    dbPath: PERSONA_DB_PATH,
    meta: snapshot.meta,
    current: snapshot.current.map((row) => ({
      ...row,
      metadata: parseJson<Record<string, unknown>>(row.metadataJson),
    })),
    history: snapshot.history,
    observations: snapshot.observations,
    graph: snapshot.graph,
    trace,
  };
}

async function buildTracePayload(url: URL) {
  const key = url.searchParams.get("key")?.trim() || "energy";
  const directionParam = url.searchParams.get("direction");
  const direction = directionParam === "upstream" || directionParam === "downstream" || directionParam === "both"
    ? directionParam
    : "both";
  const depthParam = Number(url.searchParams.get("depth") ?? "3");
  const maxDepth = Number.isFinite(depthParam) ? Math.max(1, Math.min(5, depthParam)) : 3;

  return readCausalTrace(key, { direction, maxDepth });
}

function renderPage(initialPayload: Awaited<ReturnType<typeof buildPayload>>): string {
  const initialDataJson = serializeForInlineScript(initialPayload);
  const initialName = escapeHtmlServer(initialPayload.meta.name || "Persona");
  const initialDbPath = escapeHtmlServer(initialPayload.dbPath);
  const initialGeneratedAt = escapeHtmlServer(initialPayload.generatedAt);

  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Persona Status Dashboard</title>
    <style>
      :root {
        --bg: #f5efe4;
        --bg-accent: #e4f0e4;
        --panel: rgba(255, 252, 247, 0.92);
        --panel-strong: rgba(255, 249, 240, 0.98);
        --ink: #1c2822;
        --muted: #68756d;
        --line: rgba(32, 53, 42, 0.14);
        --accent: #0e8b63;
        --accent-soft: rgba(14, 139, 99, 0.14);
        --warn: #c4622d;
        --cool: #3f7db4;
        --shadow: 0 16px 36px rgba(37, 43, 39, 0.08);
        --radius: 18px;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        color: var(--ink);
        font-family: "IBM Plex Sans JP", "Hiragino Sans", "Yu Gothic", sans-serif;
        background:
          radial-gradient(circle at top left, rgba(14, 139, 99, 0.14), transparent 32%),
          radial-gradient(circle at top right, rgba(196, 98, 45, 0.12), transparent 28%),
          linear-gradient(180deg, var(--bg), var(--bg-accent));
      }

      main {
        width: min(1400px, calc(100vw - 32px));
        margin: 0 auto;
        padding: 28px 0 40px;
      }

      .hero,
      .panel {
        border: 1px solid var(--line);
        border-radius: var(--radius);
        background: var(--panel);
        box-shadow: var(--shadow);
        backdrop-filter: blur(14px);
      }

      .hero {
        padding: 22px 24px;
        margin-bottom: 18px;
      }

      .eyebrow {
        display: inline-flex;
        gap: 10px;
        align-items: center;
        font-size: 12px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted);
      }

      h1,
      h2,
      h3,
      p {
        margin: 0;
      }

      .hero-title {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        margin-top: 12px;
        align-items: end;
        flex-wrap: wrap;
      }

      .hero-title h1 {
        font-size: clamp(28px, 4vw, 42px);
        letter-spacing: -0.03em;
      }

      .hero-meta {
        color: var(--muted);
        font-size: 14px;
      }

      .hero-subtitle {
        margin-top: 12px;
        color: var(--muted);
        line-height: 1.7;
        max-width: 860px;
      }

      .grid-top {
        display: grid;
        grid-template-columns: 1.15fr 1fr;
        gap: 18px;
      }

      .grid-bottom {
        display: grid;
        grid-template-columns: 1.25fr 0.95fr;
        gap: 18px;
        margin-top: 18px;
      }

      .history-band {
        margin-bottom: 18px;
      }

      .panel {
        padding: 18px;
      }

      .panel h2 {
        font-size: 14px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted);
        margin-bottom: 14px;
      }

      .stack {
        display: grid;
        gap: 12px;
      }

      .group {
        border: 1px solid var(--line);
        border-radius: 14px;
        background: var(--panel-strong);
        padding: 12px;
      }

      .group h3 {
        font-size: 13px;
        color: var(--muted);
        margin-bottom: 10px;
      }

      .group-accordion {
        padding: 0;
        overflow: hidden;
      }

      .group-summary {
        list-style: none;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 12px;
        cursor: pointer;
      }

      .group-summary,
      .group-summary * {
        cursor: pointer;
      }

      .group-summary::-webkit-details-marker {
        display: none;
      }

      .group-summary::marker {
        content: "";
      }

      .group-summary::after {
        content: "▾";
        color: var(--muted);
        font-size: 14px;
        transition: transform 140ms ease;
      }

      .group-accordion:not([open]) .group-summary::after {
        transform: rotate(-90deg);
      }

      .group-accordion[open] .group-summary {
        border-bottom: 1px solid var(--line);
        margin-bottom: 12px;
      }

      .group-summary-main {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
      }

      .group-summary-title {
        font-size: 13px;
        font-weight: 400;
        color: var(--muted);
      }

      .group-summary-meta {
        font-size: 13px;
        color: var(--muted);
      }

      .group-body {
        padding: 0 12px 12px;
      }

      .metric-grid {
        display: grid;
        gap: 10px;
      }

      .metric-card {
        width: 100%;
        border: 1px solid transparent;
        border-radius: 14px;
        padding: 12px;
        background: white;
        text-align: left;
        color: inherit;
        cursor: pointer;
        transition: transform 120ms ease, border-color 120ms ease, box-shadow 120ms ease;
      }

      .metric-card:hover {
        transform: translateY(-1px);
        border-color: rgba(14, 139, 99, 0.32);
      }

      .metric-card.active {
        border-color: var(--accent);
        box-shadow: 0 0 0 3px var(--accent-soft);
      }

      .metric-head {
        display: flex;
        justify-content: space-between;
        gap: 10px;
        align-items: baseline;
      }

      .metric-label {
        font-size: 13px;
        color: var(--muted);
      }

      .metric-value {
        font-size: 21px;
        font-weight: 700;
      }

      .metric-time {
        font-size: 12px;
        color: var(--muted);
        margin-top: 4px;
      }

      .metric-reason {
        font-size: 12px;
        line-height: 1.6;
        color: var(--ink);
        margin-top: 8px;
      }

      .legend {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 12px;
      }

      .legend button,
      .pill {
        border: 1px solid var(--line);
        background: white;
        border-radius: 999px;
        padding: 7px 12px;
        font: inherit;
        color: var(--ink);
      }

      .legend button {
        cursor: pointer;
      }

      .legend button.active {
        border-color: var(--accent);
        background: var(--accent-soft);
      }

      .legend-chip {
        display: inline-flex;
        align-items: center;
        gap: 8px;
      }

      .legend-line {
        display: inline-block;
        width: 24px;
        border-top: 3px solid currentColor;
        border-radius: 999px;
      }

      .timeline-frame,
      .graph-frame {
        border: 1px solid var(--line);
        border-radius: 16px;
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.85), rgba(244, 248, 244, 0.85));
        padding: 12px;
      }

      .history-stack {
        display: grid;
        gap: 16px;
      }

      .history-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 16px;
      }

      .history-section-title {
        font-size: 13px;
        color: var(--muted);
        margin-bottom: 10px;
      }

      svg {
        width: 100%;
        display: block;
      }

      .log-list,
      .detail-list {
        display: grid;
        gap: 10px;
      }

      .log-item,
      .detail-item {
        border: 1px solid var(--line);
        border-radius: 14px;
        padding: 12px;
        background: rgba(255, 255, 255, 0.78);
      }

      .log-title,
      .detail-title {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: baseline;
        margin-bottom: 6px;
      }

      .log-title strong,
      .detail-title strong {
        font-size: 13px;
      }

      .log-time,
      .detail-time {
        color: var(--muted);
        font-size: 12px;
      }

      .log-body,
      .detail-body {
        font-size: 12px;
        line-height: 1.65;
      }

      .empty {
        color: var(--muted);
        font-size: 13px;
      }

      .footer {
        margin-top: 18px;
        color: var(--muted);
        font-size: 12px;
      }

      @media (max-width: 1100px) {
        .grid-top,
        .grid-bottom,
        .history-grid {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="hero">
        <div class="eyebrow">
          <span>Persona Dashboard</span>
          <span id="generated-at">${initialGeneratedAt}</span>
        </div>
        <div class="hero-title">
          <div>
            <h1 id="persona-name">${initialName}</h1>
            <p class="hero-subtitle">
              BODY / STATUS / SOUL Temperament / Lv0 environment を 1 つの軽量ストアに寄せて、
              Now / History / Logs と seed 因果グラフを同じ画面で追えるようにしたビューです。
            </p>
          </div>
          <p class="hero-meta" id="db-path">${initialDbPath}</p>
        </div>
      </section>

      <section class="history-band">
        <article class="panel">
          <h2>History</h2>
          <div class="history-grid">
            <section>
              <h3 class="history-section-title">Lv3 バイタル・情緒</h3>
              <div id="timeline-legend" class="legend"></div>
              <div class="timeline-frame">
                <svg id="timeline" viewBox="0 0 760 300" aria-label="status timeline"></svg>
              </div>
              <div id="timeline-detail" class="detail-list" style="margin-top: 12px;"></div>
            </section>
            <section>
              <h3 class="history-section-title">Lv0 環境</h3>
              <div id="environment-timeline-legend" class="legend"></div>
              <div class="timeline-frame">
                <svg id="environment-timeline" viewBox="0 0 760 300" aria-label="environment timeline"></svg>
              </div>
              <div id="environment-timeline-detail" class="detail-list" style="margin-top: 12px;"></div>
            </section>
          </div>
        </article>
      </section>

      <section class="grid-top">
        <article class="panel">
          <h2>Now</h2>
          <div id="current-groups" class="stack"></div>
        </article>

        <article class="panel">
          <h2>Logs</h2>
          <div id="log-list" class="log-list"></div>
        </article>
      </section>

      <section class="grid-bottom">
        <article class="panel">
          <h2>Causal Graph</h2>
          <div class="legend" id="trace-direction"></div>
          <div class="legend" id="trace-depth"></div>
          <div class="legend" id="graph-legend" aria-label="causal graph legend"></div>
          <div class="graph-frame">
            <svg id="graph" viewBox="0 0 980 560" aria-label="causal graph"></svg>
          </div>
        </article>

        <article class="panel">
          <h2>Selection</h2>
          <div id="selection-summary" class="stack"></div>
        </article>
      </section>

      <p class="footer">
        30 秒ごとに再読み込みします。因果は seed graph を SQLite 上で再帰 trace した結果を表示しています。
      </p>
    </main>

    <script id="initial-dashboard-data" type="application/json">${initialDataJson}</script>
    <script src="/persona-dashboard.js" defer></script>
  </body>
</html>`;
}

if (import.meta.main) {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      host: { type: "string", default: "127.0.0.1" },
      port: { type: "string", default: "4318" },
    },
  });

  const host = String(values.host);
  const port = Number(values.port);

  const server = Bun.serve({
    hostname: host,
    port,
    async fetch(request) {
      const url = new URL(request.url);
      const noStoreHeaders = {
        "cache-control": "no-store, max-age=0",
      };

      if (url.pathname === "/api/dashboard") {
        return Response.json(await buildPayload(), { headers: noStoreHeaders });
      }

      if (url.pathname === "/api/causal-trace") {
        return Response.json(await buildTracePayload(url), { headers: noStoreHeaders });
      }

      if (url.pathname === "/health") {
        return new Response("ok", { headers: noStoreHeaders });
      }

      if (url.pathname === "/persona-dashboard.js") {
        return new Response(await Bun.file(CLIENT_SCRIPT_PATH).text(), {
          headers: {
            ...noStoreHeaders,
            "content-type": "text/javascript; charset=utf-8",
          },
        });
      }

      const payload = await buildPayload();
      return new Response(renderPage(payload), {
        headers: {
          ...noStoreHeaders,
          "content-type": "text/html; charset=utf-8",
        },
      });
    },
  });

  console.log(`[persona-dashboard] http://${server.hostname}:${server.port}`);
}
