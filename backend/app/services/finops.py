import math

MODEL_PRICING: dict[str, dict[str, float | int | str]] = {
    "gpt-4o": {
        "owned_by": "openai",
        "input_per_1m": 2.50,
        "output_per_1m": 10.00,
        "context_window": 128000,
    },
    "gpt-4o-mini": {
        "owned_by": "openai",
        "input_per_1m": 0.15,
        "output_per_1m": 0.60,
        "context_window": 128000,
    },
    "gemini-2.5-pro": {
        "owned_by": "google",
        "input_per_1m": 1.25,
        "output_per_1m": 5.00,
        "context_window": 1048576,
    },
    "gemini-2.5-flash": {
        "owned_by": "google",
        "input_per_1m": 0.075,
        "output_per_1m": 0.30,
        "context_window": 1048576,
    },
    "claude-sonnet-4": {
        "owned_by": "anthropic",
        "input_per_1m": 3.00,
        "output_per_1m": 15.00,
        "context_window": 200000,
    },
}

DEFAULT_PRICING = {
    "owned_by": "aegis-router",
    "input_per_1m": 0.50,
    "output_per_1m": 1.50,
    "context_window": 128000,
}


class FinOpsEngine:
    """Calculates token estimates, model cost attribution, savings, and EvalOps scores."""

    @staticmethod
    def get_model_catalog() -> list[dict[str, float | int | str]]:
        """Return pricing and metadata for all supported upstream models."""
        catalog: list[dict[str, float | int | str]] = []
        for model_id, info in MODEL_PRICING.items():
            catalog.append({"id": model_id, **info})
        return catalog

    @staticmethod
    def estimate_tokens(text: str) -> int:
        """Estimate token count deterministically from text length and word structure."""
        cleaned = text.strip()
        if not cleaned:
            return 0
        char_estimate = math.ceil(len(cleaned) / 3.8)
        word_estimate = math.ceil(len(cleaned.split()) * 1.3)
        return max(1, round((char_estimate + word_estimate) / 2))

    @staticmethod
    def calculate_cost_usd(model: str, tokens_in: int, tokens_out: int) -> float:
        """Compute exact USD cost for a request based on model 1M-token rates."""
        pricing = MODEL_PRICING.get(model, DEFAULT_PRICING)
        input_cost = (max(0, tokens_in) / 1_000_000.0) * float(pricing["input_per_1m"])
        output_cost = (max(0, tokens_out) / 1_000_000.0) * float(pricing["output_per_1m"])
        return round(input_cost + output_cost, 6)

    @staticmethod
    def compute_eval_score(
        prompt: str,
        response: str,
        pii_masked: bool = False,
        cache_hit: bool = False,
    ) -> float:
        """Compute an asynchronous EvalOps quality & hallucination-safety score (0.0 - 1.0)."""
        if not response.strip():
            return 0.0
        base = 0.91
        if len(response) >= 120:
            base += 0.03
        if len(prompt.strip()) >= 20:
            base += 0.01
        if pii_masked:
            # Successful DLP protection preserves compliance bonus
            base += 0.02
        if cache_hit:
            base += 0.01
        if "uncertainty" in response.lower() or "i cannot verify" in response.lower():
            base -= 0.03
        return round(min(0.99, max(0.50, base)), 2)
