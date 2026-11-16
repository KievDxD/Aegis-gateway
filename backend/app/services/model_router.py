from dataclasses import dataclass
from datetime import datetime, timezone
import threading
import time
from typing import Literal

CircuitState = Literal["CLOSED", "OPEN", "HALF_OPEN"]


@dataclass(frozen=True)
class RoutingDecision:
    """Result of provider/model routing with circuit breaker failover metadata."""

    primary_model: str
    routed_model: str
    primary_provider: str
    routed_provider: str
    fallback_used: bool
    circuit_state: CircuitState
    reason: str
    routing_strategy: str = "direct"


@dataclass
class _ProviderCircuit:
    provider_id: str
    display_name: str
    models: list[str]
    state: CircuitState = "CLOSED"
    total_requests: int = 0
    failed_requests: int = 0
    total_latency_ms: float = 0.0
    opened_at: float | None = None
    last_incident: str | None = None


_MODEL_PROVIDER: dict[str, str] = {
    "gpt-4o": "openai",
    "gpt-4o-mini": "openai",
    "gemini-2.5-pro": "google",
    "gemini-2.5-flash": "google",
    "claude-sonnet-4": "anthropic",
}

_FALLBACK_CHAINS: dict[str, list[str]] = {
    "gpt-4o": ["gemini-2.5-pro", "claude-sonnet-4"],
    "gpt-4o-mini": ["gemini-2.5-flash", "gpt-4o"],
    "gemini-2.5-pro": ["claude-sonnet-4", "gpt-4o"],
    "gemini-2.5-flash": ["gpt-4o-mini", "gemini-2.5-pro"],
    "claude-sonnet-4": ["gpt-4o", "gemini-2.5-pro"],
}


_COMPLEX_KEYWORDS = (
    "architecture",
    "kubernetes",
    "distributed",
    "microservice",
    "security",
    "algorithm",
    "implement",
    "refactor",
    "design",
    "benchmark",
    "zero-trust",
    "multi-region",
    "sql",
    "typescript",
    "database",
    "consensus",
    "pipeline",
)


