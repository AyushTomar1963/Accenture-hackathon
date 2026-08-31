/* =========================================================
 * Sentinel — ControlPlane · client
 * ========================================================= */

const state = { useCase: "customer_support" };

const titles = {
  playground: ["Interactive control plane", "Query the inline gate"],
  telemetry:  ["Observability",              "Every decision, logged"],
  policies:   ["Two enterprise postures",    "Same plane, different rules"],
};

const COST_PER_1K_TOKENS_USD = 0.01;

/* ------------ tiny helpers ------------ */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

/* ============================================================
 * AUTH — server-verified. Token stored in localStorage.
 * ============================================================ */
const AUTH_KEY = "sentinel.auth.v1";

function getSession() {
  try { return JSON.parse(localStorage.getItem(AUTH_KEY) || "null"); }
  catch { return null; }
}
function setSession(s) { localStorage.setItem(AUTH_KEY, JSON.stringify(s)); }
function clearSession() { localStorage.removeItem(AUTH_KEY); }

async function apiFetch(url, opts = {}) {
  const session = getSession();
  const headers = Object.assign({}, opts.headers || {});
  if (session?.token) headers["Authorization"] = `Bearer ${session.token}`;
  const res = await fetch(url, { ...opts, headers });
  if (res.status === 401) {
    clearSession();
    showLogin();
    throw new Error("Session expired — please sign in again.");
  }
  return res;
}

async function attemptLogin(user, password) {
  const res = await fetch("/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user, password }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || "Invalid credentials");
  }
  const data = await res.json();
  const session = { user: data.user, role: data.role, label: data.label, token: data.token, at: Date.now() };
  setSession(session);
  return session;
}

function renderAuthChip(session) {
  const host = $("#auth-chip");
  if (!host) return;
  host.innerHTML = `
    <div class="auth-user">
      <span class="auth-avatar">${esc(session.user.slice(0,1).toUpperCase())}</span>
      <span class="auth-meta">
        <b>${esc(session.user)}</b>
        <em>${esc(session.role)}</em>
      </span>
      <button class="auth-out" id="logout" title="Sign out" aria-label="Sign out">↺</button>
    </div>`;
  $("#logout")?.addEventListener("click", () => {
    clearSession();
    showLogin();
  });
}

function resetLoginForm() {
  const form = $("#login-form");
  if (form) form.reset();
  const err = $("#login-error");
  if (err) { err.hidden = true; err.textContent = ""; }
  const btn = $(".login-submit");
  if (btn) { btn.disabled = false; btn.querySelector("span").textContent = "Enter Sentinel"; }
}

function showLogin() {
  $("#login")?.removeAttribute("hidden");
  $("#app")?.setAttribute("hidden", "");
  resetLoginForm();
  setTimeout(() => $("#login-user")?.focus(), 40);
}

function showApp(session) {
  $("#login")?.setAttribute("hidden", "");
  $("#app")?.removeAttribute("hidden");
  renderAuthChip(session);
  init();
  updateHeroStats();
}

async function submitLogin(e) {
  e?.preventDefault?.();
  const err = $("#login-error");
  const btn = $(".login-submit");
  const btnLabel = btn?.querySelector("span");
  err.hidden = true;
  err.textContent = "";
  if (btn) { btn.disabled = true; if (btnLabel) btnLabel.textContent = "Signing in…"; }
  try {
    const user = $("#login-user").value;
    const pass = $("#login-pass").value;
    const session = await attemptLogin(user, pass);
    showApp(session);
  } catch (e2) {
    err.textContent = e2.message || "Login failed";
    err.hidden = false;
  } finally {
    if (btn) { btn.disabled = false; if (btnLabel) btnLabel.textContent = "Enter Sentinel"; }
  }
}

function bindLoginUI() {
  $("#login-form")?.addEventListener("submit", submitLogin);
  $$(".login-fill").forEach((btn) => {
    btn.addEventListener("click", () => {
      $("#login-user").value = btn.dataset.user;
      $("#login-pass").value = btn.dataset.pass;
      submitLogin();
    });
  });
}

async function bootAuth() {
  bindLoginUI();  // ← always bind, regardless of whether a session exists
  const session = getSession();
  if (!session?.token) return showLogin();

  // Verify token is still valid; expired → back to login
  try {
    const res = await fetch("/v1/auth/me", { headers: { Authorization: `Bearer ${session.token}` } });
    if (!res.ok) throw new Error("expired");
    showApp(session);
  } catch {
    clearSession();
    showLogin();
  }
}

/* ============================================================
 * APP INIT (runs after login)
 * ============================================================ */
