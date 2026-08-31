from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from statistics import median
import base64
import hashlib
import hmac
import json
import os
import secrets
import time

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from config import POLICIES
from evaluator import AIAsJudge
from guardrails import DeterministicGuardrail
from router import SemanticRouter

IS_VERCEL = os.environ.get("VERCEL") == "1"
IS_RENDER = bool(os.environ.get("RENDER"))
# Use /tmp on serverless (read-only fs elsewhere); local file for dev/Render disk
if IS_VERCEL:
    AUDIT_PATH = Path("/tmp/audit_log.jsonl")
else:
    AUDIT_PATH = Path(os.environ.get("AUDIT_LOG_PATH", "audit_log.jsonl"))

STATIC_DIR = Path(__file__).parent / "static"
_AUDIT_MEMORY: deque[dict] = deque(maxlen=1000)

# =========================================================
# Auth — server-side credentials, HMAC-signed opaque tokens
# =========================================================
_AUTH_SECRET = os.environ.get("SENTINEL_AUTH_SECRET") or secrets.token_hex(32)
_TOKEN_TTL_SECONDS = 60 * 60 * 8  # 8h

# Demo accounts. Override with SENTINEL_ACCOUNTS env for real deployments.
_DEMO_ACCOUNTS = {
    "demo":  {"password": "sentinel2026", "role": "viewer", "label": "Demo · Product view"},
    "admin": {"password": "controlplane", "role": "admin",  "label": "Admin · Full access"},
}


def _sign(payload: dict) -> str:
    body = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
    sig = hmac.new(_AUTH_SECRET.encode(), body.encode(), hashlib.sha256).hexdigest()[:32]
    return f"{body}.{sig}"


def _verify(token: str) -> dict | None:
    try:
        body, sig = token.split(".", 1)
    except ValueError:
        return None
    expected = hmac.new(_AUTH_SECRET.encode(), body.encode(), hashlib.sha256).hexdigest()[:32]
    if not hmac.compare_digest(sig, expected):
        return None
    try:
        pad = "=" * (-len(body) % 4)
        payload = json.loads(base64.urlsafe_b64decode(body + pad))
    except Exception:
        return None
    if payload.get("exp", 0) < time.time():
        return None
    return payload


def issue_token(user: str, role: str) -> str:
    return _sign({"user": user, "role": role, "iat": int(time.time()), "exp": int(time.time()) + _TOKEN_TTL_SECONDS})


# Very small per-IP throttle (in-memory; resets on restart).
_RATE: dict[str, deque] = {}
_RATE_WINDOW = 60
_RATE_MAX = 60  # 60 req / min / ip


def rate_check(ip: str) -> bool:
    now = time.time()
    bucket = _RATE.setdefault(ip, deque())
    while bucket and bucket[0] < now - _RATE_WINDOW:
        bucket.popleft()
    if len(bucket) >= _RATE_MAX:
        return False
    bucket.append(now)
    return True

app = FastAPI(
    title="Sentinel — ControlPlane API",
    description="Inline AI control plane: guardrail → route → judge → audit.",
    version="1.0.0",
)

# CORS: friendly for demo. Tighten in production.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

guardrail = DeterministicGuardrail()
router = SemanticRouter()
judge = AIAsJudge()


class AIRequest(BaseModel):
    query: str
    use_case: str  # 'customer_support' or 'internal_copilot'


class LoginRequest(BaseModel):
    user: str
    password: str


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def log_audit_trail(data: dict) -> None:
    """Append a signed-ready audit record for every decision."""
    data.setdefault("timestamp", now_iso())
    _AUDIT_MEMORY.append(data)
    try:
        with AUDIT_PATH.open("a", encoding="utf-8") as f:
            f.write(json.dumps(data) + "\n")
    except OSError:
        pass


