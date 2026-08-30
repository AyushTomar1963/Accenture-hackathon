const state = {
  useCase: "customer_support",
};

const titles = {
  playground: ["Interactive control plane", "Query the inline gate"],
  telemetry:  ["Observability", "Every decision, logged"],
  policies:   ["Two enterprise postures", "Same plane, different rules"],
};

// ~$0.01 per 1K tokens as an illustrative Frontier cost
const COST_PER_1K_TOKENS_USD = 0.01;

function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }

function setClock() {
  const now = new Date();
  $("#clock").textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function switchView(view) {
  $$(".nav-btn").forEach((b) => {
    const on = b.dataset.view === view;
    b.classList.toggle("active", on);
    b.setAttribute("aria-pressed", String(on));
  });
  $$(".view").forEach((el) => el.classList.remove("active"));
  $(`#view-${view}`).classList.add("active");
  const [eye, title] = titles[view];
  $("#view-eyebrow").textContent = eye;
  $("#view-title").textContent = title;
  if (view === "telemetry") loadTelemetry();
  if (view === "policies")  loadPolicies();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

$$(".nav-btn").forEach((btn) => btn.addEventListener("click", () => switchView(btn.dataset.view)));

$$(".case-card").forEach((card) => {
  card.addEventListener("click", () => {
    $$(".case-card").forEach((c) => {
      c.classList.remove("active");
      c.setAttribute("aria-pressed", "false");
    });
    card.classList.add("active");
    card.setAttribute("aria-pressed", "true");
    state.useCase = card.dataset.case;
  });
});

$$("[data-hint]").forEach((btn) => {
  btn.addEventListener("click", () => {
    $("#query").value = btn.dataset.hint;
    $("#query").focus();
  });
});

function resetPipeline() {
  $$(".pipeline li").forEach((li) => li.classList.remove("active", "done", "fail"));
}

function markStage(name, kind) {
  const li = document.querySelector(`.pipeline li[data-stage="${name}"]`);
  if (!li) return;
  li.classList.remove("active", "done", "fail");
  li.classList.add(kind);
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function pillClass(decision, blocked) {
  if (blocked) return "block";
  if (decision === "FLAG_FOR_REVIEW") return "flag";
  return "allow";
}

function pillLabel(decision, blocked, detail) {
  if (blocked) return detail || "Blocked";
  if (decision === "FLAG_FOR_REVIEW") return "Flagged for review";
  return "Allowed";
}

function fmtCost(tokens) {
  const usd = ((tokens || 0) / 1000) * COST_PER_1K_TOKENS_USD;
  return `${tokens ?? 0} tok · $${usd.toFixed(4)}`;
}

function fmtSavings(tokens) {
  const usd = ((tokens || 0) / 1000) * COST_PER_1K_TOKENS_USD;
  return `${tokens.toLocaleString()} tok · $${usd.toFixed(2)}`;
}

function renderMeta(meta) {
  const items = [
    ["Routed to",   meta.routed_to],
    ["Latency",     `${meta.latency_ms} ms`],
    ["Budget",      `${meta.latency_budget_ms} ms${meta.over_budget ? " · over" : " · ok"}`],
    ["Guardrail",   `${meta.guardrail_overhead_ms} ms`],
    ["Confidence",  meta.confidence_score],
    ["Token cost",  fmtCost(meta.cost_tokens)],
  ];
  $("#meta-grid").innerHTML = items
    .map(([k, v]) => `<div><dt>${k}</dt><dd>${v ?? "—"}</dd></div>`)
    .join("");
}

$("#send").addEventListener("click", dispatch);
$("#query").addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") dispatch();
});

$("#cta-playground")?.addEventListener("click", () => {
  switchView("playground");
  setTimeout(() => $("#query").focus(), 200);
});

$("#cta-guided")?.addEventListener("click", runGuidedDemo);

async function dispatch(customQuery, customCase) {
  const query = (customQuery ?? $("#query").value).trim();
  if (!query) return;
  const useCase = customCase ?? state.useCase;
  if (customQuery !== undefined) $("#query").value = query;

  const send = $("#send");
  send.disabled = true;
  resetPipeline();
  $("#result").hidden = true;

  const stages = ["ingress", "route", "judge", "egress"];
  markStage("ingress", "active");

  try {
    const res = await fetch("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, use_case: useCase }),
    });
    const data = await res.json();

    if (!res.ok) {
      const detail = data.detail || "Request blocked";
      const atIngress = /PII|Restricted/i.test(String(detail));
      if (atIngress) {
        markStage("ingress", "fail");
      } else {
        markStage("ingress", "done");
        markStage("route", "done");
        markStage("judge", "fail");
        markStage("egress", "fail");
      }
      $("#result").hidden = false;
      $("#status-pill").className = `status ${pillClass(null, true)}`;
      $("#status-pill").textContent = pillLabel(null, true, detail);
      $("#response-text").textContent = detail;
      $("#meta-grid").innerHTML = "";
      updateHeroStats();
      return;
    }

    for (const stage of stages) {
      markStage(stage, "active");
      await sleep(240);
      markStage(stage, "done");
    }

    const meta = data.metadata;
    const flagged = meta.decision === "FLAG_FOR_REVIEW" || meta.hitl;
    $("#result").hidden = false;
    $("#status-pill").className = `status ${pillClass(meta.decision, false)}`;
    $("#status-pill").textContent = pillLabel(meta.decision, false);
    $("#response-text").textContent = data.response;
    renderMeta(meta);
    if (flagged) markStage("egress", "active");
    updateHeroStats();
  } catch (err) {
    markStage("ingress", "fail");
    $("#result").hidden = false;
    $("#status-pill").className = "status block";
    $("#status-pill").textContent = "Proxy error";
    $("#response-text").textContent = err.message;
  } finally {
    send.disabled = false;
  }
}

