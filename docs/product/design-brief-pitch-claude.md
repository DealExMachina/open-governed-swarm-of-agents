# Design brief — professional pitch (for Claude Design)

**Purpose:** Produce a short, serious investor / enterprise pitch (slides or
one-pager sequence). Not a product launch hype deck.

**Tone:** calm, precise, slightly understated. No “revolutionize,” no glow,
no purple gradients, no emoji, no fake metrics. Prefer diagrams you could
show a regulator without cringing.

**Audience:** investors + enterprise buyers (FinOps, risk, audit, platform).

**Length target:** 8–12 slides, or a 2-page fold. Dense ideas, light copy.

**Canonical product lines (use these, don’t invent slogans):**
- Delta = billed change on the case scoreboard; tokens = cost to get there.
- You pay when the file’s scores move under the rules — not per reply.
- Sources: `docs/product/elevator-pitch-delta.md`, `PRD-delta-finops.md`,
  `elevator-pitch-gtm-stripe-metronome.md`.

**Working price (footnote only, not hero):** ~$0.07 / settled delta at ~80% GM
on LLM COGS (demo-calibrated). Label as working figure.

---

## Narrative arc (keep this order)

1. Problem — agent coordination  
2. Constraint — governed settings  
3. Outcome — convergence (with business examples)  
4. Economics — delta vs token  
5. Abstraction — stable situations (“global sections”), coarse vs fine  
6. Outside retrieval — regulators / auditors  
7. Traces — HITL, decisions, resolutions, time + belief  

Close optional: GTM one slide (Stripe / Metronome / prepaid quota) — secondary.

---

## Slide-by-slide content

### 1. Title

**Product framing (pick one plain title):**  
“Governed multi-agent coordination”  
Subtitle: scoreboard progress you can audit — and bill.

No mascot. Logo + one dry subtitle.

---

### 2. The problem: coordination of agents

**Idea:** Many agents on one case is easy to start and hard to finish. They
overlap, redo work, disagree, and leave no shared notion of “done.”

**Show:**
- Left: swarm of agents → chat / tools / retries (cost and noise).
- Right: same agents → shared case state, who may act, when to stop.

**Copy (short):**  
Agents can read and write. Coordination is deciding *what still matters*,
*who is allowed to change it*, and *when the case is finished*. Without that,
you get activity. With that, you get a file that settles.

**Avoid:** claiming we invented multi-agent systems. We address coordination
under rules.

---

### 3. In governed settings

**Idea:** Enterprise work is not open-ended chat. Policy, roles, and human
override sit on the path.

**Show:** a thin vertical stack or lane:
`documents → agents → policy gate → shared state → human when needed → stop`.

**Copy:**  
Governed setting = the run is bound to a scope (a case), a permission model,
and transitions that can be blocked. High contradiction is not “interesting
debate”; it is a closed gate. YOLO / human-in-the-loop / stricter modes are
levels of permissiveness — not marketing tiers only.

**Business gloss:** bank KYC, insurance solvency pack, clinical protocol
review, M&A diligence — places where a wrong “done” is expensive.

---

### 4. Converging — what it means, with examples

**Idea:** Convergence = the case’s scores move toward a coherent, checkable
“good enough to stop,” not that the model sounds confident.

**Plain definition for the slide:**  
*Convergence: disagreement and unfinished work go down under the same rules,
until stopping conditions pass.*

**Business examples (use 2–3, concrete):**

| Domain | Not converged | Converged enough to stop |
|--------|---------------|---------------------------|
| M&A diligence | Revenue and headcount conflict across memos | Figures reconciled or explicitly resolved; open risks listed |
| AML / KYC | Screening hits and structure story disagree | Hits dispositioned; ownership story consistent |
| Solvency / risk | Model and committee numbers diverge | Position restated under one baseline |
| Clinical / ops | Sites report incompatible enrollment | Protocol facts aligned; contradictions closed or escalated |

**Visual:** a simple descent — gap / disagreement shrinking over steps (no
fake precision curves). Optional label: “toward certified stop,” not “AGI.”

---

### 5. Economics — delta vs token

