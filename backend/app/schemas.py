from datetime import datetime
from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, Field


class ToolCallFunction(BaseModel):
    """OpenAI-compatible invoked function signature."""

    name: str
    arguments: str


class ToolCallItem(BaseModel):
    """OpenAI-compatible tool call entry."""

    id: str
    type: Literal["function"] = "function"
    function: ToolCallFunction


class ChatMessage(BaseModel):
    """OpenAI-compatible chat message payload."""

    role: Literal["system", "user", "assistant", "tool"]
    content: str | None = ""
    tool_calls: list[ToolCallItem] | None = None


class ResponseFormatSpec(BaseModel):
    """OpenAI-compatible response_format constraint."""

    type: Literal["text", "json_object"] = "text"


class ToolFunctionDef(BaseModel):
    """OpenAI-compatible tool function definition."""

    name: str
    description: str = ""
    parameters: dict[str, Any] = Field(default_factory=dict)


class ToolSpec(BaseModel):
    """OpenAI-compatible tool declaration."""

    type: Literal["function"] = "function"
    function: ToolFunctionDef


class ChatCompletionRequest(BaseModel):
    """OpenAI-compatible /v1/chat/completions request schema."""

    model: str = "gpt-4o"
    messages: list[ChatMessage] = Field(..., min_length=1)
    stream: bool = False
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)
    max_tokens: int = Field(default=512, ge=1, le=16384)
    user: str | None = None
    response_format: ResponseFormatSpec | None = None
    tools: list[ToolSpec] | None = None


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
    routed_model: str = ""
    fallback_used: bool = False
    routing_strategy: str = "direct"


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
    routed_model: str = ""
    fallback_used: bool = False
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


class VirtualKeyCreate(BaseModel):
    """Payload to issue a new SHA-256 protected Virtual API Key."""

    name: str = Field(..., min_length=2, max_length=128)
    tenant_id: str = Field(default="default", min_length=1, max_length=64)


class VirtualKeyResponse(BaseModel):
    """Virtual API Key metadata (raw secret never exposed after creation)."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    tenant_id: str
    key_prefix: str
    is_active: bool
    created_at: datetime
    last_used_at: datetime | None = None


class VirtualKeyCreatedResponse(VirtualKeyResponse):
    """One-time creation response containing the full raw ag-live-... secret."""

    raw_key: str


class ProviderHealthStatus(BaseModel):
    """Live Circuit Breaker state and reliability metrics per upstream LLM provider."""

    provider_id: str
    display_name: str
    state: Literal["CLOSED", "OPEN", "HALF_OPEN"]
    models: list[str]
    fallback_target: str
    total_requests: int
    failed_requests: int
    success_rate_pct: float
    avg_latency_ms: float
    last_incident: str | None = None


class RedTeamVectorResult(BaseModel):
    """Individual OWASP LLM Red-Team security probe evaluation."""

    id: str
    category: str
    title: str
    attack_sample_masked: str
    expected_action: str
    actual_action: str
    passed: bool
    risk_score: float


class RedTeamBenchmarkRequest(BaseModel):
    """Optional tenant scope for running OWASP LLM Red-Team audit."""

    tenant_id: str = "default"


class RedTeamBenchmarkResponse(BaseModel):
    """Aggregated compliance score and per-vector findings from OWASP Red-Team suite."""

    tenant_id: str
    compliance_score: float
    status: Literal["HARDENED", "DEGRADED", "VULNERABLE"]
    passed_count: int
    total_attacks: int
    injection_threshold: float
    pii_redaction_enabled: bool
    vectors: list[RedTeamVectorResult]
