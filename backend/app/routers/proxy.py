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
from app.models import AuditTrace, TenantPolicy, VirtualKey, hash_virtual_key
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
from app.services.model_router import model_router
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
    routed_model: str = "",
    fallback_used: bool = False,
    routing_strategy: str = "direct",
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
        "X-Aegis-Routed-Model": routed_model,
        "X-Aegis-Fallback-Used": str(fallback_used).lower(),
        "X-Aegis-Routing-Strategy": routing_strategy,
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
    authorization: str | None = Header(default=None, alias="Authorization"),
    x_aegis_tenant: str = Header(default="default", alias="X-Aegis-Tenant"),
    x_aegis_api_key: str | None = Header(default=None, alias="X-Aegis-API-Key"),
    x_aegis_cache_bypass: str = Header(default="false", alias="X-Aegis-Cache-Bypass"),
    x_aegis_simulate_outage: str = Header(default="false", alias="X-Aegis-Simulate-Outage"),
) -> ChatCompletionResponse | StreamingResponse | JSONResponse:
    """OpenAI-compatible chat completions endpoint protected by Zero-Trust Guardrails."""
    request_start = time.perf_counter()
    tenant_id = (x_aegis_tenant or "default").strip() or "default"
    cache_bypass = x_aegis_cache_bypass.strip().lower() in ("true", "1", "yes")
    simulate_outage = x_aegis_simulate_outage.strip().lower() in ("true", "1", "yes")
    trace_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)

    # 0. Virtual API Key Authentication (Authorization: Bearer ag-live-... or X-Aegis-API-Key)
    bearer_token: str | None = None
    if authorization and authorization.lower().startswith("bearer "):
        candidate = authorization[7:].strip()
        if candidate and candidate != "aegis-local-key":
            bearer_token = candidate
    elif x_aegis_api_key and x_aegis_api_key.strip().startswith("ag-live-"):
        bearer_token = x_aegis_api_key.strip()

    if bearer_token is not None:
        key_hash = hash_virtual_key(bearer_token)
        vk_stmt = select(VirtualKey).where(VirtualKey.key_hash == key_hash)
        vk = (await db.execute(vk_stmt)).scalar_one_or_none()
        if vk is None or not vk.is_active:
            return JSONResponse(
                status_code=401,
                content={
                    "error": {
                        "message": "Invalid or revoked AEGIS Virtual API Key.",
                        "type": "aegis_auth_error",
                        "code": "invalid_api_key",
                    }
                },
            )
        vk.last_used_at = now
        await db.commit()
        tenant_id = vk.tenant_id

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

    user_messages = [(m.content or "") for m in payload.messages if m.role == "user"]
    prompt_original = (
        "\n".join(user_messages) if user_messages else (payload.messages[-1].content or "")
    )

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
                "routed_model": payload.model,
                "fallback_used": False,
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
                routed_model=payload.model,
                fallback_used=False,
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
        msg_text = msg.content or ""
        if policy.pii_redaction_enabled and msg_text:
            scan = GuardrailEngine.scan_and_redact_pii(msg_text)
            sanitized_messages.append(
                ChatMessage(role=msg.role, content=scan.sanitized_text, tool_calls=msg.tool_calls)
            )
            pii_redacted_count += scan.redacted_count
            for ent in scan.entities_found:
                if ent not in pii_entities:
                    pii_entities.append(ent)
        else:
            sanitized_messages.append(msg)

    sanitized_user_msgs = [(m.content or "") for m in sanitized_messages if m.role == "user"]
    prompt_sanitized = (
        "\n".join(sanitized_user_msgs)
        if sanitized_user_msgs
        else (sanitized_messages[-1].content or "")
    )

    # 4. Smart Cost-Aware Routing & Circuit Breaker + Semantic Cache Lookup
    routing = model_router.resolve_model(
        payload.model,
        simulate_outage=simulate_outage,
        prompt_text=prompt_sanitized,
    )
    effective_model = routing.routed_model
    fallback_used = routing.fallback_used
    routing_strategy = routing.routing_strategy
    json_mode = bool(payload.response_format and payload.response_format.type == "json_object")
    has_tools = bool(payload.tools)

    if policy.cache_enabled and not cache_bypass and not simulate_outage and not has_tools and not json_mode:
        query_embedding, cache_res = await SemanticCacheEngine.lookup(
            db=db,
            tenant_id=tenant_id,
            model=effective_model,
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
            effective_model, tokens_in, tokens_out
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
            "routed_model": effective_model,
            "fallback_used": fallback_used,
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
            routed_model=effective_model,
            fallback_used=fallback_used,
            routing_strategy=routing_strategy,
        )

        if payload.stream:
            async def _cached_sse_stream():
                async for sse_line, _ in UpstreamLLMService.stream_text_as_sse(
                    model=effective_model,
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
                model=effective_model,
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
                    routed_model=effective_model,
                    fallback_used=fallback_used,
                    routing_strategy=routing_strategy,
                ),
            ).model_dump(),
        )

    # 5. Cache Miss -> Execute Upstream LLM (or Autonomous Simulator)
    status = "PII_MASKED" if pii_redacted_count > 0 else "ALLOWED"
    all_sanitized_text = "\n".join((m.content or "") for m in sanitized_messages)
    tokens_in = FinOpsEngine.estimate_tokens(all_sanitized_text)

    if payload.stream and not has_tools:
        stream_content = (
            UpstreamLLMService.build_json_response(
                effective_model,
                sanitized_messages,
                pii_redacted_count,
            )
            if json_mode
            else UpstreamLLMService._build_simulated_response(
                effective_model,
                sanitized_messages,
            )
        )
        tokens_out = FinOpsEngine.estimate_tokens(stream_content)
        cost_usd = FinOpsEngine.calculate_cost_usd(effective_model, tokens_in, tokens_out)
        smart_saved_usd = 0.0
        if payload.model == "aegis-auto" and routing_strategy == "cost-optimized":
            flagship_cost = FinOpsEngine.calculate_cost_usd("gpt-4o", tokens_in, tokens_out)
            smart_saved_usd = max(0.0, round(flagship_cost - cost_usd, 6))

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
            "routed_model": effective_model,
            "fallback_used": fallback_used,
            "status": status,
            "prompt_original": prompt_original,
            "prompt_sanitized": prompt_sanitized,
            "response_preview": stream_content,
            "tokens_in": tokens_in,
            "tokens_out": tokens_out,
            "cost_usd": cost_usd,
            "saved_usd": smart_saved_usd,
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
                model=effective_model,
                text=stream_content,
                delay_seconds=0.004,
            ):
                if first_ttft is None and recorded_ttft is not None:
                    first_ttft = recorded_ttft
                if sse_line == "data: [DONE]\n\n":
                    total_ms = round((time.perf_counter() - request_start) * 1000.0, 2)
                    trace_payload["ttft_ms"] = first_ttft or round(total_ms * 0.25, 2)
                    trace_payload["latency_ms"] = total_ms
                    model_router.record_success(effective_model, total_ms)
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
            saved_usd=smart_saved_usd,
            latency_ms=round((time.perf_counter() - request_start) * 1000.0, 2),
            routed_model=effective_model,
            fallback_used=fallback_used,
            routing_strategy=routing_strategy,
        )
        return StreamingResponse(
            _live_sse_stream(),
            media_type="text/event-stream",
            headers=headers,
        )

    if has_tools and payload.tools:
        tool_call = UpstreamLLMService.build_tool_call(sanitized_messages, payload.tools)
        tool_preview = f"[tool_call] {tool_call.function.name}({tool_call.function.arguments})"
        tokens_out = FinOpsEngine.estimate_tokens(tool_preview)
        cost_usd = FinOpsEngine.calculate_cost_usd(effective_model, tokens_in, tokens_out)
        smart_saved_usd = 0.0
        if payload.model == "aegis-auto" and routing_strategy == "cost-optimized":
            flagship_cost = FinOpsEngine.calculate_cost_usd("gpt-4o", tokens_in, tokens_out)
            smart_saved_usd = max(0.0, round(flagship_cost - cost_usd, 6))
        total_ms = max(2.5, round((time.perf_counter() - request_start) * 1000.0, 2))
        model_router.record_success(effective_model, total_ms)
        eval_score = FinOpsEngine.compute_eval_score(
            prompt_sanitized,
            tool_preview,
            pii_masked=(pii_redacted_count > 0),
            cache_hit=False,
        )
        trace_payload = {
            "id": trace_id,
            "timestamp": now,
            "tenant_id": tenant_id,
            "model": payload.model,
            "routed_model": effective_model,
            "fallback_used": fallback_used,
            "status": status,
            "prompt_original": prompt_original,
            "prompt_sanitized": prompt_sanitized,
            "response_preview": tool_preview,
            "tokens_in": tokens_in,
            "tokens_out": tokens_out,
            "cost_usd": cost_usd,
            "saved_usd": smart_saved_usd,
            "ttft_ms": total_ms,
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
            saved_usd=smart_saved_usd,
            latency_ms=total_ms,
            routed_model=effective_model,
            fallback_used=fallback_used,
            routing_strategy=routing_strategy,
        )
        return JSONResponse(
            headers=headers,
            content=ChatCompletionResponse(
                id=f"chatcmpl-{uuid.uuid4().hex[:18]}",
                created=int(time.time()),
                model=effective_model,
                choices=[
                    ChatChoice(
                        message=ChatMessage(
                            role="assistant",
                            content=None,
                            tool_calls=[tool_call],
                        ),
                        finish_reason="tool_calls",
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
                    status=status,
                    cache_hit=False,
                    similarity_score=cache_res.similarity_score,
                    pii_redacted_count=pii_redacted_count,
                    pii_entities=pii_entities,
                    risk_score=injection_scan.risk_score,
                    threat_categories=injection_scan.threat_categories,
                    cost_usd=cost_usd,
                    saved_usd=smart_saved_usd,
                    ttft_ms=total_ms,
                    latency_ms=total_ms,
                    eval_score=eval_score,
                    provider_mode="agentic_tool_router",
                    routed_model=effective_model,
                    fallback_used=fallback_used,
                    routing_strategy=routing_strategy,
                ),
            ).model_dump(),
        )

    completion = await UpstreamLLMService.complete(
        model=effective_model,
        messages=sanitized_messages,
        temperature=payload.temperature,
        max_tokens=payload.max_tokens,
        json_mode=json_mode,
        pii_redacted_count=pii_redacted_count,
    )
    tokens_out = FinOpsEngine.estimate_tokens(completion.content)
    cost_usd = FinOpsEngine.calculate_cost_usd(effective_model, tokens_in, tokens_out)
    smart_saved_usd = 0.0
    if payload.model == "aegis-auto" and routing_strategy == "cost-optimized":
        flagship_cost = FinOpsEngine.calculate_cost_usd("gpt-4o", tokens_in, tokens_out)
        smart_saved_usd = max(0.0, round(flagship_cost - cost_usd, 6))
    total_ms = max(completion.latency_ms, round((time.perf_counter() - request_start) * 1000.0, 2))
    model_router.record_success(effective_model, total_ms)
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
        "routed_model": effective_model,
        "fallback_used": fallback_used,
        "status": status,
        "prompt_original": prompt_original,
        "prompt_sanitized": prompt_sanitized,
        "response_preview": completion.content,
        "tokens_in": tokens_in,
        "tokens_out": tokens_out,
        "cost_usd": cost_usd,
        "saved_usd": smart_saved_usd,
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
        saved_usd=smart_saved_usd,
        latency_ms=total_ms,
        routed_model=effective_model,
        fallback_used=fallback_used,
        routing_strategy=routing_strategy,
    )
    return JSONResponse(
        headers=headers,
        content=ChatCompletionResponse(
            id=completion.completion_id,
            created=int(time.time()),
            model=effective_model,
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
                saved_usd=smart_saved_usd,
                ttft_ms=completion.ttft_ms,
                latency_ms=total_ms,
                eval_score=eval_score,
                provider_mode="failover_router" if fallback_used else completion.provider_mode,
                routed_model=effective_model,
                fallback_used=fallback_used,
                routing_strategy=routing_strategy,
            ),
        ).model_dump(),
    )
