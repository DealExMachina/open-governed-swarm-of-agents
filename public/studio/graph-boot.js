      /* ═══════════════ Scope selector ═══════════════ */
      const scopeBtn = document.getElementById("scopeBtn");
      const scopeMenu = document.getElementById("scopeMenu");
      scopeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        scopeMenu.hidden = !scopeMenu.hidden;
      });
      document.addEventListener("click", (e) => {
        if (!scopeMenu.contains(e.target)) scopeMenu.hidden = true;
      });

      /* ═══════════════ Mode switcher ═══════════════ */
      document.querySelectorAll(".mode-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          document
            .querySelectorAll(".mode-btn")
            .forEach((b) => b.classList.remove("active"));
          btn.classList.add("active");
          document.body.dataset.mode = btn.dataset.mode;
          // refit graph on mode swap
          setTimeout(() => {
            if (btn.dataset.mode === "business") cy && cy.resize() && cy.fit(null, 50);
            if (btn.dataset.mode === "debug") cyDbg && cyDbg.resize() && cyDbg.fit(null, 50);
          }, 80);
        });
      });

      let cy, cyDbg;

      /* ═══════════════ Graph: live feed or demo fallback ═══════════════ */
      (async function initStudioGraph() {
      const MOCK_MA_NODES = [
        { data: { id: "doc-1", label: "Analyst Briefing", type: "doc", info: { subtitle: "doc · 2026-03-01 · 3 claims", desc: "Initial profile · ARR €50M · CAGR 45% · 7 patents" } } },
        { data: { id: "doc-2", label: "Financial DD", type: "doc", info: { subtitle: "doc · 2026-03-18 · 5 claims", desc: "ARR €38M · 2 patents disputed · drift high vs doc-1" } } },
        { data: { id: "doc-3", label: "Technical", type: "doc", info: { subtitle: "doc · 2026-03-26 · 4 claims", desc: "Core tech solid · CTO + 2 seniors departing" } } },
        { data: { id: "doc-4", label: "Market Intel", type: "doc", info: { subtitle: "doc · 2026-04-04 · 3 claims", desc: "Patent suit · top client evaluating alternatives" } } },
        { data: { id: "doc-5", label: "Legal Review", type: "doc", info: { subtitle: "doc · 2026-04-11 · 4 claims", desc: "IP risks manageable · price band €270–290M" } } },

        { data: { id: "c-arr-50", label: "ARR €50M", type: "claim", conf: 0.82, stale: true, info: { subtitle: "claim · stale · superseded 2026-03-18", desc: "From doc-1 · conf 0.82 · superseded by c-arr-38" } } },
        { data: { id: "c-arr-38", label: "ARR €38M", type: "claim", conf: 0.94, info: { subtitle: "claim · current", desc: "From doc-2 · conf 0.94 · supports r-overstate" } } },
        { data: { id: "c-cagr", label: "CAGR 45%", type: "claim", conf: 0.70, info: { subtitle: "claim · current", desc: "From doc-1 · conf 0.70 · no corroboration yet" } } },
        { data: { id: "c-patents-7", label: "7 patents", type: "claim", conf: 0.78, info: { subtitle: "claim · qualified", desc: "From doc-1 · conf 0.78 · 2 disputed per doc-2" } } },
        { data: { id: "c-patents-disp", label: "2 disputed", type: "claim", conf: 0.89, info: { subtitle: "claim · current", desc: "From doc-2 · conf 0.89 · qualifies c-patents-7" } } },
        { data: { id: "c-cto", label: "CTO departing", type: "claim", conf: 0.86, info: { subtitle: "claim · current", desc: "From doc-3 · conf 0.86 · supports r-talent" } } },
        { data: { id: "c-client", label: "Client evaluating alt.", type: "claim", conf: 0.74, info: { subtitle: "claim · current", desc: "From doc-4 · conf 0.74 · supports r-concent" } } },
        { data: { id: "c-ip-ok", label: "IP risks manageable", type: "claim", conf: 0.81, info: { subtitle: "claim · current", desc: "From doc-5 · conf 0.81 · supports g-signoff" } } },

        { data: { id: "x-arr", label: "ARR conflict", type: "contradiction", veto: true, resolved: false, info: { subtitle: "contradiction · unresolved · VETO", desc: "€50M (doc-1) ↔ €38M (doc-2) · valid-time overlap · blocks goal · Price band" } } },
        { data: { id: "x-risk", label: "'low risk' qualified", type: "contradiction", veto: false, resolved: true, info: { subtitle: "contradiction · resolved · soft", desc: "doc-1 qualifier reconciled with docs 2–4 · resolved via MITL" } } },

        { data: { id: "res-lowrisk", label: "Risk framing memo", type: "resolution", info: { subtitle: "resolution · MITL · policy v3.2.1", desc: "Reviewer aligned early \"low risk\" wording with subsequent diligence.", resolvedBy: "j.baptiste", resolvedAt: "2026-04-28 09:40 UTC", method: "MITL", targetsContradiction: "x-risk" } } },

        { data: { id: "r-overstate", label: "Overstatement", type: "risk", info: { subtitle: "risk · high", desc: "Financial overstatement · supported by c-arr-38" } } },
        { data: { id: "r-talent", label: "Talent flight", type: "risk", info: { subtitle: "risk · medium", desc: "Key talent departure · supported by c-cto" } } },
        { data: { id: "r-ip", label: "IP disputes", type: "risk", info: { subtitle: "risk · medium", desc: "Patent ownership · supported by c-patents-disp" } } },
        { data: { id: "r-concent", label: "Client concentration", type: "risk", info: { subtitle: "risk · medium", desc: "Top-client churn · supported by c-client" } } },

        { data: { id: "g-price", label: "Price €270–290M", type: "goal", info: { subtitle: "goal · blocked by ARR conflict", desc: "Acquisition price band · refs r-overstate, c-arr-38" } } },
        { data: { id: "g-complete", label: "DD complete", type: "goal", info: { subtitle: "goal · active", desc: "Full due-diligence closure" } } },
        { data: { id: "g-signoff", label: "Legal sign-off", type: "goal", info: { subtitle: "goal · 81% complete", desc: "Legal recommendation · refs c-ip-ok, r-ip" } } },
      ];

      const MOCK_MA_EDGES = [
        { data: { source: "doc-1", target: "c-arr-50", type: "refers" } },
        { data: { source: "doc-1", target: "c-cagr", type: "refers" } },
        { data: { source: "doc-1", target: "c-patents-7", type: "refers" } },
        { data: { source: "doc-2", target: "c-arr-38", type: "refers" } },
        { data: { source: "doc-2", target: "c-patents-disp", type: "refers" } },
        { data: { source: "doc-3", target: "c-cto", type: "refers" } },
        { data: { source: "doc-4", target: "c-client", type: "refers" } },
        { data: { source: "doc-5", target: "c-ip-ok", type: "refers" } },

        { data: { source: "x-arr", target: "c-arr-50", type: "contradicts" } },
        { data: { source: "x-arr", target: "c-arr-38", type: "contradicts" } },
        { data: { source: "x-risk", target: "c-cto", type: "contradicts" } },
        { data: { source: "x-risk", target: "c-client", type: "contradicts" } },

        { data: { source: "res-lowrisk", target: "x-risk", type: "resolves" } },

        { data: { source: "c-arr-38", target: "r-overstate", type: "supports" } },
        { data: { source: "c-cto", target: "r-talent", type: "supports" } },
        { data: { source: "c-patents-disp", target: "r-ip", type: "supports" } },
        { data: { source: "c-client", target: "r-concent", type: "supports" } },

        { data: { source: "r-overstate", target: "g-price", type: "refers" } },
        { data: { source: "r-ip", target: "g-signoff", type: "refers" } },
        { data: { source: "c-ip-ok", target: "g-signoff", type: "supports" } },
        { data: { source: "c-arr-38", target: "g-price", type: "supports" } },
      ];

      const MOCK_BASIC_NODES = [
        { data: { id: "doc-b1", label: "Company Overview", type: "doc", info: { subtitle: "doc · Acme Widgets", desc: "FY2024 revenue EUR 12M · 85 employees · Lyon HQ" } } },
        { data: { id: "doc-b2", label: "Operating Metrics", type: "doc", info: { subtitle: "doc · Q1 2025", desc: "Run-rate EUR 13.2M vs EUR 12M annual — reconcile baseline" } } },
        { data: { id: "c-rev-12", label: "Revenue EUR 12M", type: "claim", conf: 0.88, info: { subtitle: "claim · audited FY2024", desc: "From company overview" } } },
        { data: { id: "c-rev-13", label: "Run-rate EUR 13.2M", type: "claim", conf: 0.76, info: { subtitle: "claim · forecast", desc: "From operating metrics deck" } } },
        { data: { id: "x-rev", label: "Revenue baseline", type: "contradiction", veto: false, resolved: false, info: { subtitle: "contradiction · open · soft", desc: "Annual vs run-rate figures need reconciliation" } } },
        { data: { id: "g-onboard", label: "Onboarding checklist", type: "goal", info: { subtitle: "goal · active", desc: "Close supplier onboarding review" } } },
        { data: { id: "r-supplier", label: "Single-source supplier", type: "risk", info: { subtitle: "risk · medium", desc: "Chip supplier concentration for smart desk mats" } } },
      ];

      const MOCK_BASIC_EDGES = [
        { data: { source: "doc-b1", target: "c-rev-12", type: "refers" } },
        { data: { source: "doc-b2", target: "c-rev-13", type: "refers" } },
        { data: { source: "x-rev", target: "c-rev-12", type: "contradicts" } },
        { data: { source: "x-rev", target: "c-rev-13", type: "contradicts" } },
        { data: { source: "c-rev-12", target: "g-onboard", type: "supports" } },
        { data: { source: "r-supplier", target: "g-onboard", type: "refers" } },
      ];

      let nodes = MOCK_BASIC_NODES;
      let edges = MOCK_BASIC_EDGES;
      const studioCfg = window.STUDIO_CONTROL || {};
      try {
        const raw = localStorage.getItem("studio_edges_visible");
        window.__studioEdgesVisible =
          raw === "0" || raw === "false" ? false : true;
      } catch (_prefErr) {
        window.__studioEdgesVisible = true;
      }
      const studioScope = studioCfg.scopeId || "default";
      const studioBase = String(
        studioCfg.baseUrl || "http://127.0.0.1:3002",
      ).replace(/\/$/, "");
      try {
        const liveUrl =
          studioBase +
          "/studio/elements?scope_id=" +
          encodeURIComponent(studioScope);
        const liveRes = await fetch(liveUrl);
        if (liveRes.ok) {
          const live = await liveRes.json();
          if (live.nodes && live.nodes.length > 0) {
            nodes = live.nodes;
            edges = live.edges || [];
            document.body.dataset.graphSource = "live";
          } else if (studioScope === "deal-horizon") {
            nodes = MOCK_MA_NODES;
            edges = MOCK_MA_EDGES;
            document.body.dataset.graphSource = "mock-ma";
          } else if (studioScope === "default") {
            nodes = MOCK_BASIC_NODES;
            edges = MOCK_BASIC_EDGES;
            document.body.dataset.graphSource = "mock-basic";
          } else {
            nodes = [];
            edges = [];
            document.body.dataset.graphSource = "empty";
          }
        }
      } catch (_err) {
        if (studioScope === "deal-horizon") {
          nodes = MOCK_MA_NODES;
          edges = MOCK_MA_EDGES;
          document.body.dataset.graphSource = "mock-ma";
        } else if (studioScope === "default") {
          nodes = MOCK_BASIC_NODES;
          edges = MOCK_BASIC_EDGES;
          document.body.dataset.graphSource = "mock-basic";
        } else {
          nodes = [];
          edges = [];
          document.body.dataset.graphSource = "empty";
        }
      }

      /* ═══════════════ Deterministic layered positions (no overlap) ═══════════════ */
      function layeredPositions(nodesArr) {
        const byId = {};
        const left = 52;
        const docYs = 48;
        const claimY = 158;
        const contraY = 288;
        const resY = 412;
        const riskY = 532;
        const goalY = 652;

        const docs = nodesArr.filter((n) => n.data.type === "doc");
        const spread = 148;
        docs.forEach((n, i) => {
          byId[n.data.id] = { x: left + i * spread, y: docYs };
        });

        const claims = nodesArr.filter((n) => n.data.type === "claim");
        const cs = 94;
        claims.forEach((n, i) => {
          byId[n.data.id] = { x: left + 18 + i * cs, y: claimY };
        });

        const contras = nodesArr.filter((n) => n.data.type === "contradiction");
        contras.forEach((n, i) => {
          byId[n.data.id] = { x: left + 80 + i * 180, y: contraY };
        });

        nodesArr
          .filter((n) => n.data.type === "resolution")
          .forEach((n) => {
            byId[n.data.id] = { x: left + 560, y: resY };
          });

        const risks = nodesArr.filter((n) => n.data.type === "risk");
        risks.forEach((n, i) => {
          byId[n.data.id] = { x: left + 28 + i * 142, y: riskY };
        });

        const goals = nodesArr.filter((n) => n.data.type === "goal");
        goals.forEach((n, i) => {
          byId[n.data.id] = { x: left + 120 + i * 168, y: goalY };
        });

        return byId;
      }

      const posMap = layeredPositions(nodes);
      const nodesPositioned = nodes.map((n) => ({
        data: { ...n.data, pos: posMap[n.data.id] },
      }));

      /* ═══════════════ Cytoscape shared stylesheet ═══════════════ */
      const cyStyle = [
        {
          selector: "node",
          style: {
            label: "data(label)",
            color: "#c9cdd6",
            "font-family": "Inter, sans-serif",
            "font-size": 10,
            "font-weight": 500,
            "text-valign": "bottom",
            "text-margin-y": 6,
            "text-wrap": "wrap",
            "text-max-width": 88,
            "text-outline-color": "#0b0c0f",
            "text-outline-width": 2,
            "border-width": 1,
            "border-color": "#363b47",
            "text-opacity": 0,
            "transition-property": "opacity, border-color, background-color",
            "transition-duration": "140ms",
            "transition-timing-function": "ease-out",
          },
        },
        {
          selector: 'node[type="doc"]',
          style: {
            shape: "round-rectangle",
            "background-color": "#12141a",
            "border-color": "#7a7f8b",
            "border-width": 1,
            width: 28,
            height: 28,
            color: "#9aa0ac",
          },
        },
        {
          selector: 'node[type="claim"]',
          style: {
            shape: "ellipse",
            "background-color": "#3e6b93",
            "border-color": "#6aa6d6",
            "border-width": 1.5,
            width: 26,
            height: 26,
          },
        },
        {
          selector: 'node[type="claim"][?stale]',
          style: {
            "background-color": "#1b1e25",
            "border-color": "#6aa6d6",
            "border-style": "dashed",
          },
        },
        {
          selector: 'node[type="contradiction"]',
          style: {
            shape: "diamond",
            "background-color": "#12141a",
            "border-color": "#d97a6c",
            "border-width": 2,
            width: 32,
            height: 32,
          },
        },
        {
          selector: 'node[type="contradiction"][?resolved]',
          style: {
            opacity: 0.52,
            "border-color": "#5a9468",
            "border-width": 1.5,
            "border-style": "solid",
          },
        },
        {
          selector: 'node[type="resolution"]',
          style: {
            shape: "round-rectangle",
            "background-color": "#141a17",
            "border-color": "#7fb98b",
            "border-width": 1.75,
            width: 30,
            height: 30,
          },
        },
        {
          selector: 'node[type="risk"]',
          style: {
            shape: "round-diamond",
            "background-color": "#12141a",
            "border-color": "#e8b765",
            "border-width": 1.5,
            width: 30,
            height: 30,
          },
        },
        {
          selector: 'node[type="goal"]',
          style: {
            shape: "round-hexagon",
            "background-color": "#12141a",
            "border-color": "#7fb98b",
            "border-width": 1.5,
            width: 32,
            height: 32,
          },
        },
        {
          selector: "edge",
          style: {
            width: 0.65,
            "curve-style": "bezier",
            "target-arrow-shape": "triangle",
            "arrow-scale": 0.5,
            "line-color": "#4a5c6e",
            "target-arrow-color": "#5a6c7e",
            opacity: 0.38,
            "transition-property": "opacity, line-color, width",
            "transition-duration": "140ms",
          },
        },
        {
          selector: 'edge[type="supports"]',
          style: {
            "line-color": "#4a5c6e",
            "target-arrow-color": "#5a6c7e",
            width: 0.65,
            opacity: 0.38,
          },
        },
        {
          selector: 'edge[type="contradicts"]',
          style: {
            "line-color": "#d97a6c",
            "target-arrow-color": "#d97a6c",
            "line-style": "dashed",
            width: 1,
            opacity: 0.82,
            "arrow-scale": 0.65,
          },
        },
        {
          selector: 'edge[type="refers"]',
          style: {
            "line-color": "#4a5c6e",
            "target-arrow-color": "#5a6c7e",
            width: 0.65,
            opacity: 0.34,
          },
        },
        {
          selector: 'edge[type="resolves"]',
          style: {
            "line-color": "#4a5c6e",
            "target-arrow-color": "#5a6c7e",
            "line-style": "solid",
            width: 0.65,
            opacity: 0.38,
          },
        },
        {
          selector: ".show-label",
          style: { "text-opacity": 1 },
        },
        {
          selector: "node.dim",
          style: {
            opacity: 0.12,
          },
        },
        {
          selector: "node.hi",
          style: {
            opacity: 1,
            "border-color": "#ff7a1a",
            "border-width": 2,
          },
        },
        {
          selector: "edge.hi:not(.edges-hidden)",
          style: {
            "line-color": "#ff7a1a",
            "target-arrow-color": "#ff7a1a",
            width: 1.5,
            opacity: 1,
          },
        },
        {
          selector:
            'edge.edges-hidden, edge.edges-hidden[type="supports"], edge.edges-hidden[type="contradicts"], edge.edges-hidden[type="refers"], edge.edges-hidden[type="resolves"], edge.edges-hidden.hi',
          style: {
            display: "none",
            opacity: 0,
            width: 0,
            "line-color": "transparent",
            "target-arrow-color": "transparent",
            "target-arrow-shape": "none",
            "events": "no",
          },
        },
      ];

      const presetLayout = {
        name: "preset",
        positions: (node) => node.data("pos") || { x: 0, y: 0 },
        fit: true,
        padding: 44,
        animate: false,
      };

      const elementsPayload = {
        nodes: JSON.parse(JSON.stringify(nodesPositioned)),
        edges: JSON.parse(JSON.stringify(edges)),
      };

      /* ═══════════════ Init cy (Business) ═══════════════ */
      cy = cytoscape({
        container: document.getElementById("cy"),
        elements: elementsPayload,
        minZoom: 0.35,
        maxZoom: 2.4,
        wheelSensitivity: 0.22,
        style: cyStyle,
        layout: presetLayout,
      });

      /* ═══════════════ Init cy (Debug — same positions) ═══════════════ */
      cyDbg = cytoscape({
        container: document.getElementById("cyDbg"),
        elements: JSON.parse(JSON.stringify(elementsPayload)),
        minZoom: 0.35,
        maxZoom: 2.4,
        wheelSensitivity: 0.22,
        style: cyStyle,
        layout: presetLayout,
      });

      /* ═══════════════ Debug only: zoom-tier labels (Business stays hover-only) ═══════════════ */
      function updateLabelsDbg(inst) {
        const z = inst.zoom();
        inst.batch(() => {
          inst.nodes().removeClass("show-label");
          if (z < 0.65) {
            inst.nodes('[type="contradiction"], [type="risk"], [type="resolution"]').addClass("show-label");
          } else if (z < 1.05) {
            inst
              .nodes('[type="contradiction"], [type="risk"], [type="resolution"], [type="doc"], [type="goal"]')
              .addClass("show-label");
          } else {
            inst.nodes().addClass("show-label");
          }
        });
      }

      function bindZoomDbg(inst) {
        inst.on("zoom", () => updateLabelsDbg(inst));
        inst.ready(() => updateLabelsDbg(inst));
      }

      cy.on("zoom", () => {
        document.getElementById("zoomLvl").textContent =
          Math.round(cy.zoom() * 100) + "%";
      });
      cy.ready(() => {
        document.getElementById("zoomLvl").textContent =
          Math.round(cy.zoom() * 100) + "%";
      });

      bindZoomDbg(cyDbg);

      function esc(s) {
        return String(s || "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");
      }

      /* ═══════════════ Hover: dim + tooltip (detail lives here) ═══════════════ */
      function studioLinksVisible() {
        return window.__studioEdgesVisible !== false;
      }

      function highlightGraphNeighborhood(inst, n) {
        const nbh = n.closedNeighborhood();
        inst.nodes().difference(nbh.nodes()).addClass("dim");
        nbh.nodes().addClass("hi");
        if (studioLinksVisible()) {
          nbh.edges().addClass("hi");
        }
      }

      function clearGraphHighlight(inst) {
        inst.nodes().removeClass("dim hi");
        inst.edges().removeClass("hi");
        if (window.__studioApplyEdgeVisibility) {
          window.__studioApplyEdgeVisibility(inst);
        }
      }

      function bindHover(inst, wrap, ttEl) {
        inst.on("mouseover", "node", (e) => {
          const n = e.target;
          highlightGraphNeighborhood(inst, n);
          const info = n.data("info") || {};
          const type = n.data("type");
          let tag = "";
          if (type === "contradiction") {
            if (n.data("resolved")) {
              tag = '<span class="tag resolution">resolved</span>';
            } else if (n.data("veto")) {
              tag = '<span class="tag risk">VETO</span>';
            } else {
              tag = '<span class="tag warn">soft</span>';
            }
          } else if (type === "risk") {
            tag = '<span class="tag warn">risk</span>';
          } else if (type === "claim" && n.data("stale")) {
            tag = '<span class="tag stale">stale</span>';
          } else if (type === "claim") {
            tag = '<span class="tag info">claim</span>';
          } else if (type === "goal") {
            tag = '<span class="tag info">goal</span>';
          } else if (type === "doc") {
            tag = '<span class="tag info">doc</span>';
          } else if (type === "resolution") {
            tag = '<span class="tag resolution">resolution</span>';
          }
          let meta =
            '<div class="m">' +
            esc(info.subtitle || "") +
            "<br>" +
            esc(info.desc || "") +
            "</div>";
          if (type === "resolution") {
            meta +=
              '<div class="m" style="margin-top:6px">' +
              '<span class="k">By</span> <b>' +
              esc(info.resolvedBy || "—") +
              "</b><br>" +
              '<span class="k">' +
              esc(info.method || "") +
              "</span> · <b>" +
              esc(info.resolvedAt || "") +
              "</b></div>";
          }
          ttEl.innerHTML =
            '<div class="t">' + tag + esc(n.data("label") || "") + "</div>" + meta;
          const pos = n.renderedPosition();
          ttEl.style.left = pos.x + "px";
          ttEl.style.top = pos.y + "px";
          ttEl.classList.add("show");
        });
        inst.on("mouseout", "node", () => {
          clearGraphHighlight(inst);
          ttEl.classList.remove("show");
        });
        inst.on("pan zoom", () => {
          ttEl.classList.remove("show");
        });
      }
      bindHover(cy, document.getElementById("graphWrap"), document.getElementById("tt"));
      bindHover(cyDbg, document.getElementById("graphWrapDbg"), document.getElementById("ttDbg"));

      /* ═══════════════ Focus node from sidebar ═══════════════ */
      function focusInGraph(inst, id) {
        const n = inst.getElementById(id);
        if (!n || n.empty()) return;
        clearGraphHighlight(inst);
        highlightGraphNeighborhood(inst, n);
        const z = Math.max(inst.zoom(), 1);
        inst.animate(
          { center: { eles: n }, zoom: z },
          { duration: 220, easing: "ease-out" },
        );
      }

      function wireSidebarFocus(container, graphInst) {
        container.addEventListener("click", (ev) => {
          const row = ev.target.closest("[data-node-id]");
          if (!row) return;
          const id = row.getAttribute("data-node-id");
          if (id) focusInGraph(graphInst, id);
        });
      }

      /* ═══════════════ Populate sidebars from mock graph ═══════════════ */
      function renderSidebars() {
        const sbBlockers = document.getElementById("sbBlockers");
        const sbResolutions = document.getElementById("sbResolutions");
        const sbNext = document.getElementById("sbNext");

        const blockers = nodes.filter(
          (n) => n.data.type === "contradiction" && !n.data.resolved,
        );
        if (!blockers.length) {
          sbBlockers.innerHTML =
            '<div class="sb-empty">No active blockers</div>';
        } else {
          sbBlockers.innerHTML = "";
          blockers.forEach((n) => {
            const d = n.data;
            const row = document.createElement("div");
            row.className = "sb-row blocker focusable";
            row.dataset.nodeId = d.id;
            const pill = d.veto
              ? '<span class="pill veto">VETO</span>'
              : '<span class="pill" style="background:rgba(232,183,101,.15);color:var(--amber)">soft</span>';
            row.innerHTML =
              "<div class=\"sb-title\">" +
              pill +
              esc(d.label) +
              '</div><div class="sb-meta">' +
              esc((d.info && d.info.desc) || "") +
              "</div>";
            sbBlockers.appendChild(row);
          });
        }

        const resolutions = nodes.filter((n) => n.data.type === "resolution");
        if (!resolutions.length) {
          sbResolutions.innerHTML =
            '<div class="sb-empty">No resolutions recorded</div>';
        } else {
          sbResolutions.innerHTML = "";
          resolutions.forEach((n) => {
            const d = n.data;
            const info = d.info || {};
            const edge = edges.find(
              (e) =>
                e.data.source === d.id && e.data.type === "resolves",
            );
            const contraId = edge ? edge.data.target : "";
            const contraNode = nodes.find((x) => x.data.id === contraId);
            const contraLabel = contraNode
              ? contraNode.data.label
              : contraId;
            const row = document.createElement("div");
            row.className = "sb-row resolution focusable";
            row.dataset.nodeId = d.id;
            row.innerHTML =
              '<div class="sb-title">' +
              esc(d.label) +
              '</div><div class="sb-meta">Contradiction · ' +
              esc(contraLabel) +
              "<br>" +
              esc(info.method || "") +
              " · " +
              esc(info.resolvedBy || "") +
              " · " +
              esc(info.resolvedAt || "") +
              "</div>";
            sbResolutions.appendChild(row);
          });
        }

        const nextLines = [
          {
            id: "x-arr",
            title: "Reconcile ARR figures",
            meta: "VETO blocks contradiction_resolution · goal Price €270–290M held",
          },
          {
            id: "g-price",
            title: "Complete MITL review queue",
            meta: "Open review tied to near-finality gate",
          },
          {
            id: "doc-2",
            title: "Optional: attach Finance signed memo",
            meta: "Counters ARR narrative for audit trail",
          },
        ];
        sbNext.innerHTML = "";
        nextLines.forEach((line) => {
          const row = document.createElement("div");
          row.className = "sb-row next focusable";
          row.dataset.nodeId = line.id;
          row.innerHTML =
            '<div class="sb-title">' +
            esc(line.title) +
            '</div><div class="sb-meta">' +
            esc(line.meta) +
            "</div>";
          sbNext.appendChild(row);
        });
      }

      renderSidebars();
      wireSidebarFocus(document.getElementById("sbBlockers"), cy);
      wireSidebarFocus(document.getElementById("sbResolutions"), cy);
      wireSidebarFocus(document.getElementById("sbNext"), cy);

      window.__studioCy = cy;
      window.__studioCyDbg = cyDbg;
      window.__studioMockMaNodes = MOCK_MA_NODES;
      window.__studioMockMaEdges = MOCK_MA_EDGES;
      window.__studioMockBasicNodes = MOCK_BASIC_NODES;
      window.__studioMockBasicEdges = MOCK_BASIC_EDGES;
      window.__studioMockNodes = MOCK_MA_NODES;
      window.__studioMockEdges = MOCK_MA_EDGES;
      window.__studioLayeredPositions = layeredPositions;
      window.__studioNodes = nodes;
      window.__studioEdges = edges;
      document.dispatchEvent(new CustomEvent("studio:ready"));

      cy.ready(() => {
        setTimeout(() => cy.fit(null, 48), 40);
      });
      cyDbg.ready(() => {
        setTimeout(() => cyDbg.fit(null, 48), 40);
      });

      window.addEventListener("resize", () => {
        cy.resize();
        cyDbg.resize();
      });

      (function wireStudioControlPlane() {
        const cfg = window.STUDIO_CONTROL || {};
        const msg = document.getElementById("studio-cp-msg");
        const pre = document.getElementById("studio-cp-json");
        if (!msg || !pre) return;

        function applySummary(s) {
          var el = document.querySelector(
            ".mode-pane.business .prg-compact .state",
          );
          if (el && s.finality && s.finality.status)
            el.textContent = String(s.finality.status);
          var sc = document.querySelector(
            ".mode-pane.business .prg-compact .score",
          );
          if (sc && s.finality && typeof s.finality.goal_score === "number")
            sc.textContent = String(s.finality.goal_score);
        }

        function go() {
          var base = (cfg.baseUrl || "http://127.0.0.1:3002").replace(
            /\/$/,
            "",
          );
          var key = cfg.apiKey || "";
          var scope = cfg.scopeId || "default";
          var summaryUrl = key
            ? base + "/v1/scopes/" + encodeURIComponent(scope) + "/summary"
            : base +
              "/summary?raw=1&scope_id=" +
              encodeURIComponent(scope);
          var headers = key ? { Authorization: "Bearer " + key } : {};

          fetch(summaryUrl, { headers: headers })
            .then(function (r) {
              return r.json();
            })
            .then(function (s) {
              pre.textContent = JSON.stringify(s, null, 2);
              msg.textContent = key
                ? "Live /v1 summary (authenticated)."
                : "Live feed /summary (local, no API key).";
              applySummary(s);
            })
            .catch(function () {
              msg.textContent =
                "Feed unreachable — start pnpm run feed on port 3002.";
            });

          if (key) {
            fetch(
              base + "/v1/scopes/" + encodeURIComponent(scope) + "/metrics",
              { headers: headers },
            )
              .then(function (r) {
                return r.json();
              })
              .then(function (m) {
                if (m.tokens) {
                  msg.textContent += " Metrics loaded.";
                }
              })
              .catch(function () {});
          }
        }

        go();
        setInterval(go, 30000);
      })();
      })();
