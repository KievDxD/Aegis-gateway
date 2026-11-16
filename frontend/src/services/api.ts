import type {
  AdminMetricsResponse,
  AuditTraceDetail,
  PaginatedTracesResponse,
  PlaygroundStreamResult,
  SimulateTrafficResponse,
  TenantPolicy,
  TenantPolicyUpdate,
  TraceStatus,
} from "../types/aegis";

const API_BASE = "";

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${url}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }
  return (await response.json()) as T;
}

export async function fetchAdminMetrics(tenantId?: string): Promise<AdminMetricsResponse> {
  const query = tenantId && tenantId !== "ALL" ? `?tenant_id=${encodeURIComponent(tenantId)}` : "";
  return requestJson<AdminMetricsResponse>(`/api/admin/metrics${query}`);
}

export async function fetchTraces(params: {
  status?: string;
  model?: string;
  tenant_id?: string;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<PaginatedTracesResponse> {
  const searchParams = new URLSearchParams();
  if (params.status && params.status !== "ALL") searchParams.set("status", params.status);
  if (params.model && params.model !== "ALL") searchParams.set("model", params.model);
  if (params.tenant_id && params.tenant_id !== "ALL") searchParams.set("tenant_id", params.tenant_id);
  if (params.search?.trim()) searchParams.set("search", params.search.trim());
  if (params.limit !== undefined) searchParams.set("limit", String(params.limit));
  if (params.offset !== undefined) searchParams.set("offset", String(params.offset));
  const qs = searchParams.toString();
  return requestJson<PaginatedTracesResponse>(`/api/admin/traces${qs ? `?${qs}` : ""}`);
}

export async function fetchTraceDetail(traceId: string): Promise<AuditTraceDetail> {
  return requestJson<AuditTraceDetail>(`/api/admin/traces/${encodeURIComponent(traceId)}`);
}

export async function fetchPolicies(): Promise<TenantPolicy[]> {
  return requestJson<TenantPolicy[]>("/api/admin/policies");
}

export async function updatePolicy(
  tenantId: string,
  payload: TenantPolicyUpdate
): Promise<TenantPolicy> {
  return requestJson<TenantPolicy>(`/api/admin/policies/${encodeURIComponent(tenantId)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function simulateTrafficBurst(
  count = 8,
  tenantId?: string
): Promise<SimulateTrafficResponse> {
  return requestJson<SimulateTrafficResponse>("/api/admin/playground/simulate-traffic", {
    method: "POST",
    body: JSON.stringify({ count, tenant_id: tenantId || null }),
  });
}

interface StreamChatOptions {
  model: string;
  prompt: string;
  tenantId: string;
  stream: boolean;
  cacheBypass: boolean;
  onToken: (accumulatedText: string) => void;
}

export async function executePlaygroundPrompt(
  options: StreamChatOptions
): Promise<PlaygroundStreamResult> {
  const startedAt = performance.now();
  const response = await fetch(`${API_BASE}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Aegis-Tenant": options.tenantId || "default",
      "X-Aegis-Cache-Bypass": options.cacheBypass ? "true" : "false",
    },
    body: JSON.stringify({
      model: options.model,
      stream: options.stream,
      temperature: 0.4,
      max_tokens: 512,
      messages: [{ role: "user", content: options.prompt }],
    }),
  });

  const traceId = response.headers.get("X-Aegis-Trace-Id") ?? "";
  const headerStatus = (response.headers.get("X-Aegis-Status") ?? "ALLOWED") as TraceStatus;
  const cacheHit = response.headers.get("X-Aegis-Cache-Hit") === "true";
  const similarityScore = Number(response.headers.get("X-Aegis-Similarity") ?? "0");
  const piiRedactedCount = Number(response.headers.get("X-Aegis-PII-Redacted") ?? "0");
  const costUsd = Number(response.headers.get("X-Aegis-Cost-USD") ?? "0");
  const savedUsd = Number(response.headers.get("X-Aegis-Saved-USD") ?? "0");

  if (response.status === 403) {
    const errPayload = (await response.json()) as {
      error: {
        message: string;
        trace_id: string;
        risk_score: number;
        threat_categories: string[];
      };
    };
    const resolvedTraceId = errPayload.error.trace_id || traceId;
    let detail: AuditTraceDetail | undefined;
    if (resolvedTraceId) {
      try {
        detail = await fetchTraceDetail(resolvedTraceId);
      } catch {
        detail = undefined;
      }
    }
    return {
      content: "",
      blocked: true,
      rateLimited: false,
      errorMessage: errPayload.error.message,
      traceId: resolvedTraceId,
      status: "BLOCKED",
      cacheHit: false,
      similarityScore: 0,
      piiRedactedCount: 0,
      costUsd: 0,
      savedUsd,
      latencyMs: Math.round((performance.now() - startedAt) * 100) / 100,
      riskScore: errPayload.error.risk_score ?? 0.9,
      threatCategories: errPayload.error.threat_categories ?? ["PROMPT_INJECTION"],
      traceDetail: detail,
    };
  }

  if (response.status === 429) {
    const errPayload = (await response.json()) as { error: { message: string } };
    return {
      content: "",
      blocked: false,
      rateLimited: true,
      errorMessage: errPayload.error.message,
      traceId,
      status: "RATE_LIMITED",
      cacheHit: false,
      similarityScore: 0,
      piiRedactedCount: 0,
      costUsd: 0,
      savedUsd: 0,
      latencyMs: Math.round((performance.now() - startedAt) * 100) / 100,
      riskScore: 0,
      threatCategories: ["RATE_OR_BUDGET_LIMIT"],
    };
  }

  if (!response.ok) {
    throw new Error(`Proxy error ${response.status}: ${await response.text()}`);
  }

  if (options.stream && response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullText = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (payload === "[DONE]") continue;
        try {
          const parsed = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const delta = parsed.choices?.[0]?.delta?.content ?? "";
          if (delta) {
            fullText += delta;
            options.onToken(fullText);
          }
        } catch {
          // Ignore partial SSE JSON framing
        }
      }
    }

    const latencyMs = Math.round((performance.now() - startedAt) * 100) / 100;
    let detail: AuditTraceDetail | undefined;
    if (traceId) {
      try {
        detail = await fetchTraceDetail(traceId);
      } catch {
        detail = undefined;
      }
    }

    return {
      content: fullText,
      blocked: false,
      rateLimited: false,
      traceId,
      status: detail?.status ?? headerStatus,
      cacheHit,
      similarityScore,
      piiRedactedCount: detail?.pii_redacted_count ?? piiRedactedCount,
      costUsd: detail?.cost_usd ?? costUsd,
      savedUsd: detail?.saved_usd ?? savedUsd,
      latencyMs: detail?.latency_ms ?? latencyMs,
      riskScore: detail?.risk_score ?? 0.04,
      threatCategories: detail?.threat_categories ?? [],
      traceDetail: detail,
    };
  }

  const jsonBody = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
    aegis: {
      trace_id: string;
      status: TraceStatus;
      cache_hit: boolean;
      similarity_score: number;
      pii_redacted_count: number;
      cost_usd: number;
      saved_usd: number;
      latency_ms: number;
      risk_score: number;
      threat_categories: string[];
    };
  };

  const content = jsonBody.choices?.[0]?.message?.content ?? "";
  options.onToken(content);

  let detail: AuditTraceDetail | undefined;
  const resolvedId = jsonBody.aegis.trace_id || traceId;
  if (resolvedId) {
    try {
      detail = await fetchTraceDetail(resolvedId);
    } catch {
      detail = undefined;
    }
  }

  return {
    content,
    blocked: false,
    rateLimited: false,
    traceId: resolvedId,
    status: jsonBody.aegis.status,
    cacheHit: jsonBody.aegis.cache_hit,
    similarityScore: jsonBody.aegis.similarity_score,
    piiRedactedCount: jsonBody.aegis.pii_redacted_count,
    costUsd: jsonBody.aegis.cost_usd,
    savedUsd: jsonBody.aegis.saved_usd,
    latencyMs: jsonBody.aegis.latency_ms,
    riskScore: jsonBody.aegis.risk_score,
    threatCategories: jsonBody.aegis.threat_categories,
    traceDetail: detail,
  };
}
