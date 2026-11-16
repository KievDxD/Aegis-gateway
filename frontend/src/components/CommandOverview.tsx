import { useState } from "react";
import type { AdminMetricsResponse, ProviderHealthStatus } from "../types/aegis";

interface CommandOverviewProps {
  metrics: AdminMetricsResponse | null;
  providersHealth: ProviderHealthStatus[];
  loading: boolean;
  onNavigateTraces: (statusFilter?: string) => void;
}

export function CommandOverview({
  metrics,
  providersHealth,
  loading,
  onNavigateTraces,
}: CommandOverviewProps) {
  const [hoveredHourIndex, setHoveredHourIndex] = useState<number | null>(null);

  if (loading && !metrics) {
    return (
      <div className="space-y-6">
        <div className="h-28 animate-pulse rounded-lg border border-white/[0.07] bg-[#111113] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]" />
        <div className="h-24 animate-pulse rounded-lg border border-white/[0.07] bg-[#111113] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]" />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="h-72 animate-pulse rounded-lg border border-white/[0.07] bg-[#111113] lg:col-span-2" />
          <div className="h-72 animate-pulse rounded-lg border border-white/[0.07] bg-[#111113]" />
        </div>
      </div>
    );
  }

  if (!metrics) {
    return (
      <div className="rounded-lg border border-[#EF4444]/30 bg-[#EF4444]/10 p-6 font-mono text-xs text-[#EF4444]">
        Unable to load telemetry metrics from /api/admin/metrics. Verify backend status.
      </div>
    );
  }

  const totalSpendPlusSaved = metrics.total_cost_usd + metrics.total_saved_usd;
  const savingsEfficiencyPct =
    totalSpendPlusSaved > 0
      ? ((metrics.total_saved_usd / totalSpendPlusSaved) * 100).toFixed(1)
      : "0.0";

  const hourly = metrics.hourly_series;
  const maxRequests = Math.max(1, ...hourly.map((h) => h.requests));
  const maxMoney = Math.max(
    0.0001,
    ...hourly.map((h) => Math.max(h.cost_usd + h.saved_usd, 0.0001))
  );

  const dist = metrics.status_distribution;
  const distItems = [
    {
      key: "ALLOWED",
      label: "Allowed Upstream",
      count: dist.ALLOWED ?? 0,
      color: "#FAFAFA",
      barClass: "bg-[#FAFAFA]",
      dotClass: "bg-[#FAFAFA]",
    },
    {
      key: "CACHED",
      label: "Semantic Cache Hit",
      count: dist.CACHED ?? 0,
      color: "#10B981",
      barClass: "bg-[#10B981]",
      dotClass: "bg-[#10B981]",
    },
    {
      key: "PII_MASKED",
      label: "PII Redacted (DLP)",
      count: dist.PII_MASKED ?? 0,
      color: "#F59E0B",
      barClass: "bg-[#F59E0B]",
      dotClass: "bg-[#F59E0B]",
    },
    {
      key: "BLOCKED",
      label: "Firewall Blocked",
      count: dist.BLOCKED ?? 0,
      color: "#EF4444",
      barClass: "bg-[#EF4444]",
      dotClass: "bg-[#EF4444]",
    },
  ];
  const distTotal = Math.max(1, distItems.reduce((acc, item) => acc + item.count, 0));

  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  let runningOffset = 0;

  const hoveredPoint =
    hoveredHourIndex !== null && hourly[hoveredHourIndex] ? hourly[hoveredHourIndex] : null;
  const hoveredLeftPct =
    hoveredHourIndex !== null && hourly.length > 0
      ? ((hoveredHourIndex + 0.5) / hourly.length) * 100
      : 50;

  return (
    <div className="space-y-6">
      {/* Unified Asymmetric Telemetry Bar */}
      <section className="grid grid-cols-1 divide-y divide-white/[0.07] overflow-hidden rounded-lg border border-white/[0.07] bg-[#111113] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)] lg:grid-cols-12 lg:divide-x lg:divide-y-0">
        {/* Hero Metric: Net Spend & FinOps Savings */}
        <div className="flex flex-col justify-between p-5 lg:col-span-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-zinc-400">
              Net Spend & FinOps Savings
            </span>
            <span className="inline-flex items-center rounded border border-[#10B981]/25 bg-[#10B981]/10 px-2 py-0.5 font-mono text-[11px] font-medium tabular-nums text-[#10B981]">
              +${metrics.total_saved_usd.toFixed(4)} saved
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-3">
            <span className="font-mono text-3xl font-semibold tracking-tight tabular-nums text-[#FAFAFA]">
              ${metrics.total_cost_usd.toFixed(4)}
            </span>
          </div>
          <div className="mt-2 font-mono text-[11px] tabular-nums text-zinc-500">
            <span className="text-[#10B981]">{savingsEfficiencyPct}%</span> FinOps cost reduction
          </div>
        </div>

        {/* Dense Secondary KPI 1: Semantic Cache Hit Rate */}
        <button
          type="button"
          onClick={() => onNavigateTraces("CACHED")}
          className="flex flex-col justify-between p-5 text-left transition-colors hover:bg-[#18181B]/70 lg:col-span-2"
        >
          <span className="text-xs font-medium text-zinc-400">Semantic Cache</span>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="font-mono text-xl font-semibold tracking-tight tabular-nums text-[#FAFAFA]">
              {metrics.cache_hit_rate_pct.toFixed(1)}%
            </span>
            <span className="font-mono text-[11px] tabular-nums text-[#10B981]">
              {metrics.cached_requests} hits
            </span>
          </div>
          <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full rounded-full bg-[#10B981] transition-all duration-500"
              style={{ width: `${Math.min(100, metrics.cache_hit_rate_pct)}%` }}
            />
          </div>
        </button>

        {/* Dense Secondary KPI 2: Threats Blocked */}
        <button
          type="button"
          onClick={() => onNavigateTraces("BLOCKED")}
          className="flex flex-col justify-between p-5 text-left transition-colors hover:bg-[#18181B]/70 lg:col-span-2"
        >
          <span className="text-xs font-medium text-zinc-400">Threats Blocked</span>
          <div className="mt-3 flex items-baseline gap-2">
            <span
              className={`font-mono text-xl font-semibold tracking-tight tabular-nums ${
                metrics.blocked_requests > 0 ? "text-[#EF4444]" : "text-[#FAFAFA]"
              }`}
            >
              {metrics.blocked_requests}
            </span>
            <span className="font-mono text-[11px] text-zinc-500">pre-flight</span>
          </div>
          <span className="mt-2 font-mono text-[11px] text-zinc-500">
            Zero-Trust firewall
          </span>
        </button>

        {/* Dense Secondary KPI 3: PII Redacted */}
        <button
          type="button"
          onClick={() => onNavigateTraces("PII_MASKED")}
          className="flex flex-col justify-between p-5 text-left transition-colors hover:bg-[#18181B]/70 lg:col-span-2"
        >
          <span className="text-xs font-medium text-zinc-400">PII Redacted</span>
          <div className="mt-3 flex items-baseline gap-2">
            <span
              className={`font-mono text-xl font-semibold tracking-tight tabular-nums ${
                metrics.total_pii_redacted > 0 ? "text-[#F59E0B]" : "text-[#FAFAFA]"
              }`}
            >
              {metrics.total_pii_redacted}
            </span>
            <span className="font-mono text-[11px] tabular-nums text-zinc-500">
              {metrics.pii_masked_requests} traces
            </span>
          </div>
          <span className="mt-2 font-mono text-[11px] text-zinc-500">
            Cards, IDs & secrets
          </span>
        </button>

        {/* Dense Secondary KPI 4: Avg TTFT & EvalOps */}
        <div className="flex flex-col justify-between p-5 lg:col-span-2">
          <span className="text-xs font-medium text-zinc-400">Avg TTFT & EvalOps</span>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="font-mono text-xl font-semibold tracking-tight tabular-nums text-[#FAFAFA]">
              {metrics.avg_ttft_ms.toFixed(1)} ms
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between gap-2 font-mono text-[11px] tabular-nums text-zinc-500">
            <span>E2E {metrics.avg_latency_ms.toFixed(1)} ms</span>
            <span className="text-[#10B981]">
              Eval {(metrics.avg_eval_score * 100).toFixed(0)}%
            </span>
          </div>
        </div>
      </section>

      {/* Upstream Provider Circuit Breakers — Vercel Status Style */}
      {providersHealth.length > 0 && (
        <section className="overflow-hidden rounded-lg border border-white/[0.07] bg-[#111113] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.07] px-5 py-3">
            <h2 className="text-xs font-semibold tracking-tight text-[#FAFAFA]">
              Upstream Provider Circuit Breakers
            </h2>
            <span className="font-mono text-[11px] text-zinc-500">
              Automatic multi-provider failover chain
            </span>
          </div>

          <div className="grid grid-cols-1 divide-y divide-white/[0.07] md:grid-cols-3 md:divide-x md:divide-y-0">
            {providersHealth.map((prov) => {
              const isOpen = prov.state === "OPEN";
              const isHalfOpen = prov.state === "HALF_OPEN";
              const ledColor = isOpen
                ? "bg-[#EF4444]"
                : isHalfOpen
                  ? "bg-[#F59E0B]"
                  : "bg-[#10B981]";
              const stateTextColor = isOpen
                ? "text-[#EF4444]"
                : isHalfOpen
                  ? "text-[#F59E0B]"
                  : "text-[#10B981]";
              const stateLabel = isOpen
                ? "CIRCUIT OPEN"
                : isHalfOpen
                  ? "HALF-OPEN"
                  : "HEALTHY";

              return (
                <div key={prov.provider_id} className="px-5 py-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${ledColor}`} />
                      <span className="text-xs font-medium text-[#FAFAFA]">
                        {prov.display_name}
                      </span>
                    </div>
                    <span className={`font-mono text-[10px] font-medium ${stateTextColor}`}>
                      {stateLabel}
                    </span>
                  </div>

                  <div className="mt-2.5 flex items-center justify-between gap-2 font-mono text-[11px] tabular-nums">
                    <span className="truncate text-zinc-500">{prov.models.join(", ")}</span>
                    <span className="shrink-0 text-zinc-400">
                      → {prov.fallback_target}
                    </span>
                  </div>

                  <div className="mt-2.5 flex items-center justify-between font-mono text-[11px] tabular-nums text-zinc-400">
                    <span>{prov.avg_latency_ms.toFixed(1)} ms avg</span>
                    <span>{prov.success_rate_pct.toFixed(1)}% ok</span>
                    <span className="text-zinc-500">{prov.total_requests} req</span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Telemetry Velocity Chart & Policy Breakdown */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* 12-Hour Traffic & FinOps Cost/Savings SVG Chart */}
        <div className="rounded-lg border border-white/[0.07] bg-[#111113] p-5 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)] lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold tracking-tight text-[#FAFAFA]">
                Gateway Request Volume & FinOps Velocity
              </h2>
              <p className="mt-0.5 font-mono text-[11px] text-zinc-500">
                12H UTC rolling telemetry window
              </p>
            </div>
            <div className="flex items-center gap-4 font-mono text-[11px] text-zinc-400">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm bg-[#71717A]" /> Requests
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-[#10B981]" /> Savings
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-[#EF4444]" /> Blocked
              </span>
            </div>
          </div>

          <div className="relative mt-5 w-full overflow-x-auto">
            {hoveredPoint && (
              <div
                className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 whitespace-nowrap rounded-md border border-white/[0.09] bg-[#18181B] px-2.5 py-1.5 font-mono text-[11px] tabular-nums text-zinc-200 shadow-xl"
                style={{
                  left: `${Math.min(84, Math.max(16, hoveredLeftPct))}%`,
                }}
              >
                <span className="font-medium text-[#FAFAFA]">{hoveredPoint.hour} UTC</span>
                <span className="mx-1.5 text-zinc-600">·</span>
                <span>{hoveredPoint.requests} req</span>
                <span className="mx-1.5 text-zinc-600">·</span>
                <span className="text-[#10B981]">+${hoveredPoint.saved_usd.toFixed(4)}</span>
                {hoveredPoint.blocked > 0 && (
                  <>
                    <span className="mx-1.5 text-zinc-600">·</span>
                    <span className="text-[#EF4444]">{hoveredPoint.blocked} blocked</span>
                  </>
                )}
              </div>
            )}

            <svg viewBox="0 0 720 230" className="h-56 w-full min-w-[540px]">
              {/* Horizontal reference lines */}
              {[0.25, 0.5, 0.75, 1].map((step) => {
                const y = 190 - step * 155;
                return (
                  <g key={step}>
                    <line
                      x1="36"
                      y1={y}
                      x2="704"
                      y2={y}
                      stroke="rgba(255,255,255,0.06)"
                      strokeDasharray="2 4"
                      strokeWidth="1"
                    />
                    <text
                      x="30"
                      y={y + 3}
                      textAnchor="end"
                      fill="#71717A"
                      fontSize="10"
                      fontFamily="JetBrains Mono, monospace"
                    >
                      {Math.round(maxRequests * step)}
                    </text>
                  </g>
                );
              })}

              {/* Bars and hover zones */}
              {hourly.map((point, idx) => {
                const slotWidth = 660 / Math.max(1, hourly.length);
                const x = 42 + idx * slotWidth;
                const barW = Math.max(14, slotWidth - 18);
                const barH = (point.requests / maxRequests) * 155;
                const y = 190 - barH;
                const isHovered = hoveredHourIndex === idx;

                return (
                  <g
                    key={point.hour}
                    onMouseEnter={() => setHoveredHourIndex(idx)}
                    onMouseLeave={() => setHoveredHourIndex(null)}
                    className="cursor-pointer"
                  >
                    <rect
                      x={x}
                      y={24}
                      width={slotWidth}
                      height={180}
                      fill={isHovered ? "rgba(255, 255, 255, 0.03)" : "transparent"}
                    />
                    <rect
                      x={x + (slotWidth - barW) / 2 - 4}
                      y={y}
                      width={barW}
                      height={Math.max(2, barH)}
                      rx={3}
                      fill={isHovered ? "#A1A1AA" : "#3F3F46"}
                      fillOpacity={point.requests > 0 ? 1 : 0.35}
                    />
                    {point.blocked > 0 && (
                      <circle
                        cx={x + (slotWidth - barW) / 2 - 4 + barW / 2}
                        cy={Math.max(28, y - 8)}
                        r={3.5}
                        fill="#EF4444"
                      />
                    )}
                    <text
                      x={x + slotWidth / 2 - 4}
                      y={212}
                      textAnchor="middle"
                      fill={isHovered ? "#FAFAFA" : "#71717A"}
                      fontSize="10"
                      fontFamily="JetBrains Mono, monospace"
                    >
                      {point.hour}
                    </text>
                  </g>
                );
              })}

              {/* Savings Trend Polyline */}
              {hourly.length > 1 && (
                <polyline
                  fill="none"
                  stroke="#10B981"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  points={hourly
                    .map((point, idx) => {
                      const slotWidth = 660 / hourly.length;
                      const cx = 42 + idx * slotWidth + slotWidth / 2 - 4;
                      const cy = 190 - (point.saved_usd / maxMoney) * 140;
                      return `${cx},${cy}`;
                    })
                    .join(" ")}
                />
              )}
            </svg>
          </div>
        </div>

        {/* Policy Enforcement Breakdown */}
        <div className="rounded-lg border border-white/[0.07] bg-[#111113] p-5 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]">
          <h2 className="text-sm font-semibold tracking-tight text-[#FAFAFA]">
            Policy Enforcement Breakdown
          </h2>
          <p className="mt-0.5 font-mono text-[11px] text-zinc-500">
            Real-time gateway traffic verdicts
          </p>

          <div className="my-5 flex items-center justify-center">
            <div className="relative flex h-36 w-36 items-center justify-center">
              <svg viewBox="0 0 140 140" className="h-36 w-36 -rotate-90">
                <circle
                  cx="70"
                  cy="70"
                  r={radius}
                  fill="none"
                  stroke="#18181B"
                  strokeWidth="14"
                />
                {distItems.map((item) => {
                  const dashLen = (item.count / distTotal) * circumference;
                  const dashArray = `${dashLen} ${circumference - dashLen}`;
                  const dashOffset = -runningOffset;
                  runningOffset += dashLen;
                  if (item.count === 0) return null;
                  return (
                    <circle
                      key={item.key}
                      cx="70"
                      cy="70"
                      r={radius}
                      fill="none"
                      stroke={item.color}
                      strokeWidth="14"
                      strokeDasharray={dashArray}
                      strokeDashoffset={dashOffset}
                    />
                  );
                })}
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="font-mono text-xl font-semibold tabular-nums text-[#FAFAFA]">
                  {metrics.total_requests}
                </span>
                <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                  Events
                </span>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            {distItems.map((item) => {
              const pct = ((item.count / distTotal) * 100).toFixed(1);
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => onNavigateTraces(item.key)}
                  className="block w-full rounded-md border border-transparent p-1.5 text-left transition-colors hover:border-white/[0.07] hover:bg-[#18181B]"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-2 text-zinc-300">
                      <span className={`h-2 w-2 rounded-full ${item.dotClass}`} />
                      {item.label}
                    </span>
                    <span className="font-mono tabular-nums text-zinc-200">
                      {item.count} <span className="text-zinc-500">({pct}%)</span>
                    </span>
                  </div>
                  <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className={`h-full rounded-full ${item.barClass}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Model FinOps Attribution Table */}
      <section className="overflow-hidden rounded-lg border border-white/[0.07] bg-[#111113] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.07] px-5 py-3.5">
          <h2 className="text-sm font-semibold tracking-tight text-[#FAFAFA]">
            Multi-Model FinOps Cost Attribution
          </h2>
          <span className="font-mono text-[11px] text-zinc-500">
            Aggregated across all active tenants
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-white/[0.07] bg-[#09090B]/40 font-mono text-[11px] uppercase tracking-wider text-zinc-500">
                <th className="px-5 py-3">Model ID</th>
                <th className="px-5 py-3 text-right">Requests</th>
                <th className="px-5 py-3 text-right">Tokens Metered</th>
                <th className="px-5 py-3 text-right">Actual Spend ($ USD)</th>
                <th className="px-5 py-3 text-right">Cache & Firewall Savings</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.05] font-mono">
              {metrics.model_breakdown.map((row) => (
                <tr key={row.model} className="transition-colors hover:bg-[#18181B]/70">
                  <td className="px-5 py-3 font-medium text-[#FAFAFA]">{row.model}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-zinc-300">
                    {row.requests}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums text-zinc-400">
                    {row.tokens_total.toLocaleString()}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums text-zinc-200">
                    ${row.cost_usd.toFixed(6)}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums text-[#10B981]">
                    +${row.saved_usd.toFixed(6)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
