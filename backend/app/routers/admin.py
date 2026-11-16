from collections import defaultdict
import csv
from datetime import datetime, timedelta, timezone
import io
import json
import secrets
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy import desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app import database
from app.models import AuditTrace, TenantPolicy, VirtualKey, hash_virtual_key
from app.schemas import (
    AdminMetricsResponse,
    AuditTraceDetail,
    AuditTraceSummary,
    HourlyMetricPoint,
    ModelCostBreakdown,
    PaginatedTracesResponse,
    ProviderHealthStatus,
    RedTeamBenchmarkRequest,
    RedTeamBenchmarkResponse,
    SimulateTrafficRequest,
    SimulateTrafficResponse,
    TenantPolicyResponse,
    TenantPolicyUpdate,
    VirtualKeyCreate,
    VirtualKeyCreatedResponse,
    VirtualKeyResponse,
)
from app.services.model_router import model_router
from app.services.redteam_auditor import RedTeamAuditor
from app.services.seeder import simulate_traffic_burst

router = APIRouter(prefix="/api/admin", tags=["Admin Observability & Governance"])


@router.get("/metrics", response_model=AdminMetricsResponse)
async def get_admin_metrics(
    tenant_id: str | None = Query(default=None),
    db: AsyncSession = Depends(database.get_db),
) -> AdminMetricsResponse:
    """Compute aggregated FinOps, caching, security, and latency KPIs."""
    stmt = select(AuditTrace)
    if tenant_id:
        stmt = stmt.where(AuditTrace.tenant_id == tenant_id)
    traces = (await db.execute(stmt)).scalars().all()

    total_requests = len(traces)
    status_dist: dict[str, int] = {
        "ALLOWED": 0,
        "CACHED": 0,
        "PII_MASKED": 0,
        "BLOCKED": 0,
    }
    total_cost = 0.0
    total_saved = 0.0
    total_pii = 0
    ttft_values: list[float] = []
    latency_values: list[float] = []
    eval_values: list[float] = []

    model_agg: dict[str, dict[str, float | int]] = defaultdict(
        lambda: {"requests": 0, "cost_usd": 0.0, "saved_usd": 0.0, "tokens_total": 0}
    )

    now = datetime.now(timezone.utc)
    hour_keys: list[str] = []
    hourly_buckets: dict[str, dict[str, float | int | list[float]]] = {}
    for offset in range(11, -1, -1):
        bucket_dt = (now - timedelta(hours=offset)).replace(minute=0, second=0, microsecond=0)
        key = bucket_dt.strftime("%H:00")
        hour_keys.append(key)
        hourly_buckets[key] = {
            "requests": 0,
            "blocked": 0,
            "cached": 0,
            "cost_usd": 0.0,
            "saved_usd": 0.0,
            "ttfts": [],
        }

    for tr in traces:
        status_dist[tr.status] = status_dist.get(tr.status, 0) + 1
        total_cost += tr.cost_usd
        total_saved += tr.saved_usd
        total_pii += tr.pii_redacted_count
        ttft_values.append(tr.ttft_ms)
        latency_values.append(tr.latency_ms)
        if tr.eval_score > 0:
            eval_values.append(tr.eval_score)

        m_entry = model_agg[tr.model]
        m_entry["requests"] = int(m_entry["requests"]) + 1
        m_entry["cost_usd"] = float(m_entry["cost_usd"]) + tr.cost_usd
        m_entry["saved_usd"] = float(m_entry["saved_usd"]) + tr.saved_usd
        m_entry["tokens_total"] = int(m_entry["tokens_total"]) + tr.tokens_in + tr.tokens_out

        tr_ts = tr.timestamp
        if tr_ts.tzinfo is None:
            tr_ts = tr_ts.replace(tzinfo=timezone.utc)
        hour_key = tr_ts.astimezone(timezone.utc).strftime("%H:00")
        if hour_key in hourly_buckets:
            hb = hourly_buckets[hour_key]
            hb["requests"] = int(hb["requests"]) + 1
            if tr.status == "BLOCKED":
                hb["blocked"] = int(hb["blocked"]) + 1
            if tr.cache_hit:
                hb["cached"] = int(hb["cached"]) + 1
            hb["cost_usd"] = float(hb["cost_usd"]) + tr.cost_usd
            hb["saved_usd"] = float(hb["saved_usd"]) + tr.saved_usd
            ttft_list = hb["ttfts"]
            if isinstance(ttft_list, list):
                ttft_list.append(tr.ttft_ms)

    cached_count = status_dist["CACHED"]
    cache_hit_rate = round((cached_count / total_requests) * 100.0, 1) if total_requests else 0.0
    avg_ttft = round(sum(ttft_values) / len(ttft_values), 2) if ttft_values else 0.0
    avg_latency = round(sum(latency_values) / len(latency_values), 2) if latency_values else 0.0
    avg_eval = round(sum(eval_values) / len(eval_values), 3) if eval_values else 0.95

    model_breakdown = [
        ModelCostBreakdown(
            model=model_name,
            requests=int(vals["requests"]),
            cost_usd=round(float(vals["cost_usd"]), 6),
            saved_usd=round(float(vals["saved_usd"]), 6),
            tokens_total=int(vals["tokens_total"]),
        )
        for model_name, vals in sorted(
            model_agg.items(),
            key=lambda kv: int(kv[1]["requests"]),
            reverse=True,
        )
    ]

    hourly_series = []
    for hk in hour_keys:
        hb = hourly_buckets[hk]
        ttft_list = hb["ttfts"]
        bucket_ttft = (
            round(sum(ttft_list) / len(ttft_list), 2)
            if isinstance(ttft_list, list) and ttft_list
            else 0.0
        )
        hourly_series.append(
            HourlyMetricPoint(
                hour=hk,
                requests=int(hb["requests"]),
                blocked=int(hb["blocked"]),
                cached=int(hb["cached"]),
                cost_usd=round(float(hb["cost_usd"]), 6),
                saved_usd=round(float(hb["saved_usd"]), 6),
                avg_ttft_ms=bucket_ttft,
            )
        )

    return AdminMetricsResponse(
        total_requests=total_requests,
        allowed_requests=status_dist["ALLOWED"],
        cached_requests=cached_count,
        pii_masked_requests=status_dist["PII_MASKED"],
        blocked_requests=status_dist["BLOCKED"],
        cache_hit_rate_pct=cache_hit_rate,
        total_cost_usd=round(total_cost, 6),
        total_saved_usd=round(total_saved, 6),
        total_pii_redacted=total_pii,
        avg_ttft_ms=avg_ttft,
        avg_latency_ms=avg_latency,
        avg_eval_score=avg_eval,
        status_distribution=status_dist,
        model_breakdown=model_breakdown,
        hourly_series=hourly_series,
    )