def read_logs() -> list[dict]:
    rows: list[dict] = []
    try:
        if AUDIT_PATH.exists():
            with AUDIT_PATH.open("r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        rows.append(json.loads(line))
                    except json.JSONDecodeError:
                        continue
    except OSError:
        pass
    return rows if rows else list(_AUDIT_MEMORY)


@app.get("/", include_in_schema=False)
async def index():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/health")
async def health():
    """Liveness probe for Render / Vercel / K8s."""
    return {"status": "ok", "service": "sentinel", "time": now_iso()}


@app.post("/v1/auth/login")
async def auth_login(req: LoginRequest):
    """Server-verified login. Returns a signed token clients attach as Bearer."""
    account = _DEMO_ACCOUNTS.get(req.user.strip().lower())
    # constant-time compare, even for missing accounts
    supplied = req.password.encode()
    expected = (account["password"] if account else "").encode()
    ok = account is not None and hmac.compare_digest(supplied, expected)
    if not ok:
        # No hint about which side was wrong.
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = issue_token(req.user, account["role"])
    return {
        "token": token,
        "user": req.user,
        "role": account["role"],
        "label": account["label"],
        "expires_in": _TOKEN_TTL_SECONDS,
    }


@app.get("/v1/auth/me")
async def auth_me(authorization: str | None = Header(default=None)):
    """Verify a token. Client uses this to detect expired sessions on load."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    payload = _verify(authorization[7:])
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return {"user": payload["user"], "role": payload["role"], "exp": payload["exp"]}


@app.get("/v1/policies")
async def get_policies():
    return POLICIES


@app.get("/v1/telemetry")
async def telemetry():
    logs = read_logs()
    success = [row for row in logs if row.get("event") == "success"]
    blocked = [row for row in logs if str(row.get("event", "")).startswith("blocked")]
    flagged = [row for row in logs if row.get("event") == "flagged_hitl"]

    # Illustrative baseline: every request would have hit a Frontier model at ~150 tok.
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

    avg_latency = round(sum(latencies) / len(latencies), 2) if latencies else 0
    med_latency = round(median(latencies), 2) if latencies else 0

    return {
        "total": len(logs),
        "success": len(success),
        "blocked": len(blocked),
        "flagged": len(flagged),
        "avg_latency_ms": avg_latency,
        "median_latency_ms": med_latency,
        "token_savings": max(0, baseline_cost - actual_cost),
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
    if not req.query or not req.query.strip():
        raise HTTPException(status_code=400, detail="Empty prompt")

    policy = POLICIES[req.use_case]
    query_preview = req.query[:160]

    # 1. Ingress guardrail (pre-response gate)
    is_safe, reason, gr_latency = guardrail.scan(req.query, policy["block_pii"])
    if not is_safe:
        log_audit_trail({
            "event": "blocked_ingress",
            "reason": reason,
            "use_case": req.use_case,
            "query": query_preview,
            "model": None,
            "cost_tokens": 0,
            "confidence": None,
            "latency_ms": round((time.perf_counter() - start_total) * 1000, 2),
        })
        raise HTTPException(status_code=403, detail=f"Blocked: {reason}")

    # 2. Semantic routing (cache → SLM → Frontier)
    response_text, model_used, cost = router.route_query(req.query)

    # 3. Egress evaluation (predictive verification)
    hitl = False
    if model_used != "Cache":
        decision, confidence = judge.evaluate(
            req.query, response_text, policy["hallucination_threshold"]
        )
        if decision == "BLOCK":
            log_audit_trail({
                "event": "blocked_egress",
                "reason": "High hallucination risk",
                "use_case": req.use_case,
                "query": query_preview,
                "model": model_used,
                "cost_tokens": cost,
                "confidence": confidence,
                "latency_ms": round((time.perf_counter() - start_total) * 1000, 2),
            })
            raise HTTPException(status_code=422, detail="Blocked: High hallucination risk")
        if decision == "FLAG_FOR_REVIEW" and policy["allow_hitl"]:
            response_text = "[FLAGGED FOR REVIEW] " + response_text
            hitl = True
            log_audit_trail({
                "event": "flagged_hitl",
                "reason": "Confidence below policy threshold",
                "use_case": req.use_case,
                "query": query_preview,
                "model": model_used,
                "cost_tokens": cost,
                "confidence": confidence,
                "latency_ms": round((time.perf_counter() - start_total) * 1000, 2),
            })
        elif decision == "FLAG_FOR_REVIEW" and not policy["allow_hitl"]:
            log_audit_trail({
                "event": "blocked_egress",
                "reason": "Flagged but HITL disabled",
                "use_case": req.use_case,
                "query": query_preview,
                "model": model_used,
                "cost_tokens": cost,
                "confidence": confidence,
                "latency_ms": round((time.perf_counter() - start_total) * 1000, 2),
            })
            raise HTTPException(status_code=422, detail="Blocked: Flagged but HITL disabled")
    else:
        decision, confidence = "ALLOW", 1.0

    total_latency = (time.perf_counter() - start_total) * 1000
    over_budget = total_latency > policy["latency_budget_ms"]

    if not hitl:
        log_audit_trail({
            "event": "success",
            "reason": decision,
            "use_case": req.use_case,
            "query": query_preview,
            "model": model_used,
            "latency_ms": round(total_latency, 2),
            "cost_tokens": cost,
            "confidence": confidence,
        })

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


# Static assets with cache headers
if STATIC_DIR.exists():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR), name="assets")


@app.exception_handler(404)
async def not_found(_request, _exc):
    return JSONResponse({"detail": "Not found", "hint": "See /docs for API."}, status_code=404)
