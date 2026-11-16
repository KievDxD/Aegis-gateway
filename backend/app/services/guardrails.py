from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import datetime, timezone
import re
import threading
import time
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditTrace, TenantPolicy


class AegisGuardrailBlockedError(Exception):
    """Raised when the Zero-Trust firewall blocks an adversarial prompt."""

    def __init__(
        self,
        risk_score: float,
        threat_categories: list[str],
        message: str,
    ) -> None:
        super().__init__(message)
        self.risk_score = risk_score
        self.threat_categories = threat_categories
        self.message = message


class AegisRateLimitExceededError(Exception):
    """Raised when a tenant exceeds RPM rate limits or daily USD FinOps budget."""

    def __init__(self, reason: str, retry_after_seconds: int = 60) -> None:
        super().__init__(reason)
        self.reason = reason
        self.retry_after_seconds = retry_after_seconds


@dataclass(frozen=True)
class InjectionScanResult:
    """Result of pre-flight prompt injection and jailbreak analysis."""

    risk_score: float
    threat_categories: list[str]
    blocked: bool


@dataclass(frozen=True)
class PiiScanResult:
    """Result of real-time DLP & PII detection and redaction."""

    sanitized_text: str
    entities_found: list[str]
    redacted_count: int


_INJECTION_RULES: list[tuple[re.Pattern[str], float, str]] = [
    (
        re.compile(
            r"(?i)\b(?:ignore|disregard|forget|override|bypass)\b.{0,30}\b(?:previous|prior|above|all|system|safety|core)\b.{0,30}\b(?:instructions|rules|prompts|directives|constraints|guardrails|filters)\b"
        ),
        0.86,
        "INSTRUCTION_OVERRIDE",
    ),
    (
        re.compile(
            r"(?i)\b(?:reveal|show|print|dump|output|leak|expose|repeat)\b.{0,25}\b(?:system\s+prompt|developer\s+prompt|hidden\s+instructions|initial\s+instructions|system\s+message)\b"
        ),
        0.88,
        "SYSTEM_PROMPT_EXFILTRATION",
    ),
    (
        re.compile(
            r"(?i)(?:\bdo\s+anything\s+now\b|\bDAN\s+mode\b|\bjailbreak\b|\bunrestricted\s+mode\b|\bdeveloper\s+mode\s+(?:on|enabled)\b)"
        ),
        0.87,
        "JAILBREAK_PERSONA",
    ),
    (
        re.compile(
            r"(?i)(?:\b(?:reveal|dump|extract|show|print|exfiltrate|leak)\b.{0,25}\b(?:credentials|api[\s_-]?keys|secrets|passwords|tokens|env\s*vars|\.env|private\s+keys)\b|cat\s+/etc/passwd|;\s*drop\s+table\b|union\s+all\s+select\b)"
        ),
        0.91,
        "CREDENTIAL_DATA_EXFILTRATION",
    ),
    (
        re.compile(
            r"(?i)(?:<\|im_start\|>\s*system|###\s*SYSTEM\s*OVERRIDE|\[SYSTEM\s+OVERRIDE\])"
        ),
        0.78,
        "DELIMITER_ROLE_SPOOFING",
    ),
]

_API_KEY_PATTERN = re.compile(
    r"\b(?:sk-(?:proj-|live-|test-)?[A-Za-z0-9_-]{12,}|AIza[0-9A-Za-z_-]{20,}|ghp_[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16})\b"
)
_EMAIL_PATTERN = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
_CARD_CANDIDATE_PATTERN = re.compile(r"(?<!\w)(?:\d[ -]?){12,18}\d(?!\w)")
_SSN_PATTERN = re.compile(r"\b\d{3}-\d{2}-\d{4}\b")
_LABELED_ID_PATTERN = re.compile(
    r"(?i)\b(?:c[eé]dula|c\.c\.|cc|ssn|dni|national[\s_-]?id|identificaci[oó]n|pasaporte|passport)\s*(?:#|n[oº]\.?|:|is|es)?\s*[:#-]?\s*([0-9][0-9.\-]{5,14}[0-9])\b"
)
_PHONE_PATTERN = re.compile(
    r"(?<!\w)(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)|\d{3})[\s.-]\d{3}[\s.-]\d{4}(?!\w)"
)


def _passes_luhn(digits: str) -> bool:
    """Validate credit card numbers using the Luhn checksum algorithm."""
    if not digits.isdigit() or not (13 <= len(digits) <= 19):
        return False
    total = 0
    reverse_digits = digits[::-1]
    for idx, ch in enumerate(reverse_digits):
        num = int(ch)
        if idx % 2 == 1:
            num *= 2
            if num > 9:
                num -= 9
        total += num
    return total % 10 == 0