def _build_trace_filters(
    status: str | None,
    model: str | None,
    tenant_id: str | None,
    search: str | None,
) -> list:
    """Build reusable SQLAlchemy filter clauses for trace listing and export."""
    filters = []
    if status and status != "ALL":
        filters.append(AuditTrace.status == status)
    if model and model != "ALL":
        filters.append(AuditTrace.model == model)
    if tenant_id and tenant_id != "ALL":
        filters.append(AuditTrace.tenant_id == tenant_id)
    if search:
        like_expr = f"%{search.strip()}%"
        filters.append(
            or_(
                AuditTrace.prompt_sanitized.ilike(like_expr),
                AuditTrace.response_preview.ilike(like_expr),
                AuditTrace.tenant_id.ilike(like_expr),
                AuditTrace.id.ilike(like_expr),
            )
        )
    return filters


@router.get("/traces", response_model=PaginatedTracesResponse)
async def list_traces(
    status: str | None = Query(default=None),
    model: str | None = Query(default=None),
    tenant_id: str | None = Query(default=None),
    search: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(database.get_db),
) -> PaginatedTracesResponse:
    """Return paginated and filterable audit traces for the Live Trace Inspector."""
    filters = _build_trace_filters(status, model, tenant_id, search)

    count_stmt = select(func.count()).select_from(AuditTrace).where(*filters)
    total = int((await db.execute(count_stmt)).scalar_one())

    data_stmt = (
        select(AuditTrace)
        .where(*filters)
        .order_by(desc(AuditTrace.timestamp))
        .offset(offset)
        .limit(limit)
    )
    rows = (await db.execute(data_stmt)).scalars().all()

    return PaginatedTracesResponse(
        total=total,
        limit=limit,
        offset=offset,
        items=[AuditTraceSummary.model_validate(row) for row in rows],
    )


