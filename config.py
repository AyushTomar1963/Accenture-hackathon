# Policy configurations for different enterprise environments
POLICIES = {
    "customer_support": {
        "label": "Customer Support",
        "description": "Real-time assistance. Tight latency, strict PII, no human-in-the-loop.",
        "latency_budget_ms": 30,
        "block_pii": True,
        "hallucination_threshold": 0.85,
        "allow_hitl": False,
        "tone": "strict",
    },
    "internal_copilot": {
        "label": "Internal Copilot",
        "description": "Employee assistant. Relaxed latency, HITL review, deeper reasoning allowed.",
        "latency_budget_ms": 500,
        "block_pii": False,
        "hallucination_threshold": 0.60,
        "allow_hitl": True,
        "tone": "relaxed",
    },
}
