# ControlPlane Sentinel

**An inline AI control plane for the enterprise.**
Sentinel sits between your application and the model. It scans every prompt, routes to the cheapest capable model, judges the answer before it ships, and writes a signed record for every decision — all in one process.

Built to demonstrate a single control plane that safely serves two very different enterprise workloads: **Customer Support** (real-time, PII-sensitive) and **Internal Copilot** (deeper reasoning, human-in-the-loop).

> Live app: `http://127.0.0.1:8000` after quick start.

---

## Why it matters

Enterprise AI fails in three predictable ways: it leaks sensitive data, it burns tokens on questions that didn't need a frontier model, and it produces confident hallucinations no one can trace after the fact. Sentinel closes all three gaps in a single inline layer, and proves it with an audit trail per request.

---

## The pipeline

```
Prompt
  │
  ▼
[1] Ingress guardrail      PII · restricted keywords
  │
  ▼
[2] Semantic router        Cache → SLM → Frontier
  │
  ▼
[3] AI-as-judge            Allow · Flag · Block
  │
  ▼
[4] Egress + audit log     Response + telemetry
```

- **Ingress** is deterministic and fast — regex and keyword rules for zero-trust filtering.
- **Routing** spends tokens only when the question deserves them.
- **Judge** is a second model that scores hallucination risk against the active policy.
- **Audit** records event, use case, model, latency, cost, and confidence for every decision.

---

## Two policies, one control plane

The same pipeline enforces radically different postures depending on the workload.

| Control              | Customer Support        | Internal Copilot         |
| -------------------- | ----------------------- | ------------------------ |
| Latency budget       | 30 ms                   | 500 ms                   |
| Block PII            | Yes                     | No                       |
| Hallucination gate   | 0.85 (strict)           | 0.60 (relaxed)           |
| Human in the loop    | Off — real-time only    | On — flag for review     |

Switching workloads is one field in the request body. No redeploy.

---

## Demo paths

Prompts the judges can run to see each branch of the pipeline fire.

| Prompt                                    | Expected path                        |
| ----------------------------------------- | ------------------------------------ |
| `reset my password`                       | Cache hit · 0 tokens                 |
| Short question                            | Local SLM (Llama 3 8B)               |
| Long CFO-style prompt                     | Frontier API (GPT-4)                 |
| Email or SSN on Customer Support          | Ingress block (PII)                  |
| Same email on Internal Copilot            | Allowed (PII policy off)             |
| `confidential_project_x`                  | Ingress block (restricted keyword)   |

---

## Deliverables

| # | Deliverable            | What you get                                                           | Location                       |
| - | ---------------------- | ---------------------------------------------------------------------- | ------------------------------ |
| 1 | Working prototype      | FastAPI inline proxy that gates, routes, evaluates, and logs every request | `main.py`                  |
| 2 | Two policy postures    | Distinct enterprise configs (latency, PII, hallucination, HITL)        | `config.py`                    |
| 3 | Ingress guardrail      | Deterministic PII + restricted-keyword scan                            | `guardrails.py`                |
| 4 | Semantic router        | Cache → local SLM → Frontier LLM for cost control                      | `router.py`                    |
| 5 | AI-as-judge            | Egress verification: Allow / Flag for review / Block                   | `evaluator.py`                 |
| 6 | Audit trail            | JSONL log behind every allow, flag, and block                          | `audit_log.jsonl` *(runtime)*  |
| 7 | Control-room website   | Playground, live pipeline, telemetry, policy viewer                    | `static/`                      |
| 8 | Streamlit telemetry    | Optional metrics dashboard                                             | `dashboard.py`                 |

---

## Quick start

```bash
python -m pip install -r requirements.txt
python -m uvicorn main:app --reload --port 8000
```

Open **http://127.0.0.1:8000**.

Optional Streamlit dashboard in a second terminal:

```bash
streamlit run dashboard.py
```

---

## Walkthrough

1. Open **Playground**.
2. Pick **Customer Support** or **Internal Copilot**.
3. Use a preset chip or type a prompt, then **Dispatch**.
4. Watch **Ingress → Route → Judge → Egress** light up in real time.
5. Open **Telemetry** for request counts, token savings, routing mix, and the audit table.
6. Open **Policies** to compare the two rule sets side by side.

---

## API

### `POST /v1/chat/completions`

```json
{
  "query": "reset my password",
  "use_case": "customer_support"
}
```

`use_case` is `customer_support` or `internal_copilot`.

### All endpoints

| Method | Path                       | Purpose                       |
| ------ | -------------------------- | ----------------------------- |
| GET    | `/`                        | Control-room website          |
| POST   | `/v1/chat/completions`     | Inline gate                   |
| GET    | `/v1/policies`             | Policy configs                |
| GET    | `/v1/telemetry`            | Metrics + recent audit rows   |

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

One process serves the API and the site. No build step.

---

## Status

Prototype. Deterministic guardrails, routing, and judge scoring are implemented; the judge model itself is stubbed and swappable. Audit log is append-only JSONL — production deployments should chain and sign entries for tamper evidence.