@router.get("/traces/export")
async def export_traces(
    format: str = Query(default="csv", pattern="^(csv|json)$"),
    status: str | None = Query(default=None),
    model: str | None = Query(default=None),
    tenant_id: str | None = Query(default=None),
    search: str | None = Query(default=None),
    db: AsyncSession = Depends(database.get_db),
) -> Response:
    """Export filtered FinOps & Security audit traces as downloadable CSV or JSON."""
    filters = _build_trace_filters(status, model, tenant_id, search)
    stmt = (
        select(AuditTrace)
        .where(*filters)
        .order_by(desc(AuditTrace.timestamp))
        .limit(2000)
    )
    rows = (await db.execute(stmt)).scalars().all()

    if format == "json":
        payload = [
            AuditTraceSummary.model_validate(row).model_dump(mode="json")
            for row in rows
        ]
        return Response(
            content=json.dumps(payload, indent=2),
            media_type="application/json",
            headers={
                "Content-Disposition": 'attachment; filename="aegis_audit_traces.json"'
            },
        )

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(
        [
            "id",
            "timestamp",
            "tenant_id",
            "status",
            "requested_model",
            "routed_model",
            "fallback_used",
            "tokens_in",
            "tokens_out",
            "cost_usd",
            "saved_usd",
            "ttft_ms",
            "latency_ms",
            "risk_score",
            "pii_redacted_count",
            "cache_hit",
            "similarity_score",
            "eval_score",
        ]
    )
    for row in rows:
        writer.writerow(
            [
                row.id,
                row.timestamp.isoformat(),
                row.tenant_id,
                row.status,
                row.model,
                row.routed_model or row.model,
                row.fallback_used,
                row.tokens_in,
                row.tokens_out,
                f"{row.cost_usd:.6f}",
                f"{row.saved_usd:.6f}",
                f"{row.ttft_ms:.2f}",
                f"{row.latency_ms:.2f}",
                f"{row.risk_score:.3f}",
                row.pii_redacted_count,
                row.cache_hit,
                f"{row.similarity_score:.4f}",
                f"{row.eval_score:.2f}",
            ]
        )
    return Response(
        content=buf.getvalue(),
        media_type="text/csv",
        headers={
            "Content-Disposition": 'attachment; filename="aegis_audit_traces.csv"'
        },
    )


@router.get("/traces/{trace_id}", response_model=AuditTraceDetail)
async def get_trace_detail(
    trace_id: str,
    db: AsyncSession = Depends(database.get_db),
) -> AuditTraceDetail:
    """Return full payload details for a specific audit trace."""
    stmt = select(AuditTrace).where(AuditTrace.id == trace_id)
    row = (await db.execute(stmt)).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail=f"Trace '{trace_id}' not found.")
    return AuditTraceDetail.model_validate(row)


@router.get("/policies", response_model=list[TenantPolicyResponse])
async def list_policies(
    db: AsyncSession = Depends(database.get_db),
) -> list[TenantPolicyResponse]:
    """List governance policies across all registered tenants."""
    stmt = select(TenantPolicy).order_by(TenantPolicy.tenant_id)
    rows = (await db.execute(stmt)).scalars().all()
    return [TenantPolicyResponse.model_validate(row) for row in rows]


@router.put("/policies/{tenant_id}", response_model=TenantPolicyResponse)
async def update_policy(
    tenant_id: str,
    payload: TenantPolicyUpdate,
    db: AsyncSession = Depends(database.get_db),
) -> TenantPolicyResponse:
    """Update (or upsert) live security, cache, and FinOps policy for a tenant."""
    stmt = select(TenantPolicy).where(TenantPolicy.tenant_id == tenant_id)
    policy = (await db.execute(stmt)).scalar_one_or_none()

    if policy is None:
        settings = get_settings()
        policy = TenantPolicy(
            tenant_id=tenant_id,
            name=payload.name or f"Tenant {tenant_id}",
            injection_threshold=payload.injection_threshold
            if payload.injection_threshold is not None
            else settings.DEFAULT_INJECTION_THRESHOLD,
            pii_redaction_enabled=payload.pii_redaction_enabled
            if payload.pii_redaction_enabled is not None
            else True,
            cache_enabled=payload.cache_enabled if payload.cache_enabled is not None else True,
            cache_similarity_threshold=payload.cache_similarity_threshold
            if payload.cache_similarity_threshold is not None
            else settings.DEFAULT_CACHE_THRESHOLD,
            rate_limit_rpm=payload.rate_limit_rpm
            if payload.rate_limit_rpm is not None
            else settings.DEFAULT_RATE_LIMIT_RPM,
            max_daily_budget_usd=payload.max_daily_budget_usd
            if payload.max_daily_budget_usd is not None
            else settings.DEFAULT_DAILY_BUDGET_USD,
        )
        db.add(policy)
    else:
        update_data = payload.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            if value is not None:
                setattr(policy, field, value)
        policy.updated_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(policy)
    return TenantPolicyResponse.model_validate(policy)


