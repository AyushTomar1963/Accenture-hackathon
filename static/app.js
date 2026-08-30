const state = {
  useCase: "customer_support",
};

const titles = {
  playground: ["Interactive control plane", "Query the inline gate"],
  telemetry: ["Observability", "Every decision, logged"],
  policies: ["Two enterprise postures", "Same plane, different rules"],
};

function $(sel) {
  return document.querySelector(sel);
}

function setClock() {
  const now = new Date();
  $("#clock").textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const view = btn.dataset.view;
    document.querySelectorAll(".view").forEach((el) => el.classList.remove("active"));
    $(`#view-${view}`).classList.add("active");
    const [eye, title] = titles[view];
    $("#view-eyebrow").textContent = eye;
    $("#view-title").textContent = title;
    if (view === "telemetry") loadTelemetry();
    if (view === "policies") loadPolicies();
  });
});

document.querySelectorAll(".case-card").forEach((card) => {
  card.addEventListener("click", () => {
    document.querySelectorAll(".case-card").forEach((c) => c.classList.remove("active"));
    card.classList.add("active");
    state.useCase = card.dataset.case;
  });
});

document.querySelectorAll("[data-hint]").forEach((btn) => {
  btn.addEventListener("click", () => {
    $("#query").value = btn.dataset.hint;
    $("#query").focus();
  });
});

function resetPipeline() {
  document.querySelectorAll(".pipeline li").forEach((li) => {
    li.classList.remove("active", "done", "fail");
  });
}

function markStage(name, kind) {
  const li = document.querySelector(`.pipeline li[data-stage="${name}"]`);
  if (!li) return;
  li.classList.remove("active", "done", "fail");
  li.classList.add(kind);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pillClass(decision, blocked) {
  if (blocked) return "block";
  if (decision === "FLAG_FOR_REVIEW") return "flag";
  return "allow";
}

function pillLabel(decision, blocked, detail) {
  if (blocked) return detail || "Blocked";
  if (decision === "FLAG_FOR_REVIEW") return "Flagged for review";
  return decision || "Allow";
}

function renderMeta(meta) {
  const items = [
    ["Routed to", meta.routed_to],
    ["Latency", `${meta.latency_ms} ms`],
    ["Budget", `${meta.latency_budget_ms} ms${meta.over_budget ? " · over" : ""}`],
    ["Guardrail", `${meta.guardrail_overhead_ms} ms`],
    ["Confidence", meta.confidence_score],
    ["Token cost", meta.cost_tokens],
  ];
  $("#meta-grid").innerHTML = items
    .map(([k, v]) => `<div><dt>${k}</dt><dd>${v ?? "—"}</dd></div>`)
    .join("");
}

$("#send").addEventListener("click", dispatch);
$("#query").addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") dispatch();
});

async function dispatch() {
  const query = $("#query").value.trim();
  if (!query) return;

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
      body: JSON.stringify({ query, use_case: state.useCase }),
    });
    const data = await res.json();

    if (!res.ok) {
      const detail = data.detail || "Request blocked";
      const atIngress = String(detail).includes("PII") || String(detail).includes("Restricted");
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
      return;
    }

    for (const stage of stages) {
      markStage(stage, "active");
      await sleep(90);
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

function metricCard(label, value) {
  return `<div class="metric"><span>${label}</span><strong>${value}</strong></div>`;
}

function bars(map) {
  const entries = Object.entries(map || {});
  const max = Math.max(1, ...entries.map(([, n]) => n));
  if (!entries.length) return `<p class="hint-copy">No traffic yet. Dispatch a few queries first.</p>`;
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
  } catch {
    return iso;
  }
}

async function loadTelemetry() {
  const data = await fetch("/v1/telemetry").then((r) => r.json());
  $("#metrics").innerHTML = [
    metricCard("Requests", data.total),
    metricCard("Avg latency", `${data.avg_latency_ms} ms`),
    metricCard("Token savings", data.token_savings),
    metricCard("Blocked", data.blocked),
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
        <td class="query">${row.query || row.reason || ""}</td>
      </tr>`
    )
    .join("");
}

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

$("#refresh").addEventListener("click", loadTelemetry);
setClock();
setInterval(setClock, 1000);