async function runGuidedDemo() {
  switchView("playground");
  const script = [
    { q: "reset my password", uc: "customer_support" },
    { q: "How do I export last quarter invoices?", uc: "customer_support" },
    { q: "Compare the last four billing cycles, flag anomalies, and draft a CFO-ready summary with recommended actions.", uc: "internal_copilot" },
    { q: "Reset access for jane@acme.com SSN 123-45-6789", uc: "customer_support" },
    { q: "Share notes from confidential_project_x", uc: "internal_copilot" },
  ];
  const btn = $("#cta-guided");
  if (btn) { btn.disabled = true; btn.querySelector("svg")?.remove(); btn.textContent = "Running guided demo…"; }
  for (const step of script) {
    const target = document.querySelector(`.case-card[data-case="${step.uc}"]`);
    if (target && !target.classList.contains("active")) target.click();
    await dispatch(step.q, step.uc);
    await sleep(1200);
  }
  if (btn) { btn.disabled = false; btn.textContent = "Run again"; }
}

function metricCard(label, value, sub, hi = false) {
  return `<div class="metric ${hi ? "hi" : ""}">
    <span>${label}</span>
    <strong>${value}</strong>
    ${sub ? `<em>${sub}</em>` : ""}
  </div>`;
}

function bars(map) {
  const entries = Object.entries(map || {});
  const max = Math.max(1, ...entries.map(([, n]) => n));
  if (!entries.length) return `<p class="hint-copy">No traffic yet. Run the guided demo or dispatch a query.</p>`;
  return entries
    .map(
      ([name, n]) => `
      <div class="bar-row">
        <span>${name}</span>
        <div class="bar"><i style="width:${Math.round((n / max) * 100)}%"></i></div>
        <span>${n}</span>
      </div>`
    )
    .join("");
}

function fmtTime(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch { return iso; }
}

async function loadTelemetry() {
  try {
    const data = await fetch("/v1/telemetry").then((r) => r.json());
    const dollarSaved = ((data.token_savings || 0) / 1000) * COST_PER_1K_TOKENS_USD;
    $("#metrics").innerHTML = [
      metricCard("Requests",       data.total,                                       "total handled"),
      metricCard("Avg latency",    `${data.avg_latency_ms} ms`,                      "end-to-end"),
      metricCard("Tokens saved",   (data.token_savings || 0).toLocaleString(),       `≈ $${dollarSaved.toFixed(2)} vs. baseline`, true),
      metricCard("Blocked",        data.blocked,                                     "PII + judge blocks"),
    ].join("");
    $("#model-bars").innerHTML = bars(data.models);
    $("#event-bars").innerHTML = bars(data.events);
    $("#audit-body").innerHTML = (data.logs || [])
      .map(
        (row) => `<tr>
          <td>${fmtTime(row.timestamp)}</td>
          <td>${row.event || "—"}</td>
          <td>${row.use_case || "—"}</td>
          <td>${row.model || "—"}</td>
          <td>${row.latency_ms ?? "—"}</td>
          <td>${row.cost_tokens ?? "—"}</td>
          <td>${row.confidence ?? "—"}</td>
          <td class="query">${(row.query || row.reason || "").toString().replace(/</g, "&lt;")}</td>
        </tr>`
      )
      .join("");
    updateHeroStatsFromTelemetry(data);
  } catch (e) {
    $("#metrics").innerHTML = `<p class="hint-copy">Telemetry unavailable: ${e.message}</p>`;
  }
}

async function updateHeroStats() {
  try {
    const data = await fetch("/v1/telemetry").then((r) => r.json());
    updateHeroStatsFromTelemetry(data);
  } catch { /* ignore */ }
}

function updateHeroStatsFromTelemetry(data) {
  const prevented = (data.blocked || 0) + (data.flagged || 0);
  $("#stat-prevented").textContent = prevented;
  $("#stat-tokens").textContent = fmtSavings(data.token_savings || 0);
  $("#stat-latency").textContent = data.avg_latency_ms ? `${data.avg_latency_ms} ms` : "— ms";
}

$("#refresh")?.addEventListener("click", loadTelemetry);
$("#download")?.addEventListener("click", async () => {
  const data = await fetch("/v1/telemetry").then((r) => r.json());
  const jsonl = (data.logs || []).map((r) => JSON.stringify(r)).join("\n");
  const blob = new Blob([jsonl], { type: "application/x-ndjson" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `sentinel-audit-${Date.now()}.jsonl`;
  a.click();
  URL.revokeObjectURL(url);
});

async function loadPolicies() {
  const policies = await fetch("/v1/policies").then((r) => r.json());
  $("#policy-grid").innerHTML = Object.entries(policies)
    .map(([key, p]) => `
      <article class="policy-card">
        <span class="case-tag ${p.tone}">${p.tone}</span>
        <h3>${p.label}</h3>
        <p>${p.description}</p>
        <div class="kv">
          <div><span>Latency budget</span><strong>${p.latency_budget_ms} ms</strong></div>
          <div><span>Block PII</span><strong>${p.block_pii ? "Yes" : "No"}</strong></div>
          <div><span>Hallucination gate</span><strong>${p.hallucination_threshold}</strong></div>
          <div><span>Human in the loop</span><strong>${p.allow_hitl ? "Allowed" : "Disabled"}</strong></div>
        </div>
        <p style="margin-top:14px;font-family:var(--mono);font-size:11px;color:var(--muted)">${key}</p>
      </article>
    `)
    .join("");
}

setClock();
setInterval(setClock, 1000);
updateHeroStats();
