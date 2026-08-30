from datetime import datetime, timezone
from pathlib import Path
import json
import time

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from config import POLICIES
from evaluator import AIAsJudge
from guardrails import DeterministicGuardrail
from router import SemanticRouter

AUDIT_PATH = Path("audit_log.jsonl")
STATIC_DIR = Path(__file__).parent / "static"

app = FastAPI(title="ControlPlane Sentinel API")
guardrail = DeterministicGuardrail()
router = SemanticRouter()
judge = AIAsJudge()

if STATIC_DIR.exists():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR), name="assets")


class AIRequest(BaseModel):
    query: str
    use_case: str  # 'customer_support' or 'internal_copilot'


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def log_audit_trail(data: dict) -> None:
    """Maintains a clear audit trail behind every decision."""
    data.setdefault("timestamp", now_iso())
    with AUDIT_PATH.open("a", encoding="utf-8") as f:
        f.write(json.dumps(data) + "\n")


def read_logs() -> list[dict]:
    if not AUDIT_PATH.exists():
        return []
    rows = []
    with AUDIT_PATH.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return rows


@app.get("/")
async def index():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/v1/policies")
async def get_policies():
    return POLICIES


@app.get("/v1/telemetry")
async def telemetry():
    logs = read_logs()
    success = [row for row in logs if row.get("event") == "success"]
    blocked = [row for row in logs if str(row.get("event", "")).startswith("blocked")]
    flagged = [row for row in logs if row.get("event") == "flagged_hitl"]

    baseline_cost = len(success) * 150
    actual_cost = sum(row.get("cost_tokens", 0) or 0 for row in success)
    latencies = [row.get("latency_ms", 0) or 0 for row in success]

    models: dict[str, int] = {}
    events: dict[str, int] = {}
    use_cases: dict[str, int] = {}
    for row in logs:
        model = row.get("model") or "—"
        models[model] = models.get(model, 0) + 1
        event = row.get("event") or "unknown"
        events[event] = events.get(event, 0) + 1
        use_case = row.get("use_case") or "unknown"
        use_cases[use_case] = use_cases.get(use_case, 0) + 1

    return {
        "total": len(logs),
        "success": len(success),
        "blocked": len(blocked),
        "flagged": len(flagged),
        "avg_latency_ms": round(sum(latencies) / len(latencies), 2) if latencies else 0,
        "token_savings": baseline_cost - actual_cost,
        "actual_cost": actual_cost,
        "baseline_cost": baseline_cost,
        "models": models,
        "events": events,
        "use_cases": use_cases,
        "logs": list(reversed(logs[-80:])),
    }


@app.post("/v1/chat/completions")
async def process_request(req: AIRequest):
    start_total = time.perf_counter()
    if req.use_case not in POLICIES:
        raise HTTPException(status_code=400, detail="Unknown use case")

    policy = POLICIES[req.use_case]
    query_preview = req.query[:160]

    # 1. Ingress Guardrails (pre-response gate)
    is_safe, reason, gr_latency = guardrail.scan(req.query, policy["block_pii"])
    if not is_safe:
        log_audit_trail(
            {
                "event": "blocked_ingress",
                "reason": reason,
                "use_case": req.use_case,
                "query": query_preview,
                "model": None,
                "cost_tokens": 0,
                "confidence": None,
                "latency_ms": round((time.perf_counter() - start_total) * 1000, 2),
            }
        )
        raise HTTPException(status_code=403, detail=f"Blocked: {reason}")

    # 2. Semantic routing
    response_text, model_used, cost = router.route_query(req.query)

    # 3. Egress evaluation (predictive verification)
    hitl = False
    if model_used != "Cache":
        decision, confidence = judge.evaluate(req.query, response_text, policy["hallucination_threshold"])
        if decision == "BLOCK":
            log_audit_trail(
                {
                    "event": "blocked_egress",
                    "reason": "High Hallucination Risk",
                    "use_case": req.use_case,
                    "query": query_preview,
                    "model": model_used,
                    "cost_tokens": cost,
                    "confidence": confidence,
                    "latency_ms": round((time.perf_counter() - start_total) * 1000, 2),
                }
            )
            raise HTTPException(status_code=500, detail="Blocked: High Hallucination Risk")
        if decision == "FLAG_FOR_REVIEW" and policy["allow_hitl"]:
            response_text = "[FLAGGED FOR REVIEW] " + response_text
            hitl = True
            log_audit_trail(
                {
                    "event": "flagged_hitl",
                    "reason": "Confidence below policy threshold",
                    "use_case": req.use_case,
                    "query": query_preview,
                    "model": model_used,
                    "cost_tokens": cost,
                    "confidence": confidence,
                    "latency_ms": round((time.perf_counter() - start_total) * 1000, 2),
                }
            )
        elif decision == "FLAG_FOR_REVIEW" and not policy["allow_hitl"]:
            # Real-time path cannot wait for a human — treat as block.
            log_audit_trail(
                {
                    "event": "blocked_egress",
                    "reason": "Flagged but HITL disabled",
                    "use_case": req.use_case,
                    "query": query_preview,
                    "model": model_used,
                    "cost_tokens": cost,
                    "confidence": confidence,
                    "latency_ms": round((time.perf_counter() - start_total) * 1000, 2),
                }
            )
            raise HTTPException(status_code=500, detail="Blocked: Flagged but HITL disabled")
    else:
        decision, confidence = "ALLOW", 1.0

    total_latency = (time.perf_counter() - start_total) * 1000
    over_budget = total_latency > policy["latency_budget_ms"]

    if not hitl:
        log_audit_trail(
            {
                "event": "success",
                "reason": decision,
                "use_case": req.use_case,
                "query": query_preview,
                "model": model_used,
                "latency_ms": round(total_latency, 2),
                "cost_tokens": cost,
                "confidence": confidence,
            }
        )

    return {
        "response": response_text,
        "metadata": {
            "routed_to": model_used,
            "decision": decision,
            "hitl": hitl,
            "latency_ms": round(total_latency, 2),
            "latency_budget_ms": policy["latency_budget_ms"],
            "over_budget": over_budget,
            "guardrail_overhead_ms": round(gr_latency, 2),
            "confidence_score": confidence,
            "cost_tokens": cost,
            "use_case": req.use_case,
        },
    }
