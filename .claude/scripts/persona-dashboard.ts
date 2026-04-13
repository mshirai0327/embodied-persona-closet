#!/usr/bin/env bun

import { parseArgs } from "node:util";

import { readCausalTrace, traceCausalGraph } from "./causal-graph";
import { PERSONA_DB_PATH, readPersonaDashboardSnapshot } from "./persona-data";

function parseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

async function buildPayload() {
  const snapshot = await readPersonaDashboardSnapshot();

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
    trace: traceCausalGraph(
      {
        nodes: snapshot.graph.nodes,
        edges: snapshot.graph.edges,
        currentMetrics: snapshot.current.map((row) => ({
          key: row.key,
          label: row.label,
          level: row.level,
          valueText: row.valueText,
          valueNumber: row.valueNumber,
          unit: row.unit,
          reason: row.reason,
        })),
      },
      "energy",
      { direction: "both", maxDepth: 3 },
    ),
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

function renderPage(): string {
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
        grid-template-columns: 1.15fr 1fr 1fr;
        gap: 18px;
      }

      .grid-bottom {
        display: grid;
        grid-template-columns: 1.25fr 0.95fr;
        gap: 18px;
        margin-top: 18px;
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

      .timeline-frame,
      .graph-frame {
        border: 1px solid var(--line);
        border-radius: 16px;
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.85), rgba(244, 248, 244, 0.85));
        padding: 12px;
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
        .grid-bottom {
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
          <span id="generated-at">loading</span>
        </div>
        <div class="hero-title">
          <div>
            <h1 id="persona-name">Loading...</h1>
            <p class="hero-subtitle">
              BODY / STATUS / SOUL Temperament / Lv0 environment を 1 つの軽量ストアに寄せて、
              Now / History / Logs と seed 因果グラフを同じ画面で追えるようにしたビューです。
            </p>
          </div>
          <p class="hero-meta" id="db-path"></p>
        </div>
      </section>

      <section class="grid-top">
        <article class="panel">
          <h2>Now</h2>
          <div id="current-groups" class="stack"></div>
        </article>

        <article class="panel">
          <h2>History</h2>
          <div id="timeline-legend" class="legend"></div>
          <div class="timeline-frame">
            <svg id="timeline" viewBox="0 0 760 300" aria-label="status timeline"></svg>
          </div>
          <div id="timeline-detail" class="detail-list" style="margin-top: 12px;"></div>
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

    <script>
      const LEVEL_ORDER = ["Lv0", "Lv1-1", "Lv1-2", "Lv2", "Lv3-1", "Lv3-2"];
      const LEVEL_LABELS = {
        "Lv0": "Lv0 環境",
        "Lv1-1": "Lv1-1 不変の核",
        "Lv1-2": "Lv1-2 性格傾向",
        "Lv2": "Lv2 不可逆な成長",
        "Lv3-1": "Lv3-1 バイタル",
        "Lv3-2": "Lv3-2 情緒・関係性",
      };
      const SERIES_COLORS = {
        mood: "#0e8b63",
        energy: "#c4622d",
        satiation: "#c2a227",
        health: "#3f7db4",
        trust_mizuho: "#8d5fd3",
        ambient_brightness: "#5f9a3b",
        environment_thermal_load: "#b14c2a",
      };
      const KIND_COLORS = {
        environment: "#d9efe2",
        sensor: "#d9efe2",
        vital: "#f6e6cf",
        emotion: "#f4dccc",
        latent: "#ece7d8",
        action: "#d9e6f5",
        outcome: "#d8edf2",
      };

      const state = {
        data: null,
        selectedKey: "energy",
        selectedSeries: new Set(),
        initializedSeries: false,
        trace: null,
        traceDirection: "both",
        traceDepth: 3,
        traceRequestId: 0,
      };

      function escapeHtml(text) {
        return String(text ?? "")
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;");
      }

      function formatTime(text) {
        if (!text) return "—";
        return text.replace("T", " ").replace(/:00\\.\\d+Z$/, "Z");
      }

      function formatMetricValue(metric) {
        if (metric.valueText == null) return "—";
        if (metric.domain === "environment" && metric.unit === "score") {
          return (metric.valueNumber ?? "—") + "/100";
        }
        if (!metric.unit || metric.unit === "score") {
          return metric.unit === "score" ? metric.valueText + "/100" : metric.valueText;
        }
        if (String(metric.valueText).includes(metric.unit)) return metric.valueText;
        return metric.valueText + " " + metric.unit;
      }

      function groupByLevel(metrics) {
        const grouped = new Map();
        for (const level of LEVEL_ORDER) {
          grouped.set(level, []);
        }
        for (const metric of metrics) {
          if (!grouped.has(metric.level)) grouped.set(metric.level, []);
          grouped.get(metric.level).push(metric);
        }
        for (const items of grouped.values()) {
          items.sort((a, b) => a.label.localeCompare(b.label, "ja"));
        }
        return grouped;
      }

      function renderCurrent() {
        const root = document.getElementById("current-groups");
        const groups = groupByLevel(state.data.current);
        const html = [];

        for (const level of LEVEL_ORDER) {
          const items = groups.get(level) || [];
          if (items.length === 0) continue;
          html.push('<section class="group">');
          html.push("<h3>" + escapeHtml(LEVEL_LABELS[level] || level) + "</h3>");
          html.push('<div class="metric-grid">');
          for (const metric of items) {
            const active = metric.key === state.selectedKey ? " active" : "";
            html.push(
              '<button class="metric-card' + active + '" data-metric-key="' + escapeHtml(metric.key) + '">'
              + '<div class="metric-head">'
              + '<span class="metric-label">' + escapeHtml(metric.label) + "</span>"
              + '<strong class="metric-value">' + escapeHtml(formatMetricValue(metric)) + "</strong>"
              + "</div>"
              + '<div class="metric-time">' + escapeHtml(formatTime(metric.observedAt || metric.recordedAt || metric.personaTime)) + "</div>"
              + '<div class="metric-reason">' + escapeHtml(metric.reason || metric.sourceFile) + "</div>"
              + "</button>"
            );
          }
          html.push("</div></section>");
        }

        root.innerHTML = html.join("");
      }

      function buildSeries() {
        const grouped = new Map();
        for (const entry of state.data.history) {
          if (entry.nextValueNumber == null || !entry.changedAt) continue;
          if (!state.selectedSeries.has(entry.key)) continue;
          if (!grouped.has(entry.key)) grouped.set(entry.key, []);
          grouped.get(entry.key).push({
            timestamp: new Date(entry.changedAt).getTime(),
            label: entry.label,
            value: entry.nextValueNumber,
            reason: entry.reason,
            changedAt: entry.changedAt,
            unit: entry.unit,
          });
        }

        const series = Array.from(grouped.entries()).map(([key, points]) => ({
          key,
          points: points.sort((a, b) => a.timestamp - b.timestamp),
        }));

        return series.sort((a, b) => a.key.localeCompare(b.key));
      }

      function initializeSelectedSeries() {
        if (state.initializedSeries || !state.data) return;

        const reversibleLevels = new Set(["Lv0", "Lv3-1", "Lv3-2"]);
        const seriesKeys = new Set(
          state.data.history
            .filter((entry) => entry.nextValueNumber != null && reversibleLevels.has(entry.level))
            .map((entry) => entry.key)
        );

        state.selectedSeries = seriesKeys;
        state.initializedSeries = true;
      }

      function renderTraceControls() {
        const directionRoot = document.getElementById("trace-direction");
        const depthRoot = document.getElementById("trace-depth");
        const directions = [
          { key: "both", label: "Both" },
          { key: "upstream", label: "Upstream" },
          { key: "downstream", label: "Downstream" },
        ];
        const depths = [1, 2, 3, 4];

        directionRoot.innerHTML = directions
          .map((item) => {
            const active = state.traceDirection === item.key ? "active" : "";
            return '<button class="' + active + '" data-trace-direction="' + item.key + '">' + item.label + "</button>";
          })
          .join("");

        depthRoot.innerHTML = depths
          .map((depth) => {
            const active = state.traceDepth === depth ? "active" : "";
            return '<button class="' + active + '" data-trace-depth="' + depth + '">Depth ' + depth + "</button>";
          })
          .join("");
      }

      function renderLegend(series) {
        const root = document.getElementById("timeline-legend");
        root.innerHTML = series
          .map((serie) => {
            const active = state.selectedSeries.has(serie.key) ? "active" : "";
            const label = serie.points[serie.points.length - 1]?.label || serie.key;
            return '<button class="' + active + '" data-series-key="' + escapeHtml(serie.key) + '">' +
              '<span class="pill" style="background:' + (SERIES_COLORS[serie.key] || "#ddd") + '; width:12px; height:12px; display:inline-block; padding:0; border:none; margin-right:8px;"></span>' +
              escapeHtml(label) + "</button>";
          })
          .join("");
      }

      function renderTimeline() {
        const svg = document.getElementById("timeline");
        const series = buildSeries();
        renderLegend(series);

        if (series.length === 0) {
          svg.innerHTML = '<text x="40" y="60" fill="#68756d" font-size="14">数値履歴がまだありません。</text>';
          document.getElementById("timeline-detail").innerHTML = "";
          return;
        }

        const allPoints = series.flatMap((serie) => serie.points);
        const minTs = Math.min(...allPoints.map((point) => point.timestamp));
        const maxTs = Math.max(...allPoints.map((point) => point.timestamp));
        const width = 760;
        const height = 300;
        const padLeft = 48;
        const padRight = 18;
        const padTop = 24;
        const padBottom = 34;
        const usableWidth = width - padLeft - padRight;
        const usableHeight = height - padTop - padBottom;
        const xFor = (timestamp) => {
          if (maxTs === minTs) return padLeft + usableWidth / 2;
          return padLeft + ((timestamp - minTs) / (maxTs - minTs)) * usableWidth;
        };
        const yFor = (value) => padTop + (1 - Math.max(0, Math.min(100, value)) / 100) * usableHeight;

        const parts = [
          '<rect x="0" y="0" width="' + width + '" height="' + height + '" rx="12" fill="transparent"></rect>'
        ];

        for (const tick of [0, 25, 50, 75, 100]) {
          const y = yFor(tick);
          parts.push('<line x1="' + padLeft + '" y1="' + y + '" x2="' + (width - padRight) + '" y2="' + y + '" stroke="rgba(32,53,42,0.12)" stroke-dasharray="4 6"></line>');
          parts.push('<text x="10" y="' + (y + 4) + '" fill="#68756d" font-size="11">' + tick + "</text>");
        }

        for (const serie of series) {
          const path = serie.points
            .map((point, index) => (index === 0 ? "M" : "L") + xFor(point.timestamp) + " " + yFor(point.value))
            .join(" ");
          parts.push(
            '<path d="' + path + '" fill="none" stroke="' + (SERIES_COLORS[serie.key] || "#333") + '" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"></path>'
          );
          for (const point of serie.points) {
            parts.push(
              '<circle cx="' + xFor(point.timestamp) + '" cy="' + yFor(point.value) + '" r="4.5" fill="' + (SERIES_COLORS[serie.key] || "#333") + '" data-point-key="' + escapeHtml(serie.key) + '"></circle>'
            );
          }
        }

        svg.innerHTML = parts.join("");

        const details = [];
        for (const serie of series) {
          const latest = serie.points[serie.points.length - 1];
          details.push(
            '<article class="detail-item">'
            + '<div class="detail-title">'
            + "<strong>" + escapeHtml(latest.label) + "</strong>"
            + '<span class="detail-time">' + escapeHtml(formatTime(latest.changedAt)) + "</span>"
            + "</div>"
            + '<div class="detail-body">' + escapeHtml(latest.reason || "理由なし") + "</div>"
            + "</article>"
          );
        }
        document.getElementById("timeline-detail").innerHTML = details.join("");
      }

      function renderLogs() {
        const root = document.getElementById("log-list");
        const statusLogs = state.data.history.slice(0, 8).map((entry) => ({
          title: entry.label,
          time: entry.changedAt,
          body: [entry.previousValueText, entry.nextValueText].filter(Boolean).join(" → ")
            + (entry.reason ? " / " + entry.reason : ""),
        }));
        const envLogs = state.data.observations.slice(0, 8).map((entry) => ({
          title: entry.label,
          time: entry.observedAt,
          body:
            "raw " + (entry.rawValueText ?? "—") +
            " / score " + (entry.normalizedValue ?? "—") +
            (entry.reason ? " / " + entry.reason : ""),
        }));

        const combined = [...statusLogs, ...envLogs]
          .sort((a, b) => String(b.time || "").localeCompare(String(a.time || "")))
          .slice(0, 12);

        if (combined.length === 0) {
          root.innerHTML = '<p class="empty">ログはまだありません。</p>';
          return;
        }

        root.innerHTML = combined
          .map((item) =>
            '<article class="log-item">'
            + '<div class="log-title"><strong>' + escapeHtml(item.title) + '</strong><span class="log-time">'
            + escapeHtml(formatTime(item.time)) + "</span></div>"
            + '<div class="log-body">' + escapeHtml(item.body) + "</div>"
            + "</article>"
          )
          .join("");
      }

      function buildGraphLayout(nodes) {
        const columns = [
          ["environment", "sensor"],
          ["vital"],
          ["emotion", "latent"],
          ["action", "outcome"],
        ];
        const positioned = new Map();
        const width = 980;
        const height = 560;
        const xPositions = [120, 350, 610, 850];

        columns.forEach((kindSet, columnIndex) => {
          const columnNodes = nodes.filter((node) => kindSet.includes(node.kind));
          columnNodes.sort((a, b) => a.id.localeCompare(b.id));
          const gap = height / (columnNodes.length + 1);
          columnNodes.forEach((node, index) => {
            positioned.set(node.id, {
              x: xPositions[columnIndex],
              y: gap * (index + 1),
            });
          });
        });

        return { width, height, positioned };
      }

      function renderGraph() {
        const svg = document.getElementById("graph");
        const nodes = state.data.graph.nodes;
        const edges = state.data.graph.edges;
        const layout = buildGraphLayout(nodes);
        const selected = state.selectedKey;
        const hasTraceFocus = Boolean(state.trace?.startNode);
        const tracedNodeIds = new Set((state.trace?.nodes ?? []).map((node) => node.id));
        const tracedEdgeIds = new Set(
          (state.trace?.edges ?? []).map((edge) =>
            edge.direction + ":" + edge.sourceId + ":" + edge.targetId + ":" + edge.relation
          )
        );

        const parts = [
          '<rect x="0" y="0" width="' + layout.width + '" height="' + layout.height + '" rx="18" fill="transparent"></rect>'
        ];

        for (const edge of edges) {
          const source = layout.positioned.get(edge.sourceId);
          const target = layout.positioned.get(edge.targetId);
          if (!source || !target) continue;

          const forwardKey = "downstream:" + edge.sourceId + ":" + edge.targetId + ":" + edge.relation;
          const backwardKey = "upstream:" + edge.sourceId + ":" + edge.targetId + ":" + edge.relation;
          const highlighted = tracedEdgeIds.has(forwardKey) || tracedEdgeIds.has(backwardKey);
          const opacity = hasTraceFocus ? (highlighted ? 1 : 0.12) : 0.55;
          const stroke = edge.causalLevel === "Lv1"
            ? "#0e8b63"
            : edge.causalLevel === "Lv2"
              ? "#c4622d"
              : "#3f7db4";

          const c1x = source.x + 90;
          const c2x = target.x - 90;
          const path = "M" + source.x + " " + source.y
            + " C" + c1x + " " + source.y
            + ", " + c2x + " " + target.y
            + ", " + target.x + " " + target.y;

          parts.push(
            '<path d="' + path + '" fill="none" stroke="' + stroke + '" stroke-width="' + (1.8 + edge.weight * 1.2) + '" opacity="' + opacity + '"></path>'
          );
        }

        for (const node of nodes) {
          const point = layout.positioned.get(node.id);
          if (!point) continue;
          const active = hasTraceFocus ? tracedNodeIds.has(node.id) : true;
          const opacity = active ? 1 : 0.18;
          const fill = KIND_COLORS[node.kind] || "#ececec";
          const stroke = node.id === selected ? "#0e8b63" : "rgba(32,53,42,0.16)";

          parts.push(
            '<g opacity="' + opacity + '" data-node-id="' + escapeHtml(node.id) + '">'
            + '<rect x="' + (point.x - 74) + '" y="' + (point.y - 22) + '" width="148" height="44" rx="16" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + (node.id === selected ? 2.5 : 1.2) + '"></rect>'
            + '<text x="' + point.x + '" y="' + (point.y - 2) + '" text-anchor="middle" font-size="13" fill="#1c2822">' + escapeHtml(node.label) + '</text>'
            + '<text x="' + point.x + '" y="' + (point.y + 14) + '" text-anchor="middle" font-size="11" fill="#68756d">' + escapeHtml(node.kind + (node.dataLevel ? " / " + node.dataLevel : "")) + '</text>'
            + "</g>"
          );
        }

        svg.innerHTML = parts.join("");
      }

      function renderSelectionSummary() {
        const root = document.getElementById("selection-summary");
        const selectedMetric = state.data.current.find((metric) => metric.key === state.selectedKey);
        const trace = state.trace;

        const parts = [];
        if (selectedMetric) {
          parts.push(
            '<article class="group"><h3>Current</h3>'
            + '<div class="detail-item"><div class="detail-title"><strong>'
            + escapeHtml(selectedMetric.label)
            + '</strong><span class="detail-time">'
            + escapeHtml(formatTime(selectedMetric.observedAt || selectedMetric.recordedAt))
            + '</span></div><div class="detail-body">'
            + escapeHtml(formatMetricValue(selectedMetric))
            + (selectedMetric.reason ? "<br>" + escapeHtml(selectedMetric.reason) : "")
            + "</div></div></article>"
          );
        }

        function renderChains(title, chains) {
          if (!chains || chains.length === 0) return "";
          const body = chains
            .slice(0, 6)
            .map((chain) => {
              const labels = chain.direction === "upstream"
                ? [...chain.labels].reverse()
                : chain.labels;
              return (
                '<div class="detail-item"><div class="detail-title"><strong>'
                + escapeHtml(labels.join(" → "))
                + '</strong><span class="detail-time">'
                + escapeHtml("depth " + chain.depth + " / score " + chain.score.toFixed(2))
                + '</span></div><div class="detail-body">'
                + escapeHtml(chain.edges.map((edge) => edge.relation + " (" + edge.causalLevel + ")").join(" → "))
                + "</div></div>"
              );
            })
            .join("");
          return '<article class="group"><h3>' + title + "</h3><div class=\"detail-list\">" + body + "</div></article>";
        }

        if (trace) {
          if (!trace.startNode) {
            parts.push(
              '<article class="group"><h3>Causal Mapping Pending</h3>'
              + '<div class="detail-item"><div class="detail-body">'
              + escapeHtml("この指標はまだ causal seed に未接続です。current / history は表示されています。")
              + "</div></div></article>"
            );
          }

          parts.push(renderChains("Upstream Chains", trace.upstream));
          parts.push(renderChains("Downstream Chains", trace.downstream));

          if ((trace.upstream.length > 0 || trace.downstream.length > 0) && trace.startNode) {
            const related = trace.nodes
              .filter((node) => node.id !== trace.startNode.id)
              .slice(0, 8);
            const relatedHtml = related.map((node) =>
              '<div class="detail-item"><div class="detail-title"><strong>'
              + escapeHtml(node.label)
              + '</strong><span class="detail-time">'
              + escapeHtml(node.role)
              + '</span></div><div class="detail-body">'
              + escapeHtml(
                node.currentMetric
                  ? node.currentMetric.label + ": " + (node.currentMetric.valueText ?? "—")
                  : node.description || "current value unavailable"
              )
              + "</div></div>"
            ).join("");
            parts.push(
              '<article class="group"><h3>Trace Nodes</h3><div class="detail-list">'
              + relatedHtml
              + "</div></article>"
            );
          }
        }

        if (parts.length === 0) {
          root.innerHTML = '<p class="empty">左のカードやグラフのノードを選ぶと、関連する因果と現在値を表示します。</p>';
          return;
        }

        root.innerHTML = parts.join("");
      }

      function renderHeader() {
        document.getElementById("generated-at").textContent = "updated " + formatTime(state.data.generatedAt);
        document.getElementById("persona-name").textContent = state.data.meta.name || "Persona";
        document.getElementById("db-path").textContent = state.data.dbPath;
      }

      function render() {
        initializeSelectedSeries();
        renderTraceControls();
        renderHeader();
        renderCurrent();
        renderTimeline();
        renderLogs();
        renderGraph();
        renderSelectionSummary();
      }

      async function loadTraceForSelection() {
        const requestId = ++state.traceRequestId;
        const params = new URLSearchParams({
          key: state.selectedKey,
          direction: state.traceDirection,
          depth: String(state.traceDepth),
        });
        const response = await fetch("/api/causal-trace?" + params.toString(), { cache: "no-store" });
        const trace = await response.json();
        if (requestId !== state.traceRequestId) return;
        state.trace = trace;
        renderGraph();
        renderSelectionSummary();
        renderTraceControls();
      }

      async function load() {
        const response = await fetch("/api/dashboard", { cache: "no-store" });
        state.data = await response.json();
        state.trace = state.data.trace;
        render();
      }

      document.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;

        const metricButton = target.closest("[data-metric-key]");
        if (metricButton) {
          state.selectedKey = metricButton.getAttribute("data-metric-key");
          render();
          loadTraceForSelection().catch(() => {});
          return;
        }

        const seriesButton = target.closest("[data-series-key]");
        if (seriesButton) {
          const key = seriesButton.getAttribute("data-series-key");
          if (state.selectedSeries.has(key)) {
            if (state.selectedSeries.size > 1) state.selectedSeries.delete(key);
          } else {
            state.selectedSeries.add(key);
          }
          renderTimeline();
          return;
        }

        const node = target.closest("[data-node-id]");
        if (node) {
          state.selectedKey = node.getAttribute("data-node-id");
          renderGraph();
          renderSelectionSummary();
          renderCurrent();
          loadTraceForSelection().catch(() => {});
          return;
        }

        const point = target.closest("[data-point-key]");
        if (point) {
          state.selectedKey = point.getAttribute("data-point-key");
          render();
          loadTraceForSelection().catch(() => {});
          return;
        }

        const directionButton = target.closest("[data-trace-direction]");
        if (directionButton) {
          state.traceDirection = directionButton.getAttribute("data-trace-direction");
          renderTraceControls();
          loadTraceForSelection().catch(() => {});
          return;
        }

        const depthButton = target.closest("[data-trace-depth]");
        if (depthButton) {
          state.traceDepth = Number(depthButton.getAttribute("data-trace-depth")) || 3;
          renderTraceControls();
          loadTraceForSelection().catch(() => {});
        }
      });

      load().catch((error) => {
        document.getElementById("persona-name").textContent = "Dashboard error";
        document.getElementById("current-groups").innerHTML =
          '<p class="empty">' + escapeHtml(error.message || String(error)) + "</p>";
      });

      setInterval(() => {
        load().catch(() => {});
      }, 30000);
    </script>
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

      if (url.pathname === "/api/dashboard") {
        return Response.json(await buildPayload());
      }

      if (url.pathname === "/api/causal-trace") {
        return Response.json(await buildTracePayload(url));
      }

      if (url.pathname === "/health") {
        return new Response("ok");
      }

      return new Response(renderPage(), {
        headers: {
          "content-type": "text/html; charset=utf-8",
        },
      });
    },
  });

  console.log(`[persona-dashboard] http://${server.hostname}:${server.port}`);
}