class ModelRouter:
    """Multi-provider model router with automatic Circuit Breaker failover and smart routing."""

    COOLDOWN_SECONDS: float = 20.0

    @staticmethod
    def classify_prompt_complexity(prompt_text: str) -> Literal["simple", "complex"]:
        """Heuristically classify whether a prompt needs flagship reasoning or fast low-cost routing."""
        cleaned = prompt_text.strip()
        if len(cleaned) >= 140 or "```" in cleaned:
            return "complex"
        lowered = cleaned.lower()
        if any(keyword in lowered for keyword in _COMPLEX_KEYWORDS):
            return "complex"
        return "simple"

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._circuits: dict[str, _ProviderCircuit] = {}
        self.reset()

    def reset(self) -> None:
        """Reset all provider circuit breakers and health telemetry."""
        with self._lock:
            self._circuits = {
                "openai": _ProviderCircuit(
                    provider_id="openai",
                    display_name="OpenAI",
                    models=["gpt-4o", "gpt-4o-mini"],
                ),
                "google": _ProviderCircuit(
                    provider_id="google",
                    display_name="Google Gemini",
                    models=["gemini-2.5-pro", "gemini-2.5-flash"],
                ),
                "anthropic": _ProviderCircuit(
                    provider_id="anthropic",
                    display_name="Anthropic Claude",
                    models=["claude-sonnet-4"],
                ),
            }

    @staticmethod
    def provider_for_model(model: str) -> str:
        """Resolve upstream provider identifier for a model name."""
        if model in _MODEL_PROVIDER:
            return _MODEL_PROVIDER[model]
        lowered = model.lower()
        if "gemini" in lowered:
            return "google"
        if "claude" in lowered:
            return "anthropic"
        return "openai"

    def resolve_model(
        self,
        requested_model: str,
        simulate_outage: bool = False,
        prompt_text: str = "",
    ) -> RoutingDecision:
        """Select primary model, smart cost-aware tier, or failover model on circuit outage."""
        strategy = "direct"
        effective_requested = requested_model
        if requested_model == "aegis-auto":
            complexity = self.classify_prompt_complexity(prompt_text)
            if complexity == "simple":
                effective_requested = "gemini-2.5-flash"
                strategy = "cost-optimized"
            else:
                effective_requested = "gpt-4o"
                strategy = "flagship-reasoning"

        primary_provider = self.provider_for_model(effective_requested)
        now_mono = time.monotonic()

        with self._lock:
            circuit = self._circuits[primary_provider]

            if simulate_outage:
                circuit.total_requests += 1
                circuit.failed_requests += 1
                circuit.state = "OPEN"
                circuit.opened_at = now_mono
                circuit.last_incident = (
                    f"{datetime.now(timezone.utc).strftime('%H:%M:%S UTC')} — "
                    f"Upstream outage triggered on {effective_requested}; circuit opened."
                )
                fallback_model = self._pick_healthy_fallback_locked(effective_requested)
                fallback_provider = self.provider_for_model(fallback_model)
                return RoutingDecision(
                    primary_model=requested_model,
                    routed_model=fallback_model,
                    primary_provider=primary_provider,
                    routed_provider=fallback_provider,
                    fallback_used=True,
                    circuit_state="OPEN",
                    reason=(
                        f"Circuit Breaker OPEN for {circuit.display_name} ({effective_requested}); "
                        f"routed automatically to {fallback_model}."
                    ),
                    routing_strategy=strategy,
                )

            if circuit.state == "OPEN":
                elapsed = now_mono - (circuit.opened_at or now_mono)
                if elapsed < self.COOLDOWN_SECONDS:
                    fallback_model = self._pick_healthy_fallback_locked(effective_requested)
                    fallback_provider = self.provider_for_model(fallback_model)
                    return RoutingDecision(
                        primary_model=requested_model,
                        routed_model=fallback_model,
                        primary_provider=primary_provider,
                        routed_provider=fallback_provider,
                        fallback_used=True,
                        circuit_state="OPEN",
                        reason=(
                            f"Circuit Breaker active ({circuit.display_name}); "
                            f"serving via failover {fallback_model}."
                        ),
                        routing_strategy=strategy,
                    )
                circuit.state = "HALF_OPEN"

            return RoutingDecision(
                primary_model=requested_model,
                routed_model=effective_requested,
                primary_provider=primary_provider,
                routed_provider=primary_provider,
                fallback_used=False,
                circuit_state=circuit.state,
                reason=(
                    f"Smart router selected {effective_requested} ({strategy})."
                    if strategy != "direct"
                    else "Primary provider healthy."
                ),
                routing_strategy=strategy,
            )

    def _pick_healthy_fallback_locked(self, requested_model: str) -> str:
        """Return first non-OPEN fallback model from the configured chain."""
        candidates = _FALLBACK_CHAINS.get(requested_model, ["gemini-2.5-pro", "claude-sonnet-4"])
        for candidate in candidates:
            provider = self.provider_for_model(candidate)
            if self._circuits[provider].state != "OPEN":
                return candidate
        return candidates[0]

    def record_success(self, routed_model: str, latency_ms: float) -> None:
        """Record a successful upstream completion and close HALF_OPEN circuits."""
        provider_id = self.provider_for_model(routed_model)
        with self._lock:
            circuit = self._circuits[provider_id]
            circuit.total_requests += 1
            circuit.total_latency_ms += max(0.0, latency_ms)
            if circuit.state == "HALF_OPEN":
                circuit.state = "CLOSED"
                circuit.opened_at = None

    def record_failure(self, model: str, reason: str) -> str:
        """Record an upstream failure, open its circuit, and return a fallback model."""
        provider_id = self.provider_for_model(model)
        with self._lock:
            circuit = self._circuits[provider_id]
            circuit.total_requests += 1
            circuit.failed_requests += 1
            circuit.state = "OPEN"
            circuit.opened_at = time.monotonic()
            circuit.last_incident = reason
            return self._pick_healthy_fallback_locked(model)

    def get_providers_health(self) -> list[dict[str, object]]:
        """Return live Circuit Breaker telemetry across all upstream LLM providers."""
        now_mono = time.monotonic()
        with self._lock:
            items: list[dict[str, object]] = []
            for circuit in self._circuits.values():
                # Auto-transition expired OPEN circuits to HALF_OPEN for visibility
                if circuit.state == "OPEN" and circuit.opened_at is not None:
                    if (now_mono - circuit.opened_at) >= self.COOLDOWN_SECONDS:
                        circuit.state = "HALF_OPEN"

                successful = max(0, circuit.total_requests - circuit.failed_requests)
                success_rate = (
                    round((successful / circuit.total_requests) * 100.0, 1)
                    if circuit.total_requests > 0
                    else 100.0
                )
                avg_latency = (
                    round(circuit.total_latency_ms / successful, 2)
                    if successful > 0
                    else 0.0
                )
                primary_model = circuit.models[0]
                fallback_target = _FALLBACK_CHAINS.get(primary_model, ["gemini-2.5-pro"])[0]
                items.append(
                    {
                        "provider_id": circuit.provider_id,
                        "display_name": circuit.display_name,
                        "state": circuit.state,
                        "models": list(circuit.models),
                        "fallback_target": fallback_target,
                        "total_requests": circuit.total_requests,
                        "failed_requests": circuit.failed_requests,
                        "success_rate_pct": success_rate,
                        "avg_latency_ms": avg_latency,
                        "last_incident": circuit.last_incident,
                    }
                )
            return items


model_router = ModelRouter()
