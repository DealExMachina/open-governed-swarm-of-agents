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
    const payload = {
      nodes: JSON.parse(JSON.stringify(nodesPositioned)),
      edges: JSON.parse(JSON.stringify(edges)),
    };
    const layout = {
      name: "preset",
      positions: (node) => node.data("pos") || { x: 0, y: 0 },
      fit: true,
      padding: 44,
      animate: false,
    };
    cy.json({ elements: payload });
    cy.layout(layout).run();
    if (cyDbg) {
      cyDbg.json({ elements: JSON.parse(JSON.stringify(payload)) });
      cyDbg.layout(layout).run();
    }
    setTimeout(() => {
      cy.resize();
      cy.fit(null, 48);
      if (cyDbg) {
        cyDbg.resize();
        cyDbg.fit(null, 48);
      }
    }, 60);
    return { nodes, edges };
  }

  async function reloadGraph(scopeId, mockNodes, mockEdges, layeredPositions) {
    const cy = window.__studioCy;
    if (!cy) return { nodes: mockNodes, edges: mockEdges, live: false };
    let nodes = mockNodes;
    let edges = mockEdges;
    let live = false;
    try {
      const liveData = await fetchGraph(scopeId);
      if (liveData.nodes && liveData.nodes.length > 0) {
        nodes = liveData.nodes;
        edges = liveData.edges || [];
        live = true;
        document.body.dataset.graphSource = "live";
      } else {
        document.body.dataset.graphSource = "mock";
      }
    } catch (_e) {
      document.body.dataset.graphSource = "mock";
    }
    applyGraphToCy(cy, window.__studioCyDbg, nodes, edges, layeredPositions);
    window.__studioNodes = nodes;
    window.__studioEdges = edges;
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
      const unresolved = blockers.filter((b) => b.data.veto).length;
      const fin = summary && summary.finality;
      if (p) {
        if (unresolved > 0) {
          p.innerHTML =
            'Near-finality reached but <span style="color:var(--risk)">contradiction_resolution</span> is below veto threshold. ' +
            unresolved +
            " blocking contradiction(s) remain.";
          attn.style.display = "";
        } else if (fin && fin.status === "ACTIVE" && fin.goal_score < 0.92) {
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
    }
    renderSidebarsFromGraph(graph.nodes, graph.edges, summary);
    return { graph, summary };
  }

  async function switchScope(scopeId, catalog) {
    setScopeId(scopeId);
    const meta = (catalog || []).find((s) => s.id === scopeId);
    if (meta) updateScopeButton(meta);
    await refreshLiveUi(
      scopeId,
      window.__studioMockNodes || [],
      window.__studioMockEdges || [],
      window.__studioLayeredPositions,
    );
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
      const documents = [];
      for (const file of fileInput.files) {
        documents.push({
          title: file.name.replace(/\.txt$/i, ""),
          body: await file.text(),
        });
      }
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

  document.addEventListener("studio:ready", async () => {
    bindModal();
    const scopeId = currentScopeId();
    let catalog = [];
    try {
      catalog = await fetchCatalog();
      renderCatalogMenu(catalog, scopeId);
      const meta = catalog.find((s) => s.id === scopeId) || catalog[0];
      if (meta) updateScopeButton(meta);
    } catch (e) {
      console.warn("studio catalog", e);
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