**Idea:** Tokens measure spend. Deltas measure billed progress on the
scoreboard.

| | Token | Delta |
|--|-------|-------|
| What it is | Model input/output used | Clear scoreboard move (for/against a topic) after the gate |
| When it grows | Retries, long context, loops | Only when scores move enough and the gate is open |
| Invoice role | Cost of goods (show it) | Unit we sell |
| Unchanged re-run | Still can cost tokens | No new charge |

**Visual:** two columns; arrow “tokens → produce → deltas”; gate icon that
can yield **0 deltas** with non-zero tokens (honest).

**Footnote:** list ~7¢ / settled delta is a working figure from demos +
frontier rates at ~80% GM on LLM cost alone.

---

### 6. Generalisation — stable situations, coarse vs fine

**Idea (keep humble):** Over time, the system is not only storing documents;
it accumulates **stable readings of situations** — places where the local
evidence fits together. In the formal language: toward a **global section**
(a coherent assignment across the case structure). Buyers hear: *a settled
understanding you can reuse*, not a chat log.

**Coarse vs fine (Galois-style tours — one sentence + diagram):**  
You can move **up** (forget detail, keep the stable summary a committee needs)
and **down** (re-open the evidence that justified that summary). That round
trip is the point: detail and summary stay related, not two disconnected
stories.

**Visual:**
- Bottom: detailed claims / evidence.
- Middle: topics with for/against scores.
- Top: situation card — short, stable reading.
- Arrows up = abstract; arrows down = refine / audit.

**Do not** put “Galois” in the hero title. Put it in a small caption:
“Formal idea: adjunction between coarse and fine views (Galois connection).”

---

### 7. Retrieval by outside agents (regulators, auditors)

**Idea:** External parties should retrieve a **situation**, not a transcript
dump.

**Show:** outsider (regulator / auditor / second-line) queries a scope →
gets: situation summary, open vs closed contradictions, decision trail,
what changed (deltas), when.

**Copy:**  
Outside agents don’t need to re-run the swarm. They need the settled reading,
the exceptions, and the path that produced them — at the grain they choose
(committee one-pager or full evidence).

---

### 8. HITL traces — decisions, resolutions, time, belief

**Idea:** Humans intervene; every intervention is an event with time and a
clear effect on the board.

**Elements to show (small legend, not a wall of theory):**

| Concept | Plain meaning on the slide |
|---------|----------------------------|
| HITL | Human chooses / resolves when the gate or policy requires it |
| Decision record | What was allowed or denied, under which policy version |
| Resolution | Explicit close of a contradiction (or free-text resolution that marks claims) |
| Temporality | Valid time vs transaction time — when it was true vs when we recorded it |
| Belnap-style belief | Not only true/false: support and challenge can both be present (for / against) until resolved |

**Visual:** timeline of audited events — doc in → contradiction → human
resolution → scores update → delta → (optional) stop / certificate.  
Caption: “Governed traces: replayable events, not screenshots of a chat.”

**Avoid:** claiming full philosophical completeness of four-valued logic on
the slide. One line is enough: *we keep support and challenge as separate
channels until the case resolves them.*

---

### 9. Optional close — how it is sold

One quiet slide:
- Unit: prepaid delta quota (enterprise) or pack (self-serve).
- Meter: usage on deltas (e.g. Metronome).
- Cash: Stripe.
- Tokens: visible for FinOps, not the SKU.

---

## Design constraints

- One idea per slide; max ~40 words body copy.
- Prefer line diagrams, tables, and timelines over stock photos.
- Typography: serious, editorial; avoid default “AI startup” purple-on-white.
- Dark mode optional; if used, keep high contrast, no neon.
- Diagrams must work in greyscale print (regulator PDF).
- Mark formal terms once, then use plain language.

## Success test

A partner who has never seen the repo can answer after the deck:
1. Why multi-agent needs coordination under rules.  
2. What “converged” means on a real case.  
3. Why we bill deltas and only show tokens.  
4. How an auditor gets a situation, not a chat log.  
5. Where the human shows up in the trace.

If they only remember “AI platform,” the deck failed.