class GuardrailEngine:
    """Zero-Trust pre-flight firewall for injection blocking and real-time DLP redaction."""

    @staticmethod
    def scan_prompt_injection(
        text: str,
        threshold: float = 0.75,
    ) -> InjectionScanResult:
        """Analyze prompt text for adversarial injection, jailbreak, or exfiltration."""
        if not text.strip():
            return InjectionScanResult(risk_score=0.0, threat_categories=[], blocked=False)

        matched_weights: list[float] = []
        categories: list[str] = []

        for pattern, weight, category in _INJECTION_RULES:
            if pattern.search(text):
                matched_weights.append(weight)
                if category not in categories:
                    categories.append(category)

        if not matched_weights:
            return InjectionScanResult(risk_score=0.0, threat_categories=[], blocked=False)

        max_weight = max(matched_weights)
        # Boost score slightly when multiple distinct adversarial vectors combine
        combined_score = min(1.0, round(max_weight + 0.08 * (len(matched_weights) - 1), 3))
        return InjectionScanResult(
            risk_score=combined_score,
            threat_categories=categories,
            blocked=combined_score >= threshold,
        )

    @staticmethod
    def scan_and_redact_pii(text: str) -> PiiScanResult:
        """Detect and redact API keys, credit cards, emails, national IDs, and phones."""
        if not text:
            return PiiScanResult(sanitized_text="", entities_found=[], redacted_count=0)

        sanitized = text
        entities: list[str] = []
        redacted_count = 0

        def _record(entity_type: str) -> None:
            nonlocal redacted_count
            redacted_count += 1
            if entity_type not in entities:
                entities.append(entity_type)

        # 1. API Keys & Cloud Secrets
        def _replace_api_key(_: re.Match[str]) -> str:
            _record("API_KEY")
            return "[API_KEY_REDACTED]"

        sanitized = _API_KEY_PATTERN.sub(_replace_api_key, sanitized)

        # 2. Credit Cards (Luhn validated)
        def _replace_card(match: re.Match[str]) -> str:
            raw = match.group(0)
            digits = re.sub(r"\D", "", raw)
            if _passes_luhn(digits):
                _record("CREDIT_CARD")
                return "[CARD_REDACTED]"
            return raw

        sanitized = _CARD_CANDIDATE_PATTERN.sub(_replace_card, sanitized)

        # 3. Email addresses
        def _replace_email(_: re.Match[str]) -> str:
            _record("EMAIL")
            return "[EMAIL_REDACTED]"

        sanitized = _EMAIL_PATTERN.sub(_replace_email, sanitized)

        # 4. National IDs / SSN / Cédulas
        def _replace_ssn(_: re.Match[str]) -> str:
            _record("NATIONAL_ID")
            return "[ID_REDACTED]"

        sanitized = _SSN_PATTERN.sub(_replace_ssn, sanitized)

        def _replace_labeled_id(match: re.Match[str]) -> str:
            _record("NATIONAL_ID")
            full = match.group(0)
            id_value = match.group(1)
            return full.replace(id_value, "[ID_REDACTED]")

        sanitized = _LABELED_ID_PATTERN.sub(_replace_labeled_id, sanitized)

        # 5. Phone numbers
        def _replace_phone(_: re.Match[str]) -> str:
            _record("PHONE")
            return "[PHONE_REDACTED]"

        sanitized = _PHONE_PATTERN.sub(_replace_phone, sanitized)

        return PiiScanResult(
            sanitized_text=sanitized,
            entities_found=entities,
            redacted_count=redacted_count,
        )


class RateLimiter:
    """In-memory sliding-window RPM rate limiter and DB-backed FinOps daily budget guard."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._requests: dict[str, deque[float]] = defaultdict(deque)
        self._daily_spend: dict[tuple[str, str], float] = defaultdict(float)

    def reset(self) -> None:
        """Clear all tracked per-tenant RPM counters and in-memory daily spend."""
        with self._lock:
            self._requests.clear()
            self._daily_spend.clear()

    def record_spend(self, tenant_id: str, cost_usd: float) -> None:
        """Atomically record UTC-day USD spend for a tenant."""
        if cost_usd <= 0.0:
            return
        day_key = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        with self._lock:
            self._daily_spend[(tenant_id, day_key)] += float(cost_usd)

    def check_rpm(self, tenant_id: str, max_rpm: int) -> None:
        """Verify tenant stays within its requests-per-minute quota."""
        now = time.monotonic()
        cutoff = now - 60.0
        with self._lock:
            bucket = self._requests[tenant_id]
            while bucket and bucket[0] < cutoff:
                bucket.popleft()
            if len(bucket) >= max_rpm:
                retry_after = max(1, int(60.0 - (now - bucket[0])))
                raise AegisRateLimitExceededError(
                    reason=f"Rate limit exceeded for tenant '{tenant_id}' ({max_rpm} RPM).",
                    retry_after_seconds=retry_after,
                )
            bucket.append(now)

    async def check_daily_budget(
        self,
        db: AsyncSession,
        policy: TenantPolicy,
    ) -> float:
        """Ensure tenant daily USD spend has not exceeded max_daily_budget_usd."""
        now_utc = datetime.now(timezone.utc)
        utc_midnight = now_utc.replace(hour=0, minute=0, second=0, microsecond=0)
        day_key = now_utc.strftime("%Y-%m-%d")

        stmt = select(AuditTrace.timestamp, AuditTrace.cost_usd).where(
            AuditTrace.tenant_id == policy.tenant_id,
            AuditTrace.cost_usd > 0.0,
        )
        rows = (await db.execute(stmt)).all()
        db_daily_spend = 0.0
        for ts, cost in rows:
            ts_utc = (
                ts.replace(tzinfo=timezone.utc)
                if ts.tzinfo is None
                else ts.astimezone(timezone.utc)
            )
            if ts_utc >= utc_midnight:
                db_daily_spend += float(cost or 0.0)

        with self._lock:
            mem_spend = self._daily_spend.get((policy.tenant_id, day_key), 0.0)
            daily_spend = max(mem_spend, db_daily_spend)
            self._daily_spend[(policy.tenant_id, day_key)] = daily_spend

        if daily_spend >= policy.max_daily_budget_usd:
            raise AegisRateLimitExceededError(
                reason=(
                    f"Daily FinOps budget exhausted for tenant '{policy.tenant_id}' "
                    f"(${daily_spend:.4f} / ${policy.max_daily_budget_usd:.2f} USD)."
                ),
                retry_after_seconds=3600,
            )
        return daily_spend


rate_limiter = RateLimiter()
