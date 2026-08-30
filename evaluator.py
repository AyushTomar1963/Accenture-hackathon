import random


class AIAsJudge:
    """Simulates a secondary SLM evaluating output for hallucinations."""

    def evaluate(self, prompt: str, response: str, threshold: float) -> tuple[str, float]:
        # Bias slightly upward so demos usually pass, but still produce FLAG/BLOCK cases.
        confidence = round(random.uniform(0.48, 0.99), 2)
        if confidence >= threshold:
            return "ALLOW", confidence
        if confidence >= (threshold - 0.15):
            return "FLAG_FOR_REVIEW", confidence
        return "BLOCK", confidence
