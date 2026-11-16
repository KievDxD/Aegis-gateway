from datetime import datetime, timezone
import uuid
from sqlalchemy import Boolean, DateTime, Float, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


def _utc_now() -> datetime:
    """Return timezone-aware UTC timestamp."""
    return datetime.now(timezone.utc)


class TenantPolicy(Base):
    """Per-tenant security, caching, rate limiting, and FinOps governance policies."""

    __tablename__ = "tenant_policies"

    tenant_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    injection_threshold: Mapped[float] = mapped_column(Float, default=0.75, nullable=False)
    pii_redaction_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    cache_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    cache_similarity_threshold: Mapped[float] = mapped_column(Float, default=0.92, nullable=False)
    rate_limit_rpm: Mapped[int] = mapped_column(Integer, default=60, nullable=False)
    max_daily_budget_usd: Mapped[float] = mapped_column(Float, default=50.0, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=_utc_now,
        onupdate=_utc_now,
        nullable=False,
    )


class AuditTrace(Base):
    """Immutable audit trace capturing security, caching, FinOps, and EvalOps telemetry."""

    __tablename__ = "audit_traces"

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid.uuid4()),
    )
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=_utc_now,
        index=True,
        nullable=False,
    )
    tenant_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    model: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    status: Mapped[str] = mapped_column(
        String(24),
        index=True,
        nullable=False,
    )  # ALLOWED | CACHED | PII_MASKED | BLOCKED

    prompt_original: Mapped[str] = mapped_column(Text, nullable=False)
    prompt_sanitized: Mapped[str] = mapped_column(Text, nullable=False)
    response_preview: Mapped[str] = mapped_column(Text, default="", nullable=False)

    tokens_in: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    tokens_out: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    cost_usd: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    saved_usd: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)

    ttft_ms: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    latency_ms: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)

    risk_score: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    threat_categories: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    pii_entities: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    pii_redacted_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    cache_hit: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    similarity_score: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    eval_score: Mapped[float] = mapped_column(Float, default=1.0, nullable=False)

    embedding_json: Mapped[list[float]] = mapped_column(JSON, default=list, nullable=False)