@router.post("/playground/simulate-traffic", response_model=SimulateTrafficResponse)
async def trigger_traffic_simulation(
    payload: SimulateTrafficRequest | None = None,
    db: AsyncSession = Depends(database.get_db),
) -> SimulateTrafficResponse:
    """Inject a burst of realistic multi-tenant traffic into the gateway ledger."""
    req = payload or SimulateTrafficRequest()
    summary = await simulate_traffic_burst(
        db=db,
        count=req.count,
        tenant_override=req.tenant_id,
    )
    return SimulateTrafficResponse(**summary)


@router.get("/providers/health", response_model=list[ProviderHealthStatus])
async def get_providers_health() -> list[ProviderHealthStatus]:
    """Return live Circuit Breaker telemetry across upstream LLM providers."""
    return [ProviderHealthStatus(**item) for item in model_router.get_providers_health()]


@router.get("/keys", response_model=list[VirtualKeyResponse])
async def list_virtual_keys(
    db: AsyncSession = Depends(database.get_db),
) -> list[VirtualKeyResponse]:
    """List Virtual API Keys without exposing raw secret hashes."""
    stmt = select(VirtualKey).order_by(desc(VirtualKey.created_at))
    rows = (await db.execute(stmt)).scalars().all()
    return [VirtualKeyResponse.model_validate(row) for row in rows]


@router.post("/keys", response_model=VirtualKeyCreatedResponse, status_code=201)
async def create_virtual_key(
    payload: VirtualKeyCreate,
    db: AsyncSession = Depends(database.get_db),
) -> VirtualKeyCreatedResponse:
    """Issue a new SHA-256 protected Virtual API Key and return raw_key once."""
    raw_key = f"ag-live-{secrets.token_urlsafe(20)}"
    key = VirtualKey(
        name=payload.name.strip(),
        tenant_id=payload.tenant_id.strip(),
        key_prefix=f"{raw_key[:15]}...",
        key_hash=hash_virtual_key(raw_key),
        is_active=True,
    )
    db.add(key)
    await db.commit()
    await db.refresh(key)
    base = VirtualKeyResponse.model_validate(key).model_dump()
    return VirtualKeyCreatedResponse(**base, raw_key=raw_key)


@router.delete("/keys/{key_id}", response_model=VirtualKeyResponse)
async def revoke_virtual_key(
    key_id: str,
    db: AsyncSession = Depends(database.get_db),
) -> VirtualKeyResponse:
    """Instantly revoke a Virtual API Key so future Bearer requests fail with HTTP 401."""
    stmt = select(VirtualKey).where(VirtualKey.id == key_id)
    key = (await db.execute(stmt)).scalar_one_or_none()
    if key is None:
        raise HTTPException(status_code=404, detail=f"Virtual key '{key_id}' not found.")
    key.is_active = False
    await db.commit()
    await db.refresh(key)
    return VirtualKeyResponse.model_validate(key)


@router.post("/security/redteam-benchmark", response_model=RedTeamBenchmarkResponse)
async def run_redteam_benchmark(
    payload: RedTeamBenchmarkRequest | None = None,
    db: AsyncSession = Depends(database.get_db),
) -> RedTeamBenchmarkResponse:
    """Execute 10-vector OWASP LLM Red-Team suite against a tenant's active Guardrail policy."""
    tenant_id = (payload.tenant_id if payload else "default").strip() or "default"
    stmt = select(TenantPolicy).where(TenantPolicy.tenant_id == tenant_id)
    policy = (await db.execute(stmt)).scalar_one_or_none()
    if policy is None:
        settings = get_settings()
        policy = TenantPolicy(
            tenant_id=tenant_id,
            name=f"Tenant {tenant_id}",
            injection_threshold=settings.DEFAULT_INJECTION_THRESHOLD,
            pii_redaction_enabled=True,
            cache_enabled=True,
            cache_similarity_threshold=settings.DEFAULT_CACHE_THRESHOLD,
            rate_limit_rpm=settings.DEFAULT_RATE_LIMIT_RPM,
            max_daily_budget_usd=settings.DEFAULT_DAILY_BUDGET_USD,
        )
    report = RedTeamAuditor.run_benchmark(policy)
    return RedTeamBenchmarkResponse(**report)
