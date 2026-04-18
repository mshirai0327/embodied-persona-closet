(function () {
  const LEVEL_ORDER = ["Lv0", "Lv1-1", "Lv1-2", "Lv2", "Lv3-1", "Lv3-2"];
  const COLLAPSIBLE_LEVELS = new Set(["Lv1-1", "Lv1-2", "Lv2"]);
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
  const CAUSAL_LEVEL_STYLES = {
    Lv1: { color: "#0e8b63", label: "Lv1 生理・環境", markerId: "graph-arrow-lv1" },
    Lv2: { color: "#c4622d", label: "Lv2 経験・proxy", markerId: "graph-arrow-lv2" },
    Lv3: { color: "#3f7db4", label: "Lv3 文脈依存", markerId: "graph-arrow-lv3" },
  };
  const GRAPH_LEVEL_COLUMNS = [
    { key: "Lv0", label: "Lv0" },
    { key: "Lv1", label: "Lv1" },
    { key: "Lv2", label: "Lv2" },
    { key: "Lv3-1", label: "Lv3-1" },
    { key: "Lv3-2", label: "Lv3-2" },
  ];
  const NODE_HALF_WIDTH = 74;
  const NODE_HALF_HEIGHT = 22;

  let initialDataError = null;
  function readInitialData() {
    const initialDataNode = document.getElementById("initial-dashboard-data");
    if (!initialDataNode) return null;
    try {
      return JSON.parse(initialDataNode.textContent || "null");
    } catch (error) {
      initialDataError = error;
      return null;
    }
  }

  const INITIAL_DATA = readInitialData();

  const state = {
    data: null,
    selectedKey: "energy",
    statusSelectedSeries: new Set(),
    environmentSelectedSeries: new Set(),
    initializedSeries: false,
    trace: null,
    traceDirection: "both",
    traceDepth: 3,
    traceRequestId: 0,
    openLevels: new Set(),
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
    return text.replace("T", " ").replace(/:00\.\d+Z$/, "Z");
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
      const isCollapsible = COLLAPSIBLE_LEVELS.has(level);
      const isSelectedLevel = items.some((metric) => metric.key === state.selectedKey);
      const isOpen = state.openLevels.has(level) || isSelectedLevel;

      if (isCollapsible) {
        html.push(
          '<details class="group group-accordion" data-level="' + escapeHtml(level) + '"'
          + (isOpen ? " open" : "")
          + ">"
        );
        html.push(
          '<summary class="group-summary">'
          + '<span class="group-summary-main">'
          + '<span class="group-summary-title">' + escapeHtml(LEVEL_LABELS[level] || level) + "</span>"
          + "</span>"
          + '<span class="group-summary-meta">' + escapeHtml(String(items.length)) + "項目</span>"
          + "</summary>"
        );
        html.push('<div class="group-body"><div class="metric-grid">');
      } else {
        html.push('<section class="group">');
        html.push("<h3>" + escapeHtml(LEVEL_LABELS[level] || level) + "</h3>");
        html.push('<div class="metric-grid">');
      }

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

      if (isCollapsible) {
        html.push("</div></div></details>");
      } else {
        html.push("</div></section>");
      }
    }

    root.innerHTML = html.join("");
  }

  function collectTimelineEntries(levels) {
    const reversibleLevels = new Set(levels);
    return state.data.history.filter(
      (entry) => entry.nextValueNumber != null && entry.changedAt && reversibleLevels.has(entry.level)
    );
  }

  function buildSeries(entries, selectedSet, selectedOnly) {
    const grouped = new Map();
    for (const entry of entries) {
      if (selectedOnly && !selectedSet.has(entry.key)) continue;
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

    state.statusSelectedSeries = new Set(
      collectTimelineEntries(["Lv3-1", "Lv3-2"]).map((entry) => entry.key)
    );
    state.environmentSelectedSeries = new Set(
      collectTimelineEntries(["Lv0"]).map((entry) => entry.key)
    );
    state.initializedSeries = true;
  }

  function getSelectedSeries(scope) {
    return scope === "environment" ? state.environmentSelectedSeries : state.statusSelectedSeries;
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

  function renderGraphLegend() {
    const root = document.getElementById("graph-legend");
    if (!root) return;

    root.innerHTML = ["Lv1", "Lv2", "Lv3"]
      .map((level) => {
        const item = CAUSAL_LEVEL_STYLES[level];
        return '<span class="pill legend-chip">'
          + '<span class="legend-line" style="color:' + item.color + '"></span>'
          + escapeHtml(item.label)
          + "</span>";
      })
      .join("");
  }

  function buildGraphEdgePath(source, target) {
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const horizontal = Math.abs(dx) >= Math.abs(dy);

    if (horizontal) {
      const direction = dx >= 0 ? 1 : -1;
      const startX = source.x + NODE_HALF_WIDTH * direction;
      const startY = source.y;
      const endX = target.x - NODE_HALF_WIDTH * direction;
      const endY = target.y;
      const handle = Math.max(48, Math.abs(endX - startX) * 0.35);

      return "M" + startX + " " + startY
        + " C" + (startX + handle * direction) + " " + startY
        + ", " + (endX - handle * direction) + " " + endY
        + ", " + endX + " " + endY;
    }

    const direction = dy >= 0 ? 1 : -1;
    const startX = source.x;
    const startY = source.y + NODE_HALF_HEIGHT * direction;
    const endX = target.x;
    const endY = target.y - NODE_HALF_HEIGHT * direction;
    const handle = Math.max(36, Math.abs(endY - startY) * 0.45);

    return "M" + startX + " " + startY
      + " C" + startX + " " + (startY + handle * direction)
      + ", " + endX + " " + (endY - handle * direction)
      + ", " + endX + " " + endY;
  }

  function renderLegend(rootId, series, selectedSet, scope) {
    const root = document.getElementById(rootId);
    root.innerHTML = series
      .map((serie) => {
        const active = selectedSet.has(serie.key) ? "active" : "";
        const label = serie.points[serie.points.length - 1]?.label || serie.key;
        return '<button class="' + active + '" data-series-key="' + escapeHtml(serie.key) + '" data-series-scope="' + escapeHtml(scope) + '">'
          + '<span class="pill" style="background:' + (SERIES_COLORS[serie.key] || "#ddd") + '; width:12px; height:12px; display:inline-block; padding:0; border:none; margin-right:8px;"></span>'
          + escapeHtml(label) + "</button>";
      })
      .join("");
  }

  function graphLevelForNode(node) {
    if (node.dataLevel === "Lv0") return "Lv0";
    if (node.dataLevel === "Lv2") return "Lv2";
    if (typeof node.dataLevel === "string" && node.dataLevel.startsWith("Lv1")) return "Lv1";
    if (node.dataLevel === "Lv3-1") return "Lv3-1";
    if (node.dataLevel === "Lv3-2") return "Lv3-2";

    if (node.kind === "environment" || node.kind === "sensor") return "Lv0";
    if (node.kind === "vital") return "Lv3-1";
    return "Lv3-2";
  }

  function renderTimelineChart(config) {
    const svg = document.getElementById(config.svgId);
    const detailRoot = document.getElementById(config.detailId);
    const entries = collectTimelineEntries(config.levels);
    const selectedSet = getSelectedSeries(config.scope);
    const allSeries = buildSeries(entries, selectedSet, false);
    const series = buildSeries(entries, selectedSet, true);
    renderLegend(config.legendId, allSeries, selectedSet, config.scope);

    if (series.length === 0) {
      svg.innerHTML = '<text x="40" y="60" fill="#68756d" font-size="14">' + escapeHtml(config.emptyMessage) + "</text>";
      detailRoot.innerHTML = "";
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
      '<rect x="0" y="0" width="' + width + '" height="' + height + '" rx="12" fill="transparent"></rect>',
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
    detailRoot.innerHTML = details.join("");
  }

  function renderHistory() {
    renderTimelineChart({
      scope: "status",
      levels: ["Lv3-1", "Lv3-2"],
      legendId: "timeline-legend",
      svgId: "timeline",
      detailId: "timeline-detail",
      emptyMessage: "Lv3 の数値履歴がまだありません。",
    });
    renderTimelineChart({
      scope: "environment",
      levels: ["Lv0"],
      legendId: "environment-timeline-legend",
      svgId: "environment-timeline",
      detailId: "environment-timeline-detail",
      emptyMessage: "Lv0 の数値履歴がまだありません。",
    });
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
    const positioned = new Map();
    const width = 980;
    const height = 560;
    const topPadding = 74;
    const bottomPadding = 28;
    const columnWidth = width / GRAPH_LEVEL_COLUMNS.length;
    const columns = GRAPH_LEVEL_COLUMNS.map((column, index) => ({
      ...column,
      xStart: columnWidth * index,
      xCenter: columnWidth * index + columnWidth / 2,
      width: columnWidth,
    }));

    columns.forEach((column) => {
      const columnNodes = nodes
        .filter((node) => graphLevelForNode(node) === column.key)
        .sort((left, right) => {
          if (left.kind !== right.kind) {
            return left.kind.localeCompare(right.kind, "ja");
          }
          return left.label.localeCompare(right.label, "ja");
        });
      const gap = (height - topPadding - bottomPadding) / (columnNodes.length + 1);
      columnNodes.forEach((node, index) => {
        positioned.set(node.id, {
          x: column.xCenter,
          y: topPadding + gap * (index + 1),
        });
      });
    });

    return { width, height, positioned, columns };
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
      "<defs>",
      ...Object.values(CAUSAL_LEVEL_STYLES).map((style) =>
        '<marker id="' + style.markerId + '" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="4.5" markerHeight="4.5" orient="auto">'
        + '<path d="M 0 0 L 10 5 L 0 10 z" fill="' + style.color + '"></path>'
        + "</marker>"
      ),
      "</defs>",
      '<rect x="0" y="0" width="' + layout.width + '" height="' + layout.height + '" rx="18" fill="transparent"></rect>',
    ];

    layout.columns.forEach((column, index) => {
      parts.push(
        '<rect x="' + (column.xStart + 8) + '" y="10" width="' + (column.width - 16) + '" height="' + (layout.height - 20) + '" rx="18" fill="' + (index % 2 === 0 ? "rgba(255,255,255,0.5)" : "rgba(244,248,244,0.68)") + '" stroke="rgba(32,53,42,0.08)"></rect>'
      );
      parts.push(
        '<text x="' + column.xCenter + '" y="34" text-anchor="middle" font-size="16" font-weight="600" fill="#68756d">' + escapeHtml(column.label) + "</text>"
      );
      if (index > 0) {
        parts.push(
          '<line x1="' + column.xStart + '" y1="18" x2="' + column.xStart + '" y2="' + (layout.height - 18) + '" stroke="rgba(32,53,42,0.1)" stroke-dasharray="6 8"></line>'
        );
      }
    });

    for (const edge of edges) {
      const source = layout.positioned.get(edge.sourceId);
      const target = layout.positioned.get(edge.targetId);
      if (!source || !target) continue;

      const forwardKey = "downstream:" + edge.sourceId + ":" + edge.targetId + ":" + edge.relation;
      const backwardKey = "upstream:" + edge.sourceId + ":" + edge.targetId + ":" + edge.relation;
      const highlighted = tracedEdgeIds.has(forwardKey) || tracedEdgeIds.has(backwardKey);
      const opacity = hasTraceFocus ? (highlighted ? 1 : 0.12) : 0.55;
      const style = CAUSAL_LEVEL_STYLES[edge.causalLevel] || CAUSAL_LEVEL_STYLES.Lv3;
      const path = buildGraphEdgePath(source, target);

      parts.push(
        '<path d="' + path + '" fill="none" stroke="' + style.color + '" stroke-width="' + (1.8 + edge.weight * 1.2) + '" opacity="' + opacity + '" marker-end="url(#' + style.markerId + ')"></path>'
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
        + '<rect x="' + (point.x - NODE_HALF_WIDTH) + '" y="' + (point.y - NODE_HALF_HEIGHT) + '" width="' + (NODE_HALF_WIDTH * 2) + '" height="' + (NODE_HALF_HEIGHT * 2) + '" rx="16" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + (node.id === selected ? 2.5 : 1.2) + '"></rect>'
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
      return '<article class="group"><h3>' + title + '</h3><div class="detail-list">' + body + "</div></article>";
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
    renderGraphLegend();
    renderHeader();
    renderCurrent();
    renderHistory();
    renderLogs();
    renderGraph();
    renderSelectionSummary();
  }

  function fetchTrace(key, direction, depth) {
    const params = new URLSearchParams({
      key,
      direction,
      depth: String(depth),
    });
    return fetch("/api/causal-trace?" + params.toString(), { cache: "no-store" })
      .then((response) => response.json());
  }

  function matchesTraceSelection(trace, key, direction, depth) {
    return Boolean(
      trace
      && trace.startKey === key
      && trace.direction === direction
      && trace.maxDepth === depth
    );
  }

  function hasSelectableKey(data, key) {
    return data.current.some((metric) => metric.key === key)
      || data.graph.nodes.some((node) => node.id === key);
  }

  function pickDefaultSelectedKey(data) {
    return data.current[0]?.key || data.graph.nodes[0]?.id || "energy";
  }

  async function loadTraceForSelection() {
    const requestId = ++state.traceRequestId;
    const key = state.selectedKey;
    const direction = state.traceDirection;
    const depth = state.traceDepth;
    const trace = await fetchTrace(key, direction, depth);
    if (requestId !== state.traceRequestId) return;
    if (state.selectedKey !== key || state.traceDirection !== direction || state.traceDepth !== depth) return;
    state.trace = trace;
    renderGraph();
    renderSelectionSummary();
    renderTraceControls();
  }

  async function load() {
    if (!state.data && INITIAL_DATA) {
      state.data = INITIAL_DATA;
      state.trace = INITIAL_DATA.trace;
      render();
      return;
    }

    const response = await fetch("/api/dashboard", { cache: "no-store" });
    const nextData = await response.json();
    state.data = nextData;

    if (!hasSelectableKey(nextData, state.selectedKey)) {
      state.selectedKey = pickDefaultSelectedKey(nextData);
    }

    const key = state.selectedKey;
    const direction = state.traceDirection;
    const depth = state.traceDepth;

    if (matchesTraceSelection(nextData.trace, key, direction, depth)) {
      state.trace = nextData.trace;
      render();
      return;
    }

    try {
      const trace = await fetchTrace(key, direction, depth);
      if (state.selectedKey === key && state.traceDirection === direction && state.traceDepth === depth) {
        state.trace = trace;
      }
    } catch {
      if (matchesTraceSelection(nextData.trace, state.selectedKey, state.traceDirection, state.traceDepth)) {
        state.trace = nextData.trace;
      }
    }

    render();
  }

  function renderBootError(error) {
    const message = error instanceof Error ? error.message : String(error);
    const nameRoot = document.getElementById("persona-name");
    const currentRoot = document.getElementById("current-groups");
    if (nameRoot) nameRoot.textContent = "Dashboard error";
    if (currentRoot) {
      currentRoot.innerHTML = '<p class="empty">' + escapeHtml(message) + "</p>";
    }
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
      const scope = seriesButton.getAttribute("data-series-scope") || "status";
      const selectedSet = getSelectedSeries(scope);
      if (selectedSet.has(key)) {
        if (selectedSet.size > 1) selectedSet.delete(key);
      } else {
        selectedSet.add(key);
      }
      renderHistory();
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

  document.addEventListener("toggle", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLDetailsElement)) return;

    const level = target.getAttribute("data-level");
    if (!level) return;

    if (target.open) {
      state.openLevels.add(level);
    } else {
      state.openLevels.delete(level);
    }
  }, true);

  window.addEventListener("error", (event) => {
    if (event.error) {
      renderBootError(event.error);
    }
  });

  window.addEventListener("unhandledrejection", (event) => {
    renderBootError(event.reason);
  });

  try {
    if (INITIAL_DATA) {
      state.data = INITIAL_DATA;
      state.trace = INITIAL_DATA.trace;
      render();
    } else if (initialDataError) {
      renderBootError(initialDataError);
    } else {
      load().catch(renderBootError);
    }
  } catch (error) {
    renderBootError(error);
  }

  setInterval(() => {
    load().catch(() => {});
  }, 30000);
})();
