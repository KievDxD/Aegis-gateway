from dataclasses import dataclass
import hashlib
import math
import re
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditTrace

try:
    import numpy as np  # type: ignore[import-not-found]
except ImportError:
    np = None  # Pure-Python math fallback keeps runtime compatible with Python 3.15+


EMBEDDING_DIM = 128

_STOP_WORDS = frozenset(
    {
        "a",
        "an",
        "and",
        "are",
        "as",
        "at",
        "be",
        "by",
        "can",
        "could",
        "describe",
        "do",
        "does",
        "explain",
        "for",
        "from",
        "how",
        "i",
        "in",
        "is",
        "it",
        "me",
        "of",
        "on",
        "or",
        "please",
        "tell",
        "that",
        "the",
        "this",
        "to",
        "using",
        "what",
        "when",
        "where",
        "which",
        "who",
        "why",
        "with",
        "work",
        "works",
        "would",
        "you",
        "your",
    }
)


def _stem_token(token: str) -> str:
    """Apply lightweight deterministic suffix stemming for semantic matching."""
    if len(token) <= 4:
        return token
    for suffix in ("izations", "ization", "ations", "ation", "ments", "ment", "ing", "ers", "er", "ed", "es", "s"):
        if token.endswith(suffix) and len(token) - len(suffix) >= 4:
            return token[: -len(suffix)]
    return token


def _hash_bucket(feature: str, dim: int = EMBEDDING_DIM) -> int:
    """Map a text feature deterministically to an embedding dimension."""
    digest = hashlib.blake2b(feature.encode("utf-8"), digest_size=8).digest()
    return int.from_bytes(digest, "big") % dim


@dataclass(frozen=True)
class CacheLookupResult:
    """Best matching cached trace entry when cosine similarity clears the threshold."""

    hit: bool
    similarity_score: float
    response_text: str
    tokens_in: int
    tokens_out: int
    estimated_saved_usd: float
    source_trace_id: str | None = None


class SemanticCacheEngine:
    """Low-latency cosine-similarity semantic cache scoped per tenant and model."""

    @staticmethod
    def compute_embedding(text: str) -> list[float]:
        """Generate a normalized 128-dim semantic embedding vector."""
        normalized = re.sub(r"[^a-z0-9\[\]_]+", " ", text.lower()).strip()
        raw_tokens = [t for t in normalized.split() if t]
        content_tokens = [_stem_token(t) for t in raw_tokens if t not in _STOP_WORDS]
        if not content_tokens:
            content_tokens = [_stem_token(t) for t in raw_tokens]

        vec = [0.0] * EMBEDDING_DIM
        if not content_tokens:
            return vec

        for token in content_tokens:
            vec[_hash_bucket(f"w:{token}")] += 4.0
            if len(token) >= 4:
                for i in range(len(token) - 3):
                    vec[_hash_bucket(f"c4:{token[i : i + 4]}")] += 0.5

        for i in range(len(content_tokens) - 1):
            bigram = f"{content_tokens[i]}_{content_tokens[i + 1]}"
            vec[_hash_bucket(f"b:{bigram}")] += 1.5

        if np is not None:
            arr = np.array(vec, dtype=float)
            norm = float(np.linalg.norm(arr))
            if norm > 0.0:
                return [round(float(x), 6) for x in (arr / norm)]
            return vec

        norm = math.sqrt(sum(v * v for v in vec))
        if norm == 0.0:
            return vec
        return [round(v / norm, 6) for v in vec]

    @staticmethod
    def cosine_similarity(vec_a: list[float], vec_b: list[float]) -> float:
        """Compute cosine similarity between two equal-length embedding vectors."""
        if not vec_a or not vec_b or len(vec_a) != len(vec_b):
            return 0.0

        if np is not None:
            a = np.array(vec_a, dtype=float)
            b = np.array(vec_b, dtype=float)
            denom = float(np.linalg.norm(a) * np.linalg.norm(b))
            if denom == 0.0:
                return 0.0
            return round(float(np.dot(a, b) / denom), 4)

        dot = sum(x * y for x, y in zip(vec_a, vec_b))
        norm_a = math.sqrt(sum(x * x for x in vec_a))
        norm_b = math.sqrt(sum(y * y for y in vec_b))
        denom = norm_a * norm_b
        if denom == 0.0:
            return 0.0
        return round(dot / denom, 4)

    @classmethod
    async def lookup(
        cls,
        db: AsyncSession,
        tenant_id: str,
        model: str,
        prompt_text: str,
        threshold: float,
    ) -> tuple[list[float], CacheLookupResult]:
        """Search tenant-scoped prior completions for a semantically equivalent prompt."""
        query_embedding = cls.compute_embedding(prompt_text)

        stmt = (
            select(AuditTrace)
            .where(
                AuditTrace.tenant_id == tenant_id,
                AuditTrace.model == model,
                AuditTrace.cache_hit.is_(False),
                AuditTrace.status.in_(["ALLOWED", "PII_MASKED"]),
            )
            .order_by(desc(AuditTrace.timestamp))
            .limit(100)
        )
        result = await db.execute(stmt)
        candidates = result.scalars().all()

        best_trace: AuditTrace | None = None
        best_sim = 0.0

        for candidate in candidates:
            if not candidate.embedding_json:
                continue
            sim = cls.cosine_similarity(query_embedding, candidate.embedding_json)
            if sim > best_sim:
                best_sim = sim
                best_trace = candidate

        if best_trace is not None and best_sim >= threshold:
            return query_embedding, CacheLookupResult(
                hit=True,
                similarity_score=best_sim,
                response_text=best_trace.response_preview,
                tokens_in=best_trace.tokens_in,
                tokens_out=best_trace.tokens_out,
                estimated_saved_usd=best_trace.cost_usd,
                source_trace_id=best_trace.id,
            )

        return query_embedding, CacheLookupResult(
            hit=False,
            similarity_score=best_sim,
            response_text="",
            tokens_in=0,
            tokens_out=0,
            estimated_saved_usd=0.0,
        )