let inited = false;
function init() {
  if (inited) return;
  inited = true;

  setClock();
  setInterval(setClock, 1000);

  /* nav */
  $$(".nav-btn").forEach((btn) => btn.addEventListener("click", () => switchView(btn.dataset.view)));

  /* case cards */
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

  /* preset hint chips */
  $$("[data-hint]").forEach((btn) => {
    btn.addEventListener("click", () => {
      $("#query").value = btn.dataset.hint;
      $("#query").focus();
    });
  });

  /* dispatch triggers */
  $("#send").addEventListener("click", () => dispatch());
  $("#query").addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") dispatch();
  });

  /* hero CTAs */
  $("#cta-focus")?.addEventListener("click", () => {
    switchView("playground");
    setTimeout(() => { $("#query")?.focus(); $("#query")?.scrollIntoView({ behavior: "smooth", block: "center" }); }, 60);
  });
  $("#cta-guided")?.addEventListener("click", runGuidedDemo);

  /* telemetry actions */
  $("#refresh")?.addEventListener("click", loadTelemetry);
  $("#download")?.addEventListener("click", downloadAudit);

  updateHeroStats();
}

/* ============================================================
 * NAVIGATION
 * ============================================================ */
function switchView(view) {
  $$(".nav-btn").forEach((b) => {
    const on = b.dataset.view === view;
    b.classList.toggle("active", on);
    b.setAttribute("aria-pressed", String(on));
  });
  $$(".view").forEach((el) => el.classList.remove("active"));
  const target = $(`#view-${view}`);
  if (!target) return;
  target.classList.add("active");
  const [eye, title] = titles[view];
  $("#view-eyebrow").textContent = eye;
  $("#view-title").textContent = title;

  const chip = $("#api-chip");
  if (chip) chip.textContent = view === "telemetry" ? "GET /v1/telemetry" : view === "policies" ? "GET /v1/policies" : "POST /v1/chat/completions";

  if (view === "telemetry") loadTelemetry();
  if (view === "policies")  loadPolicies();
}

/* ============================================================
 * PIPELINE UI
 * ============================================================ */
function resetPipeline() {
  $$(".pipeline li").forEach((li) => li.classList.remove("active", "done", "fail"));
}
function markStage(name, kind) {
  const li = document.querySelector(`.pipeline li[data-stage="${name}"]`);
  if (!li) return;
  li.classList.remove("active", "done", "fail");
  li.classList.add(kind);
}

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

/* ============================================================
 * CLOCK
 * ============================================================ */
