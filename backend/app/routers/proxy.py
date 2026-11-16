from datetime import datetime, timezone
import time
from typing import Any
import uuid
from fastapi import APIRouter, Depends, Header
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app import database
from app.models import AuditTrace, TenantPolicy
from app.schemas import (
    AegisTelemetryMetadata,
    ChatChoice,
    ChatCompletionRequest,
    ChatCompletionResponse,
    ChatMessage,
    ChatUsage,
    ModelInfo,
    ModelListResponse,
)
from app.services.finops import FinOpsEngine
from app.services.guardrails import (
    AegisRateLimitExceededError,
    GuardrailEngine,
    rate_limiter,
)
from app.services.llm_simulator import UpstreamLLMService
from app.services.semantic_cache import CacheLookupResult, SemanticCacheEngine

router = APIRouter(prefix="/v1", tags=["OpenAI-Compatible Proxy"])


async def _get_or_create_policy(db: AsyncSession, tenant_id: str) -> TenantPolicy:
    """Fetch tenant governance policy or provision a default policy automatically."""
    stmt = select(TenantPolicy).where(TenantPolicy.tenant_id == tenant_id)
    result = await db.execute(stmt)
    policy = result.scalar_one_or_none()
    if policy is not None:
        return policy

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
    db.add(policy)
    await db.commit()
    await db.refresh(policy)
    return policy


async def _persist_audit_trace(trace_payload: dict[str, Any]) -> None:
    """Persist an audit trace asynchronously inside a dedicated database session."""
    async with database.AsyncSessionLocal() as session:
        trace = AuditTrace(**trace_payload)
        session.add(trace)
        await session.commit()


def _build_aegis_headers(
    trace_id: str,
    tenant_id: str,
    status: str,
    cache_hit: bool,
    similarity_score: float,
    pii_redacted_count: int,
    cost_usd: float,
    saved_usd: float,
    latency_ms: float,
) -> dict[str, str]:
    """Build standard AEGIS observability response headers."""
    return {
        "X-Aegis-Trace-Id": trace_id,
        "X-Aegis-Tenant": tenant_id,
        "X-Aegis-Status": status,
        "X-Aegis-Cache-Hit": str(cache_hit).lower(),
        "X-Aegis-Similarity": f"{similarity_score:.4f}",
        "X-Aegis-PII-Redacted": str(pii_redacted_count),
        "X-Aegis-Cost-USD": f"{cost_usd:.6f}",
        "X-Aegis-Saved-USD": f"{saved_usd:.6f}",
        "X-Aegis-Latency-Ms": f"{latency_ms:.2f}",
    }


@router.get("/models", response_model=ModelListResponse)
async def list_models() -> ModelListResponse:
    """List OpenAI-compatible models with FinOps token pricing metadata."""
    created_ts = 1735689600
    items = [
        ModelInfo(
            id=str(item["id"]),
            created=created_ts,
            owned_by=str(item["owned_by"]),
            input_cost_per_1m=float(item["input_per_1m"]),
            output_cost_per_1m=float(item["output_per_1m"]),
            context_window=int(item["context_window"]),
        )
        for item in FinOpsEngine.get_model_catalog()
    ]
    return ModelListResponse(data=items)


