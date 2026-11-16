export type TraceStatus = "ALLOWED" | "CACHED" | "PII_MASKED" | "BLOCKED";

export type ActiveTab = "overview" | "playground" | "traces" | "policies";

export interface AuditTraceSummary {
  id: string;
  timestamp: string;
  tenant_id: string;
  model: string;
  routed_model: string;
  fallback_used: boolean;
  status: TraceStatus;
  prompt_sanitized: string;
  response_preview: string;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  saved_usd: number;
  ttft_ms: number;
  latency_ms: number;
  risk_score: number;
  threat_categories: string[];
  pii_entities: string[];
  pii_redacted_count: number;
  cache_hit: boolean;
  similarity_score: number;
  eval_score: number;
}

export interface AuditTraceDetail extends AuditTraceSummary {
  prompt_original: string;
}

export interface PaginatedTracesResponse {
  total: number;
  limit: number;
  offset: number;
  items: AuditTraceSummary[];
}

export interface HourlyMetricPoint {
  hour: string;
  requests: number;
  blocked: number;
  cached: number;
  cost_usd: number;
  saved_usd: number;
  avg_ttft_ms: number;
}

export interface ModelCostBreakdown {
  model: string;
  requests: number;
  cost_usd: number;
  saved_usd: number;
  tokens_total: number;
}

export interface AdminMetricsResponse {
  total_requests: number;
  allowed_requests: number;
  cached_requests: number;
  pii_masked_requests: number;
  blocked_requests: number;
  cache_hit_rate_pct: number;
  total_cost_usd: number;
  total_saved_usd: number;
  total_pii_redacted: number;
  avg_ttft_ms: number;
  avg_latency_ms: number;
  avg_eval_score: number;
  status_distribution: Record<string, number>;
  model_breakdown: ModelCostBreakdown[];
  hourly_series: HourlyMetricPoint[];
}

export interface TenantPolicy {
  tenant_id: string;
  name: string;
  injection_threshold: number;
  pii_redaction_enabled: boolean;
  cache_enabled: boolean;
  cache_similarity_threshold: number;
  rate_limit_rpm: number;
  max_daily_budget_usd: number;
  updated_at: string;
}

export interface TenantPolicyUpdate {
  name?: string;
  injection_threshold?: number;
  pii_redaction_enabled?: boolean;
  cache_enabled?: boolean;
  cache_similarity_threshold?: number;
  rate_limit_rpm?: number;
  max_daily_budget_usd?: number;
}

export interface SimulateTrafficResponse {
  generated_count: number;
  breakdown: Record<string, number>;
  total_cost_usd: number;
  total_saved_usd: number;
  traces: Array<{
    id: string;
    tenant_id: string;
    model: string;
    status: TraceStatus;
    cost_usd: number;
    saved_usd: number;
    latency_ms: number;
  }>;
}

export interface ProviderHealthStatus {
  provider_id: string;
  display_name: string;
  state: "CLOSED" | "OPEN" | "HALF_OPEN";
  models: string[];
  fallback_target: string;
  total_requests: number;
  failed_requests: number;
  success_rate_pct: number;
  avg_latency_ms: number;
  last_incident: string | null;
}

export interface VirtualKey {
  id: string;
  name: string;
  tenant_id: string;
  key_prefix: string;
  is_active: boolean;
  created_at: string;
  last_used_at: string | null;
}

export interface VirtualKeyCreated extends VirtualKey {
  raw_key: string;
}

export interface RedTeamVectorResult {
  id: string;
  category: string;
  title: string;
  attack_sample_masked: string;
  expected_action: string;
  actual_action: string;
  passed: boolean;
  risk_score: number;
}

export interface RedTeamBenchmarkResponse {
  tenant_id: string;
  compliance_score: number;
  status: "HARDENED" | "DEGRADED" | "VULNERABLE";
  passed_count: number;
  total_attacks: number;
  injection_threshold: number;
  pii_redaction_enabled: boolean;
  vectors: RedTeamVectorResult[];
}

export interface PlaygroundStreamResult {
  content: string;
  blocked: boolean;
  rateLimited: boolean;
  errorMessage?: string;
  traceId: string;
  status: TraceStatus | "RATE_LIMITED";
  cacheHit: boolean;
  similarityScore: number;
  piiRedactedCount: number;
  costUsd: number;
  savedUsd: number;
  latencyMs: number;
  riskScore: number;
  threatCategories: string[];
  routedModel: string;
  fallbackUsed: boolean;
  routingStrategy?: string;
  traceDetail?: AuditTraceDetail;
}
