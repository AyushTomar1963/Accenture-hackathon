<div align="center">

# Sentinel — ControlPlane

**An inline AI control plane for the enterprise.**
Gate every prompt. Route to the cheapest capable model. Judge every answer. Audit every decision.
All in one hop, in one process.

[![Live demo](https://img.shields.io/badge/live-accenture--rho.vercel.app-a100ff?style=flat-square)](https://accenture-rho.vercel.app)
[![FastAPI](https://img.shields.io/badge/api-FastAPI-0e0a1c?style=flat-square)]()
[![License](https://img.shields.io/badge/license-MIT-6a00c9?style=flat-square)]()

</div>

---

## The problem

Enterprise deployments of large language models fail in three predictable ways:

1. **Data leakage.** PII, secrets, and restricted keywords cross the wire because nothing inspects the prompt.
2. **Cost drift.** Every request hits a frontier model — including the ones that a cached answer or a small model could have handled.
3. **Untraceable hallucinations.** A confidently wrong answer ships to the user, and nothing on the wire proves why the system chose to send it.

Point solutions exist for each. Stitching them together across teams is where the cost is.

## The product

Sentinel is a **single inline layer** between your application and any model provider. It closes all three gaps in one hop:

```
Prompt
  │
  ▼
[1] Ingress guardrail      →  deterministic PII + restricted-keyword scan
  │
  ▼
[2] Semantic router        →  cache · local SLM · frontier LLM
  │
  ▼
[3] AI-as-judge            →  allow · flag · block, against your policy
  │
  ▼
[4] Egress + audit log     →  signed record of every decision
```

- **Ingress** is fast and rule-based — zero-trust for the edge.
- **Routing** spends tokens only when the question deserves them.
- **Judge** is a second model that scores hallucination risk against the active policy.
- **Audit** records event, use case, model, latency, cost, and confidence for every decision.

## One control plane, two enterprise postures

The same pipeline enforces radically different policies depending on the workload. Switching between them is one field in the request body — no redeploy.

| Control              | Customer Support        | Internal Copilot         |
| -------------------- | ----------------------- | ------------------------ |
| Latency budget       | 30 ms                   | 500 ms                   |
| Block PII            | Yes                     | No                       |
| Hallucination gate   | 0.85 (strict)           | 0.60 (relaxed)           |
| Human in the loop    | Off — real-time only    | On — flag for review     |

## Demo

**Live:** [accenture-rho.vercel.app](https://accenture-rho.vercel.app)

Or click **Run guided demo** in the app to watch all four decision types (cache · SLM · frontier · block) fire hands-free.

| Prompt                                    | Expected path                        |
| ----------------------------------------- | ------------------------------------ |
| `reset my password`                       | Cache hit · 0 tokens                 |
| Short question                            | Local SLM (Llama 3 8B)               |
| Long CFO-style prompt                     | Frontier API (GPT-4)                 |
| Email or SSN on Customer Support          | Ingress block (PII)                  |
| Same email on Internal Copilot            | Allowed (PII policy off)             |
| `confidential_project_x`                  | Ingress block (restricted keyword)   |

## Quick start

```bash
python -m pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Open **http://127.0.0.1:8000**.

Optional Streamlit telemetry dashboard:

```bash
python -m pip install -r requirements-dashboard.txt
streamlit run dashboard.py
```

## API

### `POST /v1/chat/completions`

```json
{
  "query": "reset my password",
  "use_case": "customer_support"
}
```

Response includes the model routed to, judge decision, confidence score, latency, guardrail overhead, and token cost.

### All endpoints

| Method | Path                    | Purpose                                 |
| ------ | ----------------------- | --------------------------------------- |
| GET    | `/`                     | Control-room web UI                     |
| GET    | `/health`               | Liveness probe                          |
| POST   | `/v1/chat/completions`  | Inline gate + route + judge             |
| GET    | `/v1/policies`          | Configured policies                     |
| GET    | `/v1/telemetry`         | Metrics + recent audit rows             |
| GET    | `/docs`                 | OpenAPI (Swagger) UI                    |

## Deployment

The service is a single ASGI app and deploys anywhere Python runs.

### Vercel (current)

`vercel.json` is preconfigured. Push to `main` and Vercel picks up FastAPI automatically.

### Render

`render.yaml` is preconfigured. In the Render dashboard: **New → Blueprint**, point at this repo, deploy. Health check hits `/health`.

Manual settings if not using the blueprint:

- **Runtime:** Python 3.11
- **Build:** `pip install -r requirements.txt`
- **Start:** `uvicorn main:app --host 0.0.0.0 --port $PORT`
- **Health check:** `/health`

### Any container platform

```bash
uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}
```

## Project structure

```
├── main.py                   FastAPI app: routes, static, telemetry, audit
├── config.py                 Two enterprise policy postures
├── guardrails.py             Deterministic ingress scan (PII + keywords)
├── router.py                 Cache / SLM / Frontier routing
├── evaluator.py              AI-as-judge (hallucination scoring)
├── dashboard.py              Optional Streamlit telemetry
├── static/
│   ├── index.html            Control-room UI
│   ├── styles.css            Vibrant Accenture-inspired theme
│   └── app.js                Playground · Telemetry · Policies
├── requirements.txt
├── requirements-dashboard.txt
├── vercel.json               Vercel config
├── render.yaml               Render blueprint
└── Procfile                  Generic PaaS start command
```

## Stack

FastAPI · Uvicorn · Pydantic · vanilla HTML / CSS / JS · optional Streamlit for the analyst view.

One process serves the API and the site. No build step. No framework lock-in on the front end.

## Design principles

- **Inline, not sidecar.** A control plane that lives outside the request path can be bypassed. Sentinel is on the wire.
- **Deterministic first, probabilistic second.** Regex and keyword scans catch the obvious. The model-based judge is the second layer, not the first.
- **Cost is a policy.** Routing decisions are visible per request. The dashboard shows tokens saved vs. an always-Frontier baseline in real time.
- **Every decision is a record.** The audit log is append-only JSONL. Production deployments should chain and sign entries for tamper evidence.

## Status

Prototype — production-quality architecture with stubbed models. The judge and router use deterministic placeholders so demos are reproducible; both are swappable for real model calls behind the same interface.

## License

MIT.
