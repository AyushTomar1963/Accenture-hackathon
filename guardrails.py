import re
import time


class DeterministicGuardrail:
    """Zero-trust layer for fast, rule-based heuristics."""

    def __init__(self):
        self.pii_pattern = re.compile(
            r"\b\d{3}-\d{2}-\d{4}\b|"
            r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b|"
            r"\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}\b"
        )
        self.toxic_words = ["confidential_project_x", "internal_pass"]

    def scan(self, text: str, block_pii: bool) -> tuple[bool, str, float]:
        start = time.perf_counter()
        if block_pii and self.pii_pattern.search(text):
            return False, "PII Detected", (time.perf_counter() - start) * 1000

        lowered = text.lower()
        for word in self.toxic_words:
            if word in lowered:
                return False, "Restricted Keyword Detected", (time.perf_counter() - start) * 1000

        return True, "Clean", (time.perf_counter() - start) * 1000
