from datetime import datetime
from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, Field


class ChatMessage(BaseModel):
    """OpenAI-compatible chat message payload."""

    role: Literal["system", "user", "assistant", "tool"]
    content: str


class ChatCompletionRequest(BaseModel):
    """OpenAI-compatible /v1/chat/completions request schema."""

    model: str = "gpt-4o"
    messages: list[ChatMessage] = Field(..., min_length=1)
    stream: bool = False
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)
    max_tokens: int = Field(default=512, ge=1, le=16384)
    user: str | None = None


class AegisTelemetryMetadata(BaseModel):
    """Aegis governance metadata attached to proxy responses."""

    trace_id: str
    tenant_id: str
    status: str
    cache_hit: bool
    similarity_score: float
    pii_redacted_count: int
    pii_entities: list[str]
    risk_score: float
    threat_categories: list[str]
    cost_usd: float
    saved_usd: float
    ttft_ms: float
    latency_ms: float
    eval_score: float
    provider_mode: str


class ChatChoice(BaseModel):
    """OpenAI-compatible completion choice."""

    index: int = 0
    message: ChatMessage
    finish_reason: str = "stop"


class ChatUsage(BaseModel):
    """OpenAI-compatible token usage."""

    prompt_tokens: int
    completion_tokens: int
    total_tokens: int


class ChatCompletionResponse(BaseModel):
    """OpenAI-compatible completion response enriched with Aegis telemetry."""

    id: str
    object: str = "chat.completion"
    created: int
    model: str
    choices: list[ChatChoice]
    usage: ChatUsage
    aegis: AegisTelemetryMetadata


class ModelInfo(BaseModel):
    """OpenAI-compatible model listing entry with FinOps pricing."""

    id: str
    object: str = "model"
    created: int
    owned_by: str
    input_cost_per_1m: float
    output_cost_per_1m: float
    context_window: int


class ModelListResponse(BaseModel):
    """OpenAI-compatible /v1/models response."""

    object: str = "list"
    data: list[ModelInfo]


class TenantPolicyResponse(BaseModel):
    """Tenant governance policy representation."""

    model_config = ConfigDict(from_attributes=True)

    tenant_id: str
    name: str
    injection_threshold: float
    pii_redaction_enabled: bool
    cache_enabled: bool
    cache_similarity_threshold: float
    rate_limit_rpm: int
    max_daily_budget_usd: float
    updated_at: datetime


class TenantPolicyUpdate(BaseModel):
    """Editable tenant governance parameters."""

    name: str | None = None
    injection_threshold: float | None = Field(default=None, ge=0.1, le=1.0)
    pii_redaction_enabled: bool | None = None
    cache_enabled: bool | None = None
    cache_similarity_threshold: float | None = Field(default=None, ge=0.5, le=0.99)
    rate_limit_rpm: int | None = Field(default=None, ge=1, le=10000)
    max_daily_budget_usd: float | None = Field(default=None, ge=0.0, le=100000.0)


class AuditTraceSummary(BaseModel):
    """Compact trace row for the Live Trace Inspector table."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    timestamp: datetime
    tenant_id: str
    model: str
    status: str
    prompt_sanitized: str
    response_preview: str
    tokens_in: int
    tokens_out: int
    cost_usd: float
    saved_usd: float
    ttft_ms: float
    latency_ms: float
    risk_score: float
    threat_categories: list[str]
    pii_entities: list[str]
    pii_redacted_count: int
    cache_hit: bool
    similarity_score: float
    eval_score: float


class AuditTraceDetail(AuditTraceSummary):
    """Detailed trace payload inspected in the drawer."""

    prompt_original: str


class PaginatedTracesResponse(BaseModel):
    """Paginated trace list response."""

    total: int
    limit: int
    offset: int
    items: list[AuditTraceSummary]


class HourlyMetricPoint(BaseModel):
    """Time-series metric bucket."""

    hour: str
    requests: int
    blocked: int
    cached: int
    cost_usd: float
    saved_usd: float
    avg_ttft_ms: float


class ModelCostBreakdown(BaseModel):
    """Cost and request share per model."""

    model: str
    requests: int
    cost_usd: float
    saved_usd: float
    tokens_total: int


class AdminMetricsResponse(BaseModel):
    """Aggregated executive FinOps & Security telemetry."""

    total_requests: int
    allowed_requests: int
    cached_requests: int
    pii_masked_requests: int
    blocked_requests: int
    cache_hit_rate_pct: float
    total_cost_usd: float
    total_saved_usd: float
    total_pii_redacted: int
    avg_ttft_ms: float
    avg_latency_ms: float
    avg_eval_score: float
    status_distribution: dict[str, int]
    model_breakdown: list[ModelCostBreakdown]
    hourly_series: list[HourlyMetricPoint]


class SimulateTrafficRequest(BaseModel):
    """Payload to trigger a burst of realistic multi-tenant traffic."""

    count: int = Field(default=8, ge=1, le=30)
    tenant_id: str | None = None


class SimulateTrafficResponse(BaseModel):
    """Summary returned after generating simulated traffic."""

    generated_count: int
    breakdown: dict[str, int]
    total_cost_usd: float
    total_saved_usd: float
    traces: list[dict[str, Any]]
