# ControlPlane Sentinel

Inline AI control plane for two enterprise use cases: **Customer Support** and **Internal Copilot**.

Sentinel sits in front of the model. It scans the prompt, routes cheap when it can, judges the answer before it ships, and writes an audit trail for every decision.

**Live app:** run locally at [http://127.0.0.1:8000](http://127.0.0.1:8000)

---

## Deliverables

| # | Deliverable | What you get | Where it lives |
|---|-------------|--------------|----------------|
| 1 | **Working prototype** | FastAPI inline proxy that gates, routes, evaluates, and logs every request | `main.py` |
| 2 | **Two policy postures** | Distinct enterprise configs (latency, PII, hallucination, HITL) | `config.py` |
| 3 | **Deterministic guardrails** | Zero-trust ingress scan for PII and restricted keywords | `guardrails.py` |
| 4 | **Semantic router** | Cache → local SLM → Frontier LLM for cost control | `router.py` |
| 5 | **AI-as-judge** | Egress verification: Allow / Flag for review / Block | `evaluator.py` |
| 6 | **Audit trail** | JSONL log behind every allow, flag, and block | `audit_log.jsonl` (created at runtime) |
| 7 | **Control-room website** | Playground, live pipeline, telemetry, policy viewer | `static/` |
| 8 | **Streamlit telemetry** | Optional metrics dashboard from the original brief | `dashboard.py` |

### Demo paths the judges can run

| Prompt | Expected path |
|--------|----------------|
| `reset my password` | Cache hit · 0 tokens |
| Short question | Local SLM (Llama 3 8B) |
| Long CFO-style prompt | Frontier API (GPT-4) |
| Email or SSN on **Customer Support** | Ingress **block** (PII) |
| Same email on **Internal Copilot** | Allowed (PII policy off) |
| `confidential_project_x` | Ingress **block** (restricted keyword) |

---

## Why two use cases

Same control plane. Different risk.

| | Customer Support | Internal Copilot |
|---|---|---|
| Latency budget | **30 ms** | **500 ms** |
| Block PII | Yes | No |
| Hallucination gate | **0.85** (strict) | **0.60** (relaxed) |
| Human in the loop | Off — real-time only | On — flag for review |

---

## Architecture

```
Prompt
  │
  ▼
[1] Ingress guardrail     PII · restricted keywords
  │
  ▼
[2] Semantic router       Cache → SLM → Frontier
  │
  ▼
[3] AI-as-judge           Allow · Flag · Block
  │
  ▼
[4] Egress + audit log    Response + telemetry
```

- **Ingress** is rule-based and fast.
- **Routing** spends tokens only when the question deserves them.
- **Judge** is a second model (simulated) that scores hallucination risk against the active policy.
- **Audit** records event, use case, model, latency, cost, and confidence.

---

## Quick start

```bash
python -m pip install -r requirements.txt
python -m uvicorn main:app --reload --port 8000
```

Open **http://127.0.0.1:8000**

### Optional Streamlit dashboard

```bash
streamlit run dashboard.py
```

---

## How to demo the website

1. Open **Playground**.
2. Pick **Customer Support** or **Internal Copilot**.
3. Use a preset chip or type a prompt, then **Dispatch**.
4. Watch **Ingress → Route → Judge → Egress** light up.
5. Open **Telemetry** for request counts, token savings, routing mix, and the audit table.
6. Open **Policies** to compare the two rule sets.

---

## API

`POST /v1/chat/completions`

```json
{
  "query": "reset my password",
  "use_case": "customer_support"
}
```

`use_case` is `customer_support` or `internal_copilot`.

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/` | Control-room website |
| `POST` | `/v1/chat/completions` | Inline gate |
| `GET` | `/v1/policies` | Policy configs |
| `GET` | `/v1/telemetry` | Metrics + recent audit rows |

---

## Project structure

```
├── main.py              FastAPI proxy + static site
├── config.py            Two enterprise policies
├── guardrails.py        Deterministic ingress scan
├── router.py            Cache / SLM / Frontier routing
├── evaluator.py         AI-as-judge
├── dashboard.py         Streamlit telemetry
├── requirements.txt
├── static/              Website (HTML / CSS / JS)
└── g.txt                Original build brief
```

---

## Stack

FastAPI · Uvicorn · Pydantic · Streamlit · vanilla HTML/CSS/JS

No extra build step. One process serves the API and the site.
