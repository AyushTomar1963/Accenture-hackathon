class SemanticRouter:
    """Simulates semantic caching and model routing for cost optimization."""

    def __init__(self):
        self.cache = {
            "reset my password": "Go to Settings → Security → Reset password. A confirmation email will arrive within two minutes.",
            "what are your hours": "Support is available 24/7 via chat. Phone coverage is 8:00–20:00 local time, Monday through Friday.",
            "how do i cancel": "Open Billing → Subscription → Cancel plan. Access remains active until the end of the current billing cycle.",
        }

    def route_query(self, query: str) -> tuple[str, str, int]:
        key = query.lower().strip().rstrip("?.!")
        if key in self.cache:
            return self.cache[key], "Cache", 0

        complexity = len(query.split())
        if complexity < 10:
            return (
                f"Here is a concise answer based on your request: {query.strip()}",
                "Local SLM (Llama 3 8B)",
                15,
            )
        return (
            f"Deep-reasoned response for: {query.strip()}\n\n"
            "I weighed policy constraints, prior tickets, and product context before answering. "
            "The recommended next step is to confirm the account scope, then apply the least-privilege action.",
            "Frontier API (GPT-4)",
            150,
        )
