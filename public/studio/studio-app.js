/**
 * SGRS Studio — catalog, scope switching, live sidebars, new-scope modal.
 * Loaded by index.html after the Cytoscape graph bootstrap fires `studio:ready`.
 */
(function () {
  const cfg = window.STUDIO_CONTROL || {};
  const baseUrl = String(cfg.baseUrl || location.origin).replace(/\/$/, "");

  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function currentScopeId() {
    return (
      new URLSearchParams(location.search).get("scope_id") ||
      localStorage.getItem("studio_scope_id") ||
      cfg.scopeId ||
      "default"
    );
  }

  function setScopeId(scopeId) {
    localStorage.setItem("studio_scope_id", scopeId);
    const u = new URL(location.href);
    u.searchParams.set("scope_id", scopeId);
    history.replaceState({}, "", u.toString());
    if (window.STUDIO_CONTROL) window.STUDIO_CONTROL.scopeId = scopeId;
  }

  function stateLabel(state, score) {
    if (state === "resolved") return "resolved ✓";
    if (state === "archived") return "archived";
    if (state === "near-final") return "near-final " + Number(score).toFixed(2);
    if (state === "active" || state === "escalated" || state === "ACTIVE")
      return "active " + Number(score).toFixed(2);
    return String(state || "active");
  }

  function updateScopeButton(scope) {
    const btn = document.getElementById("scopeBtn");
    if (!btn || !scope) return;
    const nameEl = btn.querySelector(".scope-name");
    const tagEl = btn.querySelector(".scope-tag");
    if (nameEl) nameEl.textContent = scope.name;
    if (tagEl) tagEl.textContent = scope.tag;
  }

  async function fetchCatalog() {
    const res = await fetch(baseUrl + "/studio/scopes");
    if (!res.ok) throw new Error("catalog " + res.status);
    const data = await res.json();
    return data.scopes || [];
  }

  function renderCatalogMenu(scopes, activeId) {
    const menu = document.getElementById("scopeMenu");
    if (!menu) return;
    const active = scopes.filter((s) => s.section !== "archived");
    const archived = scopes.filter((s) => s.section === "archived");
    let html =
      '<input class="scope-search" id="scopeSearch" placeholder="Search scopes…" type="text" name="scope_search" />';
    html += '<div class="scope-section">Active</div><div id="scopeMenuActive">';
    active.forEach((s) => {
      const cls = s.id === activeId ? "scope-item active" : "scope-item";
      html +=
        '<div class="' +
        cls +
        '" data-scope-id="' +
        esc(s.id) +
        '" role="button" tabindex="0">' +
        '<div class="n">' +
        esc(s.name) +
        "</div>" +
        '<div class="state' +
        (s.state === "resolved" ? " ok" : s.state === "active" ? " active-state" : "") +
        '">' +
        esc(stateLabel(s.state, s.score)) +
        "</div>" +
        '<div class="m">' +
        esc(s.tag) +
        " · " +
        s.cycles +
        " cycles</div></div>";
    });
    html += "</div>";
    if (archived.length) {
      html += '<div class="scope-section">Archived</div><div id="scopeMenuArchived">';
      archived.forEach((s) => {
        html +=
          '<div class="scope-item" data-scope-id="' +
          esc(s.id) +
          '" role="button" tabindex="0">' +
          '<div class="n">' +
          esc(s.name) +
          "</div>" +
          '<div class="state">' +
          esc(stateLabel(s.state, s.score)) +
          "</div>" +
          '<div class="m">' +
          esc(s.tag) +
          " · " +
          s.cycles +
          " cycles</div></div>";
      });
      html += "</div>";
    }
    html += '<button type="button" class="scope-new" id="scopeNewBtn">+ New scope</button>';
    menu.innerHTML = html;
    window.__studioCatalog = scopes;

    menu.querySelectorAll("[data-scope-id]").forEach((el) => {
      el.addEventListener("click", () => {
        const id = el.getAttribute("data-scope-id");
        if (id) switchScope(id, scopes);
        menu.hidden = true;
      });
    });
    const search = document.getElementById("scopeSearch");
    if (search) {
      search.addEventListener("input", () => {
        const q = search.value.toLowerCase();
        menu.querySelectorAll(".scope-item").forEach((row) => {
          const text = row.textContent.toLowerCase();
          row.style.display = text.includes(q) ? "" : "none";
        });
      });
    }
    document.getElementById("scopeNewBtn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      openNewScopeModal();
      menu.hidden = true;
    });
  }

  async function fetchGraph(scopeId) {
    const res = await fetch(
      baseUrl + "/studio/elements?scope_id=" + encodeURIComponent(scopeId),
    );
    if (!res.ok) throw new Error("elements " + res.status);
    return res.json();
  }

  async function fetchSummary(scopeId) {
    const key = cfg.apiKey || "";
    const url = key
      ? baseUrl + "/v1/scopes/" + encodeURIComponent(scopeId) + "/summary"
      : baseUrl + "/summary?raw=1&scope_id=" + encodeURIComponent(scopeId);
    const headers = key ? { Authorization: "Bearer " + key } : {};
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error("summary " + res.status);
    return res.json();
  }

  function applyGraphToCy(cy, cyDbg, nodes, edges, layeredPositions) {
    const posMap = layeredPositions(nodes);
    const nodesPositioned = nodes.map((n) => ({
      data: { ...n.data, pos: posMap[n.data.id] },
    }));
    const nodeElements = JSON.parse(JSON.stringify(nodesPositioned));
    const edgeElements = JSON.parse(JSON.stringify(edges)).map((e, idx) => {
      const data = { ...(e.data || {}) };
      if (!data.id) {
        data.id =
          "link-" +
          data.source +
          "-" +
          data.target +
          "-" +
          (data.type || "refers") +
          "-" +
          idx;
      }
      return { data };
    });
    const layout = {
      name: "preset",
      positions: (node) => node.data("pos") || { x: 0, y: 0 },
      fit: true,
      padding: 44,
      animate: false,
    };
    const paint = (inst) => {
      if (!inst) return;
      inst.batch(() => {
        inst.elements().remove();
        inst.add([...nodeElements, ...edgeElements]);
      });
      inst.layout(layout).run();
    };
    paint(cy);
    paint(cyDbg);
    syncGraphEdgesVisibility();
    setTimeout(() => {
      cy.resize();
      cy.fit(null, 52);
      if (cyDbg) {
        cyDbg.resize();
        cyDbg.fit(null, 48);
      }
      updateBusinessGraphLabels(cy);
      syncGraphEdgesVisibility();
    }, 60);
    ensureGraphUiHooks(cy);
    ensureGraphEdgeToggleHooks();
    return { nodes, edges };
  }

  const GRAPH_TYPE_META = {
    doc: { label: "doc", color: "#7a7f8b" },
    claim: { label: "claim", color: "#6aa6d6" },
    contradiction: { label: "block", color: "#d97a6c" },
    resolution: { label: "fix", color: "#7fb98b" },
    risk: { label: "risk", color: "#e8b765" },
    goal: { label: "goal", color: "#7fb98b" },
  };

  function countNodesByType(nodes) {
    const counts = {};
    nodes.forEach((n) => {
      const t = n.data?.type || "other";
      counts[t] = (counts[t] || 0) + 1;
    });
    return counts;
  }

  function updateGraphOverlay(nodes, live) {
    const legend = document.getElementById("graphLegend");
    const empty = document.getElementById("graphEmpty");
    const source = document.body.dataset.graphSource || "empty";
    const hasNodes = Array.isArray(nodes) && nodes.length > 0;

    if (empty) empty.hidden = hasNodes;
    if (!legend) return;

    if (!hasNodes) {
      legend.hidden = true;
      const btn = document.getElementById("edgeToggleBtn");
      if (btn) btn.hidden = true;
      return;
    }

    const counts = countNodesByType(nodes);
    const edgeCount = Array.isArray(window.__studioEdges)
      ? window.__studioEdges.length
      : 0;
    const typesEl = document.getElementById("graphLegendTypes");
    const chips = Object.entries(GRAPH_TYPE_META)
      .filter(([type]) => counts[type] > 0)
      .map(
        ([type, meta]) =>
          '<span class="graph-chip"><span class="dot" style="background:' +
          meta.color +
          '"></span>' +
          esc(meta.label) +
          " " +
          counts[type] +
          "</span>",
      );
    const srcLabel =
      live || source === "live"
        ? '<span class="graph-chip src-live">live</span>'
        : '<span class="graph-chip">demo</span>';
    if (typesEl) typesEl.innerHTML = srcLabel + chips.join("");
    updateLinksToggleButton(edgeCount);
    legend.hidden = false;
  }

  function countGraphEdgesByType(edges) {
    const counts = { contradicts: 0, other: 0 };
    for (const edge of edges || []) {
      const type = edge?.data?.type || "refers";
      if (type === "contradicts") counts.contradicts += 1;
      else counts.other += 1;
    }
    return counts;
  }

  function updateLinksToggleButton(edgeCount) {
    const btn = document.getElementById("edgeToggleBtn");
    if (!btn) return;
    const total =
      typeof edgeCount === "number"
        ? edgeCount
        : Array.isArray(window.__studioEdges)
          ? window.__studioEdges.length
          : 0;
    if (total <= 0) {
      btn.hidden = true;
      return;
    }
    btn.hidden = false;
    const on = graphEdgesVisible();
    const byType = countGraphEdgesByType(window.__studioEdges);
    const label = btn.querySelector(".links-toggle-label");
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.title = on
      ? "Hide graph links (" + total + ")"
      : "Show graph links (" + total + ")";
    btn.setAttribute(
      "aria-label",
      on ? "Hide " + total + " graph links" : "Show " + total + " graph links",
    );
    if (label) {
      if (on) {
        const parts = [];
        if (byType.contradicts > 0) parts.push(byType.contradicts + " block");
        if (byType.other > 0) parts.push(byType.other + " other");
        label.textContent =
          "links · " + total + (parts.length ? " (" + parts.join(", ") + ")" : "");
      } else {
        label.textContent = "links off";
      }
    }
  }

  function updateBusinessGraphLabels(cy) {
    if (!cy) return;
    const z = cy.zoom();
    cy.batch(() => {
      cy.nodes().removeClass("show-label");
      if (z >= 0.5) {
        cy.nodes(
          '[type="contradiction"], [type="risk"], [type="goal"]',
        ).addClass("show-label");
      }
      if (z >= 0.75) {
        cy.nodes('[type="doc"], [type="resolution"]').addClass("show-label");
      }
      if (z >= 1.05) {
        cy.nodes('[type="claim"]').addClass("show-label");
      }
    });
  }

  const EDGES_VISIBLE_KEY = "studio_edges_visible";

  function loadGraphEdgesVisiblePref() {
    try {
      const raw = localStorage.getItem(EDGES_VISIBLE_KEY);
      if (raw === "0" || raw === "false") return false;
      if (raw === "1" || raw === "true") return true;
    } catch (_e) {
      /* ignore */
    }
    return true;
  }

  function saveGraphEdgesVisiblePref(visible) {
    try {
      localStorage.setItem(EDGES_VISIBLE_KEY, visible ? "1" : "0");
    } catch (_e) {
      /* ignore */
    }
  }

  function graphCyInstances() {
    return [window.__studioCy, window.__studioCyDbg].filter(Boolean);
  }

  function graphEdgesVisible() {
    if (window.__studioEdgesVisible === undefined) {
      window.__studioEdgesVisible = loadGraphEdgesVisiblePref();
    }
    return window.__studioEdgesVisible !== false;
  }

  function applyEdgeVisibility(inst) {
    if (!inst) return;
    const show = graphEdgesVisible();
    inst.batch(() => {
      inst.edges().forEach((edge) => {
        if (show) {
          edge.removeClass("edges-hidden");
          edge.removeStyle("display");
        } else {
          edge.removeClass("hi");
          edge.addClass("edges-hidden");
          edge.style("display", "none");
        }
      });
    });
  }

  function updateGraphEdgeHint() {
    const hint = document.getElementById("zoomHint");
    if (!hint) return;
    const edgeCount = Array.isArray(window.__studioEdges)
      ? window.__studioEdges.length
      : 0;
    hint.textContent =
      edgeCount > 0 ? "zoom · hover · click links chip" : "zoom · hover";
  }

  function syncGraphEdgesVisibility() {
    graphCyInstances().forEach((inst) => applyEdgeVisibility(inst));
    updateGraphEdgeHint();
    updateLinksToggleButton();
  }

  function setGraphEdgesVisible(visible) {
    window.__studioEdgesVisible = !!visible;
    saveGraphEdgesVisiblePref(!!visible);
    syncGraphEdgesVisibility();
  }

  function toggleGraphEdgesVisibility() {
    setGraphEdgesVisible(!graphEdgesVisible());
  }

  function bindEdgeToggleButton() {
    const btn = document.getElementById("edgeToggleBtn");
    if (!btn || btn.dataset.bound === "1") return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleGraphEdgesVisibility();
    });
  }

  function ensureGraphEdgeToggleHooks() {
    bindEdgeToggleButton();
    syncGraphEdgesVisibility();
  }

  window.__studioApplyEdgeVisibility = applyEdgeVisibility;

  function ensureGraphUiHooks(cy) {
    if (!cy || cy.scratch("_studioUiHooks")) return;
    cy.scratch("_studioUiHooks", true);
    cy.on("zoom", () => {
      updateBusinessGraphLabels(cy);
      const zoomEl = document.getElementById("zoomLvl");
      if (zoomEl) zoomEl.textContent = Math.round(cy.zoom() * 100) + "%";
    });
    cy.ready(() => updateBusinessGraphLabels(cy));
  }

  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    const chunk = 0x8000;
    let binary = "";
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(
        null,
        bytes.subarray(i, i + chunk),
      );
    }
    return btoa(binary);
  }

  async function fileToDocument(file) {
    const title = file.name.replace(/\.[^.]+$/i, "") || file.name;
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    if (ext === "txt" || ext === "md") {
      return { title, body: await file.text() };
    }
    if (ext === "pdf" || ext === "docx") {
      return {
        title,
        filename: file.name,
        content_base64: arrayBufferToBase64(await file.arrayBuffer()),
      };
    }
    throw new Error("Unsupported file type: " + file.name);
  }

  async function filesToDocuments(fileList) {
    const documents = [];
    for (const file of fileList) {
      documents.push(await fileToDocument(file));
    }
    return documents;
  }

  function pickScopeMock(scopeId) {
    if (scopeId === "default") {
      return {
        nodes: window.__studioMockBasicNodes || [],
        edges: window.__studioMockBasicEdges || [],
      };
    }
    if (scopeId === "deal-horizon") {
      return {
        nodes: window.__studioMockMaNodes || window.__studioMockNodes || [],
        edges: window.__studioMockMaEdges || window.__studioMockEdges || [],
      };
    }
    return { nodes: [], edges: [] };
  }

  async function reloadGraph(scopeId, _mockNodes, _mockEdges, layeredPositions) {
    const cy = window.__studioCy;
    const fallback = pickScopeMock(scopeId);
    if (!cy) return { nodes: fallback.nodes, edges: fallback.edges, live: false };
    const prevNodes = window.__studioNodes || [];
    const prevEdges = window.__studioEdges || [];
    const prevScope = window.__studioLastScopeId;
    const prevLive = document.body.dataset.graphSource === "live";
    let nodes = [];
    let edges = [];
    let live = false;
    try {
      const liveData = await fetchGraph(scopeId);
      if (liveData.nodes && liveData.nodes.length > 0) {
        const regressed =
          prevLive &&
          prevScope === scopeId &&
          prevNodes.length > 3 &&
          liveData.nodes.length < prevNodes.length * 0.45;
        if (regressed) {
          nodes = prevNodes;
          edges = prevEdges;
        } else {
          nodes = liveData.nodes;
          edges = liveData.edges || [];
          if (
            edges.length === 0 &&
            prevLive &&
            prevScope === scopeId &&
            prevEdges.length > 0
          ) {
            edges = prevEdges;
          }
        }
        live = true;
        document.body.dataset.graphSource = "live";
      } else {
        nodes = [];
        edges = [];
        live = true;
        document.body.dataset.graphSource = "empty";
      }
    } catch (_e) {
      if (prevLive && prevScope === scopeId && prevNodes.length > 0) {
        nodes = prevNodes;
        edges = prevEdges;
        live = true;
        document.body.dataset.graphSource = "live";
      } else if (fallback.nodes.length > 0) {
        nodes = fallback.nodes;
        edges = fallback.edges;
        document.body.dataset.graphSource =
          scopeId === "default"
            ? "mock-basic"
            : scopeId === "deal-horizon"
              ? "mock-ma"
              : "empty";
      } else {
        document.body.dataset.graphSource = "empty";
      }
    }
    window.__studioLastScopeId = scopeId;
    applyGraphToCy(cy, window.__studioCyDbg, nodes, edges, layeredPositions);
    window.__studioNodes = nodes;
    window.__studioEdges = edges;
    updateGraphOverlay(nodes, live);
    return { nodes, edges, live };
  }

  function renderSidebarsFromGraph(nodes, edges, summary) {
    const sbBlockers = document.getElementById("sbBlockers");
    const sbResolutions = document.getElementById("sbResolutions");
    const sbNext = document.getElementById("sbNext");
    const attn = document.querySelector(".card.attn");
    const activity = document.querySelector(".activity");
    if (!sbBlockers || !sbResolutions || !sbNext) return;

    const blockers = nodes.filter(
      (n) => n.data.type === "contradiction" && !n.data.resolved,
    );
    sbBlockers.innerHTML = blockers.length
      ? ""
      : '<div class="sb-empty">No active blockers</div>';
    blockers.forEach((n) => {
      const d = n.data;
      const row = document.createElement("div");
      row.className = "sb-row blocker focusable";
      row.dataset.nodeId = d.id;
      const pill = d.veto
        ? '<span class="pill veto">VETO</span>'
        : '<span class="pill" style="background:rgba(232,183,101,.15);color:var(--amber)">soft</span>';
      row.innerHTML =
        '<div class="sb-title">' +
        pill +
        esc(d.label) +
        '</div><div class="sb-meta">' +
        esc((d.info && d.info.desc) || "") +
        "</div>";
      sbBlockers.appendChild(row);
    });

    const resolutions = nodes.filter((n) => n.data.type === "resolution");
    sbResolutions.innerHTML = resolutions.length
      ? ""
      : '<div class="sb-empty">No resolutions recorded</div>';
    resolutions.forEach((n) => {
      const d = n.data;
      const edge = edges.find(
        (e) => e.data.source === d.id && e.data.type === "resolves",
      );
      const contraId = edge ? edge.data.target : "";
      const contraNode = nodes.find((x) => x.data.id === contraId);
      const row = document.createElement("div");
      row.className = "sb-row resolution focusable";
      row.dataset.nodeId = d.id;
      row.innerHTML =
        '<div class="sb-title">' +
        esc(d.label) +
        '</div><div class="sb-meta">Contradiction · ' +
        esc(contraNode ? contraNode.data.label : contraId) +
        "</div>";
      sbResolutions.appendChild(row);
    });

    const nextLines = [];
    blockers.slice(0, 2).forEach((n) => {
      nextLines.push({
        id: n.data.id,
        title: "Resolve: " + n.data.label,
        meta: (n.data.info && n.data.info.desc) || "",
      });
    });
    if (summary && summary.finality && !summary.finality.resolved) {
      nextLines.push({
        id: blockers[0]?.data.id || "",
        title: "Review finality gate",
        meta:
          "Status " +
          String(summary.finality.status) +
          " · score " +
          String(summary.finality.goal_score),
      });
    }
    if (!nextLines.length) {
      nextLines.push({
        id: "",
        title: "No pending actions",
        meta: "Scope is converging or awaiting documents",
      });
    }
    sbNext.innerHTML = "";
    nextLines.forEach((line) => {
      const row = document.createElement("div");
      row.className = "sb-row next" + (line.id ? " focusable" : "");
      if (line.id) row.dataset.nodeId = line.id;
      row.innerHTML =
        '<div class="sb-title">' +
        esc(line.title) +
        '</div><div class="sb-meta">' +
        esc(line.meta) +
        "</div>";
      sbNext.appendChild(row);
    });

    if (attn) {
      const p = attn.querySelector("p");
      const unresolved = blockers.length;
      const fin = summary && summary.finality;
      const status = fin && String(fin.status || "").toUpperCase();
      const needsHitl =
        status === "ESCALATED" ||
        status === "NEAR_FINALITY" ||
        status === "NEAR-FINALITY" ||
        (fin && !fin.resolved && unresolved > 0);
      if (p) {
        if (needsHitl || unresolved > 0) {
          p.innerHTML =
            (status === "ESCALATED"
              ? "Finality review needed. "
              : "Near-finality / open contradictions. ") +
            '<span style="color:var(--risk)">contradiction_resolution</span> — ' +
            unresolved +
            " active blocker(s). Review to approve, defer, or enter a resolution.";
          attn.style.display = "";
        } else if (fin && status === "ACTIVE" && fin.goal_score < 0.92) {
          p.textContent =
            "Scope is active with score " +
            fin.goal_score +
            ". Upload documents or resolve drift to progress.";
          attn.style.display = "";
        } else {
          attn.style.display = "none";
        }
      }
    }

    if (activity && summary && Array.isArray(summary.what_changed)) {
      activity.innerHTML = "";
      summary.what_changed
        .slice(-6)
        .reverse()
        .forEach((ev) => {
          const ts = ev.ts ? new Date(ev.ts) : null;
          const time = ts
            ? ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
            : "—";
          const payload = ev.payload || {};
          const msg =
            ev.type +
            (payload.to ? ": " + payload.from + " → " + payload.to : "") +
            (payload.title ? " · " + payload.title : "");
          const row = document.createElement("div");
          row.className = "ev";
          row.innerHTML =
            '<span class="time">' +
            esc(time) +
            '</span><span class="txt">' +
            esc(msg) +
            "</span>";
          activity.appendChild(row);
        });
    }

    wireSidebarFocus(document.getElementById("sbBlockers"), window.__studioCy);
    wireSidebarFocus(document.getElementById("sbResolutions"), window.__studioCy);
    wireSidebarFocus(document.getElementById("sbNext"), window.__studioCy);
  }

  function wireSidebarFocus(container, graphInst) {
    if (!container || !graphInst || container.dataset.focusWired) return;
    container.dataset.focusWired = "1";
    container.addEventListener("click", (ev) => {
      const row = ev.target.closest("[data-node-id]");
      if (!row) return;
      const id = row.getAttribute("data-node-id");
      if (!id) return;
      const n = graphInst.getElementById(id);
      if (!n || n.empty()) return;
      graphInst.elements().removeClass("dim hi");
      const nbh = n.closedNeighborhood();
      graphInst.elements().difference(nbh).addClass("dim");
      nbh.addClass("hi");
      graphInst.animate(
        { center: { eles: n }, zoom: Math.max(graphInst.zoom(), 1) },
        { duration: 220, easing: "ease-out" },
      );
    });
  }

  function applyDebugPanels(summary) {
    if (!summary || !summary.finality) return;
    const fin = summary.finality;
    const scoreEl = document.querySelector(".debug-metrics .kv b");
    const dbgScore = document.querySelector(
      ".mode-pane.debug .dbg-card .kv b",
    );
    document.querySelectorAll(".mode-pane.debug .dbg-card")[0]
      ?.querySelectorAll(".kv b")
      .forEach((el, i) => {
        if (i === 0 && typeof fin.goal_score === "number")
          el.textContent = String(fin.goal_score);
      });
    const conv = fin.convergence || {};
    const cards = document.querySelectorAll(".mode-pane.debug .dbg-card");
    if (cards[0]) {
      const kvs = cards[0].querySelectorAll(".kv b");
      if (kvs[0] && typeof fin.goal_score === "number")
        kvs[0].textContent = String(fin.goal_score);
      if (kvs[1] && typeof conv.rate === "number")
        kvs[1].textContent = String(conv.rate);
      if (kvs[2] && conv.is_monotonic !== undefined)
        kvs[2].textContent = conv.is_monotonic ? "yes" : "no";
      if (kvs[3] && typeof conv.plateau_rounds === "number")
        kvs[3].textContent = String(conv.plateau_rounds);
    }
    if (cards[1] && fin.dimensions) {
      const dims = fin.dimensions;
      const bars = cards[1].querySelectorAll(".dim-bar");
      const labels = [
        ["claim_avg_confidence", dims.claim_avg_confidence],
        ["contradiction_resolution_ratio", dims.contradiction_resolution_ratio],
        ["goal_completion_ratio", dims.goal_completion_ratio],
        ["risk_score_inverse", dims.risk_score_inverse],
      ];
      bars.forEach((bar, i) => {
        const val = Number(labels[i]?.[1] ?? 0);
        const b = bar.querySelector(".head b");
        const fl = bar.querySelector(".fl");
        if (b) b.textContent = val.toFixed(2);
        if (fl) fl.style.width = Math.round(val * 100) + "%";
      });
    }
    const evPanel = document.querySelector(".debug-events");
    if (evPanel && Array.isArray(summary.what_changed)) {
      evPanel.innerHTML = "";
      summary.what_changed
        .slice(-8)
        .reverse()
        .forEach((ev) => {
          const ts = ev.ts ? new Date(ev.ts) : null;
          const t = ts
            ? ts.toLocaleTimeString([], { hour12: false })
            : "--:--:--";
          const payload = ev.payload || {};
          const ch = ev.type === "state_transition" ? "gov.t1" : ev.type;
          const msg =
            (payload.to ? payload.from + " → " + payload.to : ev.type) +
            (payload.scope_id ? " · scope=" + payload.scope_id : "");
          const line = document.createElement("div");
          line.className = "line";
          line.innerHTML =
            '<span class="t">' +
            esc(t) +
            '</span><span class="ch">' +
            esc(ch) +
            '</span><span class="msg">' +
            esc(msg) +
            "</span>";
          evPanel.appendChild(line);
        });
    }
  }

  async function refreshLiveUi(scopeId, mockNodes, mockEdges, layeredPositions) {
    const graph = await reloadGraph(
      scopeId,
      mockNodes,
      mockEdges,
      layeredPositions,
    );
    let summary = null;
    try {
      summary = await fetchSummary(scopeId);
    } catch (_e) {
      /* feed may be down */
    }
    try {
      const docPayload = await fetchScopeDocuments(scopeId);
      renderDocsList(docPayload.documents, docPayload.progress);
    } catch (_e) {
      renderDocsList([], null);
    }
    if (summary) {
      const sc = document.querySelector(".mode-pane.business .prg-compact .score");
      const st = document.querySelector(".mode-pane.business .prg-compact .state");
      if (sc && summary.finality) sc.textContent = String(summary.finality.goal_score);
      if (st && summary.finality) st.textContent = String(summary.finality.status);
      const pre = document.getElementById("studio-cp-json");
      const msg = document.getElementById("studio-cp-msg");
      if (pre) pre.textContent = JSON.stringify(summary, null, 2);
      if (msg) msg.textContent = "Live feed /summary for scope " + scopeId + ".";
      applyDebugPanels(summary);
      renderFinalizationReport(summary.finalization_report, summary.finality);
    }
    renderSidebarsFromGraph(graph.nodes, graph.edges, summary);
    return { graph, summary };
  }

  function renderFinalizationReport(report, finality) {
    const card = document.getElementById("finalReportCard");
    if (!card) return;
    const hasContent =
      report &&
      (report.narrative ||
        (Array.isArray(report.key_facts) && report.key_facts.length > 0) ||
        (Array.isArray(report.human_resolutions) &&
          report.human_resolutions.length > 0));
    const goalScore =
      finality && typeof finality.goal_score === "number"
        ? finality.goal_score
        : 0;
    const status = String(finality?.status || "").toUpperCase();
    const showReport =
      !!hasContent &&
      !!finality &&
      (finality.resolved ||
        status === "RESOLVED" ||
        status === "NEAR_FINALITY" ||
        status === "NEAR-FINALITY" ||
        status === "ESCALATED" ||
        goalScore >= 0.75);
    if (!showReport) {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    const title = card.querySelector(".final-report-title");
    const body = card.querySelector(".final-report-body");
    const lists = card.querySelector(".final-report-lists");
    if (title) title.textContent = report.headline || "Situation report";
    if (body) body.textContent = report.narrative || "";
    if (lists) {
      function listBlock(label, items) {
        if (!items || !items.length) return "";
        return (
          '<div class="final-report-list"><div class="h">' +
          esc(label) +
          " (" +
          items.length +
          ")</div><ul>" +
          items
            .slice(0, 8)
            .map((t) => "<li>" + esc(t) + "</li>")
            .join("") +
          "</ul></div>"
        );
      }
      lists.innerHTML =
        listBlock("Key facts", report.key_facts) +
        listBlock("Objectives", report.objectives) +
        listBlock("Open contradictions", report.open_contradictions) +
        listBlock("Risks", report.risks) +
        listBlock("Human resolutions", report.human_resolutions) +
        (report.next_steps
          ? '<div class="final-report-next">' + esc(report.next_steps) + "</div>"
          : "");
    }
  }

  async function switchScope(scopeId, catalog) {
    setScopeId(scopeId);
    window.__studioCatalog = catalog || window.__studioCatalog || [];
    const meta = (catalog || []).find((s) => s.id === scopeId);
    if (meta) updateScopeButton(meta);
    renderConfigureScopes(catalog || window.__studioCatalog || [], scopeId);
    renderDebugScopes(catalog || window.__studioCatalog || [], scopeId);
    setDocsStatus("", false);
    try {
      await fetch(
        baseUrl +
          "/studio/scopes/" +
          encodeURIComponent(scopeId) +
          "/activate",
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
      );
    } catch (_e) {
      /* hatchery may be down; still show graph */
    }
    await refreshLiveUi(
      scopeId,
      window.__studioMockNodes || [],
      window.__studioMockEdges || [],
      window.__studioLayeredPositions,
    );
  }

  function scopeMeta(scopeId) {
    const catalog = window.__studioCatalog || [];
    return catalog.find((s) => s.id === scopeId) || null;
  }

  function formatDocTime(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  async function fetchScopeDocuments(scopeId) {
    const res = await fetch(
      baseUrl +
        "/studio/scopes/" +
        encodeURIComponent(scopeId) +
        "/documents",
    );
    if (!res.ok) throw new Error("documents " + res.status);
    const data = await res.json();
    return {
      documents: Array.isArray(data.documents) ? data.documents : [],
      progress: data.progress || null,
    };
  }

  function docStatusLabel(status) {
    if (status === "processed") return "Done";
    if (status === "processing") return "Analyzing";
    if (status === "stalled") return "Stalled";
    return "Queued";
  }

  function renderDocProgress(progress) {
    const wrap = document.getElementById("docProgress");
    const label = document.getElementById("docProgressLabel");
    const pctEl = document.getElementById("docProgressPct");
    const fill = document.getElementById("docProgressFill");
    if (!wrap || !label || !pctEl || !fill) return;
    if (!progress || !progress.total) {
      wrap.hidden = true;
      return;
    }
    wrap.hidden = false;
    const total = Number(progress.total) || 0;
    const processed = Number(progress.processed) || 0;
    const processing = Number(progress.processing) || 0;
    const pending = Number(progress.pending) || 0;
    const stalled = Number(progress.stalled) || 0;
    const pct = total ? Math.round((processed / total) * 100) : 0;
    pctEl.textContent = pct + "%";
    label.textContent =
      processed +
      " / " +
      total +
      " analyzed" +
      (processing ? " · 1 in progress" : "") +
      (stalled ? " · " + stalled + " stalled" : "") +
      (pending ? " · " + pending + " queued" : "");
    fill.classList.remove("indeterminate");
    fill.style.width = pct + "%";
    if (processing && processed < total) {
      fill.classList.add("indeterminate");
    }
  }

  function renderDocsList(documents, progress) {
    const list = document.getElementById("docsList");
    if (!list) return;
    renderDocProgress(progress);
    if (!documents.length) {
      list.innerHTML =
        '<div class="sb-empty">No documents yet — add .txt, .pdf, or .docx to start analysis.</div>';
      return;
    }
    list.innerHTML = "";
    documents.forEach((doc) => {
      const status = doc.status || "pending";
      const row = document.createElement("div");
      row.className = "doc-row status-" + status;
      row.innerHTML =
        '<div class="t">' +
        esc(doc.title || "document") +
        '</div><div class="m">' +
        esc(formatDocTime(doc.ingested_at)) +
        '</div><div class="doc-status ' +
        esc(status) +
        '">' +
        esc(docStatusLabel(status)) +
        "</div>";
      list.appendChild(row);
    });
  }

  function setDocsStatus(message, isError) {
    const el = document.getElementById("docsStatus");
    if (!el) return;
    if (!message) {
      el.hidden = true;
      el.textContent = "";
      el.classList.remove("err");
      return;
    }
    el.hidden = false;
    el.textContent = message;
    el.classList.toggle("err", !!isError);
  }

  function openAddDocsModal() {
    const scopeId = currentScopeId();
    const meta = scopeMeta(scopeId);
    const modal = document.getElementById("addDocsModal");
    const label = document.getElementById("addDocsScopeLabel");
    const status = document.getElementById("addDocsSubmitStatus");
    if (label) {
      label.textContent =
        "Scope: " + (meta ? meta.name + " (" + scopeId + ")" : scopeId);
    }
    const fileInput = document.getElementById("addDocFiles");
    const titleInput = document.getElementById("addDocTitle");
    const bodyInput = document.getElementById("addDocBody");
    const corpusSelect = document.getElementById("addDocCorpus");
    if (fileInput) fileInput.value = "";
    if (titleInput) titleInput.value = "";
    if (bodyInput) bodyInput.value = "";
    if (corpusSelect) corpusSelect.value = "";
    if (status) status.textContent = "";
    if (modal) modal.hidden = false;
  }

  function closeAddDocsModal() {
    const modal = document.getElementById("addDocsModal");
    if (modal) modal.hidden = true;
  }

  async function submitAddDocs() {
    const scopeId = currentScopeId();
    const status = document.getElementById("addDocsSubmitStatus");
    const submitBtn = document.getElementById("addDocsModalSubmit");
    const corpus = document.getElementById("addDocCorpus")?.value || "";
    const fileInput = document.getElementById("addDocFiles");
    const title = document.getElementById("addDocTitle")?.value?.trim() || "";
    const body = document.getElementById("addDocBody")?.value?.trim() || "";

    const documents = [];
    if (fileInput && fileInput.files && fileInput.files.length > 0) {
      documents.push(...(await filesToDocuments(fileInput.files)));
    }
    if (title && body) {
      documents.push({ title, body });
    }

    if (!corpus && documents.length === 0) {
      if (status) {
        status.textContent =
          "Add at least one file, paste a document, or pick a demo corpus.";
        status.classList.add("err");
      }
      return;
    }

    if (submitBtn) submitBtn.disabled = true;
    if (status) {
      status.classList.remove("err");
      status.textContent = corpus
        ? "Loading corpus…"
        : "Uploading " + documents.length + " document(s)…";
    }

    try {
      let fed = 0;
      if (corpus) {
        const res = await fetch(
          baseUrl +
            "/studio/scopes/" +
            encodeURIComponent(scopeId) +
            "/load-corpus",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ corpus }),
          },
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || data.detail || "corpus " + res.status);
        }
        fed = Number(data.fed ?? data.documents?.length ?? 0);
      } else {
        const res = await fetch(
          baseUrl +
            "/studio/scopes/" +
            encodeURIComponent(scopeId) +
            "/documents",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ documents }),
          },
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || data.detail || "upload " + res.status);
        }
        fed = Number(data.fed ?? data.documents?.length ?? documents.length);
        if (Array.isArray(data.skipped) && data.skipped.length) {
          throw new Error(
            data.skipped
              .map((s) => (s.title || "doc") + ": " + (s.reason || "failed"))
              .join("; "),
          );
        }
      }

      closeAddDocsModal();
      setDocsStatus(
        fed +
          " document(s) queued for analysis. The graph will update as the swarm processes them.",
        false,
      );
      await refreshLiveUi(
        scopeId,
        window.__studioMockNodes || [],
        window.__studioMockEdges || [],
        window.__studioLayeredPositions,
      );
    } catch (e) {
      if (status) {
        status.textContent = String(e.message || e);
        status.classList.add("err");
      }
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  }

  function bindAddDocs() {
    document
      .getElementById("addDocsBtn")
      ?.addEventListener("click", () => openAddDocsModal());
    document
      .getElementById("addDocsModalCancel")
      ?.addEventListener("click", closeAddDocsModal);
    document.getElementById("addDocsModal")?.addEventListener("click", (e) => {
      if (e.target.id === "addDocsModal") closeAddDocsModal();
    });
    document
      .getElementById("addDocsModalSubmit")
      ?.addEventListener("click", () => {
        submitAddDocs().catch((e) => alert(String(e)));
      });
  }

  function openNewScopeModal() {
    const modal = document.getElementById("scopeModal");
    if (modal) modal.hidden = false;
  }

  function closeNewScopeModal() {
    const modal = document.getElementById("scopeModal");
    if (modal) modal.hidden = true;
  }

  async function submitNewScope() {
    const name = document.getElementById("newScopeName")?.value?.trim();
    const tag = document.getElementById("newScopeTag")?.value?.trim() || "custom";
    const corpus = document.getElementById("newScopeCorpus")?.value || "";
    const fileInput = document.getElementById("newScopeFiles");
    if (!name) {
      alert("Scope name is required.");
      return;
    }
    const id = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48);
    const createRes = await fetch(baseUrl + "/studio/scopes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, name, tag }),
    });
    if (!createRes.ok) {
      alert("Could not create scope: " + (await createRes.text()));
      return;
    }
    if (corpus) {
      await fetch(
        baseUrl +
          "/studio/scopes/" +
          encodeURIComponent(id) +
          "/load-corpus",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ corpus }),
        },
      );
    } else if (fileInput && fileInput.files && fileInput.files.length > 0) {
      const documents = await filesToDocuments(fileInput.files);
      await fetch(
        baseUrl +
          "/studio/scopes/" +
          encodeURIComponent(id) +
          "/documents",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ documents }),
        },
      );
    }
    closeNewScopeModal();
    const catalog = await fetchCatalog();
    renderCatalogMenu(catalog, id);
    await switchScope(id, catalog);
  }

  function bindModal() {
    document.getElementById("scopeModalClose")?.addEventListener("click", closeNewScopeModal);
    document.getElementById("scopeModalCancel")?.addEventListener("click", closeNewScopeModal);
    document.getElementById("scopeModalSubmit")?.addEventListener("click", () => {
      submitNewScope().catch((e) => alert(String(e)));
    });
    document.getElementById("scopeModal")?.addEventListener("click", (e) => {
      if (e.target.id === "scopeModal") closeNewScopeModal();
    });
  }

  function showConfigureSection(sectionId) {
    document.querySelectorAll(".cfg-nav .item[data-cfg]").forEach((item) => {
      item.classList.toggle("active", item.dataset.cfg === sectionId);
    });
    document.querySelectorAll(".cfg-section[data-cfg]").forEach((panel) => {
      panel.hidden = panel.dataset.cfg !== sectionId;
    });
  }

  function renderScopeResetList(listEl, catalog, activeScopeId) {
    if (!listEl) return;
    const active = (catalog || []).filter((s) => s.section !== "archived");
    if (!active.length) {
      listEl.innerHTML = '<div class="sb-empty">No scopes in catalog.</div>';
      return;
    }
    listEl.innerHTML = "";
    active.forEach((scope) => {
      const row = document.createElement("div");
      row.className =
        "cfg-scope-row" + (scope.id === activeScopeId ? " current" : "");
      row.innerHTML =
        '<div class="name"><b>' +
        esc(scope.name) +
        '</b><span>' +
        esc(scope.id) +
        '</span></div><div class="meta">' +
        esc(scope.tag || "scope") +
        " · score " +
        esc(String(scope.score ?? 0)) +
        '</div><button type="button" class="cfg-reset-one" data-scope-id="' +
        esc(scope.id) +
        '">Reset</button>';
      listEl.appendChild(row);
    });
    listEl.querySelectorAll(".cfg-reset-one").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-scope-id");
        if (id) resetStudioScope(id).catch((e) => alert(String(e)));
      });
    });
  }

  function renderConfigureScopes(catalog, activeScopeId) {
    const list = document.getElementById("cfgScopesList");
    const navCount = document.getElementById("cfgScopeNavCount");
    const hint = document.getElementById("cfgResetScopeHint");
    const active = (catalog || []).filter((s) => s.section !== "archived");
    if (navCount) navCount.textContent = String(active.length || "—");
    if (hint) {
      const meta = (catalog || []).find((s) => s.id === activeScopeId);
      hint.textContent =
        "Wipes graph, WAL, documents, and storage for " +
        (meta ? meta.name + " (" + activeScopeId + ")" : activeScopeId) +
        ". This cannot be undone.";
    }
    renderScopeResetList(list, catalog, activeScopeId);
  }

  function renderDebugScopes(catalog, activeScopeId) {
    renderScopeResetList(
      document.getElementById("dbgScopesList"),
      catalog,
      activeScopeId,
    );
  }

  function setScopeResetStatus(message, isError) {
    ["cfgResetStatus", "dbgResetStatus"].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = message || "";
      el.classList.toggle("err", !!isError);
    });
  }

  function setResetButtonsDisabled(disabled) {
    ["cfgResetScopeBtn", "dbgResetScopeBtn", "dbgResetAllBtn"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.disabled = disabled;
    });
    document.querySelectorAll(".cfg-reset-one").forEach((btn) => {
      btn.disabled = disabled;
    });
  }

  async function refreshAfterScopeDataChange(scopeId) {
    window.__studioNodes = [];
    window.__studioEdges = [];
    document.body.dataset.graphSource = "empty";
    const catalog = await fetchCatalog();
    window.__studioCatalog = catalog;
    const activeId = currentScopeId();
    renderCatalogMenu(catalog, activeId);
    renderConfigureScopes(catalog, activeId);
    renderDebugScopes(catalog, activeId);
    if (scopeId === activeId || scopeId === currentScopeId()) {
      setDocsStatus("", false);
      await refreshLiveUi(
        activeId,
        window.__studioMockNodes || [],
        window.__studioMockEdges || [],
        window.__studioLayeredPositions,
      );
      try {
        const docPayload = await fetchScopeDocuments(activeId);
        renderDocsList(docPayload.documents, docPayload.progress);
      } catch (_e) {
        renderDocsList([], null);
      }
    }
  }

  async function resetStudioScope(scopeId) {
    const meta = scopeMeta(scopeId);
    const label = meta ? meta.name + " (" + scopeId + ")" : scopeId;
    if (
      !confirm(
        "Reset scope " +
          label +
          "?\n\nThis deletes the graph, context WAL, uploaded documents, and scope storage. You will need to reload documents afterward.",
      )
    ) {
      return;
    }
    setResetButtonsDisabled(true);
    setScopeResetStatus("Resetting " + label + "…", false);
    try {
      const res = await fetch(
        baseUrl +
          "/studio/scopes/" +
          encodeURIComponent(scopeId) +
          "/reset",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      );
      if (!res.ok) {
        throw new Error(await res.text());
      }
      await fetch(
        baseUrl +
          "/studio/scopes/" +
          encodeURIComponent(scopeId) +
          "/activate",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      ).catch(() => {});
      await refreshAfterScopeDataChange(scopeId);
      setScopeResetStatus("Reset complete for " + label + ".", false);
    } catch (e) {
      setScopeResetStatus(String(e.message || e), true);
      throw e;
    } finally {
      setResetButtonsDisabled(false);
    }
  }

  async function resetAllStudioScopes() {
    if (
      !confirm(
        "Reset ALL scenario scopes?\n\nThis removes ephemeral test scopes and wipes Deal Horizon, Meridian, Insurance, Green Bond, and Basic Example. You will need to reload documents in each scope you use.",
      )
    ) {
      return;
    }
    setResetButtonsDisabled(true);
    setScopeResetStatus("Resetting all scenario scopes…", false);
    try {
      const res = await fetch(baseUrl + "/studio/scopes/reset-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!res.ok) {
        throw new Error(await res.text());
      }
      const data = await res.json();
      const activeId = currentScopeId();
      await fetch(
        baseUrl +
          "/studio/scopes/" +
          encodeURIComponent(activeId) +
          "/activate",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      ).catch(() => {});
      await refreshAfterScopeDataChange(activeId);
      const n = Array.isArray(data.reset_scopes) ? data.reset_scopes.length : 0;
      setScopeResetStatus(
        "Reset all complete (" + n + " scopes). Reload documents as needed.",
        false,
      );
    } catch (e) {
      setScopeResetStatus(String(e.message || e), true);
      throw e;
    } finally {
      setResetButtonsDisabled(false);
    }
  }

  function bindConfigurePanel() {
    document.querySelectorAll(".cfg-nav .item[data-cfg]").forEach((item) => {
      item.addEventListener("click", () => {
        showConfigureSection(item.dataset.cfg || "governance");
      });
    });
    document.getElementById("cfgResetScopeBtn")?.addEventListener("click", () => {
      resetStudioScope(currentScopeId()).catch((e) => alert(String(e)));
    });
  }

  function bindDebugPanel() {
    document.getElementById("dbgResetScopeBtn")?.addEventListener("click", () => {
      resetStudioScope(currentScopeId()).catch((e) => alert(String(e)));
    });
    document.getElementById("dbgResetAllBtn")?.addEventListener("click", () => {
      resetAllStudioScopes().catch((e) => alert(String(e)));
    });
  }

  /** @type {{ proposal_id: string, proposal: Record<string, unknown> } | null} */
  let pendingHitl = null;

  async function fetchPending(scopeId) {
    const res = await fetch(
      baseUrl + "/pending?scope_id=" + encodeURIComponent(scopeId),
    );
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.pending) ? data.pending : [];
  }

  function openHitlModal() {
    const modal = document.getElementById("hitlModal");
    if (modal) modal.hidden = false;
  }

  function closeHitlModal() {
    const modal = document.getElementById("hitlModal");
    if (modal) modal.hidden = true;
  }

  function renderHitlBlockers(payload) {
    const host = document.getElementById("hitlBlockers");
    if (!host) return;
    const blockers = Array.isArray(payload?.blockers) ? payload.blockers : [];
    if (!blockers.length) {
      host.innerHTML =
        '<div class="hitl-status">No structured blockers on this review. Enter a freeform resolution below.</div>';
      return;
    }
    host.innerHTML = "";
    blockers.slice(0, 8).forEach((b, idx) => {
      const title =
        b.dimension || b.label || b.summary || b.description || "Blocker " + (idx + 1);
      const meta = b.reason || b.detail || b.description || "";
      const choices = Array.isArray(b.choices) ? b.choices : [];
      const nodeIds = Array.isArray(b.node_ids)
        ? b.node_ids
        : b.node_id
          ? [b.node_id]
          : [];
      const card = document.createElement("div");
      card.className = "hitl-blocker";
      let choicesHtml = "";
      if (choices.length) {
        choicesHtml =
          '<div class="hb-choices">' +
          choices
            .map((c, ci) => {
              const label =
                typeof c === "string"
                  ? c
                  : c.label || c.text || c.choice || "Option " + (ci + 1);
              const ids = Array.isArray(c.node_ids)
                ? c.node_ids
                : nodeIds;
              return (
                '<button type="button" class="btn ghost hitl-choice" data-choice="' +
                esc(label) +
                '" data-node-ids="' +
                esc(ids.join(",")) +
                '">' +
                esc(label) +
                "</button>"
              );
            })
            .join("") +
          "</div>";
      }
      card.innerHTML =
        '<div class="hb-title">' +
        esc(String(title)) +
        '</div><div class="hb-meta">' +
        esc(String(meta).slice(0, 280)) +
        "</div>" +
        choicesHtml;
      host.appendChild(card);
    });
    host.querySelectorAll(".hitl-choice").forEach((btn) => {
      btn.addEventListener("click", () => {
        const text = btn.getAttribute("data-choice") || "";
        const ids = (btn.getAttribute("data-node-ids") || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        submitStudioResolution(text, ids).catch((e) => alert(String(e)));
      });
    });
  }

  async function openHitlReview() {
    const scopeId = currentScopeId();
    const statusEl = document.getElementById("hitlStatus");
    const textEl = document.getElementById("hitlResolutionText");
    if (textEl) textEl.value = "";
    openHitlModal();
    if (statusEl) {
      statusEl.className = "hitl-status";
      statusEl.textContent = "Loading pending review…";
    }
    try {
      const pending = await fetchPending(scopeId);
      const finality = pending.find((p) => {
        const prop = p.proposal || {};
        const payload = prop.payload || prop;
        return (
          prop.proposed_action === "finality_review" ||
          payload.type === "finality_review" ||
          String(p.proposal_id || "").startsWith("finality-")
        );
      });
      pendingHitl = finality || pending[0] || null;
      if (!pendingHitl) {
        if (statusEl) {
          statusEl.className = "hitl-status warn";
          statusEl.textContent =
            "No MITL pending review for this scope. You can still submit a resolution to mark contradictions resolved.";
        }
        renderHitlBlockers(null);
        return;
      }
      const payload =
        (pendingHitl.proposal && pendingHitl.proposal.payload) ||
        pendingHitl.proposal ||
        {};
      if (statusEl) {
        statusEl.className = "hitl-status";
        statusEl.textContent =
          "Pending: " +
          pendingHitl.proposal_id +
          (payload.goal_score != null
            ? " · score " + payload.goal_score
            : "");
      }
      renderHitlBlockers(payload);
    } catch (e) {
      if (statusEl) {
        statusEl.className = "hitl-status warn";
        statusEl.textContent = "Could not load pending: " + e;
      }
    }
  }

  async function postFinalityOption(option, days) {
    if (!pendingHitl || !pendingHitl.proposal_id) {
      throw new Error("No pending finality review to respond to");
    }
    const body = {
      scope_id: currentScopeId(),
      proposal_id: pendingHitl.proposal_id,
      option: option,
    };
    if (option === "defer") body.days = days != null ? days : 7;
    const res = await fetch(baseUrl + "/finality-response", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || "finality-response " + res.status);
    }
    pendingHitl = null;
    return data;
  }

  async function submitStudioResolution(text, nodeIds) {
    const decision = String(text || "").trim();
    if (!decision) {
      alert("Enter a resolution or choose an option.");
      return;
    }
    const scopeId = currentScopeId();
    const payload = {
      scope_id: scopeId,
      decision: decision,
      summary: decision.slice(0, 120),
      text: decision,
    };
    if (nodeIds && nodeIds.length) payload.node_ids = nodeIds;
    const res = await fetch(baseUrl + "/context/resolution", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || "resolution " + res.status);
    }
    if (pendingHitl && pendingHitl.proposal_id) {
      try {
        await postFinalityOption("provide_resolution", 7);
      } catch (_e) {
        /* resolution recorded even if MITL dismiss fails */
      }
    }
    closeHitlModal();
    await refreshLiveUi(
      scopeId,
      window.__studioMockNodes || [],
      window.__studioMockEdges || [],
      window.__studioLayeredPositions,
    );
  }

  async function hitlOption(option) {
    try {
      if (!pendingHitl) {
        const pending = await fetchPending(currentScopeId());
        pendingHitl = pending[0] || null;
      }
      await postFinalityOption(option, 7);
      closeHitlModal();
      await refreshLiveUi(
        currentScopeId(),
        window.__studioMockNodes || [],
        window.__studioMockEdges || [],
        window.__studioLayeredPositions,
      );
    } catch (e) {
      alert(String(e));
    }
  }

  function bindHitl() {
    document
      .getElementById("attnReviewBtn")
      ?.addEventListener("click", () => openHitlReview().catch((e) => alert(String(e))));
    document.getElementById("attnDeferBtn")?.addEventListener("click", () => {
      openHitlReview()
        .then(() => hitlOption("defer"))
        .catch((e) => alert(String(e)));
    });
    document
      .getElementById("hitlModalClose")
      ?.addEventListener("click", closeHitlModal);
    document.getElementById("hitlModal")?.addEventListener("click", (e) => {
      if (e.target.id === "hitlModal") closeHitlModal();
    });
    document
      .getElementById("hitlSubmitResolutionBtn")
      ?.addEventListener("click", () => {
        const text =
          document.getElementById("hitlResolutionText")?.value || "";
        submitStudioResolution(text).catch((e) => alert(String(e)));
      });
    document
      .getElementById("hitlApproveBtn")
      ?.addEventListener("click", () => hitlOption("approve_finality"));
    document
      .getElementById("hitlEscalateBtn")
      ?.addEventListener("click", () => hitlOption("escalate"));
    document
      .getElementById("hitlDeferBtn")
      ?.addEventListener("click", () => hitlOption("defer"));
  }

  document.addEventListener("studio:ready", async () => {
    bindModal();
    bindAddDocs();
    bindHitl();
    bindConfigurePanel();
    bindDebugPanel();
    bindEdgeToggleButton();
    window.__studioEdgesVisible = loadGraphEdgesVisiblePref();
    ensureGraphEdgeToggleHooks();
    const scopeId = currentScopeId();
    let catalog = [];
    try {
      catalog = await fetchCatalog();
      renderCatalogMenu(catalog, scopeId);
      const meta = catalog.find((s) => s.id === scopeId) || catalog[0];
      if (meta) updateScopeButton(meta);
      renderConfigureScopes(catalog, scopeId);
      renderDebugScopes(catalog, scopeId);
    } catch (e) {
      console.warn("studio catalog", e);
    }
    try {
      await fetch(
        baseUrl +
          "/studio/scopes/" +
          encodeURIComponent(scopeId) +
          "/activate",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      );
    } catch (_e) {
      /* hatchery may be down; still show graph */
    }
    await refreshLiveUi(
      scopeId,
      window.__studioMockNodes || [],
      window.__studioMockEdges || [],
      window.__studioLayeredPositions,
    );
    setInterval(() => {
      refreshLiveUi(
        currentScopeId(),
        window.__studioMockNodes || [],
        window.__studioMockEdges || [],
        window.__studioLayeredPositions,
      ).catch(() => {});
    }, 30000);
  });
})();