@router.post("/chat/completions", response_model=None)
async def chat_completions(
    payload: ChatCompletionRequest,
    db: AsyncSession = Depends(database.get_db),
    x_aegis_tenant: str = Header(default="default", alias="X-Aegis-Tenant"),
    x_aegis_api_key: str | None = Header(default=None, alias="X-Aegis-API-Key"),
    x_aegis_cache_bypass: str = Header(default="false", alias="X-Aegis-Cache-Bypass"),
) -> ChatCompletionResponse | StreamingResponse | JSONResponse:
    """OpenAI-compatible chat completions endpoint protected by Zero-Trust Guardrails."""
    _ = x_aegis_api_key  # Reserved for multi-key tenant attribution / auth hooks
    request_start = time.perf_counter()
    tenant_id = (x_aegis_tenant or "default").strip() or "default"
    cache_bypass = x_aegis_cache_bypass.strip().lower() in ("true", "1", "yes")
    trace_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)

    policy = await _get_or_create_policy(db, tenant_id)

    # 1. Rate Limiting & Daily USD Budget Guard
    try:
        rate_limiter.check_rpm(tenant_id, policy.rate_limit_rpm)
        await rate_limiter.check_daily_budget(db, policy)
    except AegisRateLimitExceededError as exc:
        return JSONResponse(
            status_code=429,
            headers={"Retry-After": str(exc.retry_after_seconds)},
            content={
                "error": {
                    "message": exc.reason,
                    "type": "aegis_rate_limit_exceeded",
                    "code": "rate_or_budget_exceeded",
                    "tenant_id": tenant_id,
                }
            },
        )

    user_messages = [m.content for m in payload.messages if m.role == "user"]
    prompt_original = "\n".join(user_messages) if user_messages else payload.messages[-1].content

    # 2. Pre-Flight Zero-Trust Prompt Injection & Jailbreak Firewall
    injection_scan = GuardrailEngine.scan_prompt_injection(
        prompt_original,
        threshold=policy.injection_threshold,
    )
    if injection_scan.blocked:
        latency_ms = max(0.5, round((time.perf_counter() - request_start) * 1000.0, 2))
        est_tokens_in = FinOpsEngine.estimate_tokens(prompt_original)
        avoided_cost = FinOpsEngine.calculate_cost_usd(payload.model, est_tokens_in, 160)

        await _persist_audit_trace(
            {
                "id": trace_id,
                "timestamp": now,
                "tenant_id": tenant_id,
                "model": payload.model,
                "status": "BLOCKED",
                "prompt_original": prompt_original,
                "prompt_sanitized": prompt_original,
                "response_preview": (
                    f"BLOCKED BY AEGIS GUARDRAILS: {', '.join(injection_scan.threat_categories)}"
                ),
                "tokens_in": est_tokens_in,
                "tokens_out": 0,
                "cost_usd": 0.0,
                "saved_usd": avoided_cost,
                "ttft_ms": latency_ms,
                "latency_ms": latency_ms,
                "risk_score": injection_scan.risk_score,
                "threat_categories": injection_scan.threat_categories,
                "pii_entities": [],
                "pii_redacted_count": 0,
                "cache_hit": False,
                "similarity_score": 0.0,
                "eval_score": 0.0,
                "embedding_json": [],
            }
        )

        return JSONResponse(
            status_code=403,
            headers=_build_aegis_headers(
                trace_id=trace_id,
                tenant_id=tenant_id,
                status="BLOCKED",
                cache_hit=False,
                similarity_score=0.0,
                pii_redacted_count=0,
                cost_usd=0.0,
                saved_usd=avoided_cost,
                latency_ms=latency_ms,
            ),
            content={
                "error": {
                    "message": (
                        "Request blocked by AEGIS Zero-Trust Guardrails: adversarial prompt "
                        f"injection detected ({', '.join(injection_scan.threat_categories)})."
                    ),
                    "type": "aegis_guardrail_blocked",
                    "code": "prompt_injection_detected",
                    "trace_id": trace_id,
                    "risk_score": injection_scan.risk_score,
                    "threat_categories": injection_scan.threat_categories,
                }
            },
        )

    # 3. Real-Time DLP & PII Redaction
    sanitized_messages: list[ChatMessage] = []
    pii_entities: list[str] = []
    pii_redacted_count = 0

    for msg in payload.messages:
        if policy.pii_redaction_enabled:
            scan = GuardrailEngine.scan_and_redact_pii(msg.content)
            sanitized_messages.append(ChatMessage(role=msg.role, content=scan.sanitized_text))
            pii_redacted_count += scan.redacted_count
            for ent in scan.entities_found:
                if ent not in pii_entities:
                    pii_entities.append(ent)
        else:
            sanitized_messages.append(msg)

    sanitized_user_msgs = [m.content for m in sanitized_messages if m.role == "user"]
    prompt_sanitized = (
        "\n".join(sanitized_user_msgs) if sanitized_user_msgs else sanitized_messages[-1].content
    )

    # 4. Semantic Cache Lookup
    if policy.cache_enabled and not cache_bypass:
        query_embedding, cache_res = await SemanticCacheEngine.lookup(
            db=db,
            tenant_id=tenant_id,
            model=payload.model,
            prompt_text=prompt_sanitized,
            threshold=policy.cache_similarity_threshold,
        )
    else:
        query_embedding = SemanticCacheEngine.compute_embedding(prompt_sanitized)
        cache_res = CacheLookupResult(
            hit=False,
            similarity_score=0.0,
            response_text="",
            tokens_in=0,
            tokens_out=0,
            estimated_saved_usd=0.0,
        )

    if cache_res.hit:
        latency_ms = max(0.8, round((time.perf_counter() - request_start) * 1000.0, 2))
        ttft_ms = max(0.5, round(latency_ms * 0.65, 2))
        tokens_in = cache_res.tokens_in or FinOpsEngine.estimate_tokens(prompt_sanitized)
        tokens_out = cache_res.tokens_out or FinOpsEngine.estimate_tokens(cache_res.response_text)
        saved_usd = cache_res.estimated_saved_usd or FinOpsEngine.calculate_cost_usd(
            payload.model, tokens_in, tokens_out
        )
        eval_score = FinOpsEngine.compute_eval_score(
            prompt_sanitized,
            cache_res.response_text,
            pii_masked=(pii_redacted_count > 0),
            cache_hit=True,
        )
        trace_payload = {
            "id": trace_id,
            "timestamp": now,
            "tenant_id": tenant_id,
            "model": payload.model,
            "status": "CACHED",
            "prompt_original": prompt_original,
            "prompt_sanitized": prompt_sanitized,
            "response_preview": cache_res.response_text,
            "tokens_in": tokens_in,
            "tokens_out": tokens_out,
            "cost_usd": 0.0,
            "saved_usd": saved_usd,
            "ttft_ms": ttft_ms,
            "latency_ms": latency_ms,
            "risk_score": injection_scan.risk_score,
            "threat_categories": injection_scan.threat_categories,
            "pii_entities": pii_entities,
            "pii_redacted_count": pii_redacted_count,
            "cache_hit": True,
            "similarity_score": cache_res.similarity_score,
            "eval_score": eval_score,
            "embedding_json": query_embedding,
        }
        headers = _build_aegis_headers(
            trace_id=trace_id,
            tenant_id=tenant_id,
            status="CACHED",
            cache_hit=True,
            similarity_score=cache_res.similarity_score,
            pii_redacted_count=pii_redacted_count,
            cost_usd=0.0,
            saved_usd=saved_usd,
            latency_ms=latency_ms,
        )

        if payload.stream:
            async def _cached_sse_stream():
                async for sse_line, _ in UpstreamLLMService.stream_text_as_sse(
                    model=payload.model,
                    text=cache_res.response_text,
                    delay_seconds=0.001,
                ):
                    if sse_line == "data: [DONE]\n\n":
                        await _persist_audit_trace(trace_payload)
                    yield sse_line

            return StreamingResponse(
                _cached_sse_stream(),
                media_type="text/event-stream",
                headers=headers,
            )

        await _persist_audit_trace(trace_payload)
        return JSONResponse(
            headers=headers,
            content=ChatCompletionResponse(
                id=f"chatcmpl-{uuid.uuid4().hex[:18]}",
                created=int(time.time()),
                model=payload.model,
                choices=[
                    ChatChoice(
                        message=ChatMessage(role="assistant", content=cache_res.response_text)
                    )
                ],
                usage=ChatUsage(
                    prompt_tokens=tokens_in,
                    completion_tokens=tokens_out,
                    total_tokens=tokens_in + tokens_out,
                ),
                aegis=AegisTelemetryMetadata(
                    trace_id=trace_id,
                    tenant_id=tenant_id,
                    status="CACHED",
                    cache_hit=True,
                    similarity_score=cache_res.similarity_score,
                    pii_redacted_count=pii_redacted_count,
                    pii_entities=pii_entities,
                    risk_score=injection_scan.risk_score,
                    threat_categories=injection_scan.threat_categories,
                    cost_usd=0.0,
                    saved_usd=saved_usd,
                    ttft_ms=ttft_ms,
                    latency_ms=latency_ms,
                    eval_score=eval_score,
                    provider_mode="semantic_cache",
                ),
            ).model_dump(),
        )

    # 5. Cache Miss -> Execute Upstream LLM (or Autonomous Simulator)
    status = "PII_MASKED" if pii_redacted_count > 0 else "ALLOWED"
    all_sanitized_text = "\n".join(m.content for m in sanitized_messages)
    tokens_in = FinOpsEngine.estimate_tokens(all_sanitized_text)

    if payload.stream:
        stream_content = UpstreamLLMService._build_simulated_response(
            payload.model,
            sanitized_messages,
        )
        tokens_out = FinOpsEngine.estimate_tokens(stream_content)
        cost_usd = FinOpsEngine.calculate_cost_usd(payload.model, tokens_in, tokens_out)
        eval_score = FinOpsEngine.compute_eval_score(
            prompt_sanitized,
            stream_content,
            pii_masked=(pii_redacted_count > 0),
            cache_hit=False,
        )
        trace_payload = {
            "id": trace_id,
            "timestamp": now,
            "tenant_id": tenant_id,
            "model": payload.model,
            "status": status,
            "prompt_original": prompt_original,
            "prompt_sanitized": prompt_sanitized,
            "response_preview": stream_content,
            "tokens_in": tokens_in,
            "tokens_out": tokens_out,
            "cost_usd": cost_usd,
            "saved_usd": 0.0,
            "ttft_ms": 12.0,
            "latency_ms": 25.0,
            "risk_score": injection_scan.risk_score,
            "threat_categories": injection_scan.threat_categories,
            "pii_entities": pii_entities,
            "pii_redacted_count": pii_redacted_count,
            "cache_hit": False,
            "similarity_score": cache_res.similarity_score,
            "eval_score": eval_score,
            "embedding_json": query_embedding,
        }

        async def _live_sse_stream():
            first_ttft: float | None = None
            async for sse_line, recorded_ttft in UpstreamLLMService.stream_text_as_sse(
                model=payload.model,
                text=stream_content,
                delay_seconds=0.004,
            ):
                if first_ttft is None and recorded_ttft is not None:
                    first_ttft = recorded_ttft
                if sse_line == "data: [DONE]\n\n":
                    total_ms = round((time.perf_counter() - request_start) * 1000.0, 2)
                    trace_payload["ttft_ms"] = first_ttft or round(total_ms * 0.25, 2)
                    trace_payload["latency_ms"] = total_ms
                    rate_limiter.record_spend(tenant_id, cost_usd)
                    await _persist_audit_trace(trace_payload)
                yield sse_line

        headers = _build_aegis_headers(
            trace_id=trace_id,
            tenant_id=tenant_id,
            status=status,
            cache_hit=False,
            similarity_score=cache_res.similarity_score,
            pii_redacted_count=pii_redacted_count,
            cost_usd=cost_usd,
            saved_usd=0.0,
            latency_ms=round((time.perf_counter() - request_start) * 1000.0, 2),
        )
        return StreamingResponse(
            _live_sse_stream(),
            media_type="text/event-stream",
            headers=headers,
        )

    completion = await UpstreamLLMService.complete(
        model=payload.model,
        messages=sanitized_messages,
        temperature=payload.temperature,
        max_tokens=payload.max_tokens,
    )
    tokens_out = FinOpsEngine.estimate_tokens(completion.content)
    cost_usd = FinOpsEngine.calculate_cost_usd(payload.model, tokens_in, tokens_out)
    total_ms = max(completion.latency_ms, round((time.perf_counter() - request_start) * 1000.0, 2))
    eval_score = FinOpsEngine.compute_eval_score(
        prompt_sanitized,
        completion.content,
        pii_masked=(pii_redacted_count > 0),
        cache_hit=False,
    )

    trace_payload = {
        "id": trace_id,
        "timestamp": now,
        "tenant_id": tenant_id,
        "model": payload.model,
        "status": status,
        "prompt_original": prompt_original,
        "prompt_sanitized": prompt_sanitized,
        "response_preview": completion.content,
        "tokens_in": tokens_in,
        "tokens_out": tokens_out,
        "cost_usd": cost_usd,
        "saved_usd": 0.0,
        "ttft_ms": completion.ttft_ms,
        "latency_ms": total_ms,
        "risk_score": injection_scan.risk_score,
        "threat_categories": injection_scan.threat_categories,
        "pii_entities": pii_entities,
        "pii_redacted_count": pii_redacted_count,
        "cache_hit": False,
        "similarity_score": cache_res.similarity_score,
        "eval_score": eval_score,
        "embedding_json": query_embedding,
    }
    rate_limiter.record_spend(tenant_id, cost_usd)
    await _persist_audit_trace(trace_payload)

    headers = _build_aegis_headers(
        trace_id=trace_id,
        tenant_id=tenant_id,
        status=status,
        cache_hit=False,
        similarity_score=cache_res.similarity_score,
        pii_redacted_count=pii_redacted_count,
        cost_usd=cost_usd,
        saved_usd=0.0,
        latency_ms=total_ms,
    )
    return JSONResponse(
        headers=headers,
        content=ChatCompletionResponse(
            id=completion.completion_id,
            created=int(time.time()),
            model=payload.model,
            choices=[
                ChatChoice(message=ChatMessage(role="assistant", content=completion.content))
            ],
            usage=ChatUsage(
                prompt_tokens=tokens_in,
                completion_tokens=tokens_out,
                total_tokens=tokens_in + tokens_out,
            ),
            aegis=AegisTelemetryMetadata(
                trace_id=trace_id,
                tenant_id=tenant_id,
                status=status,
                cache_hit=False,
                similarity_score=cache_res.similarity_score,
                pii_redacted_count=pii_redacted_count,
                pii_entities=pii_entities,
                risk_score=injection_scan.risk_score,
                threat_categories=injection_scan.threat_categories,
                cost_usd=cost_usd,
                saved_usd=0.0,
                ttft_ms=completion.ttft_ms,
                latency_ms=total_ms,
                eval_score=eval_score,
                provider_mode=completion.provider_mode,
            ),
        ).model_dump(),
    )