function setClock() {
  const now = new Date();
  const el = $("#clock");
  if (el) el.textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/* ============================================================
 * DISPATCH
 * ============================================================ */
function fmtCost(tokens) {
  const usd = ((tokens || 0) / 1000) * COST_PER_1K_TOKENS_USD;
  return `${tokens ?? 0} tok · $${usd.toFixed(4)}`;
}
function fmtSavings(tokens) {
  const usd = ((tokens || 0) / 1000) * COST_PER_1K_TOKENS_USD;
  return `${Number(tokens).toLocaleString()} tok · $${usd.toFixed(2)}`;
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
    .map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v ?? "—")}</dd></div>`)
    .join("");
}

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
    const res = await apiFetch("/v1/chat/completions", {
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
        markStage("route",   "done");
        markStage("judge",   "fail");
        markStage("egress",  "fail");
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
    { q: "reset my password",                                                                                      uc: "customer_support" },
    { q: "How do I export last quarter invoices?",                                                                 uc: "customer_support" },
    { q: "Compare the last four billing cycles, flag anomalies, and draft a CFO-ready summary with recommended actions.", uc: "internal_copilot" },
    { q: "Reset access for jane@acme.com SSN 123-45-6789",                                                         uc: "customer_support" },
    { q: "Share notes from confidential_project_x",                                                                uc: "internal_copilot" },
  ];
  const btn   = $("#cta-guided");
  const label = btn?.querySelector(".cta-label");
  if (btn) btn.disabled = true;
  if (label) label.textContent = "Running guided demo…";
  for (const step of script) {
    const target = document.querySelector(`.case-card[data-case="${step.uc}"]`);
    if (target && !target.classList.contains("active")) target.click();
    await dispatch(step.q, step.uc);
    await sleep(1200);
  }
  if (btn) btn.disabled = false;
  if (label) label.textContent = "Run guided demo again";
}

/* ============================================================
 * TELEMETRY
 * ============================================================ */
function metricCard(label, value, sub, hi = false) {
  return `<div class="metric ${hi ? "hi" : ""}">
    <span>${esc(label)}</span>
    <strong>${esc(value)}</strong>
    ${sub ? `<em>${esc(sub)}</em>` : ""}
  </div>`;
}
function bars(map) {
  const entries = Object.entries(map || {});
  const max = Math.max(1, ...entries.map(([, n]) => n));
  if (!entries.length) return `<p class="hint-copy">No traffic yet. Run the guided demo or dispatch a query.</p>`;
  return entries
    .map(([name, n]) => `
      <div class="bar-row">
        <span>${esc(name)}</span>
        <div class="bar"><i style="width:${Math.round((n / max) * 100)}%"></i></div>
        <span>${n}</span>
      </div>`)
    .join("");
}
function fmtTime(iso) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
  catch { return iso; }
}

async function loadTelemetry() {
  try {
    const data = await apiFetch("/v1/telemetry").then((r) => r.json());
    const dollarSaved = ((data.token_savings || 0) / 1000) * COST_PER_1K_TOKENS_USD;
    $("#metrics").innerHTML = [
      metricCard("Requests",     data.total,                                          "total handled"),
      metricCard("Avg latency",  `${data.avg_latency_ms} ms`,                         "end-to-end"),
      metricCard("Tokens saved", (data.token_savings || 0).toLocaleString(),          `≈ $${dollarSaved.toFixed(2)} vs. baseline`, true),
      metricCard("Blocked",      data.blocked,                                        "PII + judge blocks"),
    ].join("");
    $("#model-bars").innerHTML = bars(data.models);
    $("#event-bars").innerHTML = bars(data.events);
    $("#audit-body").innerHTML = (data.logs || [])
      .map((row) => `<tr>
          <td>${fmtTime(row.timestamp)}</td>
          <td>${esc(row.event || "—")}</td>
          <td>${esc(row.use_case || "—")}</td>
          <td>${esc(row.model || "—")}</td>
          <td>${esc(row.latency_ms ?? "—")}</td>
          <td>${esc(row.cost_tokens ?? "—")}</td>
          <td>${esc(row.confidence ?? "—")}</td>
          <td class="query">${esc(row.query || row.reason || "")}</td>
        </tr>`)
      .join("");
    updateHeroStatsFromTelemetry(data);
  } catch (e) {
    $("#metrics").innerHTML = `<p class="hint-copy">Telemetry unavailable: ${esc(e.message)}</p>`;
  }
}

async function updateHeroStats() {
  try {
    const data = await apiFetch("/v1/telemetry").then((r) => r.json());
    updateHeroStatsFromTelemetry(data);
  } catch { /* ignore */ }
}
function updateHeroStatsFromTelemetry(data) {
  const prevented = (data.blocked || 0) + (data.flagged || 0);
  const p = $("#stat-prevented"); if (p) p.textContent = prevented;
  const t = $("#stat-tokens");    if (t) t.textContent = fmtSavings(data.token_savings || 0);
  const l = $("#stat-latency");   if (l) l.textContent = data.avg_latency_ms ? `${data.avg_latency_ms} ms` : "— ms";
}

async function downloadAudit() {
  const data = await apiFetch("/v1/telemetry").then((r) => r.json());
  const jsonl = (data.logs || []).map((r) => JSON.stringify(r)).join("\n");
  const blob = new Blob([jsonl], { type: "application/x-ndjson" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url;
  a.download = `sentinel-audit-${Date.now()}.jsonl`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ============================================================
 * POLICIES
 * ============================================================ */
async function loadPolicies() {
  try {
    const policies = await apiFetch("/v1/policies").then((r) => r.json());
    $("#policy-grid").innerHTML = Object.entries(policies)
      .map(([key, p]) => `
        <article class="policy-card">
          <span class="case-tag ${esc(p.tone)}">${esc(p.tone)}</span>
          <h3>${esc(p.label)}</h3>
          <p>${esc(p.description)}</p>
          <div class="kv">
            <div><span>Latency budget</span><strong>${p.latency_budget_ms} ms</strong></div>
            <div><span>Block PII</span><strong>${p.block_pii ? "Yes" : "No"}</strong></div>
            <div><span>Hallucination gate</span><strong>${p.hallucination_threshold}</strong></div>
            <div><span>Human in the loop</span><strong>${p.allow_hitl ? "Allowed" : "Disabled"}</strong></div>
          </div>
          <p style="margin-top:14px;font-family:var(--mono);font-size:11px;color:var(--muted)">${esc(key)}</p>
        </article>
      `).join("");
  } catch (e) {
    $("#policy-grid").innerHTML = `<p class="hint-copy">Could not load policies: ${esc(e.message)}</p>`;
  }
}

/* ============================================================
 * BOOT
 * ============================================================ */
document.addEventListener("DOMContentLoaded", bootAuth);
